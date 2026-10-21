import * as S from '@algosail/plystream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyProp } from '../src/props.ts'
import { installDom } from './test_util.ts'

const dom = installDom ()

const field = () => dom.document.createElement ('input')

test ('applyProp: a plain key becomes an attribute', () => {
  const el = field ()
  applyProp (el, 'placeholder', 'name')
  assert.deepStrictEqual (el.getAttribute ('placeholder'), 'name')
})

test ('applyProp: a non-string value still becomes an attribute', () => {
  const el = field ()
  applyProp (el, 'tabindex', 0)
  applyProp (el, 'data-n', 1)
  assert.deepStrictEqual (
    ['tabindex', 'data-n'].map ((k) => el.getAttribute (k)),
    ['0', '1'],
  )
})

test ('applyProp: true sets a boolean attribute, false removes it, and aria-hidden stays the string false', () => {
  const el = field ()
  applyProp (el, 'disabled', true)
  const on = el.getAttribute ('disabled')
  applyProp (el, 'disabled', false)
  const off = el.hasAttribute ('disabled')
  applyProp (el, 'aria-hidden', 'false')
  assert.deepStrictEqual ([on, off, el.getAttribute ('aria-hidden')], ['', false, 'false'])
})

test ('applyProp: a live name is written as property and attribute', () => {
  const input = field ()
  applyProp (input, 'value', 'Hobbit')
  const onField = [
    (input as HTMLInputElement).value,
    input.getAttribute ('value'),
  ]
  const box = dom.document.createElement ('div')
  applyProp (box, 'value', 'Hobbit')
  assert.deepStrictEqual ([onField, box.getAttribute ('value')], [
    ['Hobbit', 'Hobbit'],
    'Hobbit',
  ])
})

test ('applyProp: false removes a boolean and keeps an enumerated token', () => {
  const input = field ()
  applyProp (input, 'disabled', true)
  applyProp (input, 'disabled', false)
  const box = dom.document.createElement ('div')
  applyProp (box, 'contenteditable', false)
  applyProp (box, 'spellcheck', false)
  applyProp (box, 'draggable', false)
  assert.deepStrictEqual (input.hasAttribute ('disabled'), false)
  assert.deepStrictEqual (
    ['contenteditable', 'spellcheck', 'draggable'].map ((k) =>
      box.getAttribute (k),
    ),
    ['false', 'false', 'false'],
  )
})

test ('applyProp: a live value is the string the field shows', () => {
  const el = field ()
  const read = () => [(el as HTMLInputElement).value, el.getAttribute ('value')]
  applyProp (el, 'value', undefined)
  const missing = read ()
  applyProp (el, 'value', false)
  const no = read ()
  applyProp (el, 'value', true)
  const yes = read ()
  applyProp (el, 'value', null)
  const empty = read ()
  assert.deepStrictEqual ([missing, no, yes, empty], [
    ['', ''],
    ['false', 'false'],
    ['true', 'true'],
    ['', ''],
  ])
})

test ('applyProp: a stream of value follows the same string', () => {
  const el = field ()
  const [values, put] = S.state<unknown> (undefined)
  applyProp (el, 'value', values)
  const first = (el as HTMLInputElement).value
  put (false)
  const second = (el as HTMLInputElement).value
  put (true)
  const third = [(el as HTMLInputElement).value, el.getAttribute ('value')]
  assert.deepStrictEqual ([first, second, third], ['', 'false', ['true', 'true']])
})

test ('applyProp: a checkbox is live too, and takes a boolean as it is', () => {
  const el = field ()
  applyProp (el, 'type', 'checkbox')
  applyProp (el, 'checked', true)
  const on = (el as HTMLInputElement).checked
  applyProp (el, 'checked', false)
  assert.deepStrictEqual ([on, (el as HTMLInputElement).checked], [true, false])
})

test ('applyProp: a stream keeps a live name in step', () => {
  const el = field ()
  const [draft, put] = S.state ('Hobbit')
  const d = applyProp (el, 'value', draft)
  const first = (el as HTMLInputElement).value
  put ('Dune')
  const second = (el as HTMLInputElement).value
  S.dispose (d)
  put ('nobody is listening any more')
  assert.deepStrictEqual ([first, second, (el as HTMLInputElement).value], [
    'Hobbit',
    'Dune',
    'Dune',
  ])
})

test ('applyProp: null and undefined take an attribute off', () => {
  const el = field ()
  applyProp (el, 'class', 'box')
  applyProp (el, 'class', null)
  applyProp (el, 'id', 'box')
  applyProp (el, 'id', undefined)
  assert.deepStrictEqual ([el.hasAttribute ('class'), el.hasAttribute ('id')], [
    false,
    false,
  ])
})

test ('applyProp: a leading dot assigns a DOM property', () => {
  const el = field ()
  applyProp (el, '.value', 'Ada')
  assert.deepStrictEqual (el.value, 'Ada')
  assert.deepStrictEqual (el.hasAttribute ('.value'), false)
})

test ('applyProp: style takes a block of CSS properties', () => {
  const el = field ()
  applyProp (el, 'style', { color: 'rgb(1, 2, 3)' })
  assert.deepStrictEqual (el.style.color, 'rgb(1, 2, 3)')
})

