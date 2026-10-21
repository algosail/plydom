import * as S from '@algosail/plystream'

import type { Host } from './hosts/host.ts'
import type { None, ON, OUT, OutputSink, Outs } from './output.ts'
import type { Child, View, ViewState } from './view.ts'
import { buildChildren, cellView } from './child.ts'
import { disposeEach } from './close.ts'
import { buildHost } from './hosts/build.ts'
import { buildIn } from './hosts/host.ts'
import {
  applyUse,
  givenOf,
  NO_EVENT_ROUTE,
  NoSuchPart,
  providersOf,
  subscribeTo,
} from './output.ts'
import {
  isView,
  lazyView,
  MATERIALIZE,
  materialize,
  NODE,
  nodeReady,
  onNode,
  waitForNode,
  WHEN_NODE,
} from './view.ts'

type Relay = readonly [
  S.Source<unknown>,
  (stream: S.Source<unknown>) => Disposable,
]

export type Made<G extends Outs, Let extends Outs = None> =
  & View
  & {
    readonly [OUT]: Let
    readonly [ON]: Let
    use<N extends Record<string, keyof G & string>>(
      spec: N,
    ): Made<G, Let & { readonly [K in keyof N]: G[N[K]] }>
  }

export type Start = <D extends Disposable>(d: D) => D

export type Setup<Pr> = (
  props: Pr,
  on: Record<string, S.Source<unknown>>,
  start: Start,
) => View | S.Source<Child>

const readInput: ProxyHandler<Record<string, Relay>> = {
  get: (inputs, name) =>
    typeof name === 'string'
      ? (inputs[name] ??= S.relayed<unknown> ())[0]
      : undefined,
}

const ENDED: S.Stream<unknown> = S.stream<unknown> ((sink, scheduler) => {
  sink.end (scheduler.currentTime ())
  return S.disposeNone ()
})

function missingPart(name: string): NoSuchPart {
  return new NoSuchPart (`nothing is given under ${JSON.stringify (name)}`)
}

function carriesOutputs(value: unknown): value is S.Source<Child> {
  return providersOf (value) !== undefined
}

function spanAround(children: S.Source<Child>): View {
  return lazyView ((host, anchor) => {
    const wrapper = host.element (anchor, 'span', null)
    ;(wrapper as HTMLElement).style.display = 'contents'
    return buildIn (host, wrapper, (inner) => buildChildren (inner, [children]))
  })
}

export class ComponentView<Pr> {
  tag: 'view' = 'view'

  setup: Setup<Pr>
  props: Pr
  inner: View | null = null
  inputs: Record<string, Relay> | null = null
  taken: Record<string, Relay> | null = null
  published: Record<string, S.Source<unknown>> | null = null
  wires: Disposable[] | null = null
  started: Disposable[] | null = null
  waiting: ((node: Node) => void)[] | null = null

  constructor(setup: Setup<Pr>, props: Pr) {
    this.setup = setup
    this.props = props
  }

  use(spec: Record<string, string>): this {
    return applyUse (this, spec, (_name, part) => [this.take (part), NO_EVENT_ROUTE])
  }

  take(name: string): S.Source<unknown> {
    const taken = this.taken ?? (this.taken = {})
    const had = taken[name]
    if (had !== undefined) return had[0]
    const published = this.published
    const stream = published === null ? undefined : published[name]
    if (published !== null && stream === undefined) throw missingPart (name)
    const relay = taken[name] = S.relayed<unknown> ()
    if (stream !== undefined) this.keepWire (relay[1] (stream))
    return relay[0]
  }

  keepWire(handle: Disposable): void {
    (this.wires ?? (this.wires = [])).push (handle)
  }

  buildInner(): View {
    const inputs: Record<string, Relay> = {}
    this.inputs = inputs
    const start: Start = (handle) => {
      (this.started ?? (this.started = [])).push (handle)
      return handle
    }
    try {
      const on = new Proxy (inputs, readInput) as unknown as Record<
        string,
        S.Source<unknown>
      >
      const drawn = this.setup (this.props, on, start)
      this.keepWire (subscribeTo (drawn, Object.keys (inputs), new ConnectInputs (inputs)))
      const given = givenOf (drawn)
      const taken = this.taken
      if (taken !== null) {
        for (const name of Object.keys (taken)) {
          const stream = given[name]
          if (stream === undefined) throw missingPart (name)
          this.keepWire (taken[name][1] (stream))
        }
      }
      this.published = given
      const inner = isView (drawn)
        ? drawn
        : carriesOutputs (drawn)
        ? cellView (drawn)
        : spanAround (drawn)
      this.inner = inner
      return inner
    } catch (err) {
      this.release ()
      throw err
    }
  }

  [MATERIALIZE](host: Host, anchor: Node | null): ViewState {
    const inner = this.inner ?? this.buildInner ()
    let made: ViewState
    try {
      made = materialize (inner, host, anchor)
    } catch (err) {
      this.release ()
      throw err
    }
    nodeReady (this, made.node)
    return made
  }

  [WHEN_NODE](f: (node: Node) => void): Disposable {
    const inner = this.inner
    if (inner !== null) return onNode (inner, f)
    return waitForNode (this, f)
  }

  get [NODE](): Node {
    const inner = this.inner
    return inner !== null
      ? inner[NODE]
      : this[MATERIALIZE] (buildHost (null), null).node
  }

  release(): void {
    const started = this.started
    this.started = null
    if (started !== null) disposeEach (started)
    const wires = this.wires
    this.wires = null
    if (wires !== null) disposeEach (wires)
    for (const relays of [this.inputs, this.taken]) {
      if (relays === null) continue
      for (const name of Object.keys (relays)) S.dispose (relays[name][1] (ENDED))
    }
  }

  [Symbol.dispose](): void {
    this.release ()
    const inner = this.inner
    if (inner !== null) S.dispose (inner)
  }
}

class ConnectInputs implements OutputSink {
  inputs: Record<string, Relay>

  constructor(inputs: Record<string, Relay>) {
    this.inputs = inputs
  }

  accept(name: string, source: S.Source<unknown>): Disposable {
    return this.inputs[name][1] (source)
  }
}
