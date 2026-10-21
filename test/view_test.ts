import * as S from '@algosail/plystream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildHost } from '../src/hosts/build.ts'
import {
  comment,
  component,
  el,
  hydrate,
  mount,
  node,
  rows,
  svgEl,
  valueOf,
  view,
  when,
} from '../src/mod.ts'
import { OUT, outsOf } from '../src/output.ts'
import {
  isView,
  lazyView,
  materialize,
  NO_DISPOSABLES,
} from '../src/view.ts'
import { installDom } from './test_util.ts'

const dom = installDom ()

const rewriteValue = (node: Element): Disposable => {
  const input = node as HTMLInputElement
  const hear = (): void => {
    input.value = 'kana'
  }
  input.addEventListener ('input', hear)
  return S.disposable (() => input.removeEventListener ('input', hear))
}

test ('view: wraps a finished node and the handles that go with it', () => {
  const element = dom.document.createElement ('div')
  let shut = 0
  const v = view (element, [S.disposable (() => shut += 1)])
  assert.deepStrictEqual (node (v), element)
  S.dispose (v)
  assert.deepStrictEqual (shut, 1)
})

test ('view: disposing twice runs the handles once', () => {
  let shut = 0
  const v = view (dom.document.createElement ('div'), [
    S.disposable (() => shut += 1),
  ])
  S.dispose (v)
  S.dispose (v)
  assert.deepStrictEqual (shut, 1)
})

test ('isView: tells a view from anything else', () => {
  assert.deepStrictEqual (isView (view (dom.document.createElement ('div'))), true)
  assert.deepStrictEqual ([1, 'x', null, {}, { tag: 'view' }].map (isView), [
    false,
    false,
    false,
    false,
    false,
  ])
})

test ('lazyView: builds nothing until it is asked for a node', () => {
  let builds = 0
  const v = lazyView ((host, anchor) => {
    builds += 1
    return { node: host.element (anchor, 'i', null), disposables: [], adopted: false }
  })
  assert.deepStrictEqual (builds, 0)
  node (v)
  assert.deepStrictEqual (builds, 1)
})

test ('lazyView: the node is built once and kept', () => {
  let builds = 0
  const v = lazyView ((host, anchor) => {
    builds += 1
    return { node: host.element (anchor, 'i', null), disposables: [], adopted: false }
  })
  assert.deepStrictEqual (node (v), node (v))
  assert.deepStrictEqual (builds, 1)
})

test ('lazyView: what was built already is handed back, adopting or not', () => {
  let builds = 0
  const v = lazyView ((host, anchor) => {
    builds += 1
    return { node: host.element (anchor, 'i', null), disposables: [], adopted: false }
  })
  const built = node (v)
  const adopting = { ...buildHost (dom.box ()), hydrating: true }
  assert.deepStrictEqual ([materialize (v, adopting, null).node, builds], [built, 1])
})

test ('use: the stream comes from a node that is not there yet', () => {
  const said = el ('button', {}, ['ok']).use ({ hit: 'click' })
  const seen: string[] = []
  const d = S.subscribe ((_t: S.Time, e: Event) => seen.push (e.type)) (
    said[OUT].hit,
  )
  assert.deepStrictEqual (seen, [], 'nothing to report before the node is built')
  const box = dom.box ()
  const dsp = mount (box) (said)
  const button = box.querySelector ('button') as HTMLElement
  button.dispatchEvent (new dom.Event ('click'))
  assert.deepStrictEqual (seen, ['click'])
  S.dispose (d)
  button.dispatchEvent (new dom.Event ('click'))
  assert.deepStrictEqual (seen, ['click'], 'a reader that left takes its listener with it')
  S.dispose (dsp)
})

test ('use: one name twice on one element is one stream', () => {
  const v = el ('input', { type: 'checkbox' }).use ({ hit: 'click' }).use ({
    hit: 'change',
  })
  const seen: string[] = []
  const d = S.subscribe ((_t: S.Time, e: Event) => seen.push (e.type)) (v[OUT].hit)
  const box = dom.box ()
  const dsp = mount (box) (v)
  const input = box.querySelector ('input') as HTMLElement
  input.dispatchEvent (new dom.Event ('click'))
  input.dispatchEvent (new dom.Event ('change'))
  S.dispose (d), S.dispose (dsp)
  assert.deepStrictEqual (seen, ['click', 'change'])
})

