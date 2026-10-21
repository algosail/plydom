import * as P from '@algosail/ply'
import * as S from '@algosail/plystream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as D from '../src/mod.ts'
import { installDom } from './test_util.ts'

const dom = installDom ()

const shown = (v: D.Child): HTMLElement => {
  const box = dom.box ()
  D.mount (box) (v)
  return box
}

const click = (node: Element | null | undefined) =>
  (node as HTMLElement).dispatchEvent (new dom.Event ('click', { bubbles: true }))

type Assert<T extends true> = T

test ('el: builds an element with its props and children', () => {
  const box = shown (D.el ('p', { class: 'lead' }, ['hello']))
  const p = box.querySelector ('p')
  assert.deepStrictEqual ([p?.getAttribute ('class'), dom.text (box)], ['lead', 'hello'])
})

test ('el: props and children are both optional', () => {
  assert.deepStrictEqual (shown (D.el ('hr')).querySelector ('hr') !== null, true)
})

test ('svgEl: builds in the SVG namespace', () => {
  const box = shown (D.svgEl ('circle', { r: '4' }))
  assert.deepStrictEqual (
    box.querySelector ('circle')?.namespaceURI,
    'http://www.w3.org/2000/svg',
  )
})

test ('comment: writes a comment node into the markup', () => {
  const box = shown (D.el ('div', {}, [D.comment ('here')]))
  const comments = [...(box.firstChild?.childNodes ?? [])]
    .filter ((n) => n.nodeType === 8)
    .map ((n) => (n as Comment).data)
  assert.deepStrictEqual (comments.includes ('here'), true)
})

test ('node: builds the view on demand', () => {
  const v = D.el ('section')
  assert.deepStrictEqual ((D.node (v) as Element).localName, 'section')
})

test ('mount: the handle takes everything it put there back out', () => {
  const box = dom.box ()
  const dsp = D.mount (box) (D.el ('p', {}, ['gone soon']))
  S.dispose (dsp)
  assert.deepStrictEqual (box.childNodes.length, 0)
})

test ('mount: one stream in two places is still one fold', () => {
  let folds = 0
  const [clicks, click] = S.bus<void> ()
  const count = S.hold ((n: number) => (folds += 1, n + 1), 0) (clicks)
  const box = shown (D.el ('span', { 'data-n': count }, [count]))
  click ()
  const span = box.querySelector ('span')
  assert.deepStrictEqual ([folds, span?.getAttribute ('data-n'), dom.text (box)], [
    1,
    '1',
    '1',
  ])
})

test ('events: listens on the node beneath a view', () => {
  const v = D.el ('button')
  const seen: string[] = []
  S.subscribe ((_t: S.Time, e: Event) => seen.push (e.type)) (
    D.events ('click') (v),
  )
  shown (v).querySelector ('button')?.dispatchEvent (new dom.Event ('click'))
  assert.deepStrictEqual (seen, ['click'])
})

test ('events: reading a view costs it nothing until it is built', () => {
  const later = D.el ('button', {}, ['later'])
  const seen: string[] = []
  const reading = S.subscribe ((_t: S.Time, e: Event) => seen.push (e.type)) (
    D.events ('click') (later),
  )

  const box = shown (D.el ('p', {}, [later]))
  box.querySelector ('button')!.dispatchEvent (new dom.Event ('click'))
  assert.deepStrictEqual (seen, ['click'])
  S.dispose (reading)
})

test ('events: a control wired this way survives hydration', () => {
  type Step = (n: number) => number
  const Counter = (): D.View => {
    const more = D.el ('button', {}, ['+'])
    const count = S.hold ((n: number, f: Step) => f (n), 0) (
      P.map (() => (n: number) => n + 1) (D.events ('click') (more)),
    )
    return D.el ('p', {}, [D.el ('output', {}, [count]), more])
  }

  const seed = dom.box ()
  D.mount (seed) (Counter ())
  const box = dom.box ()
  box.innerHTML = seed.innerHTML
  const before = box.querySelector ('output')

  D.hydrate (box) (Counter)
  box.querySelector ('button')!.dispatchEvent (new dom.Event ('click'))

  assert.deepStrictEqual (box.querySelector ('output'), before)
  assert.deepStrictEqual (box.querySelector ('output')?.textContent, '1')
})

test ('events: the same stream as a free function', () => {
  const button = D.el ('button', {}, ['ok'])
  const seen: string[] = []
  const d = S.subscribe ((_t: S.Time, e: Event) => seen.push (e.type)) (
    D.events ('click') (button),
  )
  const box = shown (button)
  ;(box.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click'),
  )
  S.dispose (d)
  assert.deepStrictEqual (seen, ['click'])
})

test ('when: Nothing while the flag is false, Just once it is true', () => {
  const [flags, push] = S.bus<boolean> ()
  const seen: P.Maybe<D.View>[] = []
  S.subscribe ((_t: S.Time, m: P.Maybe<D.View>) => seen.push (m)) (
    D.when (() => D.el ('i')) (S.holdWith (false) (flags)),
  )
  push (true)
  assert.deepStrictEqual (seen.map (P.isJust), [false, true])
})

test ('when: the factory is not called while the flag is false', () => {
  let built = 0
  S.subscribe (() => {}) (
    D.when (() => (built += 1, D.el ('i'))) (S.holdWith (false) (S.never ())),
  )
  assert.deepStrictEqual (built, 0)
})

test ('when: nothing takes room in the markup on false', () => {
  const box = shown (
    D.el ('div', {}, [D.when (() => D.el ('i')) (S.holdWith (false) (S.never ()))]),
  )
  assert.deepStrictEqual (box.querySelector ('i'), null)
})

test ('when: a branch coming back sees the state as it now is', () => {
  const [clicks, click] = S.bus<void> ()
  const count = S.hold ((n: number) => n + 1, 0) (clicks)
  const [flags, show] = S.bus<boolean> ()
  const box = shown (
    D.el ('div', {}, [
      D.when (() => D.el ('span', {}, [count])) (S.holdWith (true) (flags)),
    ]),
  )
  click (), click (), click ()
  assert.deepStrictEqual (dom.text (box), '3')
  show (false)
  show (true)
  assert.deepStrictEqual (dom.text (box), '3')
})

test ('when: the same answer leaves the branch where it is', () => {
  type Model = { readonly open: boolean; readonly n: number }
  const [model, put] = S.state<Model> ({ open: true, n: 0 })
  let built = 0
  const box = shown (
    D.el ('div', {}, [
      D.when (() => {
        built += 1
        return D.el ('input', { name: 'title' })
      }) (P.map ((m: Model) => m.open) (model)),
    ]),
  )
  const field = () => box.querySelector ('input') as HTMLInputElement | null
  const first = field ()
  ;(first as HTMLInputElement).value = 'typed by hand'
  for (let i = 1; i <= 5; i++) put ({ open: true, n: i })
  const kept = [built, field () === first, field ()?.value]

  put ({ open: false, n: 6 })
  const away = field ()
  put ({ open: true, n: 7 })
  assert.deepStrictEqual ([kept, built, away, field ()?.value], [
    [1, true, 'typed by hand'],
    2,
    null,
    '',
  ])
})

test ('when: a branch keeps its names until they are let out', () => {
  const branch = D.when (() =>
    D.el ('button', {}, ['×']).use ({ closed: 'click' }),
  ) (S.holdWith (true) (S.never ()))
  const page = D.el ('div', {}, [branch])
  assert.deepStrictEqual (
    [Object.keys (D.outsOf (branch)), Object.keys (D.outsOf (page))],
    [[], []],
  )
})

