import type { Action, ElementView } from './view.ts'

/**
 * Runs `action` once the element has a node. The element comes last.
 * @example
 * ```ts
 * D.act ((node) => {
 *   node.setAttribute ('lang', 'ja')
 *   return S.disposeNone ()
 * }) (H.input ())
 * ```
 */
export function act(action: Action) {
  return <E extends ElementView>(element: E): E => element.act (action)
}
