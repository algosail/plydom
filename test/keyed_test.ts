import * as S from '@algosail/plystream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { View } from '../src/view.ts'
import * as H from '../src/h.ts'
import { DuplicateKey, keyedOn } from '../src/keyed.ts'
import { component, node, OUT, view } from '../src/mod.ts'
import { installDom } from './test_util.ts'

const dom = installDom ()

type Item = { readonly id: string; readonly n: number }

const tracked = (shut: string[], name: string): View =>
  view (
    dom.document.createElement ('li'),
    [S.disposable (() => shut.push (name))],
  )

const source = <A>(
  initial: readonly A[],
): [S.HeldStream<readonly A[]>, (xs: readonly A[]) => void] => {
  const [pushes, push] = S.bus<readonly A[]> ()
  return [S.holdWith<readonly A[]> (initial) (pushes), push]
}

const collect = (b: S.Stream<View[]>): [View[][], Disposable] => {
  const seen: View[][] = []
  return [seen, S.subscribe ((_t: S.Time, vs: View[]) => seen.push (vs)) (b)]
}

const keepers: Record<
  string,
  (b: S.Source<readonly Item[]>) => S.Stream<View[]>
> = {
  'by value': (b) => keyedOn ((i: Item) => i.id) (() => tracked ([], 'row')) (b),
}

test ('keyedOn: each reading builds its own views', () => {
  const builders: Record<
    string,
    (b: S.Source<readonly string[]>) => S.Stream<View[]>
  > = {
    'by value': (b) => keyedOn ((s: string) => s) (() => tracked ([], 'row')) (b),
    'by place': (b) =>
      keyedOn ((_s: string, i: number) => i) (() => tracked ([], 'row')) (b),
  }

  for (const [name, make] of Object.entries (builders)) {
    const [items] = source (['a'])
    const list = make (items)
    const [first] = collect (list)
    const [second] = collect (list)
    assert.deepStrictEqual (first[0][0] === second[0][0], false, name)
  }
})

test ('keyedOn: disposing the reading builds nothing further', () => {
  let built = 0
  const [items, push] = source<string> (['a'])
  const [, reading] = collect (
    keyedOn ((s: string) => s) ((
      _one,
      key: string,
    ) => (built += 1, tracked ([], key))) (items),
  )
  const before = built
  S.dispose (reading)
  push (['a', 'b', 'c'])
  assert.deepStrictEqual (built, before)
})

test ('keyedOn: a late reader receives the list held now', () => {
  const [items] = source (['a', 'b'])
  const list = keyedOn ((s: string) => s) (() => tracked ([], 'row')) (items)
  const [seen] = collect (list)
  assert.deepStrictEqual (seen.map ((vs) => vs.length), [2])
})

test ('keyedOn: a push with no reader is not delivered later', () => {
  const [items, push] = source<string> ([])
  const list = keyedOn ((s: string) => s) (() => tracked ([], 'row')) (items)
  push (['a', 'b'])
  const [seen] = collect (list)
  assert.deepStrictEqual (seen.map ((vs) => vs.length), [0])
})

test ('keyedOn: a reorder keeps the same views', () => {
  const a = { id: 'a', n: 1 }
  const b = { id: 'b', n: 2 }
  const [items, push] = source ([a, b])
  const [seen] = collect (
    keyedOn ((i: Item) => i.id) ((_one, key: string) => tracked ([], key)) (items),
  )
  push ([b, a])
  assert.deepStrictEqual (seen[1][0] === seen[0][1], true)
  assert.deepStrictEqual (seen[1][1] === seen[0][0], true)
})

test ('keyedOn: a key that left is disposed', () => {
  const shut: string[] = []
  const [items, push] = source ([{ id: 'a', n: 1 }, { id: 'b', n: 1 }])
  collect (
    keyedOn ((i: Item) => i.id) ((_one, key: string) => tracked (shut, key)) (
      items,
    ),
  )
  push ([{ id: 'b', n: 1 }])
  assert.deepStrictEqual (shut, ['a'])
})

