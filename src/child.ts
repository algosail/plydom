import * as P from '@algosail/ply'
import * as S from '@algosail/plystream'

import type { Host, Region } from './hosts/host.ts'
import type { Place } from './list.ts'
import type { Child, View } from './view.ts'
import { getBackend } from './backend.ts'
import {
  addDisposable,
  disposeEach,
  isNil,
  joinDisposables,
  NOTHING_TO_CLOSE,
  removeIfPresent,
  removeRange,
} from './close.ts'
import { buildHost, buildInside } from './hosts/build.ts'
import { CELL_CLOSE, CELL_OPEN, isText } from './hosts/host.ts'
import { hydrateHost } from './hosts/hydrate.ts'
import { patchViews } from './list.ts'
import { isView, lazyView, materialize, NO_DISPOSABLES } from './view.ts'

const NO_VIEWS: View[] = []

class Cell implements S.Sink<Child>, Disposable {
  parent: Node | null
  detaches: boolean
  open: ChildNode | null
  close: ChildNode | null
  place: Place | null = null
  region: Region | null
  contents: Disposable = NOTHING_TO_CLOSE
  views: View[] = NO_VIEWS
  patchable = false
  subscription: Disposable = NOTHING_TO_CLOSE

  constructor(host: Host, anchor: Node | null, fillsParent: boolean) {
    this.parent = host.parent
    this.detaches = host.detaches
    this.open = fillsParent ? null : host.comment (anchor, CELL_OPEN)
    this.region = host.region (fillsParent)
    this.close = fillsParent ? null : host.comment (anchor, CELL_CLOSE)
  }

  event(_time: S.Time, value: Child): void {
    if (this.region !== null) {
      this.replace (value)
      return
    }
    if (this.writeText (value)) return
    if (this.moveViews (value)) return
    this.replace (value)
  }

  end(_time: S.Time): void {}

  [Symbol.dispose](): void {
    S.dispose (this.contents)
    const parent = this.parent
    if (this.detaches && parent !== null) {
      const open = this.open
      const close = this.close
      removeRange (parent, open, close)
      if (open !== null) removeIfPresent (parent, open)
      if (close !== null) removeIfPresent (parent, close)
    }
    disposeEach (this.views)
    S.dispose (this.subscription)
  }

  writeText(value: Child): boolean {
    if (typeof value !== 'string' && typeof value !== 'number') return false
    const parent = this.parent
    const open = this.open
    const close = this.close
    const text = String (value)
    const first = open === null ? parent?.firstChild ?? null : open.nextSibling
    if (
      this.views.length === 0 &&
      first !== null &&
      first.nextSibling === close &&
      isText (first)
    ) {
      if (first.data !== text) first.data = text
      return true
    }
    S.dispose (this.contents)
    if (parent !== null) removeRange (parent, open, close)
    disposeEach (this.views)
    this.views = NO_VIEWS
    this.patchable = false
    const node = getBackend ().text (text)
    parent?.insertBefore (node, close)
    return true
  }

  moveViews(value: Child): boolean {
    const place = this.place
    if (!this.patchable || place === null || !isViewList (value)) return false
    if (patchViews (place, this.views, value, (anchor, view) => {
      mountChild (place.host, anchor, view)
    })) this.views = value.slice ()
    return true
  }

  replace(value: Child): void {
    S.dispose (this.contents)
    this.contents = NOTHING_TO_CLOSE
    const parent = this.parent
    if (this.region === null && parent !== null) {
      removeRange (parent, this.open, this.close)
    }

    const claimed = this.region
    this.region = null
    const next: View[] = []
    const place = this.place ?? (this.place = {
      host: parent === null ? buildHost (null) : buildInside (parent),
      open: this.open,
      close: this.close,
    })
    this.contents = showChild (place, claimed, value, next)
    disposeEach (viewsLeft (this.views, next))
    this.views = next.length === 0 ? NO_VIEWS : next
    this.patchable = parent !== null && isViewList (value)
  }
}

function isMaybeChild(value: unknown): value is P.Maybe<Child> {
  return P.isMaybe (value)
}

function isEmpty(child: Child): boolean {
  return isNil (child) || (isMaybeChild (child) && P.maybe_ (() => true) (isEmpty) (child))
}

