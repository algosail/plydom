import * as S from '@algosail/plystream'

import type { Host } from './hosts/host.ts'
import type { View } from './view.ts'
import { disposeEach, removeIfPresent, removeRange } from './close.ts'
import { NODE } from './view.ts'

export type Place = {
  readonly host: Host
  readonly open: ChildNode | null
  readonly close: ChildNode | null
}

function nodeOf(view: View): Node {
  return view[NODE]
}

function shiftedRight(
  was: readonly View[],
  now: readonly View[],
  from: number,
  count: number,
): boolean {
  for (let step = 0; step < count; step++) {
    if (now[from + step + 1] !== was[from + step]) return false
  }
  return true
}

function shiftedLeft(
  was: readonly View[],
  now: readonly View[],
  from: number,
  count: number,
): boolean {
  for (let step = 0; step < count; step++) {
    if (now[from + step] !== was[from + step + 1]) return false
  }
  return true
}

function middleStayed(
  was: readonly View[],
  now: readonly View[],
  from: number,
  to: number,
): boolean {
  for (let index = from + 1; index < to; index++) {
    if (now[index] !== was[index]) return false
  }
  return true
}

function alreadyInOrder(places: readonly number[]): Uint8Array {
  const piles: number[] = []
  const before = new Int32Array (places.length)
  const stay = new Uint8Array (places.length)

  for (let index = 0; index < places.length; index++) {
    const place = places[index]
    if (place < 0) continue
    let low = 0
    let high = piles.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (places[piles[mid]] < place) low = mid + 1
      else high = mid
    }
    if (low > 0) before[index] = piles[low - 1] + 1
    piles[low] = index
  }

  let at = piles.length > 0 ? piles[piles.length - 1] + 1 : 0
  while (at > 0) {
    stay[at - 1] = 1
    at = before[at - 1]
  }
  return stay
}

export function patchViews(
  place: Place,
  was: readonly View[],
  now: readonly View[],
  insert: (anchor: Node | null, view: View) => void,
): boolean {
  const parent = place.host.parent as Node

  let head = 0
  while (head < was.length && head < now.length && was[head] === now[head]) {
    head += 1
  }
  let oldTail = was.length - 1
  let newTail = now.length - 1
  while (oldTail >= head && newTail >= head && was[oldTail] === now[newTail]) {
    oldTail -= 1
    newTail -= 1
  }

  if (head > oldTail && head > newTail) return false

  if (now.length === 0) {
    removeRange (parent, place.open, place.close)
    disposeEach (was)
    return true
  }

  const after: Node | null = oldTail + 1 < was.length
    ? nodeOf (was[oldTail + 1])
    : place.close

  const oldCount = oldTail - head + 1
  if (oldCount === newTail - head + 1) {
    const oldLastIsNewFirst = now[head] === was[oldTail]
    const oldFirstIsNewLast = now[newTail] === was[head]

    if (
      oldLastIsNewFirst &&
      oldFirstIsNewLast &&
      middleStayed (was, now, head, newTail)
    ) {
      parent.insertBefore (nodeOf (now[newTail]), after)
      if (oldCount > 2) {
        parent.insertBefore (nodeOf (now[head]), nodeOf (now[head + 1]))
      }
      return true
    }
    if (oldLastIsNewFirst && shiftedRight (was, now, head, oldCount - 1)) {
      parent.insertBefore (nodeOf (now[head]), nodeOf (now[head + 1]))
      return true
    }
    if (oldFirstIsNewLast && shiftedLeft (was, now, head, oldCount - 1)) {
      parent.insertBefore (nodeOf (now[newTail]), after)
      return true
    }
  }

  const from = new Map<View, number> ()
  for (let index = head; index <= oldTail; index++) from.set (was[index], index)

  const places: number[] = []
  for (let index = head; index <= newTail; index++) {
    const oldIndex = from.get (now[index])
    places.push (oldIndex === undefined ? -1 : oldIndex)
    from.delete (now[index])
  }

  for (const view of from.keys ()) {
    removeIfPresent (parent, nodeOf (view))
    S.dispose (view)
  }

  const stay = alreadyInOrder (places)
  let anchor: Node | null = after
  for (let index = places.length - 1; index >= 0; index--) {
    const view = now[head + index]
    if (stay[index] === 1) {
      anchor = nodeOf (view)
      continue
    }
    if (places[index] < 0) {
      insert (anchor, view)
      anchor = nodeOf (view)
    } else {
      const node = nodeOf (view)
      parent.insertBefore (node, anchor)
      anchor = node
    }
  }

  return true
}