test ('when: a name let out is heard while the branch stands and when it returns', () => {
  const [flags, show] = S.bus<boolean> ()
  const page = D.el ('div', {}, [
    D.when (() => D.el ('button', {}, ['×']).use ({ closed: 'click' })) (
      S.holdWith (true) (flags),
    ).use ({ done: 'closed' }),
  ])
  const heard: string[] = []
  const d = S.subscribe ((_t: S.Time, e: Event) => heard.push (e.type)) (
    page[D.OUT].done,
  )
  const box = shown (page)
  const first = box.querySelector ('button')
  click (first)
  show (false)
  click (first)
  show (true)
  click (box.querySelector ('button'))
  S.dispose (d)
  assert.deepStrictEqual (heard, ['click', 'click'])
})

test ('when: a list in a branch gives the name with the row key', () => {
  type Entry = { readonly id: number }
  const Row = (_e: S.HeldStream<Entry>, id: number) =>
    D.el ('li', {}, [
      D.el ('button', {}, [String (id)]).use ({ dropped: 'click' }),
    ])
  const items = S.holdWith<readonly Entry[]> ([{ id: 1 }, { id: 2 }]) (
    S.never (),
  )
  const branch = D.when (() =>
    D.el ('ul', {}, [
      D.rows ((e: Entry) => e.id) (Row) (items).use ({ dropped: 'dropped' }),
    ]),
  ) (S.holdWith (true) (S.never ())).use ({ dropped: 'dropped' })
  const heard: number[] = []
  const d = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    heard.push (id),
  ) (branch[D.OUT].dropped)
  const box = shown (D.el ('div', {}, [branch]))
  click (box.querySelectorAll ('button')[1])
  S.dispose (d)
  assert.deepStrictEqual (heard, [2])
})

test ('when: a name let out reaches a component setup', () => {
  type On = { readonly closed: S.Stream<Event> }
  const Panel = D.component ((_p: void, on: On) => {
    const closes = S.hold ((n: number) => n + 1, 0) (on.closed)
    return D.el ('div', {}, [
      D.when (() => D.el ('button', {}, ['×']).use ({ closed: 'click' })) (
        S.holdWith (true) (S.never ()),
      ).use ({ closed: 'closed' }),
      D.el ('output', {}, [closes]),
    ])
  })
  const box = shown (Panel ())
  click (box.querySelector ('button'))
  click (box.querySelector ('button'))
  assert.deepStrictEqual (box.querySelector ('output')?.textContent, '2')
})

test ('when: a branch with use stays held, and hydration adopts it', () => {
  const build = () =>
    D.el ('div', {}, [
      D.when (() => D.el ('button', {}, ['×']).use ({ closed: 'click' })) (
        S.holdWith (true) (S.never ()),
      ).use ({ closed: 'closed' }),
    ])
  const first = dom.box ()
  const server = D.mount (first) (build ())
  const markup = first.innerHTML
  S.dispose (server)

  const box = dom.box ()
  box.innerHTML = markup
  const before = box.querySelector ('button')
  const page = build ()
  let heard = 0
  const d = S.subscribe (() => heard += 1) (page[D.OUT].closed)
  const live = D.hydrate (box) (page)
  click (box.querySelector ('button'))
  const same = box.querySelector ('button') === before
  S.dispose (d), S.dispose (live)
  assert.deepStrictEqual ([same, heard], [true, 1])
})

test ('when: a held flag makes a held branch, and rows does the same for its list', () => {
  const [flags] = S.bus<boolean> ()
  const [items] = S.bus<readonly number[]> ()
  const held = D.when (() => D.el ('i')) (S.holdWith (false) (flags))
  const plain = D.when (() => D.el ('i')) (flags)
  const heldList = D.rows ((n: number) => n) (() => D.el ('li')) (
    S.holdWith<readonly number[]> ([1]) (S.never ()),
  )
  const plainList = D.rows ((n: number) => n) (() => D.el ('li')) (items)
  let answered = false
  const sub = S.subscribe (() => {
    answered = true
  }) (heldList)
  let plainAnswered = false
  const plainSub = S.subscribe (() => {
    plainAnswered = true
  }) (plainList)
  S.dispose (sub)
  S.dispose (plainSub)
  assert.deepStrictEqual ([
    S.isHeld (held),
    S.isStream (plain),
    S.isHeld (heldList),
    S.isStream (plainList),
    answered,
    plainAnswered,
  ], [
    true,
    true,
    true,
    true,
    true,
    false,
  ])
  // assert.deepStrictEqual (
  //   [held, plain, heldList, plainList].map ((one) => Object.hasOwn (one, 'use')),
  //   [false, false, false, false],
  // )
})

test ('ifElse: picks whichever factory the flag points at', () => {
  const [flags, push] = S.bus<boolean> ()
  const box = shown (
    D.el ('div', {}, [
      D.ifElse (() => D.el ('b')) (() => D.el ('i')) (S.holdWith (true) (flags)),
    ]),
  )
  assert.deepStrictEqual (box.querySelector ('b') !== null, true)
  push (false)
  assert.deepStrictEqual ([box.querySelector ('b'), box.querySelector ('i') !== null], [
    null,
    true,
  ])
})

test ('ifElse: one name from both branches is one stream', () => {
  const [flags, flip] = S.bus<boolean> ()
  const branch = D.ifElse (() =>
    D.el ('button', {}, ['yes']).use ({ chose: 'click' }),
  ) (() => D.el ('button', {}, ['no']).use ({ chose: 'click' })) (
    S.holdWith (true) (flags),
  ).use ({ chose: 'chose' })
  const heard: string[] = []
  const d = S.subscribe ((_t: S.Time, e: Event) =>
    heard.push ((e.target as Element).textContent ?? ''),
  ) (branch[D.OUT].chose)
  const box = shown (D.el ('div', {}, [branch]))
  click (box.querySelector ('button'))
  flip (false)
  click (box.querySelector ('button'))
  S.dispose (d)
  assert.deepStrictEqual (heard, ['yes', 'no'])
})

test ('match: the same key is the same markup', () => {
  const [tab, go] = S.state<string> ('home')
  let built = 0
  const box = shown (
    D.el ('div', {}, [
      D.match ({
        home: () => (built += 1, D.el ('p', {}, ['home'])),
        about: () => D.el ('p', {}, ['about']),
      }) (tab),
    ]),
  )
  const p = () => box.querySelector ('p')
  const first = p ()
  go ('home'), go ('home')
  const kept = [built, p () === first]
  go ('about')
  go ('home')
  assert.deepStrictEqual ([kept, built, dom.text (box)], [[1, true], 2, 'home'])
})

test ('match: renders the case that answers to the key', () => {
  const [keys, push] = S.bus<string> ()
  const box = shown (
    D.el ('div', {}, [
      D.match ({ home: () => D.el ('b'), about: () => D.el ('i') }) (
        S.holdWith ('home') (keys),
      ),
    ]),
  )
  assert.deepStrictEqual (box.querySelector ('b') !== null, true)
  push ('about')
  assert.deepStrictEqual (box.querySelector ('i') !== null, true)
})

test ('match: a key with no case renders nothing', () => {
  const box = shown (
    D.el ('div', {}, [
      D.match ({ home: () => D.el ('b') }) (S.holdWith ('nowhere') (S.never ())),
    ]),
  )
  assert.deepStrictEqual (box.querySelector ('b'), null)
})

test ('match: an inherited key misses', () => {
  const box = shown (
    D.el ('div', {}, [
      D.match ({ home: () => D.el ('b') }) (S.holdWith ('toString') (S.never ())),
    ]),
  )
  assert.deepStrictEqual (box.querySelector ('b'), null)
})

test ('match: a name the shown branch lacks stays quiet', () => {
  const [tabs, go] = S.bus<string> ()
  const branch = D.match ({
    list: () => D.el ('button', {}, ['+']).use ({ added: 'click' }),
    about: () => D.el ('p', {}, ['about']),
  }) (S.holdWith ('list') (tabs)).use ({ added: 'added' })
  let heard = 0
  const d = S.subscribe (() => heard += 1) (branch[D.OUT].added)
  const box = shown (D.el ('div', {}, [branch]))
  click (box.querySelector ('button'))
  go ('about')
  click (box.querySelector ('p'))
  go ('list')
  click (box.querySelector ('button'))
  S.dispose (d)
  assert.deepStrictEqual (heard, 2)
})

