import * as S from '@algosail/plystream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addDisposable,
  concatDisposables,
  disposeEach,
  isNil,
  isNotNil,
  joinDisposables,
  NOTHING_TO_CLOSE,
  removeBetween,
  removeIfPresent,
  removeRange,
} from '../src/close.ts'
import { installDom } from './test_util.ts'

const dom = installDom ()

const mark = (into: string[], name: string): Disposable =>
  S.disposable (() => into.push (name))

const span = (text: string): HTMLSpanElement => {
  const node = dom.document.createElement ('span')
  node.textContent = text
  return node
}

test ('isNil: only null and undefined are nothing, and isNotNil is the opposite', () => {
  assert.deepStrictEqual ([null, undefined].map (isNil), [true, true])
  assert.deepStrictEqual ([0, '', false, NaN].map (isNil), [false, false, false, false])
  assert.deepStrictEqual ([isNotNil (0), isNotNil (null)], [true, false])
})

test ('concatDisposables: disposes the first handle, then the second', () => {
  const shut: string[] = []
  S.dispose (concatDisposables (mark (shut, 'a'), mark (shut, 'b')))
  assert.deepStrictEqual (shut, ['a', 'b'])
})

test ('NOTHING_TO_CLOSE: disposing it does nothing, and it is still a handle', () => {
  assert.deepStrictEqual (S.isDisposable (NOTHING_TO_CLOSE), true)
  S.dispose (NOTHING_TO_CLOSE)
})

test ('concatDisposables: the empty handle is neutral on both sides', () => {
  const left: string[] = []
  S.dispose (concatDisposables (NOTHING_TO_CLOSE, mark (left, 'x')))
  const right: string[] = []
  S.dispose (concatDisposables (mark (right, 'x'), NOTHING_TO_CLOSE))
  assert.deepStrictEqual ([left, right], [['x'], ['x']])
})

test ('concatDisposables: is associative', () => {
  const leaning: string[][] = []
  for (
    const build of [
      (a: Disposable, b: Disposable, c: Disposable) =>
        concatDisposables (concatDisposables (a, b), c),
      (a: Disposable, b: Disposable, c: Disposable) =>
        concatDisposables (a, concatDisposables (b, c)),
    ]
  ) {
    const shut: string[] = []
    S.dispose (build (mark (shut, 'a'), mark (shut, 'b'), mark (shut, 'c')))
    leaning.push (shut)
  }
  assert.deepStrictEqual (leaning[0], leaning[1])
})

test ('disposeEach: disposes every handle in order', () => {
  const shut: string[] = []
  disposeEach ([mark (shut, 'a'), mark (shut, 'b'), mark (shut, 'c')])
  assert.deepStrictEqual (shut, ['a', 'b', 'c'])
})

test ('disposeEach: an empty list disposes nothing', () => {
  const shut: string[] = []
  disposeEach ([])
  assert.deepStrictEqual (shut, [])
})

test ('joinDisposables: nothing held is the handle that closes nothing', () => {
  assert.deepStrictEqual (joinDisposables (null), NOTHING_TO_CLOSE)
})

test ('joinDisposables: one handle is returned as itself', () => {
  const one = mark ([], 'a')
  assert.deepStrictEqual (joinDisposables ([one]), one)
})

test ('joinDisposables: several handles dispose in order', () => {
  const shut: string[] = []
  S.dispose (joinDisposables ([mark (shut, 'a'), mark (shut, 'b'), mark (shut, 'c')]))
  assert.deepStrictEqual (shut, ['a', 'b', 'c'])
})

test ('addDisposable: a handle that closes nothing is left out', () => {
  const one = mark ([], 'a')
  assert.deepStrictEqual (addDisposable (null, NOTHING_TO_CLOSE), null)
  assert.deepStrictEqual (addDisposable ([one], NOTHING_TO_CLOSE), [one])
})

