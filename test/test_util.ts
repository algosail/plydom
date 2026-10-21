/**
 * A DOM for the tests.
 */

import { Window } from 'happy-dom'
import { setBackend } from '../src/backend.ts'

/**
 * A window, plus the two things a test needs from it most.
 */
export type TestDom = {
  /**
   * The document every node in the test comes from.
   */
  readonly document: Document
  /**
   * The window's own `Event`, the only kind its targets accept.
   */
  readonly Event: typeof Event
  /**
   * A fresh detached element to mount into.
   */
  readonly box: () => HTMLElement
  /**
   * Text content with the marker comments left out.
   */
  readonly text: (n: Node) => string
}

/**
 * Build a document and point the package's backend at it.
 */
export function installDom(): TestDom {
  const win = new Window ()
  const document = win.document as unknown as Document
  setBackend ({
    element: (tag) => document.createElement (tag),
    elementNS: (ns, tag) => document.createElementNS (ns, tag),
    text: (data) => document.createTextNode (data),
    comment: (data) => document.createComment (data),
  })
  return {
    document,
    Event: win.Event as unknown as typeof Event,
    box: () => document.createElement ('div'),
    text: (n) => n.textContent ?? '',
  }
}
