import * as S from '@algosail/plystream'

export type Nil<A> = A | null | undefined

export const isNil = <A>(x: Nil<A>): x is null | undefined =>
  x === null || x === undefined

export const isNotNil = <A>(x: Nil<A>): x is A => !isNil (x)

export const NOTHING_TO_CLOSE: Disposable = S.disposeNone ()

export function concatDisposables(first: Disposable, second: Disposable): Disposable {
  return S.disposable (() => {
    S.dispose (first)
    S.dispose (second)
  })
}

export function disposeEach(disposables: readonly Disposable[]): void {
  for (const disposable of disposables) S.dispose (disposable)
}

export function joinDisposables(disposables: readonly Disposable[] | null): Disposable {
  if (disposables === null) return NOTHING_TO_CLOSE
  return disposables.length === 1
    ? disposables[0]
    : S.disposable (() => disposeEach (disposables))
}

export function addDisposable(
  list: Disposable[] | null,
  disposable: Disposable,
): Disposable[] | null {
  if (disposable === NOTHING_TO_CLOSE) return list
  if (list === null) return [disposable]
  list.push (disposable)
  return list
}

export function removeIfPresent(parent: Node | null, child: Node): void {
  if (isNotNil (parent) && child.parentNode === parent) {
    parent.removeChild (child)
  }
}

export function removeRange(
  parent: Node,
  open: ChildNode | null,
  close: ChildNode | null,
): void {
  const first = open === null ? parent.firstChild : open.nextSibling
  if (first === null || first === close) return

  if (first.nextSibling === close) {
    parent.removeChild (first)
    return
  }
  if (open === null && close === null) {
    parent.textContent = ''
    return
  }

  const doc = parent.ownerDocument
  if (doc !== null && typeof doc.createRange === 'function') {
    const range = doc.createRange ()
    if (open === null) range.setStart (parent, 0)
    else range.setStartAfter (open)
    if (close === null) range.selectNodeContents (parent)
    else range.setEndBefore (close)
    if (open !== null) range.setStartAfter (open)
    range.deleteContents ()
    return
  }

  let node: ChildNode | null = first
  while (node !== null && node !== close) {
    const next: ChildNode | null = node.nextSibling
    parent.removeChild (node)
    node = next
  }
}

export function removeBetween(
  open: ChildNode,
  close: ChildNode | null,
): void {
  const parent = open.parentNode
  if (parent !== null) removeRange (parent, open, close)
}