function needsSlot(child: Child): boolean {
  return Array.isArray (child) || isMaybeChild (child)
}

function isViewList(value: Child): value is View[] {
  if (!Array.isArray (value)) return false
  for (let index = 0; index < value.length; index++) {
    const item = value[index]
    if (item === null || item === undefined) return false
    if ((item as { tag?: unknown }).tag !== 'view') return false
  }
  return true
}

function viewsLeft(was: readonly View[], now: readonly View[]): View[] {
  const kept = new Set<View> (now)
  const left: View[] = []
  for (const view of was) {
    if (!kept.has (view)) left.push (view)
  }
  return left
}

function mountEach(
  host: Host,
  children: readonly Child[],
  held: Disposable[] | null,
): Disposable[] | null {
  let list = held
  try {
    for (const child of children) {
      list = addDisposable (
        list,
        needsSlot (child)
          ? host.childSlot ((anchor) => mountChild (host, anchor, child))
          : mountChild (host, null, child),
      )
    }
    return list
  } catch (err) {
    if (held === null && list !== null) disposeEach (list)
    throw err
  }
}

function showChild(
  place: Place,
  region: Region | null,
  value: Child,
  into: View[],
): Disposable {
  if (isEmpty (value)) {
    if (region !== null) removeRange (region.parent, place.open, region.close)
    return NOTHING_TO_CLOSE
  }
  if (region === null) return mountChild (place.host, place.close, value, into)
  const cursor = place.open === null
    ? region.parent.firstChild
    : place.open.nextSibling
  const hydrating = hydrateHost (
    region.parent,
    cursor,
    region.close,
    place.host.detaches,
  )
  const handle = mountChild (hydrating, place.close, value, into)
  hydrating.done ()
  return handle
}

function openCell(
  host: Host,
  anchor: Node | null,
  source: S.Source<Child>,
  fillsParent: boolean,
): Cell {
  const cell = new Cell (host, anchor, fillsParent)
  cell.subscription = source.run (cell, S.defaultScheduler ())
  const region = cell.region
  if (region !== null) {
    removeRange (region.parent, cell.open, region.close)
    cell.region = null
  }
  return cell
}

export function mountChild(
  host: Host,
  anchor: Node | null,
  child: Child,
  collect: View[] | null = null,
): Disposable {
  const parent = host.parent

  if (typeof child === 'string' || typeof child === 'number') {
    const text = host.text (anchor, String (child))
    if (!host.detaches) return S.disposeNone ()
    return S.disposable (() => removeIfPresent (parent, text))
  }

  if (Array.isArray (child)) {
    let list: Disposable[] | null = null
    try {
      for (const item of child) {
        list = addDisposable (list, mountChild (host, anchor, item, collect))
      }
    } catch (err) {
      if (list !== null) disposeEach (list)
      throw err
    }
    return joinDisposables (list)
  }

  if (isView (child)) {
    const state = materialize (child, host, anchor)
    if (state.adopted) state.adopted = false
    else host.place (anchor, state.node)

    if (collect !== null) collect.push (child)

    if (!host.detaches) return collect === null ? child : S.disposeNone ()

    return S.disposable (() => {
      if (collect === null) S.dispose (child)
      removeIfPresent (parent, state.node)
    })
  }

  if (S.isSource (child)) return openCell (host, anchor, child, false)

  if (isMaybeChild (child)) {
    return P.maybe_ (() => NOTHING_TO_CLOSE) ((inner: Child) =>
      mountChild (host, anchor, inner, collect),
    ) (child)
  }

  const _exhaustive: null | undefined = child
  return S.disposeNone ()
}

export function buildChildren(
  host: Host,
  children: readonly Child[],
): Disposable[] {
  return mountEach (host, children, null) ?? NO_DISPOSABLES
}

export function cellView(source: S.Source<Child>): View {
  return lazyView ((host, anchor) => {
    const cell = openCell (host, anchor, source, false)
    return { node: cell.open as ChildNode, disposables: [cell], adopted: true }
  })
}

export function placeChildren(
  host: Host,
  children: readonly Child[],
  held: Disposable[] | null,
): Disposable[] | null {
  if (children.length === 1 && S.isSource (children[0])) {
    return addDisposable (
      held,
      openCell (host, null, children[0] as S.Source<Child>, true),
    )
  }
  return mountEach (host, children, held)
}