test ('rows: a list in a branch that comes and goes leaves nothing behind', () => {
  let walked = 0
  const [pushes, push] = S.bus<readonly string[]> ()
  const items = S.holdWith<readonly string[]> (['a']) (pushes)
  const [flags, show] = S.bus<boolean> ()

  shown (
    D.when (() =>
      D.el ('ul', {}, [
        D.rows ((_s: string, i: number) => (walked += 1, i)) ((
          one: S.HeldStream<string>,
        ) => D.el ('li', {}, [one])) (items),
      ]),
    ) (S.holdWith (true) (flags)),
  )

  const walks = (): number => {
    walked = 0
    push (['a', 'b'])
    return walked
  }

  const once = walks ()
  for (let i = 0; i < 25; i++) {
    show (false)
    show (true)
  }
  assert.deepStrictEqual ([once, walks ()], [2, 2])
})

test ('rows: a name from a branch in a row is heard with the row key', () => {
  type Entry = { readonly id: number }
  const Row = (_e: S.HeldStream<Entry>, id: number) =>
    D.el ('li', {}, [
      D.when (() => D.el ('button', {}, [String (id)]).use ({ picked: 'click' })) (
        S.holdWith (true) (S.never ()),
      ).use ({ picked: 'picked' }),
    ])
  const list = D.rows ((e: Entry) => e.id) (Row) (
    S.holdWith<readonly Entry[]> ([{ id: 1 }, { id: 2 }]) (S.never ()),
  ).use ({ picked: 'picked' })
  const heard: number[] = []
  const d = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    heard.push (id),
  ) (list[D.OUT].picked)
  const box = shown (D.el ('ul', {}, [list]))
  click (box.querySelectorAll ('button')[0])
  click (box.querySelectorAll ('button')[1])
  S.dispose (d)
  assert.deepStrictEqual (heard, [1, 2])
})

test ('rows: a branch in a row answers without a use of its own', () => {
  type Entry = { readonly id: number }
  const Row = (_e: S.HeldStream<Entry>, id: number) =>
    D.el ('li', {}, [
      D.when (() => D.el ('button', {}, [String (id)]).use ({ picked: 'click' })) (
        S.holdWith (true) (S.never ()),
      ),
    ])
  const list = D.rows ((e: Entry) => e.id) (Row) (
    S.holdWith<readonly Entry[]> ([{ id: 1 }, { id: 2 }]) (S.never ()),
  ).use ({ picked: 'picked' })
  const heard: number[] = []
  const d = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    heard.push (id),
  ) (list[D.OUT].picked)
  const box = shown (D.el ('ul', {}, [list]))
  click (box.querySelectorAll ('button')[1])
  click (box.querySelectorAll ('button')[0])
  S.dispose (d)
  assert.deepStrictEqual (heard, [2, 1])
})

test ('rows: a list in a row of a list carries both keys', () => {
  type Inner = { readonly id: string }
  type Outer = { readonly id: number; readonly items: readonly Inner[] }
  const Cell = (_e: S.HeldStream<Inner>, id: string) =>
    D.el ('span', {}, [D.el ('button', {}, [id]).use ({ hit: 'click' })])
  const Row = (entry: S.HeldStream<Outer>) =>
    D.el ('li', {}, [
      D.rows ((e: Inner) => e.id) (Cell) (P.map ((o: Outer) => o.items) (entry)),
    ])
  const list = D.rows ((e: Outer) => e.id) (Row) (
    S.holdWith<readonly Outer[]> ([
      { id: 1, items: [{ id: 'a' }, { id: 'b' }] },
      { id: 2, items: [{ id: 'c' }] },
    ]) (S.never ()),
  ).use ({ hit: 'hit' })
  const heard: string[] = []
  const d = S.subscribe (
    (
      _t: S.Time,
      [outer, [inner]]: readonly [number, readonly [string, Event]],
    ) => heard.push (`${outer}${inner}`),
  ) (list[D.OUT].hit)
  const box = shown (D.el ('ul', {}, [list]))
  for (const b of box.querySelectorAll ('button')) click (b)
  S.dispose (d)
  assert.deepStrictEqual (heard, ['1a', '1b', '2c'])
})

test ('rows: a late reader hears the nested lists', () => {
  type Inner = { readonly id: string }
  const Cell = (_e: S.HeldStream<Inner>, id: string) =>
    D.el ('span', {}, [D.el ('button', {}, [id]).use ({ hit: 'click' })])
  const Row = () =>
    D.el ('li', {}, [
      D.rows ((e: Inner) => e.id) (Cell) (
        S.holdWith<readonly Inner[]> ([{ id: 'x' }]) (S.never ()),
      ),
    ])
  const list = D.rows ((e: { readonly id: number }) => e.id) (Row) (
    S.holdWith<readonly { readonly id: number }[]> ([{ id: 7 }]) (S.never ()),
  ).use ({ hit: 'hit' })
  const box = shown (D.el ('ul', {}, [list]))
  const heard: number[] = []
  const d = S.subscribe ((_t: S.Time, [outer]: readonly [number, unknown]) =>
    heard.push (outer),
  ) (list[D.OUT].hit)
  click (box.querySelector ('button'))
  S.dispose (d)
  assert.deepStrictEqual (heard, [7])
})

test ('rows: a question after the rows are built is AskedTooLate', () => {
  type Entry = { readonly id: number }
  const Row = (_e: S.HeldStream<Entry>, id: number) =>
    D.el ('li', {}, [String (id)]).use ({ hit: 'click' })
  const list = D.rows ((e: Entry) => e.id) (Row) (
    S.holdWith<readonly Entry[]> ([{ id: 1 }]) (S.never ()),
  )
  shown (D.el ('ul', {}, [list]))
  assert.throws (
    () => list.use ({ hit: 'hit' }),
    (error: unknown) => error instanceof D.AskedTooLate && error.message.includes ('hit'),
  )
})

test ('rows: a list gives what was said, row by row, with the keys', () => {
  type Entry = { readonly id: number; readonly title: string }
  const Row = (entry: S.HeldStream<Entry>) =>
    D.el ('li', {}, [
      D.el ('input', { type: 'checkbox' }).use ({ marked: 'change' }),
      D.el ('span', {}, [P.map ((e: Entry) => e.title) (entry)]),
      D.el ('button', { type: 'button' }, ['×']).use ({ dropped: 'click' }),
    ])

  const [items, feed] = S.relayed<readonly Entry[]> ()
  const list = D.rows ((e: Entry) => e.id) (Row) (items).use ({
    marked: 'marked',
    dropped: 'dropped',
  })

  const said: string[] = []
  const a = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (`marked ${id}`),
  ) (list[D.OUT].marked)
  const b = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (`dropped ${id}`),
  ) (list[D.OUT].dropped)

  const box = shown (list)
  const held = feed (
    S.holdWith<readonly Entry[]> ([
      { id: 1, title: 'Hobbit' },
      { id: 2, title: 'Dune' },
    ]) (S.never<readonly Entry[]> ()),
  )
  const li = () =>
    Array.from (box.querySelectorAll ('li')) as unknown as HTMLElement[]

  assert.deepStrictEqual ([li ().length, dom.text (box)], [2, 'Hobbit×Dune×'])
  ;(li ()[1].querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  ;(li ()[0].querySelector ('input') as HTMLElement).dispatchEvent (
    new dom.Event ('change', { bubbles: true }),
  )
  S.dispose (a), S.dispose (b), S.dispose (held)
  assert.deepStrictEqual (said, ['dropped 2', 'marked 1'])
})