test ('keyedOn: the node stays and the value arrives by stream', () => {
  const said: number[] = []
  const [items, push] = source ([{ id: 'a', n: 1 }])
  const [seen] = collect (
    keyedOn ((i: Item) => i.id) ((row: S.HeldStream<Item>) => {
      S.subscribe ((_t: S.Time, i: Item) => said.push (i.n)) (row)
      return tracked ([], 'row')
    }) (items),
  )
  push ([{ id: 'a', n: 2 }])
  assert.deepStrictEqual ([seen.length, said], [1, [1, 2]])
})

test ('keyedOn: a row answers the moment it is read', () => {
  const read: number[] = []
  const [items] = source ([{ id: 'a', n: 7 }])
  collect (
    keyedOn ((i: Item) => i.id) ((row: S.HeldStream<Item>) => {
      S.subscribe ((_t: S.Time, i: Item) => read.push (i.n)) (row)
      return tracked ([], 'row')
    }) (items),
  )
  assert.deepStrictEqual (read, [7])
})

test ('keyedOn: closing the reading stops the rows as well', () => {
  const said: number[] = []
  const [items, push] = source ([{ id: 'a', n: 1 }])
  const [, reading] = collect (
    keyedOn ((i: Item) => i.id) ((row: S.HeldStream<Item>) => {
      S.subscribe ((_t: S.Time, i: Item) => said.push (i.n)) (row)
      return tracked ([], 'row')
    }) (items),
  )
  push ([{ id: 'a', n: 2 }])
  const before = [...said]
  S.dispose (reading)
  push ([{ id: 'a', n: 3 }])
  assert.deepStrictEqual ([before, said], [[1, 2], [1, 2]])
})

test ('keyedOn: the key is handed to the renderer', () => {
  const keys: string[] = []
  const [items] = source ([{ id: 'a', n: 1 }, { id: 'b', n: 1 }])
  collect (
    keyedOn ((i: Item) => i.id) ((_row, key: string) => {
      keys.push (key)
      return tracked ([], key)
    }) (items),
  )
  assert.deepStrictEqual (keys, ['a', 'b'])
})

test ('keyedOn: only a departed key is disposed', () => {
  const shut: string[] = []
  const [items, push] = source ([{ id: 'a', n: 1 }, { id: 'b', n: 1 }])
  collect (
    keyedOn ((i: Item) => i.id) ((_row, key: string) => tracked (shut, key)) (
      items,
    ),
  )
  push ([{ id: 'a', n: 99 }])
  assert.deepStrictEqual (shut, ['b'])
})

test ('keyedOn: disposing a long list does not recurse', () => {
  const N = 5000
  const many = (tag: string) =>
    Array.from ({ length: N }, (_, i) => ({ id: `${i}`, n: i, label: tag }))

  const builders: Record<
    string,
    (b: S.Source<readonly Item[]>) => S.Stream<View[]>
  > = {
    'by value': (b) => keyedOn ((i: Item) => i.id) (() => tracked ([], 'row')) (b),
    'by place': (b) =>
      keyedOn ((_i: Item, n: number) => n) (() => tracked ([], 'row')) (b),
  }

  for (const [name, make] of Object.entries (builders)) {
    const [items, push] = source (many ('a'))
    const [seen, reading] = collect (make (items))
    push (many ('b'))
    push (many ('a').reverse ())
    assert.deepStrictEqual (seen[seen.length - 1].length, N, name)
    S.dispose (reading)
  }
})

test ('keyedOn: the emitted view is the view the row returned', () => {
  const [items] = source ([{ id: 'a', n: 1 }])
  const [seen] = collect (
    keyedOn ((i: Item) => i.id) ((_one, key: string) => tracked ([], key)) (items),
  )
  assert.deepStrictEqual ((node (seen[0][0]) as Element).localName, 'li')
})

test ('keyedOn: pushing the same array emits nothing further', () => {
  for (const [name, make] of Object.entries (keepers)) {
    const start = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]
    const [items, push] = source (start)
    const [seen] = collect (make (items))
    push (start)
    assert.deepStrictEqual (seen.length, 1, name)
  }
})

