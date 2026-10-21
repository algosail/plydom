/** Where elements, text, and comments are created. */
export interface Backend {
  /** An element in the HTML namespace. */
  element(tag: string): Element
  /** An element in `ns`, such as SVG. */
  elementNS(ns: string, tag: string): Element
  /** A text node. */
  text(data: string): Text
  /** A comment node. */
  comment(data: string): Comment
}

const domBackend: Backend = {
  element: (tag) => document.createElement (tag),
  elementNS: (ns, tag) => document.createElementNS (ns, tag),
  text: (data) => document.createTextNode (data),
  comment: (data) => document.createComment (data),
}

let backend = domBackend

/** Install `next` and return the backend it replaced. */
export function setBackend(next: Backend): Backend {
  const prev = backend
  backend = next
  return prev
}

/**
 * The backend currently in use.
 * @example
 * ```ts
 * import * as D from '@algosail/plydom'
 *
 * typeof D.getBackend ().element // => 'function'
 * ```
 */
export function getBackend(): Backend {
  return backend
}
