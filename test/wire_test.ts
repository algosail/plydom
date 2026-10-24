import * as P from '@algosail/ply'
import * as S from '@algosail/plystream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as D from '../src/mod.ts'
import { installDom } from './test_util.ts'

const dom = installDom ()

type Assert<T extends true> = T
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false
type Out<T> = T extends { [D.OUT]: infer O } ? O : never
type Sharp<T, K extends string> = string extends keyof T ? false : K extends keyof T ? true : false

const count = S.holdWith (0) (S.never<number> ())
const open = S.holdWith (true) (S.never<boolean> ())
const items = S.holdWith<readonly number[]> ([1]) (S.never ())

const elementMethod = D.el ('button', {}, ['+']).use ({ bumped: 'click' })
const elementFree = D.use ({ bumped: 'click' }) (D.el ('button', {}, ['+']))

const outMethod = D.el ('button', {}, ['+']).output ({ count })
const outFree = D.output ({ count }) (D.el ('button', {}, ['+']))

const bothMethod = D.el ('button', {}, ['+']).use ({ bumped: 'click' }).output ({ count })
const bothFree = D.output ({ count }) (D.use ({ bumped: 'click' }) (D.el ('button', {}, ['+'])))

const lateMethod = D.el ('button', {}, ['+']).output ({ count }).use ({ bumped: 'click' })
const lateFree = D.use ({ bumped: 'click' }) (D.output ({ count }) (D.el ('button', {}, ['+'])))

const actedMethod = D.el ('input').act (() => S.disposeNone ())
const actedFree = D.act (() => S.disposeNone ()) (D.el ('input'))

const actedUsedMethod = D.el ('input').act (() => S.disposeNone ()).use ({ typed: 'input' })
const actedUsedFree = D.use ({ typed: 'input' }) (D.act (() => S.disposeNone ()) (D.el ('input')))

const drawnMethod = D.comment ('m').use ({ hit: 'click' }).output ({ count })
const drawnFree = D.output ({ count }) (D.use ({ hit: 'click' }) (D.comment ('m')))

const branchMethod = D.when (() => D.el ('button', {}, ['x']).use ({ closed: 'click' })) (open)
  .output ({ count })
  .use ({ closed: 'closed' })
const branchFree = D.use ({ closed: 'closed' }) (
  D.output ({ count }) (
    D.when (() => D.el ('button', {}, ['x']).use ({ closed: 'click' })) (open),
  ),
)

const listMethod = D.rows ((n: number) => n) (() =>
  D.el ('li', {}, [D.el ('button', {}, ['x']).use ({ dropped: 'click' })]),
) (items).output ({ count }).use ({ dropped: 'dropped' })
const listFree = D.use ({ dropped: 'dropped' }) (
  D.output ({ count }) (
    D.rows ((n: number) => n) (() =>
      D.el ('li', {}, [D.el ('button', {}, ['x']).use ({ dropped: 'click' })]),
    ) (items),
  ),
)

const Clock = D.component ((p: { from: number }) => D.el ('p', {}, [p.from]).output ({ count }))
const madeMethod = Clock ({ from: 1 }).use ({ shown: 'count' })
const madeFree = D.use ({ shown: 'count' }) (Clock ({ from: 1 }))

const nestedMethod = D.el ('div', {}, [
  D.el ('button', {}, ['×']).use ({ dropped: 'click' }),
]).use ({ sent: 'submit' })
const nestedFree = D.use ({ sent: 'submit' }) (D.el ('div', {}, [
  D.el ('button', {}, ['×']).use ({ dropped: 'click' }),
]))

const piped = P.pipe (D.use ({ bumped: 'click' }), D.output ({ count }))
  (D.el ('button', {}, ['+']))

const pipedNested = P.pipe (D.use ({ sent: 'submit' }), D.output ({ count }))
  (D.el ('div', {}, [D.el ('button', {}, ['×']).use ({ dropped: 'click' })]))
const pipedNestedMethod = D.el ('div', {}, [
  D.el ('button', {}, ['×']).use ({ dropped: 'click' }),
]).use ({ sent: 'submit' }).output ({ count })

const unnamedBranch = D.use ({ missing: 'missing' }) (
  D.when (() => D.el ('button', {}, ['x']).use ({ closed: 'click' })) (open),
)
const unnamedList = D.use ({ missing: 'missing' }) (
  D.rows ((n: number) => n) (() => D.el ('li').use ({ dropped: 'click' })) (items),
)
const unnamedMade = D.use ({ missing: 'missing' }) (Clock ({ from: 1 }))

type Result<F, A> = F extends (value: A) => infer R ? R : never
type ComponentOutput = Result<
  ReturnType<typeof D.output<{ readonly count: typeof count }>>,
  ReturnType<typeof Clock>
>

const refused = (): void => {
  // @ts-expect-error act is only on an element
  D.act (() => S.disposeNone ()) (D.comment ('m'))
  // @ts-expect-error a branch has no node to act on
  D.act (() => S.disposeNone ()) (D.when (() => D.el ('button')) (open))
}