test ('addDisposable: the first handle starts the list and the next is appended', () => {
  const a = mark ([], 'a')
  const b = mark ([], 'b')
  const started = addDisposable (null, a)
  assert.deepStrictEqual (started, [a])
  assert.deepStrictEqual (addDisposable (started, b), [a, b])
})

test ('removeIfPresent: detaches the child it was given', () => {
  const parent = dom.box ()
  const child = span ('a')
  parent.appendChild (child)
  removeIfPresent (parent, child)
  assert.deepStrictEqual (parent.childNodes.length, 0)
})

test ('removeIfPresent: leaves alone a child that moved away', () => {
  const parent = dom.box ()
  const elsewhere = dom.box ()
  const child = span ('a')
  elsewhere.appendChild (child)
  removeIfPresent (parent, child)
  assert.deepStrictEqual (elsewhere.childNodes.length, 1)
})

test ('removeIfPresent: a null parent is not an error', () => {
  removeIfPresent (null, span ('a'))
})

test ('removeRange: nodes between two markers are removed', () => {
  const parent = dom.box ()
  const open = dom.document.createComment ('o')
  const close = dom.document.createComment ('c')
  parent.append (open, span ('a'), span ('b'), close, span ('d'))
  removeRange (parent, open, close)
  assert.deepStrictEqual ([dom.text (parent), parent.childNodes.length], ['d', 3])
})

test ('removeRange: nothing between the markers stays as it is', () => {
  const parent = dom.box ()
  const open = dom.document.createComment ('o')
  const close = dom.document.createComment ('c')
  parent.append (open, close)
  removeRange (parent, open, close)
  assert.deepStrictEqual (parent.childNodes.length, 2)
})

test ('removeRange: one node between the markers is removed', () => {
  const parent = dom.box ()
  const open = dom.document.createComment ('o')
  const close = dom.document.createComment ('c')
  parent.append (open, span ('a'), close)
  removeRange (parent, open, close)
  assert.deepStrictEqual (parent.childNodes.length, 2)
})

test ('removeRange: no markers clears the parent', () => {
  const parent = dom.box ()
  parent.append (span ('a'), span ('b'))
  removeRange (parent, null, null)
  assert.deepStrictEqual (parent.childNodes.length, 0)
})

test ('removeRange: from the start up to a marker is removed', () => {
  const parent = dom.box ()
  const close = dom.document.createComment ('c')
  parent.append (span ('a'), span ('b'), close, span ('d'))
  removeRange (parent, null, close)
  assert.deepStrictEqual (dom.text (parent), 'd')
})

test ('removeRange: from a marker to the end is removed', () => {
  const parent = dom.box ()
  const open = dom.document.createComment ('o')
  parent.append (span ('keep'), open, span ('a'), span ('b'))
  removeRange (parent, open, null)
  assert.deepStrictEqual ([dom.text (parent), parent.childNodes.length], ['keep', 2])
})

test ('removeRange: without Range the nodes between the markers are still removed', () => {
  const parent = dom.box ()
  const open = dom.document.createComment ('o')
  const close = dom.document.createComment ('c')
  parent.append (open, span ('a'), span ('b'), close, span ('d'))
  const doc = parent.ownerDocument
  assert (doc !== null)
  const real = doc.createRange
  doc.createRange = undefined as unknown as typeof doc.createRange
  try {
    assert.deepStrictEqual (typeof doc.createRange, 'undefined')
    removeRange (parent, open, close)
  } finally {
    doc.createRange = real
  }
  assert.deepStrictEqual ([dom.text (parent), parent.childNodes.length], ['d', 3])
})

test ('removeBetween: a marker with no parent removes nothing', () => {
  removeBetween (dom.document.createComment ('o'), null)
})

test ('removeBetween: nodes after the open marker up to close are removed', () => {
  const parent = dom.box ()
  const open = dom.document.createComment ('o')
  const close = dom.document.createComment ('c')
  parent.append (span ('keep'), open, span ('a'), close)
  removeBetween (open, close)
  assert.deepStrictEqual (dom.text (parent), 'keep')
})
