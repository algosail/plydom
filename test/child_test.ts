import * as P from '@algosail/ply'
import * as S from '@algosail/plystream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Child, View } from '../src/view.ts'
import { mountChild } from '../src/child.ts'
import * as H from '../src/h.ts'
import { buildHost } from '../src/hosts/build.ts'
import * as D from '../src/mod.ts'
import { view } from '../src/mod.ts'
import { installDom } from './test_util.ts'

const dom = installDom ()

const put = (child: Child): [HTMLElement, Disposable] => {
  const parent = dom.box ()
  return [parent, mountChild (buildHost (parent), null, child)]
}

const counting = (parent: HTMLElement) => {
  const tally = { put: 0, took: 0 }
  const insert = parent.insertBefore.bind (parent)
  const drop = parent.removeChild.bind (parent)
  parent.insertBefore = (<T extends Node>(n: T, a: Node | null): T => {
    tally.put += 1
    return insert (n, a)
  }) as typeof parent.insertBefore
  parent.removeChild = (<T extends Node>(n: T): T => {
    tally.took += 1
    return drop (n)
  }) as typeof parent.removeChild
  return tally
}

const rows = (names: readonly string[], shut: string[] = []): View[] =>
  names.map ((n) =>
    view (
      Object.assign (dom.document.createElement ('b'), { textContent: n }),
      [S.disposable (() => shut.push (n))],
    ),
  )

const listing = (start: View[]): [HTMLElement, (vs: View[]) => void] => {
  const [values, push] = S.bus<Child> ()
  const [parent] = put (S.holdWith<Child> (start) (values))
  return [parent, (vs: View[]) => push (vs)]
}

let owned = 0

const Owning = D.component ((_p: void, _on: D.None, start: D.Start) => {
  owned += 1
  start (S.disposable (() => owned -= 1))
  return H.p (['a'])
})

const boom = (): Child =>
  P.map ((): Child => {
    throw new Error ('boom')
  }) (S.holdWith (0) (S.never<number> ())) as Child

const throwsOn = (child: Child): void => {
  assert.throws (
    () => put (child),
    (error: unknown) => error instanceof Error && error.message.includes ('boom'),
  )
}

test ('mountChild: a string becomes a text node', () => {
  const [parent] = put ('Ada')
  assert.deepStrictEqual (dom.text (parent), 'Ada')
})

test ('mountChild: a number becomes text too', () => {
  const [parent] = put (42)
  assert.deepStrictEqual (dom.text (parent), '42')
})

test ('mountChild: null and undefined take no room', () => {
  assert.deepStrictEqual (put (null)[0].childNodes.length, 0)
  assert.deepStrictEqual (put (undefined)[0].childNodes.length, 0)
})

test ('mountChild: an array mounts every item in order', () => {
  const [parent] = put (['one', 'two', 'three'])
  assert.deepStrictEqual (dom.text (parent), 'onetwothree')
})

test ('mountChild: a nested tree leaves whole', () => {
  const parent = dom.box ()
  const dsp = mountChild (
    buildHost (parent),
    null,
    view (dom.document.createElement ('section')) as Child,
  )
  const deep = H.section ({}, [
    H.p ({}, ['one', H.span ({}, ['two', H.small ({}, ['three'])])]),
  ])
  const inner = mountChild (buildHost (parent), null, deep as Child)
  assert.deepStrictEqual (dom.text (parent).includes ('three'), true)
  S.dispose (inner)
  S.dispose (dsp)
  assert.deepStrictEqual ([parent.childNodes.length, dom.text (parent)], [0, ''])
})

test ('mountChild: a cell still takes its own contents out', () => {
  const [values, push] = S.bus<Child> ()
  const inside = H.p ({}, [S.holdWith<Child> ('first') (values)])
  const parent = dom.box ()
  mountChild (buildHost (parent), null, inside as Child)
  assert.deepStrictEqual (dom.text (parent), 'first')
  push ('second')
  assert.deepStrictEqual (dom.text (parent), 'second')
  push (null)
  assert.deepStrictEqual (dom.text (parent), '')
})