type Checks = [
  Assert<Equal<typeof elementFree, typeof elementMethod>>,
  Assert<Sharp<Out<typeof elementFree>, 'bumped'>>,
  Assert<Equal<typeof outFree, typeof outMethod>>,
  Assert<Equal<typeof bothFree, typeof bothMethod>>,
  Assert<Sharp<Out<typeof bothFree>, 'bumped'>>,
  Assert<Equal<typeof lateFree, typeof lateMethod>>,
  Assert<Sharp<Out<typeof lateFree>, 'bumped'>>,
  Assert<Equal<typeof actedFree, typeof actedMethod>>,
  Assert<Equal<typeof actedUsedFree, typeof actedUsedMethod>>,
  Assert<Sharp<Out<typeof actedUsedFree>, 'typed'>>,
  Assert<Equal<typeof drawnFree, typeof drawnMethod>>,
  Assert<Sharp<Out<typeof drawnFree>, 'hit'>>,
  Assert<Equal<typeof branchFree, typeof branchMethod>>,
  Assert<Sharp<Out<typeof branchFree>, 'closed'>>,
  Assert<typeof branchFree extends S.HeldStream<unknown> ? true : false>,
  Assert<typeof branchFree extends D.View ? false : true>,
  Assert<Equal<typeof listFree, typeof listMethod>>,
  Assert<Out<typeof listFree>['dropped'] extends S.Stream<readonly [number, Event]> ? true : false>,
  Assert<Equal<typeof madeFree, typeof madeMethod>>,
  Assert<Out<typeof madeFree>['shown'] extends S.HeldStream<number> ? true : false>,
  Assert<Equal<typeof nestedFree, typeof nestedMethod>>,
  Assert<Sharp<Out<typeof nestedFree>, 'dropped'>>,
  Assert<Sharp<Out<typeof nestedFree>, 'sent'>>,
  Assert<Equal<typeof piped, typeof bothMethod>>,
  Assert<Sharp<Out<typeof piped>, 'bumped'>>,
  Assert<Equal<typeof pipedNested, typeof pipedNestedMethod>>,
  Assert<Sharp<Out<typeof pipedNested>, 'dropped'>>,
  Assert<Sharp<Out<typeof pipedNested>, 'sent'>>,
  Assert<typeof unnamedBranch extends { readonly notNamed: 'missing' } ? true : false>,
  Assert<typeof unnamedBranch extends D.Child ? false : true>,
  Assert<typeof unnamedList extends { readonly notNamed: 'missing' } ? true : false>,
  Assert<typeof unnamedMade extends { readonly notNamed: 'missing' } ? true : false>,
  Assert<
    ComponentOutput extends { readonly output: 'is only for a view, a branch, or a list' }
      ? true
      : false
  >,
]

const checks: Checks = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
]

const click = (node: Element | null) =>
  (node as HTMLElement).dispatchEvent (new dom.Event ('click', { bubbles: true }))

test ('use: names a click on the element it is given', () => {
  const plain = D.el ('button', {}, ['+'])
  const button = D.use ({ bumped: 'click' }) (plain)
  assert.deepStrictEqual (button, plain)
  const seen: string[] = []
  const sub = S.subscribe (() => seen.push ('bumped')) (button[D.OUT].bumped)
  const box = dom.box ()
  D.mount (box) (button)
  click (box.querySelector ('button'))
  S.dispose (sub)
  assert.deepStrictEqual (seen, ['bumped'])
})

test ('output: a component gives the part that use names', () => {
  const held = S.holdWith (3) (S.never<number> ())
  const ClockFace = D.component ((p: { from: number }) =>
    D.output ({ held }) (D.el ('p', {}, [p.from])),
  )
  const face = D.use ({ shown: 'held' }) (ClockFace ({ from: 3 }))
  const seen: number[] = []
  const sub = S.subscribe ((_t: S.Time, n: number) => seen.push (n)) (face[D.OUT].shown)
  D.mount (dom.box ()) (face)
  S.dispose (sub)
  assert.deepStrictEqual (seen, [3])
})

test ('act: runs when the element is mounted and disposes with it', () => {
  let left = ''
  const input = D.act ((node) => {
    const field = node as HTMLInputElement
    field.lang = 'ja'
    return S.disposable (() => {
      left = field.lang
      field.removeAttribute ('lang')
    })
  }) (D.el ('input'))
  const box = dom.box ()
  const stop = D.mount (box) (input)
  assert.deepStrictEqual (box.querySelector ('input')?.getAttribute ('lang'), 'ja')
  S.dispose (stop)
  assert.deepStrictEqual (left, 'ja')
})

test ('pipe: use then output keeps the click and the list key', () => {
  const gift = S.holdWith (1) (S.never<number> ())
  const button = P.pipe (
    D.use ({ bumped: 'click' }),
    D.output ({ gift }),
  ) (D.el ('button', {}, ['+']))
  const bumps: string[] = []
  const bump = S.subscribe (() => bumps.push ('bumped')) (button[D.OUT].bumped)
  const box = dom.box ()
  D.mount (box) (button)
  click (box.querySelector ('button'))
  S.dispose (bump)

  const list = P.pipe (
    D.output ({ gift }),
    D.use ({ dropped: 'dropped' }),
  ) (
    D.rows ((n: number) => n) (() =>
      D.el ('li', {}, [D.el ('button', {}, ['x']).use ({ dropped: 'click' })]),
    ) (S.holdWith<readonly number[]> ([4]) (S.never ())),
  )
  const dropped: number[] = []
  const drop = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) => dropped.push (id)) (
    list[D.OUT].dropped,
  )
  const listBox = dom.box ()
  D.mount (listBox) (list)
  click (listBox.querySelector ('button'))
  S.dispose (drop)
  assert.deepStrictEqual ([bumps, dropped, checks.length, typeof refused], [
    ['bumped'],
    [4],
    33,
    'function',
  ])
})
