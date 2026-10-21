import * as P from '@algosail/ply'
import * as S from '@algosail/plystream'
import type { View } from './view.ts'

type Cached<V extends View> = { view: V; seen: number }

type Kept<A, K, V extends View, E extends Cached<V>> = {
  cache: Map<K, E>
  views: V[]
  from: readonly A[]
  gen: number
}

type Rows<A, K, V extends View, E extends Cached<V>> = {
  readonly build: (item: A, key: K) => E
  readonly renew: (entry: E, item: A, key: K) => void
}

export class DuplicateKey extends Error {}

const UNSEEN: readonly never[] = []

function keeping<A, K, V extends View, E extends Cached<V>>(
  keyFn: (a: A, i: number) => K,
  rows: Rows<A, K, V, E>,
): (items: S.Source<readonly A[]>) => S.Stream<V[]> {
  const step = (
    prev: Kept<A, K, V, E> | null,
    arr: readonly A[],
  ): Kept<A, K, V, E> => {
    const state: Kept<A, K, V, E> = prev ??
      { cache: new Map<K, E> (), views: [], from: UNSEEN, gen: 0 }
    if (arr === state.from) return state

    const cache = state.cache
    const was = cache.size
    const gen = state.gen += 1
    const shown = state.views
    let views: V[] | null = arr.length === shown.length ? null : []
    let matched = 0

    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      const key = keyFn (item, i)
      let entry = cache.get (key)
      if (entry === undefined) {
        entry = rows.build (item, key)
        cache.set (key, entry)
      } else if (entry.seen === gen) {
        throw new DuplicateKey (`two elements share the key ${String (key)}`)
      } else {
        matched += 1
        rows.renew (entry, item, key)
      }
      entry.seen = gen
      const view = entry.view
      if (views !== null) views.push (view)
      else if (view !== shown[i]) {
        views = shown.slice (0, i)
        views.push (view)
      }
    }

    if (matched < was) {
      for (const key of cache.keys ()) {
        const entry = cache.get (key) as E
        if (entry.seen !== gen) {
          S.dispose (entry.view)
          cache.delete (key)
        }
      }
    }

    state.from = arr
    if (views !== null) state.views = views
    return state
  }

  const sameArray = (a: V[], b: V[]): boolean => a === b
  const viewsOf = (kept: Kept<A, K, V, E> | null): V[] =>
    kept === null ? [] : kept.views

  return (items: S.Source<readonly A[]>) =>
    S.skipRepeats (sameArray) (
      P.map (viewsOf) (
        S.scan<Kept<A, K, V, E> | null, readonly A[]> (step, null) (items),
      ),
    )
}

export function keyedOn<A, K>(
  keyFn: (a: A, i: number) => K,
): <V extends View>(
  renderFn: (a: S.HeldStream<A>, key: K) => V,
) => (items: S.Source<readonly A[]>) => S.Stream<V[]> {
  return <V extends View>(renderFn: (a: S.HeldStream<A>, key: K) => V) => {
    type Entry = Cached<V> & { last: A; readonly post: (a: A) => void }
    return keeping<A, K, V, Entry> (keyFn, {
      build: (item: A, key: K): Entry => {
        const [value, post] = S.state<A> (item)
        return {
          view: renderFn (value, key),
          last: item,
          seen: 0,
          post,
        }
      },
      renew: (entry: Entry, item: A): void => {
        if (entry.last === item) return
        entry.last = item
        entry.post (item)
      },
    })
  }
}
