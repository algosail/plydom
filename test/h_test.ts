import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as H from '../src/h.ts'
import * as D from '../src/mod.ts'
import { installDom } from './test_util.ts'

const dom = installDom ()

const shown = (v: D.Child): HTMLElement => {
  const box = dom.box ()
  D.mount (box) (v)
  return box
}

test ('h: a helper called with children alone', () => {
  const box = shown (H.li (['write it down']))
  assert.deepStrictEqual ([box.querySelector ('li') !== null, dom.text (box)], [
    true,
    'write it down',
  ])
})

test ('h: a helper called with props and children', () => {
  const box = shown (H.li ({ class: 'done' }, ['crossed off']))
  assert.deepStrictEqual (box.querySelector ('li')?.getAttribute ('class'), 'done')
})

test ('h: a helper called with nothing at all', () => {
  assert.deepStrictEqual (shown (H.hr ()).querySelector ('hr') !== null, true)
})

test ('h: helpers nest the way the markup does', () => {
  const box = shown (
    H.ul ({ class: 'todo' }, [H.li (['one']), H.li (['two'])]),
  )
  assert.deepStrictEqual (box.querySelectorAll ('li').length, 2)
  assert.deepStrictEqual (dom.text (box), 'onetwo')
})

test ('h: the SVG helpers build in the SVG namespace', () => {
  const box = shown (H.svg ({}, [H.circle ({ r: '4' })]))
  assert.deepStrictEqual (
    box.querySelector ('circle')?.namespaceURI,
    'http://www.w3.org/2000/svg',
  )
})

test ('h: every helper carries its own tag', () => {
  const tagOf = (name: string) => name === 'var_' ? 'var' : name
  const names = Object.keys (H)
  const built = names.map ((name) => {
    const made = (H as Record<string, H.ElementFn>)[name] ()
    return (shown (made).firstChild as Element).localName
  })
  assert.deepStrictEqual ([names.length, built], [96, names.map (tagOf)])
})
