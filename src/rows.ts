import * as S from '@algosail/plystream'

import type {
  Giving,
  KeepGiven,
  None,
  ON,
  OutputSink,
  OutputSource,
  Outs,
  Route,
  Routes,
} from './output.ts'
import type { View } from './view.ts'
import { disposeEach, joinDisposables, NOTHING_TO_CLOSE } from './close.ts'
import { keyedOn } from './keyed.ts'
import {
  applyUse,
  AskedTooLate,
  NO_EVENT_ROUTE,
  OUT,
  outsOf,
  PROVIDERS,
  ROUTES,
  routesOf,
  setGiven,
  subscribeToProviders,
  takeChildOutputs,
} from './output.ts'
import { onNode, wrapView } from './view.ts'

type StreamValue<X> = X extends S.Source<infer A> ? A : never

export type Tagged<O extends Outs, K> = {
  readonly [N in keyof O]: S.Stream<readonly [K, StreamValue<O[N]>]>
}

export type Listed<T extends S.Source<View[]>, O extends Outs, K, Let extends Outs = None> =
  & T
  & {
    readonly [OUT]: Let
    readonly [ON]: Tagged<O, K> & Let
    use<Self, N extends Record<string, keyof O & string>>(
      this: Self,
      spec: N,
    ): KeepGiven<Self, Listed<T, O, K, Let & Tagged<{ readonly [X in keyof N]: O[N[X]] }, K>>>
    output<Self, G extends Outs>(this: Self, given: G): Self & Giving<G>
  }

type RowList = S.Source<View[]> & {
  registry: RowRegistry<unknown>
  [OUT]?: Record<string, S.Source<unknown>>
  [ROUTES]: Routes
}

const NO_NAMES: readonly string[] = Object.freeze ([])

const bubblingTypeCache = new Map<string, readonly string[] | null> ()

const BUBBLING_EVENTS = new Set ([
  'click',
  'auxclick',
  'dblclick',
  'contextmenu',
  'mousedown',
  'mouseup',
  'mousemove',
  'mouseover',
  'mouseout',
  'wheel',
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointerover',
  'pointerout',
  'pointercancel',
  'touchstart',
  'touchend',
  'touchmove',
  'touchcancel',
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'change',
  'submit',
  'reset',
  'select',
  'focusin',
  'focusout',
  'copy',
  'cut',
  'paste',
  'dragstart',
  'drag',
  'dragenter',
  'dragover',
  'dragleave',
  'drop',
  'dragend',
  'animationstart',
  'animationend',
  'animationiteration',
  'transitionrun',
  'transitionstart',
  'transitionend',
  'transitioncancel',
])

class HeldRowList extends S.Held<View[]> implements RowList {
  views: S.Stream<View[]>
  registry: RowRegistry<unknown>
  declare [ROUTES]: Routes

  constructor(views: S.Stream<View[]>, registry: RowRegistry<unknown>) {
    super ()
    this.views = views
    this.registry = registry
    this[ROUTES] = { [PROVIDERS]: [registry] }
  }

  use(spec: Record<string, string>): this {
    return exposeList (this, spec)
  }

  output<G extends Outs>(given: G): this & Giving<G> {
    return setGiven (this, given)
  }

  override run(
    sink: S.Sink<View[]>,
    scheduler: S.Scheduler = S.defaultScheduler (),
  ): Disposable {
    return this.views.run (sink, scheduler)
  }
}

class PlainRowList extends S.Plain<View[]> implements RowList {
  views: S.Stream<View[]>
  registry: RowRegistry<unknown>
  declare [ROUTES]: Routes

  constructor(views: S.Stream<View[]>, registry: RowRegistry<unknown>) {
    super ()
    this.views = views
    this.registry = registry
    this[ROUTES] = { [PROVIDERS]: [registry] }
  }

  use(spec: Record<string, string>): this {
    return exposeList (this, spec)
  }

  output<G extends Outs>(given: G): this & Giving<G> {
    return setGiven (this, given)
  }