test ('outsOf: returns the names a view says, and none when it says nothing', () => {
  const said = outsOf (el ('button', {}, ['ok']).use ({ hit: 'click' }))
  assert.deepStrictEqual (Object.keys (said), ['hit'])
  assert.deepStrictEqual (outsOf (el ('span', {}, ['quiet'])), {})
})

test ('act: runs on mount, on the mounted element, and the handle leaves with it', () => {
  let seen: Element | null = null
  let shut = 0
  const v = el ('input').act ((node) => {
    seen = node
    return S.disposable (() => shut += 1)
  })
  assert.deepStrictEqual (seen, null)
  const box = dom.box ()
  const dsp = mount (box) (v)
  assert.deepStrictEqual (seen, box.querySelector ('input'))
  S.dispose (dsp)
  S.dispose (dsp)
  assert.deepStrictEqual (shut, 1)
})

test ('act: several calls run in order, and their handles leave in that order', () => {
  const order: string[] = []
  const v = el ('span')
    .act (() => {
      order.push ('run a')
      return S.disposable (() => order.push ('drop a'))
    })
    .act (() => {
      order.push ('run b')
      return S.disposable (() => order.push ('drop b'))
    })
  assert.deepStrictEqual (order, [])
  const dsp = mount (dom.box ()) (v)
  assert.deepStrictEqual (order, ['run a', 'run b'])
  S.dispose (dsp)
  assert.deepStrictEqual (order, ['run a', 'run b', 'drop a', 'drop b'])
})

test ('act: an on: listener reads the value the action wrote', () => {
  const seen: string[] = []
  const v = el ('input', {
    'on:input': (e: Event) => seen.push ((e.target as HTMLInputElement).value),
  }).act (rewriteValue)
  const box = dom.box ()
  const dsp = mount (box) (v)
  const input = box.querySelector ('input') as HTMLInputElement
  input.value = 'raw'
  input.dispatchEvent (new dom.Event ('input'))
  S.dispose (dsp)
  input.dispatchEvent (new dom.Event ('input'))
  assert.deepStrictEqual (seen, ['kana'])
})

test ('act: valueOf reads the value the action wrote', () => {
  const seen: string[] = []
  const v = el ('input').act (rewriteValue).use ({ typed: 'input' })
  const reading = S.subscribe ((_t: S.Time, e: Event) => seen.push (valueOf (e))) (
    v[OUT].typed,
  )
  const box = dom.box ()
  const dsp = mount (box) (v)
  const input = box.querySelector ('input') as HTMLInputElement
  input.value = 'raw'
  input.dispatchEvent (new dom.Event ('input'))
  S.dispose (reading)
  input.dispatchEvent (new dom.Event ('input'))
  S.dispose (dsp)
  assert.deepStrictEqual (seen, ['kana'])
})

test ('act: hydrate hands the action the node that was already there', () => {
  const first = dom.box ()
  mount (first) (el ('input', { name: 'title' }))
  const box = dom.box ()
  box.innerHTML = first.innerHTML
  const before = box.querySelector ('input')
  let seen: Element | null = null
  const dsp = hydrate (box) (() =>
    el ('input', { name: 'title' }).act ((node) => {
      seen = node
      return S.disposeNone ()
    }),
  )
  assert.deepStrictEqual (seen, before)
  assert.deepStrictEqual (box.querySelector ('input'), before)
  S.dispose (dsp)
})

test ('act: when going false disposes the handle and leaves the rest mounted', () => {
  const [flags, push] = S.bus<boolean> ()
  let shut = 0
  const page = el ('div', {}, [
    'stay',
    when (() => el ('input').act (() => S.disposable (() => shut += 1))) (
      S.holdWith (true) (flags),
    ),
  ])
  const box = dom.box ()
  const dsp = mount (box) (page)
  assert.deepStrictEqual (box.querySelector ('input') !== null, true)
  push (false)
  assert.deepStrictEqual ([shut, box.querySelector ('input'), box.textContent], [
    1,
    null,
    'stay',
  ])
  S.dispose (dsp)
  assert.deepStrictEqual (shut, 1)
})

test ('act: a row leaving disposes its handle', () => {
  const [items, put] = S.state<readonly number[]> ([1])
  let shut = 0
  const list = rows ((n: number) => n) (() =>
    el ('li').act (() => S.disposable (() => shut += 1)),
  ) (items)
  const box = dom.box ()
  const dsp = mount (box) (list)
  assert.deepStrictEqual (box.querySelector ('li') !== null, true)
  put ([])
  assert.deepStrictEqual ([shut, box.querySelector ('li')], [1, null])
  S.dispose (dsp)
  assert.deepStrictEqual (shut, 1)
})

