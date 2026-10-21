import { getBackend } from '../backend.ts'
import { removeBetween } from '../close.ts'

export type Mount<V> = (
  host: Host,
  anchor: Node | null,
  child: V,
) => Disposable

export type Source<V> = V | (() => V)

export type Region = {
  readonly parent: Node
  readonly close: ChildNode | null
}

export type Host = {
  readonly hydrating: boolean
  readonly detaches: boolean
  readonly parent: Node | null

  element(anchor: Node | null, tag: string, ns: string | null): Element
  text(anchor: Node | null, data: string): Text
  comment(anchor: Node | null, data: string): Comment
  place(anchor: Node | null, node: Node): Node
  descend(element: Element): Host
  region(whole: boolean): Region | null
  childSlot(fill: (anchor: Node | null) => Disposable): Disposable
  done(): void
}

export type Bracket = {
  readonly parent: Node
  readonly open: ChildNode
  readonly close: ChildNode | null
}

export interface Hydrating<V> {
  readonly hydrate: (parent: Node) => (source: Source<V>) => Disposable
  readonly hydrateIn: (bracket: Bracket) => (source: Source<V>) => Disposable
}

export const CELL_OPEN = '['
export const CELL_CLOSE = ']'

const TEXT_NODE = 3

export function isText(node: Node): node is Text {
  return node.nodeType === TEXT_NODE
}

export function createElement(tag: string, ns: string | null): Element {
  return ns === null
    ? getBackend ().element (tag)
    : getBackend ().elementNS (ns, tag)
}

export function removeRegion(open: ChildNode, region: Region): void {
  removeBetween (open, region.close)
}

export function buildIn(
  host: Host,
  element: Element,
  fill: (inner: Host) => Disposable[],
): { node: Node; disposables: Disposable[]; adopted: boolean } {
  const adopted = host.hydrating
  const inner = host.descend (element)
  let disposables: Disposable[]
  try {
    disposables = fill (inner)
  } finally {
    inner.done ()
  }
  return { node: element, disposables, adopted }
}