test ('rows: a row that left says nothing further', () => {
  type Entry = { readonly id: number }
  const Row = (entry: S.HeldStream<Entry>) =>
    D.el ('li', {}, [
      P.map ((e: Entry) => String (e.id)) (entry),
    ]).use ({ hit: 'click' })

  const [items, feed] = S.relayed<readonly Entry[]> ()
  const list = D.rows ((e: Entry) => e.id) (Row) (items).use ({ hit: 'hit' })
  const said: number[] = []
  const d = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (id),
  ) (list[D.OUT].hit)

  const box = shown (list)
  const [changes, push] = S.bus<readonly Entry[]> ()
  const held = feed (
    S.holdWith<readonly Entry[]> ([{ id: 1 }, { id: 2 }]) (changes),
  )
  const first = box.querySelector ('li') as HTMLElement
  first.dispatchEvent (new dom.Event ('click', { bubbles: true }))
  push ([{ id: 2 }])
  first.dispatchEvent (new dom.Event ('click', { bubbles: true }))
  ;(box.querySelector ('li') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  S.dispose (d), S.dispose (held)
  assert.deepStrictEqual (said, [1, 2])
})

test ('rows: a name is chosen by the event, and by the node as well', () => {
  type Entry = { readonly id: number }
  const Row = (entry: S.HeldStream<Entry>, id: number) =>
    D.el ('li', {}, [
      D.el ('input', { type: 'checkbox' }).use ({
        hit: 'click',
        typed: 'input',
      }),
      String (id),
      P.map ((e: Entry) => String (e.id)) (entry),
    ])

  const [items, feed] = S.relayed<readonly Entry[]> ()
  const list = D.rows ((e: Entry) => e.id) (Row) (items).use ({
    hit: 'hit',
    typed: 'typed',
  })
  const said: string[] = []
  const a = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (`hit ${id}`),
  ) (list[D.OUT].hit)
  const b = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (`typed ${id}`),
  ) (list[D.OUT].typed)

  const box = shown (list)
  const held = feed (S.holdWith<readonly Entry[]> ([{ id: 7 }]) (S.never ()))
  const input = box.querySelector ('input') as HTMLElement
  input.dispatchEvent (new dom.Event ('input', { bubbles: true }))
  input.dispatchEvent (new dom.Event ('click', { bubbles: true }))
  S.dispose (a), S.dispose (b), S.dispose (held)
  assert.deepStrictEqual (said, ['typed 7', 'hit 7'])
})

test ('rows: an event rises through the row, as it does outside a list', () => {
  type Entry = { readonly id: number }
  const Row = (_entry: S.HeldStream<Entry>) =>
    D.el ('li', {}, [
      D.el ('button', { type: 'button' }, ['×']).use ({ dropped: 'click' }),
    ]).use ({ picked: 'click' })

  const [items, feed] = S.relayed<readonly Entry[]> ()
  const list = D.rows ((e: Entry) => e.id) (Row) (items).use ({
    dropped: 'dropped',
    picked: 'picked',
  })
  const said: string[] = []
  const a = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (`dropped ${id}`),
  ) (list[D.OUT].dropped)
  const b = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (`picked ${id}`),
  ) (list[D.OUT].picked)

  const box = shown (list)
  const held = feed (S.holdWith<readonly Entry[]> ([{ id: 1 }]) (S.never ()))
  ;(box.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  ;(box.querySelector ('li') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  S.dispose (a), S.dispose (b), S.dispose (held)
  assert.deepStrictEqual (said, ['dropped 1', 'picked 1', 'picked 1'])
})

test ('rows: an event that does not bubble is not lost in a row', () => {
  type Entry = { readonly id: number }
  const Row = (_entry: S.HeldStream<Entry>) =>
    D.el ('li', {}, [
      D.el ('video', {}).use ({ finished: 'ended' }),
    ])

  const [items, feed] = S.relayed<readonly Entry[]> ()
  const list = D.rows ((e: Entry) => e.id) (Row) (items).use ({
    finished: 'finished',
  })
  const said: number[] = []
  const a = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (id),
  ) (list[D.OUT].finished)

  const box = shown (list)
  const held = feed (S.holdWith<readonly Entry[]> ([{ id: 3 }]) (S.never ()))
  ;(box.querySelector ('video') as HTMLElement).dispatchEvent (
    new dom.Event ('ended'),
  )
  S.dispose (a), S.dispose (held)
  assert.deepStrictEqual (said, [3])
})

test ('rows: two names on one event of one node are both heard', () => {
  type Entry = { readonly id: number }
  const Row = (_entry: S.HeldStream<Entry>) =>
    D.el ('li', {}, [
      D.el ('button', { type: 'button' }, ['ok']).use ({
        dropped: 'click',
        logged: 'click',
      }),
    ])

  const [items, feed] = S.relayed<readonly Entry[]> ()
  const list = D.rows ((e: Entry) => e.id) (Row) (items).use ({
    dropped: 'dropped',
    logged: 'logged',
  })
  const said: string[] = []
  const a = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (`dropped ${id}`),
  ) (list[D.OUT].dropped)
  const b = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (`logged ${id}`),
  ) (list[D.OUT].logged)

  const box = shown (list)
  const held = feed (S.holdWith<readonly Entry[]> ([{ id: 5 }]) (S.never ()))
  ;(box.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  S.dispose (a), S.dispose (b), S.dispose (held)
  assert.deepStrictEqual (said.sort (), ['dropped 5', 'logged 5'])
})

test ('rows: a row is built only for the rows that are there', () => {
  let made = 0
  let setups = 0
  let shut = 0
  type Entry = { readonly id: number }
  const Row = D.component (
    (_p: { key: number }, on: { hit: S.Stream<Event> }, start: D.Start) => {
      setups += 1
      start (S.disposable (() => shut += 1))
      const hits = S.hold ((n: number) => n + 1, 0) (on.hit)
      return D.el ('li', {}, ['×']).use ({ hit: 'click' }).output ({ hits })
    },
  )
  const Counted = (_entry: S.HeldStream<Entry>, key: number) => {
    made += 1
    return Row ({ key }).use ({ hits: 'hits' })
  }

  const [items] = S.state<readonly Entry[]> ([{ id: 1 }, { id: 2 }])
  const list = D.rows ((e: Entry) => e.id) (Counted) (items).use ({ hits: 'hits' })
  const described = [made, setups, shut, Object.keys (D.outsOf (list))]

  const d = D.mount (dom.box ()) (list)
  const mounted = [made, setups]
  S.dispose (d)
  assert.deepStrictEqual ([described, mounted, shut], [[0, 0, 0, ['hits']], [2, 2], 2])
})

test ('rows: a row removed by its own name does not speak again', () => {
  type Entry = { readonly id: number }
  const Row = (_entry: S.HeldStream<Entry>) =>
    D.el ('li', {}, [
      D.el ('button', { type: 'button' }, ['×']).use ({ dropped: 'click' }),
    ]).use ({ picked: 'click' })

  const [items, feed] = S.relayed<readonly Entry[]> ()
  const list = D.rows ((e: Entry) => e.id) (Row) (items).use ({
    dropped: 'dropped',
    picked: 'picked',
  })
  const [changes, push] = S.bus<readonly Entry[]> ()
  const said: string[] = []
  const a = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) => {
    said.push (`dropped ${id}`)
    push ([])
  }) (list[D.OUT].dropped)
  const b = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (`picked ${id}`),
  ) (list[D.OUT].picked)

  const box = shown (list)
  const held = feed (S.holdWith<readonly Entry[]> ([{ id: 1 }]) (changes))
  ;(box.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  S.dispose (a), S.dispose (b), S.dispose (held)
  assert.deepStrictEqual ([said, box.querySelectorAll ('li').length], [['dropped 1'], 0])
})