test ('applyProp: a style property set to nothing becomes empty', () => {
  const el = field ()
  applyProp (el, 'style', { color: null })
  assert.deepStrictEqual (el.style.color, '')
})

test ('applyProp: a stream inside a style block follows that property, and stops when disposed', () => {
  const el = field ()
  const [colors, push] = S.bus<string | null> ()
  const d = applyProp (el, 'style', {
    color: S.holdWith<string | null> ('rgb(1, 2, 3)') (colors),
    backgroundColor: 'rgb(4, 5, 6)',
  })
  assert.deepStrictEqual ([el.style.color, el.style.backgroundColor], [
    'rgb(1, 2, 3)',
    'rgb(4, 5, 6)',
  ])
  push ('rgb(7, 8, 9)')
  assert.deepStrictEqual (el.style.color, 'rgb(7, 8, 9)')
  push (null)
  assert.deepStrictEqual (el.style.color, '')
  S.dispose (d)
  push ('rgb(0, 0, 0)')
  assert.deepStrictEqual (el.style.color, '')
})

test ('applyProp: an adopted node keeps what was written, and a style stream still follows', () => {
  const el = field ()
  el.setAttribute ('class', 'server')
  el.value = 'server'
  el.style.color = 'rgb(1, 2, 3)'
  const [colors, push] = S.bus<string> ()
  applyProp (el, 'class', 'client', true)
  applyProp (el, 'value', 'client', true)
  applyProp (el, 'style', {
    color: 'rgb(4, 5, 6)',
    backgroundColor: S.holdWith ('rgb(7, 8, 9)') (colors),
  }, true)
  assert.deepStrictEqual (
    [
      el.getAttribute ('class'),
      el.value,
      el.style.color,
      el.style.backgroundColor,
    ],
    ['server', 'server', 'rgb(1, 2, 3)', 'rgb(7, 8, 9)'],
  )
  push ('rgb(0, 0, 0)')
  assert.deepStrictEqual ([el.style.color, el.style.backgroundColor], [
    'rgb(1, 2, 3)',
    'rgb(0, 0, 0)',
  ])
})

test ('applyProp: on: plus a name attaches a handler', () => {
  const el = field ()
  let clicks = 0
  applyProp (el, 'on:click', () => clicks += 1)
  el.dispatchEvent (new dom.Event ('click'))
  assert.deepStrictEqual (clicks, 1)
})

test ('applyProp: disposing the handle removes the handler', () => {
  const el = field ()
  let clicks = 0
  const d = applyProp (el, 'on:click', () => clicks += 1)
  el.dispatchEvent (new dom.Event ('click'))
  S.dispose (d)
  el.dispatchEvent (new dom.Event ('click'))
  assert.deepStrictEqual (clicks, 1)
})

test ('applyProp: an on: key without a function is just an attribute', () => {
  const el = field ()
  applyProp (el, 'on:click', 'not a handler')
  assert.deepStrictEqual (el.getAttribute ('on:click'), 'not a handler')
})

test ('applyProp: an on: key with a stream is refused', () => {
  const el = field ()
  const [values, push] = S.bus<() => void> ()
  const handlers = S.holdWith<() => void> (() => {}) (values)
  assert.throws (
    () => applyProp (el, 'on:click', handlers),
    (error: unknown) => error instanceof TypeError && error.message.includes ('on:click'),
  )
  assert.deepStrictEqual (el.hasAttribute ('on:click'), false)
  push (() => {})
  assert.deepStrictEqual (el.hasAttribute ('on:click'), false)
})

test ('applyProp: an on: key with a stream is refused unread', () => {
  const el = field ()
  const [values, push] = S.bus<unknown> ()
  assert.throws (() => applyProp (el, 'on:click', values), TypeError)
  push ('x')
  assert.deepStrictEqual (el.hasAttribute ('on:click'), false)
})

test ('applyProp: a stream keeps the attribute in step', () => {
  const el = field ()
  const [values, push] = S.bus<string | null> ()
  const d = applyProp (el, 'class', S.holdWith<string | null> ('a') (values))
  assert.deepStrictEqual (el.getAttribute ('class'), 'a')
  push ('b')
  assert.deepStrictEqual (el.getAttribute ('class'), 'b')
  push (null)
  assert.deepStrictEqual (el.hasAttribute ('class'), false)
  S.dispose (d)
  push ('c')
  assert.deepStrictEqual (el.hasAttribute ('class'), false)
})

test ('applyProp: a stream keeps a property in step too', () => {
  const el = field ()
  const [values, push] = S.bus<string> ()
  applyProp (el, '.value', S.holdWith ('one') (values))
  push ('two')
  assert.deepStrictEqual (el.value, 'two')
})

test ('applyProp: a stream named style stays an attribute', () => {
  const el = field ()
  const [values, push] = S.bus<string> ()
  applyProp (el, 'style', S.holdWith ('color: red') (values))
  assert.deepStrictEqual (el.getAttribute ('style'), 'color: red')
  push ('color: blue')
  assert.deepStrictEqual (el.getAttribute ('style'), 'color: blue')
})