test ('mountChild: a long list comes apart without recursing', () => {
  const parent = dom.box ()
  const many = Array.from ({ length: 20000 }, (_, i) => String (i))
  const dsp = mountChild (buildHost (parent), null, many)
  assert.deepStrictEqual (parent.childNodes.length, 20000)
  S.dispose (dsp)
  assert.deepStrictEqual (parent.childNodes.length, 0)
})

test ('mountChild: arrays nest', () => {
  const [parent] = put (['a', ['b', ['c']]])
  assert.deepStrictEqual (dom.text (parent), 'abc')
})

test ('mountChild: a view puts its node in place', () => {
  const element = dom.document.createElement ('span')
  const [parent] = put (view (element))
  assert.deepStrictEqual (parent.firstChild, element)
})

test ('mountChild: disposing takes the node back out', () => {
  const [parent, dsp] = put (view (dom.document.createElement ('span')))
  S.dispose (dsp)
  assert.deepStrictEqual (parent.childNodes.length, 0)
})

test ('mountChild: Just mounts what is inside it', () => {
  const [parent] = put (P.just ('inside') as Child)
  assert.deepStrictEqual (dom.text (parent), 'inside')
})

test ('mountChild: Nothing takes no room', () => {
  const [parent] = put (P.nothing<Child> () as Child)
  assert.deepStrictEqual (parent.childNodes.length, 0)
})

test ('mountChild: a Just of nothing is still nothing', () => {
  const [parent] = put (P.just (null) as Child)
  assert.deepStrictEqual (parent.childNodes.length, 0)
})

test ('mountChild: a stream becomes a cell that follows it', () => {
  const [values, push] = S.bus<Child> ()
  const [parent] = put (S.holdWith<Child> ('first') (values))
  assert.deepStrictEqual (dom.text (parent), 'first')
  push ('second')
  assert.deepStrictEqual (dom.text (parent), 'second')
})

test ('mountChild: a view handed to the tree is closed by the tree', () => {
  let shut = 0
  const placed = view (dom.document.createElement ('b'), [
    S.disposable (() => shut += 1),
  ])
  const [, dsp] = put (placed)
  S.dispose (dsp)
  assert.deepStrictEqual (shut, 1)
})

test ('mountChild: a stream handed to the tree outlives the cell', () => {
  const [pushes, push] = S.bus<Child> ()
  const source = S.holdWith<Child> ('one') (pushes)
  const [, dsp] = put (source)
  push ('two')
  S.dispose (dsp)

  const seen: Child[] = []
  S.subscribe ((_t: S.Time, c: Child) => seen.push (c)) (source)
  assert.deepStrictEqual (seen, ['two'])
})

test ('mountChild: a cell going empty leaves nothing behind', () => {
  const [values, push] = S.bus<Child> ()
  const [parent] = put (S.holdWith<Child> ('here') (values))
  push (null)
  assert.deepStrictEqual (dom.text (parent), '')
})

test ('mountChild: a cell brackets its contents with markers', () => {
  const [parent] = put (S.holdWith<Child> ('x') (S.never<Child> ()))
  const comments = [...parent.childNodes].filter ((n) => n.nodeType === 8)
  assert.deepStrictEqual (comments.map ((n) => (n as Comment).data), ['[', ']'])
})

test ('mountChild: disposing a cell removes its markers', () => {
  const [parent, dsp] = put (S.holdWith<Child> ('x') (S.never<Child> ()))
  S.dispose (dsp)
  assert.deepStrictEqual (parent.childNodes.length, 0)
})

test ('mountChild: a cell handed the same views leaves them alone', () => {
  const kept = view (dom.document.createElement ('b'))
  const [values, push] = S.bus<Child> ()
  const [parent] = put (S.holdWith<Child> ([kept]) (values))
  const before = parent.firstChild
  push ([kept])
  assert.deepStrictEqual (parent.firstChild, before)
})

test ('mountChild: a list losing its tail string loses it on the page', () => {
  const kept = view (
    Object.assign (dom.document.createElement ('b'), { textContent: 'V' }),
  )
  const [values, push] = S.bus<Child> ()
  const [parent] = put (S.holdWith<Child> ([kept, ' and one more']) (values))
  assert.deepStrictEqual (dom.text (parent), 'V and one more')
  push ([kept])
  assert.deepStrictEqual (dom.text (parent), 'V')
})

