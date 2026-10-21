import type { Host, Region } from './host.ts'
import { getBackend } from '../backend.ts'
import { createElement } from './host.ts'

export class BuildHost implements Host {
  readonly hydrating = false
  parent: Node | null
  detaches: boolean
  private rootDetaches: boolean
  private parents: (Node | null)[] | null = null

  constructor(parent: Node | null, detaches: boolean) {
    this.parent = parent
    this.detaches = detaches
    this.rootDetaches = detaches
  }

  element(_anchor: Node | null, tag: string, ns: string | null): Element {
    return createElement (tag, ns)
  }

  text(anchor: Node | null, data: string): Text {
    const node = getBackend ().text (data)
    this.parent?.insertBefore (node, anchor)
    return node
  }

  comment(anchor: Node | null, data: string): Comment {
    const node = getBackend ().comment (data)
    this.parent?.insertBefore (node, anchor)
    return node
  }

  place(anchor: Node | null, node: Node): Node {
    this.parent?.insertBefore (node, anchor)
    return node
  }

  descend(element: Element): Host {
    const parents = this.parents ?? (this.parents = [])
    parents.push (this.parent)
    this.parent = element
    this.detaches = false
    return this
  }

  region(): Region | null {
    return null
  }

  childSlot(fill: (anchor: Node | null) => Disposable): Disposable {
    return fill (this.comment (null, ''))
  }

  done(): void {
    const parents = this.parents
    if (parents === null || parents.length === 0) return
    this.parent = parents.pop () as Node | null
    this.detaches = parents.length === 0 ? this.rootDetaches : false
  }
}

export function buildHost(parent: Node | null): Host {
  return new BuildHost (parent, true)
}

export function buildInside(parent: Node): Host {
  return new BuildHost (parent, false)
}
