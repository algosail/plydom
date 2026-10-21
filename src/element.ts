import * as S from '@algosail/plystream'

import type { Host } from './hosts/host.ts'
import type {
  Action,
  Child,
  ElementView,
  Merge,
  On,
  Props,
  ViewState,
} from './view.ts'
import { placeChildren } from './child.ts'
import { addDisposable, disposeEach, NOTHING_TO_CLOSE } from './close.ts'
import { buildHost } from './hosts/build.ts'
import { takeChildOutputs } from './output.ts'
import { applyProp } from './props.ts'
import {
  MarkupView,
  MATERIALIZE,
  NO_DISPOSABLES,
  NODE,
  nodeReady,
  waitForNode,
  WHEN_NODE,
} from './view.ts'

export type ElementBuilder = {
  <const Ks extends readonly Child[]>(
    tag: string,
    props?: Props,
    children?: Ks,
  ): ElementView<Merge<Ks>, On<Ks>>
}

const NO_PROPS: Props = Object.freeze ({})
const NO_CHILDREN: readonly Child[] = Object.freeze ([])

class Elem extends MarkupView {
  name: string
  ns: string | null
  props: Props
  children: readonly Child[]
  node: Node | null = null
  disposables: Disposable[] = NO_DISPOSABLES
  adopted = false
  waiting: ((node: Node) => void)[] | null = null
  acts: Action[] | null = null

  constructor(
    name: string,
    ns: string | null,
    props: Props,
    children: readonly Child[],
  ) {
    super ()
    this.name = name
    this.ns = ns
    this.props = props
    this.children = children
  }

  act(action: Action): this {
    const node = this.node
    if (node === null) {
      const queued = this.acts ?? (this.acts = [])
      queued.push (action)
      return this
    }
    const handle = action (node as Element)
    if (handle !== NOTHING_TO_CLOSE) {
      if (this.disposables === NO_DISPOSABLES) this.disposables = [handle]
      else this.disposables.push (handle)
    }
    return this
  }

  [MATERIALIZE](host: Host, anchor: Node | null): ViewState {
    if (this.node !== null) return this as unknown as ViewState
    const element = host.element (anchor, this.name, this.ns)
    const adopted = host.hydrating
    const acted = runActs (this, element)
    const inner = host.descend (element)
    try {
      this.disposables = keptAfter (
        acted,
        buildElement (inner, element, this.props, this.children),
      )
    } catch (err) {
      disposeEach (acted)
      throw err
    } finally {
      inner.done ()
    }
    this.adopted = adopted
    this.node = element
    this.props = NO_PROPS
    this.children = NO_CHILDREN
    nodeReady (this, element)
    return this as unknown as ViewState
  }

  [WHEN_NODE](f: (node: Node) => void): Disposable {
    const had = this.node
    if (had !== null) {
      f (had)
      return S.disposeNone ()
    }
    return waitForNode (this, f)
  }

  get [NODE](): Node {
    const had = this.node
    return had !== null ? had : this[MATERIALIZE] (buildHost (null), null).node
  }

  [Symbol.dispose](): void {
    if (this.node === null) return
    disposeEach (this.disposables)
    this.disposables = NO_DISPOSABLES
  }
}

function runActs(view: Elem, element: Element): Disposable[] {
  let acted: Disposable[] | null = null
  try {
    while (view.acts !== null) {
      const queued = view.acts
      view.acts = null
      for (const action of queued) {
        acted = addDisposable (acted, action (element))
      }
    }
  } catch (err) {
    if (acted !== null) disposeEach (acted)
    view.acts = null
    throw err
  }
  return acted ?? NO_DISPOSABLES
}

function keptAfter(acted: Disposable[], filled: Disposable[]): Disposable[] {
  if (acted === NO_DISPOSABLES) return filled
  if (filled === NO_DISPOSABLES) return acted
  return acted.concat (filled)
}

function buildElement(
  host: Host,
  element: Element,
  props: Props,
  children: readonly Child[],
): Disposable[] {
  let made: Disposable[] | null = null
  try {
    const adopted = host.hydrating
    for (const name in props) {
      made = addDisposable (made, applyProp (element, name, props[name], adopted))
    }
    made = placeChildren (host, children, made)
    return made ?? NO_DISPOSABLES
  } catch (err) {
    if (made !== null) disposeEach (made)
    throw err
  }
}

export function elementIn(ns: string | null): ElementBuilder {
  return (<const Ks extends readonly Child[]>(
    tag: string,
    props: Props = NO_PROPS,
    children: Ks = NO_CHILDREN as unknown as Ks,
  ) => {
    const kids = children as readonly Child[]
    return takeChildOutputs (new Elem (tag, ns, props, kids), kids) as ElementView<
      Merge<Ks>,
      On<Ks>
    >
  }) as ElementBuilder
}