test ('mountChild: an empty list empties a cell that held no views', () => {
  const [values, push] = S.bus<Child> ()
  const [parent] = put (S.holdWith<Child> ('no rows') (values))
  push ([])
  assert.deepStrictEqual (dom.text (parent), '')
})

test ('mountChild: a view that left the cell is disposed', () => {
  let shut = 0
  const leaving = view (dom.document.createElement ('b'), [
    S.disposable (() => shut += 1),
  ])
  const [values, push] = S.bus<Child> ()
  put (S.holdWith<Child> ([leaving]) (values))
  push (['plain text'])
  assert.deepStrictEqual (shut, 1)
})

test ('mountChild: a cell handed more text writes into the node it has', () => {
  const [values, push] = S.bus<Child> ()
  const [parent] = put (S.holdWith<Child> ('first') (values))
  const before = parent.firstChild?.nextSibling
  push ('second')
  assert.deepStrictEqual (parent.firstChild?.nextSibling, before)
  assert.deepStrictEqual (dom.text (parent), 'second')
})

test ('mountChild: a number reaching a cell is written the same way', () => {
  const [values, push] = S.bus<Child> ()
  const [parent] = put (S.holdWith<Child> (1) (values))
  const before = parent.firstChild?.nextSibling
  push (2)
  assert.deepStrictEqual ([parent.firstChild?.nextSibling, dom.text (parent)], [
    before,
    '2',
  ])
})

test ('mountChild: a text view in a cell is replaced, not written over', () => {
  let shut = 0
  const owned = view (dom.document.createTextNode ('a'), [
    S.disposable (() => shut += 1),
  ])
  const [values, push] = S.bus<Child> ()
  const [parent] = put (S.holdWith<Child> (owned) (values))
  push ('b')
  assert.deepStrictEqual ([shut, dom.text (parent)], [1, 'b'])
})

test ('mountChild: swapping two views moves those two nodes and leaves the rest', () => {
  const [a, b, c, d, e, f] = rows (['a', 'b', 'c', 'd', 'e', 'f'])
  const [parent, show] = listing ([a, b, c, d, e, f])
  const tally = counting (parent)
  show ([f, b, c, d, e, a])
  assert.deepStrictEqual (tally, { put: 2, took: 0 })
  assert.deepStrictEqual (dom.text (parent), 'fbcdea')
})

test ('mountChild: moving one view to the front moves that one node', () => {
  const [a, b, c, d, e, f] = rows (['a', 'b', 'c', 'd', 'e', 'f'])
  const [parent, show] = listing ([a, b, c, d, e, f])
  const tally = counting (parent)
  show ([a, f, b, c, d, e])
  assert.deepStrictEqual (tally, { put: 1, took: 0 })
  assert.deepStrictEqual (dom.text (parent), 'afbcde')
})

test ('mountChild: moving one view to the back moves that one node', () => {
  const [a, b, c, d, e, f] = rows (['a', 'b', 'c', 'd', 'e', 'f'])
  const [parent, show] = listing ([a, b, c, d, e, f])
  const tally = counting (parent)
  show ([a, c, d, e, b, f])
  assert.deepStrictEqual (tally, { put: 1, took: 0 })
  assert.deepStrictEqual (dom.text (parent), 'acdebf')
})

test ('mountChild: exchanging two neighbouring views moves one node', () => {
  const [a, b, c, d] = rows (['a', 'b', 'c', 'd'])
  const [parent, show] = listing ([a, b, c, d])
  const tally = counting (parent)
  show ([a, c, b, d])
  assert.deepStrictEqual (tally, { put: 1, took: 0 })
  assert.deepStrictEqual (dom.text (parent), 'acbd')
})

test ('mountChild: rotating the list by one keeps every node', () => {
  const made = rows (['a', 'b', 'c', 'd', 'e'])
  const [parent, show] = listing (made)
  const before = [...parent.childNodes]
  const tally = counting (parent)
  show ([made[4], made[0], made[1], made[2], made[3]])
  assert.deepStrictEqual (tally, { put: 1, took: 0 })
  assert.deepStrictEqual (dom.text (parent), 'eabcd')
  assert.deepStrictEqual (
    [...parent.childNodes].every ((n) => before.includes (n)),
    true,
  )
})