test ('keyedOn: a new array of the same items emits nothing further', () => {
  for (const [name, make] of Object.entries (keepers)) {
    const a = { id: 'a', n: 1 }, b = { id: 'b', n: 2 }
    const [items, push] = source ([a, b])
    const [seen] = collect (make (items))
    push ([a, b])
    push ([{ id: 'a', n: 1 }, { id: 'b', n: 2 }])
    assert.deepStrictEqual (seen.length, 1, name)
  }
})

test ('keyedOn: a reorder emits the same views in the new order', () => {
  for (const [name, make] of Object.entries (keepers)) {
    const a = { id: 'a', n: 1 }, b = { id: 'b', n: 2 }
    const [items, push] = source ([a, b])
    const [seen] = collect (make (items))
    push ([b, a])
    assert.deepStrictEqual (seen.length, 2, name)
    assert.deepStrictEqual (seen[1][0] === seen[0][1], true, name)
  }
})

test ('keyedOn: two items with one key throw DuplicateKey', () => {
  for (const make of Object.values (keepers)) {
    const [items, push] = source ([{ id: 'a', n: 1 }])
    collect (make (items))
    assert.throws (
      () => push ([{ id: 'a', n: 1 }, { id: 'a', n: 2 }]),
      (error: unknown) => error instanceof DuplicateKey && error.message.includes ('a'),
    )
  }
})

test ('keyedOn: a duplicate key emits nothing, and the next good list does', () => {
  for (const [name, make] of Object.entries (keepers)) {
    const [items, push] = source ([{ id: 'a', n: 1 }])
    const [seen] = collect (make (items))
    assert.throws (
      () => push ([{ id: 'b', n: 1 }, { id: 'b', n: 2 }]),
      DuplicateKey,
    )
    assert.deepStrictEqual (seen.length, 1, name)
    push ([{ id: 'c', n: 1 }])
    assert.deepStrictEqual ([seen.length, seen[1].length], [2, 1], name)
  }
})

test ('keyedOn: a component row keeps the output the row gave', () => {
  type Picked = { readonly [OUT]: { readonly picked: S.Stream<Event> } }
  const Row = component (
    (props: { said: string }, on: { picked: S.Stream<Event> }) =>
      H.li ({}, [props.said]).use ({ picked: 'click' })
        .output ({ picked: on.picked }),
  )

  const [items, push] = S.bus<readonly string[]> ()
  const said: string[] = []
  const listen = (rows: readonly Picked[]) =>
    S.mergeArray (rows.map ((r) => r[OUT].picked))

  const built: Picked[][] = []
  S.subscribe ((_t: S.Time, rows: readonly Picked[]) => {
    built.push ([...rows])
  }) (
    keyedOn ((s: string) => s) ((_one: S.HeldStream<string>, key: string) =>
      Row ({ said: key }).use ({ picked: 'picked' }),
    ) (items),
  )

  push (['one', 'two'])
  assert.deepStrictEqual (built.length, 1)
  const heard = S.subscribe ((_t: S.Time, e: Event) =>
    said.push ((e.target as unknown as { textContent: string }).textContent),
  ) (listen (built[0]))
  for (const row of built[0]) {
    (node (row as unknown as View) as unknown as EventTarget).dispatchEvent (
      new dom.Event ('click', { bubbles: true }),
    )
  }
  assert.deepStrictEqual (said, ['one', 'two'])
  S.dispose (heard)
})

test ('keyedOn: an index key renders repeated values in place', () => {
  const [items, push] = source (['a', 'a', 'a'])
  const said: string[][] = []
  const [seen] = collect (
    keyedOn ((_s: string, i: number) => i) ((one: S.HeldStream<string>, key) => {
      const mine: string[] = []
      said[key] = mine
      S.subscribe ((_t: S.Time, s: string) => mine.push (s)) (one)
      return tracked ([], String (key))
    }) (items),
  )
  assert.deepStrictEqual (seen[0].length, 3)
  push (['b', 'a', 'a'])
  assert.deepStrictEqual (seen.length, 1)
  assert.deepStrictEqual (said, [['a', 'b'], ['a'], ['a']])
})
