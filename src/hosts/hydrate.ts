import * as P from '@algosail/ply'

import type { Bracket, Host, Hydrating, Mount, Region, Source } from './host.ts'
import { getBackend } from '../backend.ts'
import { buildInside } from './build.ts'
import { CELL_CLOSE, CELL_OPEN, createElement, isText } from './host.ts'

const COMMENT_NODE = 8
const ELEMENT_NODE = 1

function isComment(node: Node): node is Comment {
  return node.nodeType === COMMENT_NODE
}

function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE
}

function detachSiblings(
  parent: Node,
  stop: ChildNode | null,
  from: ChildNode | null,
  accept: (node: ChildNode) => boolean,
): ChildNode | null {
  let node = from
  while (node !== null && node !== stop && accept (node)) {
    const next = node.nextSibling
    parent.removeChild (node)
    node = next
  }
  return node
}

function isFormatting(node: ChildNode): boolean {
  return isText (node) && node.data.trim () === ''
}

const anyNode: (node: ChildNode) => boolean = () => true

function findCellClose(from: ChildNode | null, stop: ChildNode | null): Comment | null {
  let depth = 1
  for (let node = from; node !== null && node !== stop; node = node.nextSibling) {
    if (!isComment (node)) continue
    if (node.data === CELL_OPEN) depth += 1
    else if (node.data === CELL_CLOSE && --depth === 0) return node
  }
  return null
}

function takeText(node: ChildNode | null, stop: ChildNode | null, data: string): Text | null {
  if (node === null || node === stop || !isText (node)) return null
  if (node.data !== data) {
    if (!P.startsWith (data) (node.data)) return null

    const tail = getBackend ().text (node.data.slice (data.length))
    node.parentNode?.insertBefore (tail, node.nextSibling)
    node.data = data
  }
  return node
}

function skipFormatting(host: HydrateHost): void {
  host.cursor = detachSiblings (host.parent, host.stop, host.cursor, isFormatting)
}

function stopHydrating(host: HydrateHost): void {
  host.cursor = detachSiblings (host.parent, host.stop, host.cursor, anyNode)
  host.hydrating = false
}

function insertBeforeStop<N extends Node>(host: HydrateHost, anchor: Node | null, node: N): N {
  host.parent.insertBefore (node, anchor ?? host.stop)
  return node
}

export class HydrateHost implements Host {
  hydrating = true
  parent: Node
  detaches: boolean
  cursor: ChildNode | null
  stop: ChildNode | null

  constructor(
    parent: Node,
    cursor: ChildNode | null,
    stop: ChildNode | null,
    detaches: boolean,
  ) {
    this.parent = parent
    this.cursor = cursor
    this.stop = stop
    this.detaches = detaches
  }

  element(_anchor: Node | null, tag: string, ns: string | null): Element {
    if (this.hydrating) {
      skipFormatting (this)
      const node = this.cursor
      if (
        node !== null && node !== this.stop && isElement (node) &&
        node.localName === tag && (ns === null || node.namespaceURI === ns)
      ) {
        this.cursor = node.nextSibling
        return node
      }
      stopHydrating (this)
    }
    return createElement (tag, ns)
  }

  text(anchor: Node | null, data: string): Text {
    if (this.hydrating) {
      if (data === '') {
        const node = getBackend ().text ('')
        this.parent.insertBefore (node, this.cursor)
        return node
      }
      const node = takeText (this.cursor, this.stop, data)
      if (node !== null) {
        this.cursor = node.nextSibling
        return node
      }
      stopHydrating (this)
    }
    return insertBeforeStop (this, anchor, getBackend ().text (data))
  }

  comment(anchor: Node | null, data: string): Comment {
    if (this.hydrating) {
      skipFormatting (this)
      const node = this.cursor
      if (
        node !== null && node !== this.stop && isComment (node) &&
        node.data === data
      ) {
        this.cursor = node.nextSibling
        return node
      }
      stopHydrating (this)
    }
    return insertBeforeStop (this, anchor, getBackend ().comment (data))
  }

  place(anchor: Node | null, node: Node): Node {
    if (this.hydrating) stopHydrating (this)
    return insertBeforeStop (this, anchor, node)
  }

  descend(element: Element): Host {
    return this.hydrating
      ? hydrateHost (element, element.firstChild, null, false)
      : buildInside (element)
  }

  region(whole: boolean): Region | null {
    if (!this.hydrating) return null
    if (whole) {
      this.cursor = this.stop
      return { parent: this.parent, close: this.stop }
    }
    const close = findCellClose (this.cursor, this.stop)
    if (close === null) {
      stopHydrating (this)
      return null
    }
    this.cursor = close
    return { parent: this.parent, close }
  }

  childSlot(fill: (anchor: Node | null) => Disposable): Disposable {
    if (!this.hydrating) return fill (this.comment (null, ''))
    const handle = fill (null)
    this.comment (null, '')
    return handle
  }

  done(): void {
    this.cursor = detachSiblings (this.parent, this.stop, this.cursor, anyNode)
  }
}

function adopt<V extends Disposable>(
  mount: Mount<V>,
  source: Source<V>,
  parent: Node,
  from: ChildNode | null,
  stop: ChildNode | null,
): Disposable {
  const view = typeof source === 'function' ? source () : source
  const host = hydrateHost (parent, from, stop)
  const handle = mount (host, stop, view)
  host.done ()
  return handle
}

export function hydrateHost(
  parent: Node,
  cursor: ChildNode | null,
  stop: ChildNode | null,
  detaches = true,
): Host {
  return new HydrateHost (parent, cursor, stop, detaches)
}

export function hydrateWith<V extends Disposable>(mount: Mount<V>): Hydrating<V> {
  return {
    hydrate: (parent: Node) => (source: Source<V>): Disposable =>
      adopt (mount, source, parent, parent.firstChild, null),

    hydrateIn: ({ parent, open, close }: Bracket) => (source: Source<V>): Disposable =>
      adopt (mount, source, parent, open.nextSibling, close),
  }
}
