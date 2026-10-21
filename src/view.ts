import type * as P from '@algosail/ply'
import * as S from '@algosail/plystream'

import type { Host } from './hosts/host.ts'
import type { Giving, KeepGiven, None, Outs } from './output.ts'
import { disposeEach } from './close.ts'
import { buildHost } from './hosts/build.ts'
import { applyUse, ON, OUT, setGiven } from './output.ts'

export const NODE: unique symbol = Symbol ('node')
export const MATERIALIZE = Symbol ('materialize')
export const WHEN_NODE = Symbol ('whenNode')

export type ViewState = {
  node: Node
  disposables: Disposable[]
  adopted: boolean
}

export interface View extends Disposable {
  tag: 'view'
  readonly [NODE]: Node
  readonly [MATERIALIZE]: (host: Host, anchor: Node | null) => ViewState
  readonly [WHEN_NODE]: (f: (node: Node) => void) => Disposable
}

export type Child =
  | string
  | number
  | View
  | Child[]
  | S.Source<Child>
  | P.Just<Child>
  | P.Nothing<Child>
  | null
  | undefined

export type Props = Readonly<P.StrMap<unknown>>

export interface Drawn<Exposed extends Outs = None, Askable extends Outs = Exposed>
  extends View {
  readonly [OUT]: Exposed
  readonly [ON]: Askable
  use<N extends Record<string, string>>(
    spec: N,
  ): KeepGiven<this, Drawn<
    Exposed & { readonly [K in keyof N]: S.Stream<Event> },
    Askable & { readonly [K in keyof N]: S.Stream<Event> }
  >>
  output<G extends Outs>(given: G): this & Giving<G>
}

export type Action = (node: Element) => Disposable

export interface ElementView<Exposed extends Outs = None, Askable extends Outs = Exposed>
  extends Drawn<Exposed, Askable> {
  act(action: Action): this
  use<N extends Record<string, string>>(spec: N): KeepGiven<
    this,
    ElementView<
      Exposed & { readonly [K in keyof N]: S.Stream<Event> },
      Askable & { readonly [K in keyof N]: S.Stream<Event> }
    >
  >
}

type OutOf<K> = K extends { readonly [OUT]: infer Exposed extends Outs } ? Exposed : None

type OnOf<K> = K extends { readonly [ON]: infer Askable extends Outs } ? Askable
  : OutOf<K>

type AllOf<U> = (U extends unknown ? (x: U) => void : never) extends
  (x: infer I) => void ? I : never

export type Merge<Ks extends readonly unknown[]> =
  AllOf<OutOf<Ks[number]>> extends infer R extends Outs ? R : None

export type On<Ks extends readonly unknown[]> = AllOf<OnOf<Ks[number]>> extends
  infer R extends Outs ? R : None

export type Waiting = { waiting: ((node: Node) => void)[] | null }

export const NO_DISPOSABLES: Disposable[] = []

export class MarkupView {
  tag: 'view' = 'view'

  use(spec: Record<string, string>): this {
    return applyUse (this, spec, (_name, type) => [
      eventsOf (this as unknown as View, type),
      { type, view: this as unknown as View },
    ])
  }

  output<G extends Outs>(given: G): this & Giving<G> {
    return setGiven (this, given)
  }
}

export class ExistingView extends MarkupView {
  state: ViewState

  constructor(state: ViewState) {
    super ()
    this.state = state
  }

  [MATERIALIZE](): ViewState {
    return this.state
  }

  [WHEN_NODE](f: (node: Node) => void): Disposable {
    f (this.state.node)
    return S.disposeNone ()
  }

  get [NODE](): Node {
    return this.state.node
  }

  [Symbol.dispose](): void {
    release (this.state)
  }
}

class LazyView extends MarkupView {
  build: (host: Host, anchor: Node | null) => ViewState
  state: ViewState | null = null
  waiting: ((node: Node) => void)[] | null = null

  constructor(build: (host: Host, anchor: Node | null) => ViewState) {
    super ()
    this.build = build
  }

  [MATERIALIZE](host: Host, anchor: Node | null): ViewState {
    if (this.state === null) {
      const state = this.build (host, anchor)
      this.state = state
      nodeReady (this, state.node)
    }
    return this.state
  }

  [WHEN_NODE](f: (node: Node) => void): Disposable {
    const state = this.state
    if (state !== null) {
      f (state.node)
      return S.disposeNone ()
    }
    return waitForNode (this, f)
  }

  get [NODE](): Node {
    const state = this.state
    return state !== null
      ? state.node
      : this[MATERIALIZE] (buildHost (null), null).node
  }

  [Symbol.dispose](): void {
    const state = this.state
    if (state !== null) release (state)
  }
}

class WrappedView extends MarkupView {
  extra: Disposable
  inner: View

  constructor(extra: Disposable, inner: View) {
    super ()
    this.extra = extra
    this.inner = inner
  }

  [MATERIALIZE](host: Host, anchor: Node | null): ViewState {
    return materialize (this.inner, host, anchor)
  }

  [WHEN_NODE](f: (node: Node) => void): Disposable {
    return onNode (this.inner, f)
  }

  get [NODE](): Node {
    return this.inner[NODE]
  }

  [Symbol.dispose](): void {
    S.dispose (this.extra)
    S.dispose (this.inner)
  }
}

function release(state: ViewState): void {
  disposeEach (state.disposables)
  state.disposables = NO_DISPOSABLES
}

export function materialize(
  view: View,
  host: Host,
  anchor: Node | null,
): ViewState {
  return view[MATERIALIZE] (host, anchor)
}

export function onNode(view: View, f: (node: Node) => void): Disposable {
  return view[WHEN_NODE] (f)
}

export function waitForNode(pending: Waiting, hear: (node: Node) => void): Disposable {
  const asked = pending.waiting ?? (pending.waiting = [])
  asked.push (hear)
  return S.disposable (() => {
    const index = asked.indexOf (hear)
    if (index >= 0) asked.splice (index, 1)
  })
}

export function nodeReady(pending: Waiting, node: Node): void {
  const asked = pending.waiting
  pending.waiting = null
  if (asked !== null) {
    for (const hear of asked) hear (node)
  }
}

export function eventsOf<E extends Event = Event>(
  view: View,
  type: string,
  options?: AddEventListenerOptions | boolean,
): S.Stream<E> {
  return S.stream<E> ((sink, scheduler) => {
    let node: Node | null = null
    let listener: ((event: Event) => void) | null = null

    const waiting = onNode (view, (ready: Node) => {
      const hear = (event: Event): void => {
        sink.event (scheduler.currentTime (), event as E)
      }
      node = ready
      listener = hear
      ready.addEventListener (type, hear, options)
    })

    return S.disposable (() => {
      S.dispose (waiting)
      if (node !== null && listener !== null) {
        node.removeEventListener (type, listener, options)
        node = null
        listener = null
      }
    })
  })
}

export function lazyView(
  build: (host: Host, anchor: Node | null) => ViewState,
): Drawn {
  return new LazyView (build) as unknown as Drawn
}

export function isView(value: unknown): value is View {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tag' in value &&
    value.tag === 'view' &&
    NODE in value
  )
}

export function wrapView(extra: Disposable, view: View): View {
  return new WrappedView (extra, view)
}