test ('mountChild: appending inserts only the new views', () => {
  const [a, b, c] = rows (['a', 'b', 'c'])
  const [parent, show] = listing ([a, b, c])
  const tally = counting (parent)
  const [d, e] = rows (['d', 'e'])
  show ([a, b, c, d, e])
  assert.deepStrictEqual (tally, { put: 2, took: 0 })
  assert.deepStrictEqual (dom.text (parent), 'abcde')
})

test ('mountChild: prepending inserts only the new view', () => {
  const [b, c] = rows (['b', 'c'])
  const [parent, show] = listing ([b, c])
  const tally = counting (parent)
  show ([...rows (['a']), b, c])
  assert.deepStrictEqual (tally, { put: 1, took: 0 })
  assert.deepStrictEqual (dom.text (parent), 'abc')
})

test ('mountChild: removing one view takes that node out and disposes it', () => {
  const shut: string[] = []
  const [a, b, c, d] = rows (['a', 'b', 'c', 'd'], shut)
  const [parent, show] = listing ([a, b, c, d])
  const tally = counting (parent)
  show ([a, c, d])
  assert.deepStrictEqual (tally, { put: 0, took: 1 })
  assert.deepStrictEqual ([shut, dom.text (parent)], [['b'], 'acd'])
})

test ('mountChild: the same view list again moves nothing', () => {
  const [a, b, c] = rows (['a', 'b', 'c'])
  const [parent, show] = listing ([a, b, c])
  const tally = counting (parent)
  show ([a, b, c])
  assert.deepStrictEqual (tally, { put: 0, took: 0 })
})

test ('mountChild: reversing a list keeps every node', () => {
  const made = rows (['a', 'b', 'c', 'd', 'e'])
  const [parent, show] = listing (made)
  const before = [...parent.childNodes]
  show ([...made].reverse ())
  assert.deepStrictEqual (dom.text (parent), 'edcba')
  const after = new Set (parent.childNodes)
  assert.deepStrictEqual (before.every ((n) => after.has (n)), true)
})

test ('mountChild: a view list replaced by new views drops the old ones', () => {
  const shut: string[] = []
  const [parent, show] = listing (rows (['x', 'y'], shut))
  const tally = counting (parent)
  show (rows (['z'], shut))
  assert.deepStrictEqual (tally, { put: 1, took: 2 })
  assert.deepStrictEqual ([dom.text (parent), shut], ['z', ['x', 'y']])
})

test ('mountChild: one update can move, insert, and remove views', () => {
  const shut: string[] = []
  const [a, b, c, d, e] = rows (['a', 'b', 'c', 'd', 'e'], shut)
  const [parent, show] = listing ([a, b, c, d, e])
  const [f] = rows (['f'], shut)
  show ([a, f, d, c, e])
  assert.deepStrictEqual (dom.text (parent), 'afdce')
  assert.deepStrictEqual (shut, ['b'])
  show ([e, c, d, f, a])
  assert.deepStrictEqual (dom.text (parent), 'ecdfa')
})

test ('mountChild: replacing every view disposes the old nodes', () => {
  const shut: string[] = []
  const [parent, show] = listing (rows (['a', 'b'], shut))
  const gone = [...parent.childNodes].filter ((n) => n.nodeType === 1)
  show (rows (['c', 'd'], shut))
  const now = new Set (parent.childNodes)
  assert.deepStrictEqual (gone.some ((n) => now.has (n)), false)
  assert.deepStrictEqual ([dom.text (parent), shut], ['cd', ['a', 'b']])
})

test ('mountChild: emptying a view list disposes its rows, and the next list is shown', () => {
  const shut: string[] = []
  const [parent, show] = listing (rows (['a', 'b'], shut))
  show ([])
  assert.deepStrictEqual ([dom.text (parent), shut], ['', ['a', 'b']])
  show (rows (['c', 'd', 'e'], shut))
  assert.deepStrictEqual (dom.text (parent), 'cde')
})

test ('mountChild: disposing an element stops the cell reading inside it', () => {
  let folds = 0
  const [pushes, push] = S.bus<void> ()
  const count = S.hold ((n: number) => (folds += 1, n + 1), 0) (pushes)
  const parent = dom.box ()
  const dsp = mountChild (
    buildHost (parent),
    null,
    H.p ({}, [count]) as Child,
  )
  push ()
  assert.deepStrictEqual ([dom.text (parent), folds], ['1', 1])

  S.dispose (dsp)
  push ()
  assert.deepStrictEqual ([parent.childNodes.length, folds], [0, 1])
})