  override run(
    sink: S.Sink<View[]>,
    scheduler: S.Scheduler = S.defaultScheduler (),
  ): Disposable {
    return this.views.run (sink, scheduler)
  }
}

class RowRegistry<K> implements OutputSource {
  liveOutputs: LiveOutputs<K> | null = null
  exposed: Set<string> | null = null
  rowsBuilt = false

  subscribe(names: readonly string[], sink: OutputSink): Disposable {
    let held: Disposable[] | null = null
    for (const name of names) {
      if (this.exposed?.has (name)) continue
      ;(held ??= []).push (sink.accept (name, this.channel (name).events))
    }
    return joinDisposables (held)
  }

  channel(sourceName: string): OutputChannel<K> {
    const outputs = this.liveFor (sourceName)
    const had = outputs.byName.get (sourceName)
    if (had !== undefined) return had
    if (this.rowsBuilt) throw askedTooLate (sourceName)
    return outputs.openChannel (sourceName)
  }

  liveFor(name: string): LiveOutputs<K> {
    const had = this.liveOutputs
    if (had !== null) return had
    if (this.rowsBuilt) throw askedTooLate (name)
    return this.liveOutputs = new LiveOutputs<K> ()
  }

  addRow(key: K, view: View): View {
    this.rowsBuilt = true
    const outputs = this.liveOutputs
    return outputs === null ? view : outputs.add (key, view)
  }
}

class LiveOutputs<K> {
  channels: OutputChannel<K>[] = []
  byName = new Map<string, OutputChannel<K>> ()
  sourceNames: readonly string[] = NO_NAMES
  rows = new Set<LiveRow<K>> ()
  keyByNode = new WeakMap<Node, K> ()
  markByNode = new WeakMap<Node, Record<string, string | string[]>> ()

  openChannel(sourceName: string): OutputChannel<K> {
    const had = this.byName.get (sourceName)
    if (had !== undefined) return had
    const made = new OutputChannel (this, sourceName, this.channels.length)
    this.channels.push (made)
    this.byName.set (sourceName, made)
    this.sourceNames = [...this.sourceNames, sourceName]
    const asked = [sourceName]
    for (const row of this.rows) row.askChildren (asked)
    return made
  }

  add(key: K, view: View): View {
    const row = new LiveRow (this, key, view)
    this.rows.add (row)
    row.untilNode = onNode (view, (node: Node) => row.rememberNode (node))
    if (this.sourceNames.length > 0) row.askChildren (this.sourceNames)
    for (const channel of this.channels) {
      if (channel.emit !== null) channel.startRow (row)
    }
    return takeChildOutputs (wrapView (row, view), [view])
  }

  hasMark(node: Node, type: string, name: string): boolean {
    const here = this.markByNode.get (node)?.[type]
    return here === name || (Array.isArray (here) && here.includes (name))
  }

  addMark(node: Node, type: string, name: string): void {
    const had = this.markByNode.get (node)
    if (had === undefined) {
      this.markByNode.set (node, { [type]: name })
      return
    }
    const was = had[type]
    had[type] = was === undefined
      ? name
      : typeof was === 'string'
      ? [was, name]
      : (was.push (name), was)
  }
}

class LiveRow<K> implements OutputSink {
  outputs: LiveOutputs<K>
  key: K
  view: View
  fromChildren: Disposable = NOTHING_TO_CLOSE
  feeds: RowFeed<K> | null = null
  listeners: (Disposable | undefined)[]
  node: Node | null = null
  untilNode: Disposable = NOTHING_TO_CLOSE

  constructor(outputs: LiveOutputs<K>, key: K, view: View) {
    this.outputs = outputs
    this.key = key
    this.view = view
    this.listeners = new Array (outputs.channels.length)
  }

  rememberNode(node: Node): void {
    this.node = node
    this.outputs.keyByNode.set (node, this.key)
    for (const channel of this.outputs.channels) channel.onRowNode (this)
  }