test ('rows: a component row gives a part of its model with the row key', () => {
  type Entry = { readonly id: number; readonly title: string }
  const Row = (entry: S.HeldStream<Entry>, id: number) =>
    D.component (
      (_p: void, on: { hit: S.Stream<Event> }) => {
        const shown = S.hold ((t: string) => `${t}!`, `book ${id}`) (on.hit)
        return D.el ('li', {}, [
          D.el ('button', {}, ['×']).use ({ hit: 'click' }),
          shown,
          P.map ((e: Entry) => e.title) (entry),
        ]).output ({ shown })
      },
    ) ().use ({ picked: 'shown' })

  const [items, feed] = S.relayed<readonly Entry[]> ()
  const list = D.rows ((e: Entry) => e.id) (Row) (items).use ({ picked: 'picked' })
  const said: string[] = []
  const a = S.subscribe ((_t: S.Time, [id, what]: readonly [number, string]) =>
    said.push (`${id}:${what}`),
  ) (list[D.OUT].picked)

  const box = shown (list)
  const held = feed (
    S.holdWith<readonly Entry[]> ([{ id: 1, title: 'Dune' }]) (S.never ()),
  )
  ;(box.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  S.dispose (a), S.dispose (held)
  assert.deepStrictEqual (said, ['1:book 1', '1:book 1!'])
})

test ('rows: one name from a part and a markup event is heard as both', () => {
  type Entry = { readonly id: number }
  const Inner = D.component ((_p: void, on: { tap: S.Stream<Event> }) => {
    const what = S.hold (() => 'said', 'held') (on.tap)
    return D.el ('span', {}, [what]).use ({ tap: 'dblclick' }).output ({ what })
  })
  const Row = (_e: S.HeldStream<Entry>) =>
    D.el ('li', {}, [
      Inner ().use ({ x: 'what' }),
      D.el ('button', {}, ['click']),
    ]).use ({ x: 'click' })

  const [items, feed] = S.relayed<readonly Entry[]> ()
  const list = D.rows ((e: Entry) => e.id) (Row) (items).use ({ x: 'x' })
  const said: string[] = []
  const a = S.subscribe ((_t: S.Time, [id, v]: readonly [number, unknown]) =>
    said.push (`${id}:${typeof v === 'string' ? v : (v as Event).type}`),
  ) (list[D.OUT].x as S.Stream<readonly [number, unknown]>)

  const box = shown (list)
  const held = feed (S.holdWith<readonly Entry[]> ([{ id: 1 }]) (S.never ()))
  ;(box.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  S.dispose (a), S.dispose (held)
  assert.deepStrictEqual (said, ['1:held', '1:click'])
})

test ('rows: a name nobody reads costs a row nothing', () => {
  let added = 0
  let et = Object.getPrototypeOf (dom.document.createElement ('li'))
  while (et !== null && !Object.hasOwn (et, 'addEventListener')) {
    et = Object.getPrototypeOf (et)
  }
  const real = et.addEventListener
  et.addEventListener = function(this: EventTarget, ...a: unknown[]) {
    added += 1
    return (real as (...xs: unknown[]) => unknown).apply (this, a)
  }

  type Entry = { readonly id: number }
  const Row = (_e: S.HeldStream<Entry>, id: number) =>
    D.el ('li', {}, [String (id)]).use ({ hit: 'click' })
  const many = Array.from ({ length: 20 }, (_, i) => ({ id: i }))

  const quiet = D.rows ((e: Entry) => e.id) (Row) (
    S.holdWith<readonly Entry[]> (many) (S.never ()),
  ).use ({ hit: 'hit' })
  const a = D.mount (dom.box ()) (quiet)
  const withoutReader = added

  added = 0
  const loud = D.rows ((e: Entry) => e.id) (Row) (
    S.holdWith<readonly Entry[]> (many) (S.never ()),
  ).use ({ hit: 'hit' })
  const sub = S.subscribe (() => {}) (
    loud[D.OUT].hit as S.Stream<readonly [number, Event]>,
  )
  const b = D.mount (dom.box ()) (loud)
  const withReader = added

  et.addEventListener = real
  S.dispose (sub), a[Symbol.dispose] (), b[Symbol.dispose] ()
  assert.deepStrictEqual ([withoutReader, withReader], [0, 20])
})

test ('rows: a late reader hears the rows that are already up', () => {
  type Entry = { readonly id: number }
  const Row = (_e: S.HeldStream<Entry>, id: number) =>
    D.el ('li', {}, [String (id)]).use ({ hit: 'click' })
  const list = D.rows ((e: Entry) => e.id) (Row) (
    S.holdWith<readonly Entry[]> ([{ id: 1 }, { id: 2 }]) (S.never ()),
  ).use ({ hit: 'hit' })
  const box = shown (list)
  const li = () =>
    Array.from (box.querySelectorAll ('li')) as unknown as HTMLElement[]
  const click = (n: number) =>
    li ()[n].dispatchEvent (new dom.Event ('click', { bubbles: true }))

  click (0)

  const said: number[] = []
  const a = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (id),
  ) (list[D.OUT].hit as S.Stream<readonly [number, Event]>)
  click (0), click (1)
  const heard = [...said]

  S.dispose (a)
  click (0)
  const afterOff = said.length

  const b = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    said.push (id),
  ) (list[D.OUT].hit as S.Stream<readonly [number, Event]>)
  click (1)
  S.dispose (b)
  assert.deepStrictEqual ([heard, afterOff, said], [[1, 2], 2, [1, 2, 2]])
})

test ('component: on hears a list inside a branch with no use on the list', () => {
  type Entry = { readonly id: number }
  type On = { readonly dropped: S.Stream<readonly [number, Event]> }
  const Row = (_e: S.HeldStream<Entry>, id: number) =>
    D.el ('li', {}, [
      D.el ('button', {}, [String (id)]).use ({ dropped: 'click' }),
    ])
  const Page = D.component ((_p: void, on: On) => {
    const last = S.holdWith ('—') (
      P.map (([id]: readonly [number, Event]) => String (id)) (on.dropped),
    )
    return D.el ('section', {}, [
      D.when (() =>
        D.el ('ul', {}, [
          D.rows ((e: Entry) => e.id) (Row) (
            S.holdWith<readonly Entry[]> ([{ id: 1 }, { id: 2 }]) (S.never ()),
          ),
        ]),
      ) (S.holdWith (true) (S.never ())),
      D.el ('output', {}, [last]),
    ])
  })
  const box = shown (Page ())
  click (box.querySelectorAll ('button')[1])
  assert.deepStrictEqual (box.querySelector ('output')?.textContent, '2')
})

test ('component: a closed boundary, its markup cannot be asked through it', () => {
  const Inner = D.component ((_p: void) =>
    D.el ('button', {}, ['×']).use ({ secret: 'click' }),
  )
  let heard = 0
  const Outer = D.component ((_p: void, h: { secret: S.Stream<Event> }) => {
    const n = S.hold ((x: number) => x + 1, 0) (h.secret)
    return D.el ('div', {}, [
      D.when (() => Inner ()) (S.holdWith (true) (S.never ())),
      D.el ('output', {}, [P.map ((x: number) => (heard = x, String (x))) (n)]),
    ]) as unknown as D.View
  })
  const box = shown (Outer ())
  click (box.querySelector ('button'))
  assert.deepStrictEqual ([heard, box.querySelector ('output')?.textContent], [0, '0'])
})

test ('component: a click leaves as the name given to output', () => {
  const Button = D.component (
    (p: { label: string }, on: { pressed: S.Stream<Event> }) =>
      D.el ('button', {}, [p.label]).use ({ pressed: 'click' })
        .output ({ pressed: on.pressed }),
  )

  const b = Button ({ label: 'ok' }).use ({ hit: 'pressed' })
  const heard: string[] = []
  const d = S.subscribe ((_t: S.Time, e: Event) => heard.push (e.type)) (
    b[D.OUT].hit,
  )
  const box = shown (b)
  box.querySelector ('button')!.dispatchEvent (new dom.Event ('click'))
  assert.deepStrictEqual ([dom.text (box), heard], ['ok', ['click']])
  S.dispose (d)
})