test ('mountChild: disposing an element stops a cell nested in that cell', () => {
  let folds = 0
  const [pushes, push] = S.bus<void> ()
  const count = S.hold ((n: number) => (folds += 1, n + 1), 0) (pushes)
  const parent = dom.box ()
  const dsp = mountChild (
    buildHost (parent),
    null,
    H.p ({}, [
      S.holdWith<Child> (['tag:', count as Child]) (S.never<Child> ()),
    ]) as Child,
  )
  push ()
  assert.deepStrictEqual ([dom.text (parent), folds], ['tag:1', 1])

  S.dispose (dsp)
  push ()
  assert.deepStrictEqual ([parent.childNodes.length, folds], [0, 1])
})

test ('mountChild: disposing an element disposes its rows without removing each one', () => {
  const shut: string[] = []
  const parent = dom.box ()
  const dsp = mountChild (
    buildHost (parent),
    null,
    H.p ({}, [
      S.holdWith<Child> (rows (['a', 'b'], shut)) (S.never<Child> ()),
    ]) as Child,
  )
  const p = parent.querySelector ('p') as HTMLElement
  const inner = counting (p)
  S.dispose (dsp)
  assert.deepStrictEqual ([inner, shut], [{ put: 0, took: 0 }, ['a', 'b']])
})

test ('mountChild: disposing an element removes the element, not each node inside the cell', () => {
  const [pushes] = S.bus<Child> ()
  const parent = dom.box ()
  const dsp = mountChild (
    buildHost (parent),
    null,
    H.p ({}, [S.holdWith<Child> ('here') (pushes)]) as Child,
  )
  const p = parent.querySelector ('p') as HTMLElement
  const inner = counting (p)
  const outer = counting (parent)
  S.dispose (dsp)
  assert.deepStrictEqual ([inner, outer], [{ put: 0, took: 0 }, { put: 0, took: 1 }])
})

test ('mountChild: disposing a cell that stays in place removes its markers', () => {
  const [pushes] = S.bus<Child> ()
  const parent = dom.box ()
  const dsp = mountChild (
    buildHost (parent),
    null,
    S.holdWith<Child> ('here') (pushes) as Child,
  )
  assert.deepStrictEqual (parent.childNodes.length, 3)
  S.dispose (dsp)
  assert.deepStrictEqual (parent.childNodes.length, 0)
})

test ('mountChild: emptying a view list leaves the markers and disposes every row', () => {
  const shut: string[] = []
  const [parent, show] = listing (rows (['a', 'b', 'c'], shut))
  show ([])
  assert.deepStrictEqual ([dom.text (parent), shut], ['', ['a', 'b', 'c']])
  assert.deepStrictEqual (parent.childNodes.length, 2, 'the two markers, and nothing else')
  show (rows (['d'], shut))
  assert.deepStrictEqual (dom.text (parent), 'd')
})

test ('mountChild: a throw lets go of a component built before it', () => {
  owned = 0
  throwsOn (H.div ([Owning (), boom ()]))
  assert.deepStrictEqual (owned, 0)
})

test ('mountChild: a throw in an array lets go of what came before it', () => {
  owned = 0
  throwsOn (H.div ([[Owning (), boom ()]]))
  assert.deepStrictEqual (owned, 0)
})

test ('mountChild: a component whose markup throws lets go of its setup', () => {
  owned = 0
  const Throwing = D.component ((_p: void, _on: D.None, start: D.Start) => {
    owned += 1
    start (S.disposable (() => owned -= 1))
    return H.p (['a', boom ()])
  })
  throwsOn (H.div ([Throwing ()]))
  assert.deepStrictEqual (owned, 0)
})

test ('mountChild: a throw stops the cells read before it', () => {
  let reading = 0
  const cell = S.heldStream<Child> ((sink, sch) => {
    reading += 1
    sink.event (sch.currentTime (), 'cell')
    return S.disposable (() => reading -= 1)
  })
  throwsOn (H.div ([cell as Child, boom ()]))
  assert.deepStrictEqual (reading, 0)
})