  askChildren(names: readonly string[]): void {
    const heard = subscribeToProviders (this.view, names, this)
    if (heard === NOTHING_TO_CLOSE) return
    this.fromChildren = this.fromChildren === NOTHING_TO_CLOSE
      ? heard
      : joinDisposables ([this.fromChildren, heard])
  }

  accept(name: string, source: S.Source<unknown>): Disposable {
    const channel = this.outputs.byName.get (name)
    if (channel === undefined) return NOTHING_TO_CLOSE
    const feed = new RowFeed (this, channel, source)
    feed.next = this.feeds
    this.feeds = feed
    if (this.listeners[channel.index] !== undefined) feed.start ()
    return feed
  }

  drop(gone: RowFeed<K>): void {
    if (this.feeds === gone) {
      this.feeds = gone.next
      return
    }
    for (let one = this.feeds; one !== null; one = one.next) {
      if (one.next === gone) {
        one.next = gone.next
        return
      }
    }
  }

  [Symbol.dispose](): void {
    S.dispose (this.untilNode)
    S.dispose (this.fromChildren)
    this.outputs.rows.delete (this)
    for (const channel of this.outputs.channels) channel.stopRow (this)
  }
}

class RowFeed<K> implements S.Sink<unknown> {
  row: LiveRow<K>
  channel: OutputChannel<K>
  source: S.Source<unknown>
  reading: Disposable = NOTHING_TO_CLOSE
  next: RowFeed<K> | null = null

  constructor(row: LiveRow<K>, channel: OutputChannel<K>, source: S.Source<unknown>) {
    this.row = row
    this.channel = channel
    this.source = source
  }

  start(): void {
    if (this.reading === NOTHING_TO_CLOSE) {
      this.reading = this.source.run (this, S.defaultScheduler ())
    }
  }

  stop(): void {
    S.dispose (this.reading)
    this.reading = NOTHING_TO_CLOSE
  }

  event(_time: S.Time, value: unknown): void {
    this.channel.emit?. ([this.row.key, value])
  }

  end(): void {}

  [Symbol.dispose](): void {
    this.stop ()
    this.row.drop (this)
  }
}

class OutputChannel<K> implements EventListenerObject {
  outputs: LiveOutputs<K>
  sourceName: string
  index: number
  emit: ((said: readonly [K, unknown]) => void) | null = null
  events: S.Stream<unknown>

  constructor(outputs: LiveOutputs<K>, sourceName: string, index: number) {
    this.outputs = outputs
    this.sourceName = sourceName
    this.index = index
    this.events = S.multicast (S.stream<unknown> ((sink, scheduler) => {
      this.emit = (said: readonly [K, unknown]) =>
        sink.event (scheduler.currentTime (), said)
      for (const row of this.outputs.rows) this.startRow (row)
      return S.disposable (() => {
        this.emit = null
        for (const row of this.outputs.rows) this.stopRow (row)
      })
    }))
  }

  startRow(row: LiveRow<K>): void {
    if (row.listeners[this.index] !== undefined) return
    row.listeners[this.index] = this.listenTo (row)
    for (let one = row.feeds; one !== null; one = one.next) {
      if (one.channel === this) one.start ()
    }
  }

  stopRow(row: LiveRow<K>): void {
    const had = row.listeners[this.index]
    if (had === undefined) return
    row.listeners[this.index] = undefined
    S.dispose (had)
    for (let one = row.feeds; one !== null; one = one.next) {
      if (one.channel === this) one.stop ()
    }
  }

  listenTo(row: LiveRow<K>): Disposable {
    const routes = routesOf (row.view)[this.sourceName]
    const types = bubblingTypes (routes)
    if (types === null || routes === undefined) {
      const source = outsOf (row.view)[this.sourceName]
      return source === undefined ? NOTHING_TO_CLOSE : this.readSource (row, source)
    }
    return this.listenAtRoot (row, routes, types)
  }

  readSource(row: LiveRow<K>, source: S.Source<unknown>): Disposable {
    return S.subscribe ((_t: S.Time, value: unknown) =>
      this.emit?. ([row.key, value]),
    ) (source)
  }