test ('component: a click updates the count drawn from that click', () => {
  const Counter = D.component (
    (_p: void, on: { bumped: S.Stream<Event> }) => {
      const count = S.hold ((n: number) => n + 1, 0) (on.bumped)
      return D.el ('p', undefined, [
        D.el ('button', {}).use ({ bumped: 'click' }),
        ' ',
        count,
      ]).output ({ count })
    },
  )

  const box = shown (Counter ())
  assert.deepStrictEqual (dom.text (box), ' 0')
  const button = box.querySelector ('button') as HTMLElement
  button.dispatchEvent (new dom.Event ('click', { bubbles: true }))
  button.dispatchEvent (new dom.Event ('click', { bubbles: true }))
  assert.deepStrictEqual (dom.text (box), ' 2')
})

test ('component: what was given goes out, under the name the taker chose', () => {
  const Counter = D.component (
    (_p: void, on: { bumped: S.Stream<Event> }) => {
      const count = S.hold ((n: number) => n + 1, 7) (on.bumped)
      return D.el ('p', undefined, [
        D.el ('button', {}).use ({ bumped: 'click' }),
      ])
        .output ({ count })
    },
  )

  const built = Counter ().use ({ counted: 'count' })
  const seen: number[] = []
  const a = S.subscribe ((_t: S.Time, n: number) => seen.push (n)) (
    built[D.OUT].counted,
  )
  const box = shown (built)
  ;(box.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  S.dispose (a)
  assert.deepStrictEqual ([seen, Object.keys (D.outsOf (built))], [[7, 8], ['counted']])
})

test ('component: a change to one output does not emit on another', () => {
  const Two = D.component (
    (_p: void, on: { typed: S.Stream<Event>; flipped: S.Stream<Event> }) => {
      const draft = S.holdWith ('') (P.map (D.valueOf) (on.typed))
      const open = S.hold ((b: boolean) => !b, false) (on.flipped)
      return D.el ('p', undefined, [
        D.el ('input', {}).use ({ typed: 'input' }),
        D.el ('button', {}).use ({ flipped: 'click' }),
        draft,
        P.map ((b: boolean) => b ? 'yes' : 'no') (open),
      ]).output ({ draft, open })
    },
  )

  const built = Two ().use ({ draft: 'draft', open: 'open' })
  let drafts = 0, opens = 0
  const a = S.subscribe (() => drafts += 1) (built[D.OUT].draft)
  const b = S.subscribe (() => opens += 1) (built[D.OUT].open)
  const box = shown (built)
  drafts = 0, opens = 0

  const field = box.querySelector ('input') as unknown as { value: string }
  field.value = 'a'
  box.querySelector ('input')!.dispatchEvent (
    new dom.Event ('input', { bubbles: true }),
  )
  assert.deepStrictEqual ([drafts, opens], [1, 0])
  S.dispose (a), S.dispose (b)
})

test ('component: what was not given is absent outside', () => {
  const Quiet = D.component ((_p: void, on: { typed: S.Stream<Event> }) => {
    const draft = S.holdWith ('') (P.map (D.valueOf) (on.typed))
    const said = P.map ((s: string) => s.toUpperCase ()) (draft)
    return D.el ('p', undefined, [
      D.el ('input', {}).use ({ typed: 'input' }),
      said,
    ]).output ({ said })
  })

  const built = Quiet ()
  assert.deepStrictEqual (Object.keys (D.outsOf (built)), [])
  const box = shown (built)
  const field = box.querySelector ('input') as unknown as { value: string }
  field.value = 'quiet'
  box.querySelector ('input')!.dispatchEvent (
    new dom.Event ('input', { bubbles: true }),
  )
  assert.deepStrictEqual (dom.text (box), 'QUIET')
})

test ('component: disposing the view stops the stream the markup folded', () => {
  let live = 0
  const source = S.stream<number> ((snk, sch) => {
    live += 1
    void snk
    void sch
    return S.disposable (() => live -= 1)
  })
  const Thing = D.component ((_p: void, _on: D.None) => {
    const count = S.hold ((n: number, by: number) => n + by, 0) (source)
    return D.el ('i', undefined, [count]).output ({ count })
  })

  const built = Thing ()
  const stop = D.mount (dom.box ()) (built)
  assert.deepStrictEqual (live, 1)
  S.dispose (stop)
  assert.deepStrictEqual (live, 0)
})

test ('component: a stream view gets a wrapper that takes no room', () => {
  const [values, push] = S.bus<D.Child> ()
  const Live = D.component (() => S.holdWith<D.Child> ('one') (values))
  const box = shown (Live ())
  const wrapper = box.querySelector ('span')
  assert.deepStrictEqual (wrapper?.style.display, 'contents')
  push ('two')
  assert.deepStrictEqual (dom.text (box), 'two')
})

test ('component: output on a branch root is what the parent is given', () => {
  const open = S.holdWith (true) (S.never<boolean> ())
  const Panel = D.component (
    (_p: void, on: { closed: S.Stream<Event> }) => {
      const hits = S.hold ((k: number) => k + 1, 0) (on.closed)
      return D.when (() => D.el ('button', {}, ['x']).use ({ closed: 'click' })) (
        open,
      ).use ({ closed: 'closed' }).output ({ hits })
    },
  )
  const built = Panel ().use ({ hits: 'hits' })
  const seen: number[] = []
  const stop = S.subscribe ((_t: S.Time, n: number) => seen.push (n)) (
    built[D.OUT].hits,
  )
  const box = shown (built)
  ;(box.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  S.dispose (stop)
  assert.deepStrictEqual ([seen, box.querySelector ('span')], [[0, 1], null])
})

test ('component: a branch at the root is asked, and nothing wraps it', () => {
  const open = S.holdWith (true) (S.never<boolean> ())
  const Panel = D.component (
    (_p: void, on: { closed: S.Stream<Event> }) => {
      const n = S.hold ((k: number) => k + 1, 0) (on.closed)
      return D.when (() => D.el ('button', {}, [n]).use ({ closed: 'click' })) (
        open,
      ).use ({ closed: 'closed' })
    },
  )
  const box = shown (D.el ('div', {}, [Panel ()]))
  const button = box.querySelector ('button') as HTMLElement
  assert.deepStrictEqual (button.parentElement, box.querySelector ('div'))
  assert.deepStrictEqual (button.textContent, '0')
  button.dispatchEvent (new dom.Event ('click', { bubbles: true }))
  assert.deepStrictEqual (button.textContent, '1')
})

test ('component: a list at the root is asked, and its rows stay direct', () => {
  type Item = { readonly id: number }
  const items = S.holdWith<readonly Item[]> ([{ id: 1 }]) (S.never ())
  const List = D.component (
    (_p: void, on: { hit: S.Stream<readonly [number, Event]> }) => {
      const n = S.hold ((k: number) => k + 1, 0) (on.hit)
      return D.rows ((item: Item) => item.id) (
        () =>
          D.el ('li', {}, [
            n,
            D.el ('button', {}, ['x']).use ({ hit: 'click' }),
          ]),
      ) (items)
    },
  )
  const box = shown (D.el ('ul', {}, [List ()]))
  const ul = box.querySelector ('ul') as HTMLElement
  const li = ul.querySelector ('li') as HTMLElement
  assert.deepStrictEqual (li.parentElement, ul)
  assert.deepStrictEqual (box.querySelector ('span'), null)
  assert.deepStrictEqual (li.textContent, '0x')
  ;(li.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  assert.deepStrictEqual (li.textContent, '1x')
})

test ('component: output on props alone is what use names', () => {
  const count = S.holdWith (1) (S.never<number> ())
  const Clock = D.component ((p: { from: number }) =>
    D.el ('p', {}, [p.from]).output ({ count }),
  )
  const clock = Clock ({ from: 1 }).use ({ shown: 'count' })
  const seen: number[] = []
  const sub = S.subscribe ((_t: S.Time, n: number) => seen.push (n)) (
    clock[D.OUT].shown,
  )
  shown (clock)
  S.dispose (sub)
  assert.deepStrictEqual (seen, [1])
})

test ('component: on the markup does not answer is refused', () => {
  const element = (_p: void, on: { bumped: S.Stream<Event> }) => {
    const n = S.hold ((x: number) => x + 1, 0) (on.bumped)
    return D.el ('p', {}, [n]).output ({ n })
  }
  const open = S.holdWith (true) (S.never<boolean> ())
  const branched = (_p: void, on: { bumped: S.Stream<Event> }) => {
    const n = S.hold ((x: number) => x + 1, 0) (on.bumped)
    return D.when (() => D.el ('p', {}, [n])) (open).output ({ n })
  }
  // @ts-expect-error the paragraph does not say bumped
  D.component (element)
  // @ts-expect-error the branch does not say bumped
  D.component (branched)
})

test ('component: output before use on the root still leaves the gift', () => {
  const count = S.holdWith (2) (S.never<number> ())
  const Late = D.component ((p: { from: number }) =>
    D.el ('p', {}, [p.from]).output ({ count }).use ({ hit: 'click' }),
  )
  const late = Late ({ from: 2 }).use ({ shown: 'count' })
  const seen: number[] = []
  const sub = S.subscribe ((_t: S.Time, n: number) => seen.push (n)) (
    late[D.OUT].shown,
  )
  shown (late)
  S.dispose (sub)
  assert.deepStrictEqual (seen, [2])
})

test ('start: returns that disposable, and disposes it when the view leaves', () => {
  let shut = 0
  const handle = S.disposable (() => shut += 1)
  let handed: Disposable | null = null
  const box = dom.box ()
  const Thing = D.component ((_p: void, _on: D.None, start: D.Start) => {
    handed = start (handle)
    return D.el ('i')
  })
  S.dispose (D.mount (box) (Thing ()))
  assert.deepStrictEqual ([handed, shut, box.innerHTML], [handle, 1, ''])
})

test ('output: use before or after output keeps the gift, and a branch stays a stream', () => {
  const count = S.holdWith (0) (S.never<number> ())
  const open = S.holdWith (true) (S.never<boolean> ())
  const late = D.el ('button', {}, ['+']).output ({ count }).use ({
    hit: 'click',
  })
  const early = D.el ('button', {}, ['+']).use ({ hit: 'click' }).output ({
    count,
  })
  const branch = D.when (() =>
    D.el ('button', {}, ['x']).use ({ closed: 'click' }),
  ) (
    open,
  ).output ({ count }).use ({ closed: 'closed' })
  const list = D.rows ((n: number) => n) (() =>
    D.el ('li', {}, [D.el ('button', {}, ['x']).use ({ dropped: 'click' })]),
  ) (S.holdWith<readonly number[]> ([1]) (S.never ())).output ({ count }).use ({
    dropped: 'dropped',
  })
  const wrapped = D.view (dom.document.createElement ('div')).use ({
    hit: 'click',
  })
    .output ({ count })
  const mark = D.comment ('m').output ({ count }).use ({ hit: 'click' })
  type Gifts = [
    Assert<
      typeof late extends D.Giving<{ count: S.HeldStream<number> }> ? true
        : false
    >,
    Assert<
      typeof early extends D.Giving<{ count: S.HeldStream<number> }> ? true
        : false
    >,
    Assert<
      typeof branch extends D.Giving<{ count: S.HeldStream<number> }> ? true
        : false
    >,
    Assert<typeof branch extends D.View ? false : true>,
    Assert<
      typeof list extends D.Giving<{ count: S.HeldStream<number> }> ? true
        : false
    >,
    Assert<typeof list extends S.HeldStream<D.View[]> ? true : false>,
    Assert<typeof list extends D.View ? false : true>,
    Assert<
      typeof wrapped extends D.Giving<{ count: S.HeldStream<number> }> ? true
        : false
    >,
    Assert<
      typeof mark extends D.Giving<{ count: S.HeldStream<number> }> ? true
        : false
    >,
  ]
  const gifts: Gifts = [true, true, true, true, true, true, true, true, true]
  const stop = D.mount (dom.box ()) (branch)
  S.dispose (stop)
  assert.deepStrictEqual ([
    D.isView (branch),
    S.isHeld (branch),
    S.isHeld (list),
    gifts.length,
  ], [
    false,
    true,
    true,
    9,
  ])
  // @ts-expect-error a branch is a stream, so hydrate does not take it
  D.hydrate (dom.box ()) (branch)
  // @ts-expect-error a branch has no node
  D.node (branch)
})

test ('use: a name on a branch reaches the list inside it', () => {
  type Entry = { readonly id: number }
  const Row = (_e: S.HeldStream<Entry>, id: number) =>
    D.el ('li', {}, [
      D.el ('button', {}, [String (id)]).use ({ dropped: 'click' }),
    ])
  const branch = D.when (() =>
    D.el ('ul', {}, [
      D.rows ((e: Entry) => e.id) (Row) (
        S.holdWith<readonly Entry[]> ([{ id: 1 }, { id: 2 }]) (S.never ()),
      ),
    ]),
  ) (S.holdWith (true) (S.never ())).use ({ dropped: 'dropped' })
  const heard: number[] = []
  const d = S.subscribe ((_t: S.Time, [id]: readonly [number, Event]) =>
    heard.push (id),
  ) (branch[D.OUT].dropped)
  const box = shown (D.el ('div', {}, [branch]))
  click (box.querySelectorAll ('button')[0])
  click (box.querySelectorAll ('button')[1])
  S.dispose (d)
  assert.deepStrictEqual (heard, [1, 2])
})

test ('use: names travel up to the parent through three levels', () => {
  const said = D.el ('div', {}, [
    D.el ('form', {}, [
      D.el ('input', { name: 'title' }).use ({ typed: 'input' }),
      D.el ('button', { type: 'submit' }, ['add']),
    ]).use ({ added: 'submit' }),
    D.el ('p', {}, ['left: ', 3]),
    D.el ('p', {}, [
      D.el ('button', { type: 'button' }, ['remove']).use ({ cleared: 'click' }),
    ]),
  ])

  const exact: {
    readonly typed: S.Stream<Event>
    readonly added: S.Stream<Event>
    readonly cleared: S.Stream<Event>
  } = said[D.OUT]
  const back: typeof said[typeof D.OUT] = exact
  assert.deepStrictEqual (Object.keys (D.outsOf (said)).sort (), [
    'added',
    'cleared',
    'typed',
  ])
  assert.deepStrictEqual (back === exact, true)
})

test ('use: two elements under one name are one stream', () => {
  const two = D.el ('div', {}, [
    D.el ('button', { class: 'a' }, ['a']).use ({ hit: 'click' }),
    D.el ('button', { class: 'b' }, ['b']).use ({ hit: 'click' }),
  ])
  const seen: string[] = []
  const d = S.subscribe ((_t: S.Time, e: Event) =>
    seen.push ((e.target as HTMLElement).className),
  ) (two[D.OUT].hit)
  const box = shown (two)
  ;(box.querySelector ('.a') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  ;(box.querySelector ('.b') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  S.dispose (d)
  assert.deepStrictEqual (seen, ['a', 'b'])
})

test ('use: a projection still has time to cancel the event', () => {
  const said = D.el ('form', {}, [D.el ('button', { type: 'submit' })]).use ({
    added: 'submit',
  })
  const seen: boolean[] = []
  const d = S.subscribe ((_t: S.Time, ok: boolean) => seen.push (ok)) (
    P.map ((e: Event) => (e.preventDefault (), e.defaultPrevented)) (
      said[D.OUT].added,
    ),
  )
  const box = shown (said)
  const ev = new dom.Event ('submit', { bubbles: true, cancelable: true })
  ;(box.querySelector ('form') as HTMLElement).dispatchEvent (ev)
  S.dispose (d)
  assert.deepStrictEqual ([seen, ev.defaultPrevented], [[true], true])
})

test ('use: adopted markup speaks the same way as markup that was built', () => {
  const source = dom.box ()
  const first = D.el ('p', {}, [
    D.el ('button', {}, ['×']).use ({ hit: 'click' }),
  ])
  const dsp = D.mount (source) (first)
  const markup = source.innerHTML
  S.dispose (dsp)

  const box = dom.box ()
  box.innerHTML = markup
  const again = D.el ('p', {}, [
    D.el ('button', {}, ['×']).use ({ hit: 'click' }),
  ])
  const seen: string[] = []
  const d = S.subscribe ((_t: S.Time, e: Event) => seen.push (e.type)) (
    again[D.OUT].hit,
  )
  const live = D.hydrate (box) (again)
  ;(box.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  const kept = box.innerHTML === markup
  S.dispose (d), S.dispose (live)
  assert.deepStrictEqual ([kept, seen], [true, ['click']])
})

test ('use: a component gives a part of its model, not a markup event', () => {
  type Counted = { readonly count: S.HeldStream<number> }
  const Counter = D.component (
    (p: { from: number }, on: { bumped: S.Stream<Event> }) => {
      const count = S.hold ((n: number) => n + 1, p.from) (on.bumped)
      return D.el ('p', {}, [
        D.el ('button', {}, ['+']).use ({ bumped: 'click' }),
        count,
      ]).output ({ count })
    },
  )

  const counter = Counter ({ from: 3 }).use ({ counted: 'count' })
  const heard: number[] = []
  const a = S.subscribe ((_t: S.Time, n: number) => heard.push (n)) (
    counter[D.OUT].counted,
  )
  const page = D.el ('div', {}, [counter])
  const up: number[] = []
  const b = S.subscribe ((_t: S.Time, n: number) => up.push (n)) (
    page[D.OUT].counted,
  )

  const box = shown (page)
  ;(box.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  S.dispose (a), S.dispose (b)
  assert.deepStrictEqual ([heard, up], [[3, 4], [3, 4]])
})

test ('use: a component markup stays silent outside, and the boundary holds', () => {
  const Counter = D.component (
    (_p: void, on: { bumped: S.Stream<Event> }) => {
      const count = S.hold ((n: number) => n + 1, 0) (on.bumped)
      return D.el ('p', {}, [
        D.el ('button', {}, ['+']).use ({ bumped: 'click' }),
      ])
        .output ({ count })
    },
  )
  const page = D.el ('div', {}, [Counter ()])
  assert.deepStrictEqual (Object.keys (D.outsOf (page)), [])
})

test ('use: two readers of one event-part share one subscription', () => {
  let added = 0
  let mapped = 0
  let et = Object.getPrototypeOf (dom.document.createElement ('p'))
  while (et !== null && !Object.hasOwn (et, 'addEventListener')) {
    et = Object.getPrototypeOf (et)
  }
  const real = et.addEventListener
  et.addEventListener = function(this: EventTarget, ...a: unknown[]) {
    added += 1
    return (real as (...xs: unknown[]) => unknown).apply (this, a)
  }

  const Editor = D.component ((_p: void, on: { sent: S.Stream<Event> }) => {
    const saved = P.map ((e: Event) => (mapped += 1, D.prevented (e).type)) (
      on.sent,
    )
    return D.el ('form', {}, [D.el ('button', {}, ['ok'])])
      .use ({ sent: 'submit' })
      .output ({ saved })
  })

  const editor = Editor ().use ({ stored: 'saved' })
  const box = shown (D.el ('div', {}, [editor]))
  added = 0
  const one: string[] = []
  const two: string[] = []
  const a = S.subscribe ((_t: S.Time, s: string) => one.push (s)) (
    editor[D.OUT].stored,
  )
  const b = S.subscribe ((_t: S.Time, s: string) => two.push (s)) (
    editor[D.OUT].stored,
  )
  mapped = 0
  ;(box.querySelector ('form') as HTMLElement).dispatchEvent (
    new dom.Event ('submit', { bubbles: true, cancelable: true }),
  )
  S.dispose (a), S.dispose (b)
  et.addEventListener = real
  assert.deepStrictEqual (
    [added, mapped, one, two],
    [0, 1, ['submit'], ['submit']],
  )
})

test ('use: what was given holds, and ends when the component closes', () => {
  const Counter = D.component (
    (_p: void, on: { bumped: S.Stream<Event> }) => {
      const count = S.hold ((n: number) => n + 1, 0) (on.bumped)
      return D.el ('p', {}, [
        D.el ('button', {}, ['+']).use ({ bumped: 'click' }),
        count,
      ]).output ({ count })
    },
  )
  const counter = Counter ().use ({ counted: 'count' })
  const box = dom.box ()
  const d = D.mount (box) (counter)
  ;(box.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )

  const late: number[] = []
  const a = S.subscribe ((_t: S.Time, n: number) => late.push (n)) (
    counter[D.OUT].counted,
  )
  S.dispose (a)

  d[Symbol.dispose] ()
  const after: number[] = []
  let ended = false
  const b = S.subscribe (
    (_t: S.Time, n: number) => after.push (n),
    () => ended = true,
  ) (counter[D.OUT].counted)
  S.dispose (b)
  assert.deepStrictEqual ([late, after, ended], [[1], [1], true])
})

test ('use: a name the component never gave is NoSuchPart', () => {
  const Counter = D.component (
    (_p: void, on: { bumped: S.Stream<Event> }) => {
      const count = S.hold ((n: number) => n + 1, 0) (on.bumped)
      return D.el ('p', {}, [
        D.el ('button', {}, ['+']).use ({ bumped: 'click' }),
      ])
        .output ({ count })
    },
  )
  const early = (Counter () as unknown as D.Drawn<D.None>).use ({
    counted: 'cont',
  })
  assert.throws (
    () => D.mount (dom.box ()) (early),
    (error: unknown) => error instanceof D.NoSuchPart && error.message.includes ('cont'),
  )

  const built = Counter ()
  const d = D.mount (dom.box ()) (built)
  assert.throws (
    () => (built as unknown as D.Drawn<D.None>).use ({ counted: 'cont' }),
    (error: unknown) => error instanceof D.NoSuchPart && error.message.includes ('cont'),
  )
  S.dispose (d)

  const Bare = D.component ((p: { label: string }) =>
    D.el ('button', {}, [p.label]),
  )
  const bare = (Bare ({ label: 'ok' }) as unknown as D.Drawn<D.None>).use ({
    hit: 'click',
  })
  assert.throws (() => D.mount (dom.box ()) (bare), D.NoSuchPart)
})

test ('use: something given that the markup never draws still goes out', () => {
  const Counter = D.component (
    (_p: void, on: { bumped: S.Stream<Event> }) => {
      const count = S.hold ((n: number) => n + 1, 0) (on.bumped)
      const twice = S.hold ((n: number) => n + 2, 0) (on.bumped)
      return D.el ('p', {}, [
        D.el ('button', {}, ['+']).use ({ bumped: 'click' }),
        count,
      ]).output ({ count, twice })
    },
  )
  const made = Counter ().use ({ shown: 'count', hidden: 'twice' })
  const seen: number[] = []
  const a = S.subscribe ((_t: S.Time, n: number) => seen.push (n)) (
    made[D.OUT].hidden,
  )
  const box = shown (made)
  ;(box.querySelector ('button') as HTMLElement).dispatchEvent (
    new dom.Event ('click', { bubbles: true }),
  )
  S.dispose (a)
  assert.deepStrictEqual ([Object.keys (D.outsOf (made)), seen], [['shown', 'hidden'], [
    0,
    2,
  ]])
})

test ('setBackend: hands back the backend that was in place', () => {
  const current = D.getBackend ()
  const previous = D.setBackend (current)
  assert.deepStrictEqual (previous, current)
  assert.deepStrictEqual (D.setBackend (previous), current)
})