test ('act: after the node exists it runs at once, and the handle leaves with the element', () => {
  let seen: Element | null = null
  let shut = 0
  const v = el ('br')
  const box = dom.box ()
  const dsp = mount (box) (v)
  v.act ((node) => {
    seen = node
    return S.disposable (() => shut += 1)
  })
  assert.deepStrictEqual (seen, box.querySelector ('br'))
  S.dispose (dsp)
  assert.deepStrictEqual ([shut, NO_DISPOSABLES.length], [1, 0])
})

test ('act: a handle that closes nothing does not take the shared list', () => {
  const v = el ('br').act (() => S.disposeNone ())
  const box = dom.box ()
  const dsp = mount (box) (v)
  v.act (() => S.disposeNone ())
  S.dispose (dsp)
  assert.deepStrictEqual (NO_DISPOSABLES.length, 0)
})

test ('act: a later action throwing disposes the handles already started', () => {
  let shut = 0
  const v = el ('input')
    .act (() => S.disposable (() => shut += 1))
    .act (() => {
      throw new Error ('nope')
    })
  const box = dom.box ()
  assert.throws (
    () => mount (box) (v),
    (error: unknown) => error instanceof Error && error.message.includes ('nope'),
  )
  assert.deepStrictEqual ([shut, box.querySelector ('input')], [1, null])
})

test ('act: a child that fails to build disposes the action handle', () => {
  let shut = 0
  const bad = lazyView (() => {
    throw new Error ('boom')
  })
  const v = el ('div', {}, [bad]).act (() => S.disposable (() => shut += 1))
  assert.throws (
    () => mount (dom.box ()) (v),
    (error: unknown) => error instanceof Error && error.message.includes ('boom'),
  )
  assert.deepStrictEqual (shut, 1)
})

test ('act: an action may queue another, and both run before listeners', () => {
  const order: string[] = []
  const v = el ('button', {
    'on:click': () => order.push ('on'),
  }).act (() => {
    order.push ('first')
    v.act ((node) => {
      order.push ('second')
      node.addEventListener ('click', () => order.push ('queued'))
      return S.disposeNone ()
    })
    return S.disposeNone ()
  }).use ({ hit: 'click' })
  const seen: string[] = []
  const reading = S.subscribe (() => seen.push ('use')) (v[OUT].hit)
  const box = dom.box ()
  const dsp = mount (box) (v)
  assert.deepStrictEqual (order, ['first', 'second'])
  box.querySelector ('button')?.dispatchEvent (new dom.Event ('click'))
  S.dispose (reading)
  S.dispose (dsp)
  assert.deepStrictEqual (order, ['first', 'second', 'queued', 'on'])
  assert.deepStrictEqual (seen, ['use'])
})

test ('act: use and output leave the method in place', () => {
  let ran = 0
  const chained = el ('input')
    .use ({ typed: 'input' })
    .output ({ n: S.holdWith (0) (S.never ()) })
    .act (() => {
      ran += 1
      return S.disposeNone ()
    })
  const other = el ('button')
    .act (() => S.disposeNone ())
    .use ({ hit: 'click' })
    .output ({ n: S.holdWith (0) (S.never ()) })
    .act (() => S.disposeNone ())
  const dsp = mount (dom.box ()) (chained)
  assert.deepStrictEqual (
    [ran, Object.keys (outsOf (chained)), Object.keys (outsOf (other))],
    [1, ['typed'], ['hit']],
  )
  S.dispose (dsp)
})

test ('act: an svg element receives its own node', () => {
  let ns: string | null = null
  const dsp = mount (dom.box ()) (
    svgEl ('circle').act ((node) => {
      ns = node.namespaceURI
      return S.disposeNone ()
    }),
  )
  assert.deepStrictEqual (ns, 'http://www.w3.org/2000/svg')
  S.dispose (dsp)
})

test ('act: a component, a branch, a comment and a finished node have none', () => {
  const made = component (() => el ('i')) ()
  const branch = when (() => el ('i')) (S.holdWith (false) (S.never ()))
  assert.deepStrictEqual ([
    'act' in made,
    'act' in branch,
    'act' in comment ('x'),
    'act' in view (dom.document.createElement ('div')),
  ], [false, false, false, false])
})