  listenAtRoot(
    row: LiveRow<K>,
    routes: readonly Route[],
    types: readonly string[],
  ): Disposable {
    const node = row.node
    if (node === null) return NOTHING_TO_CLOSE
    let watches: Disposable[] | null = null
    for (const route of routes) {
      if (route.view === null) continue
      const waiting = onNode (
        route.view,
        (node: Node) => this.outputs.addMark (node, route.type, this.sourceName),
      )
      if (waiting !== NOTHING_TO_CLOSE) (watches ??= []).push (waiting)
    }
    for (const type of types) node.addEventListener (type, this)
    return new BubbleBinding (this, row, watches)
  }

  onRowNode(row: LiveRow<K>): void {
    const had = row.listeners[this.index]
    if (had === undefined) return
    const routes = routesOf (row.view)[this.sourceName]
    const types = bubblingTypes (routes)
    if (types === null || routes === undefined) return
    row.listeners[this.index] = this.listenAtRoot (row, routes, types)
  }

  handleEvent(event: Event): void {
    const emit = this.emit
    if (emit === null) return
    let node: Node | null = event.target as Node | null
    let matched = false
    while (node !== null) {
      if (!matched) matched = this.outputs.hasMark (node, event.type, this.sourceName)
      const key = this.outputs.keyByNode.get (node)
      if (key !== undefined) {
        if (matched && node.parentNode !== null) emit ([key, event])
        return
      }
      node = node.parentNode
    }
  }
}

class BubbleBinding<K> {
  channel: OutputChannel<K>
  row: LiveRow<K>
  watches: Disposable[] | null

  constructor(channel: OutputChannel<K>, row: LiveRow<K>, watches: Disposable[] | null) {
    this.channel = channel
    this.row = row
    this.watches = watches
  }

  [Symbol.dispose](): void {
    if (this.watches !== null) disposeEach (this.watches)
    const channel = this.channel
    const node = this.row.node as Node
    const types = bubblingTypes (routesOf (this.row.view)[channel.sourceName]) ?? NO_NAMES
    for (const type of types) node.removeEventListener (type, channel)
  }
}

function exposeList<L extends RowList>(list: L, spec: Record<string, string>): L {
  const registry = list.registry
  const exposed = registry.exposed ?? (registry.exposed = new Set ())
  return applyUse (list, spec, (name, sourceName) => {
    exposed.add (name)
    return [registry.channel (sourceName).events, NO_EVENT_ROUTE]
  })
}

function askedTooLate(name: string): AskedTooLate {
  return new AskedTooLate (
    `a list was asked for ${JSON.stringify (name)} after its rows were built`,
  )
}

function bubblingTypes(routes: readonly Route[] | undefined): readonly string[] | null {
  if (routes === undefined) return null
  if (routes.length === 1) return oneBubblingType (routes[0].type)
  const types: string[] = []
  for (const route of routes) {
    if (!BUBBLING_EVENTS.has (route.type)) return null
    if (!types.includes (route.type)) types.push (route.type)
  }
  return types.length === 0 ? null : types
}

function oneBubblingType(type: string): readonly string[] | null {
  const known = bubblingTypeCache.get (type)
  if (known !== undefined) return known
  const made = BUBBLING_EVENTS.has (type) ? [type] : null
  bubblingTypeCache.set (type, made)
  return made
}

export function listRows<A, K>(
  keyOf: (item: A, index: number) => K,
  render: (entry: S.HeldStream<A>, key: K) => View,
  items: S.Source<readonly A[]>,
): S.Source<View[]> {
  const registry = new RowRegistry<K> ()
  const views = keyedOn (keyOf) (
    (entry: S.HeldStream<A>, key: K) => registry.addRow (key, render (entry, key)),
  ) (items)
  const shared = registry as RowRegistry<unknown>
  return S.isHeld (items)
    ? new HeldRowList (views, shared)
    : new PlainRowList (views, shared)
}
