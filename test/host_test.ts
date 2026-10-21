import * as P from '@algosail/ply'
import * as S from '@algosail/plystream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Child, View } from '../src/view.ts'
import * as H from '../src/h.ts'
import { hydrateHost } from '../src/hosts/hydrate.ts'
import * as D from '../src/mod.ts'
import { installDom } from './test_util.ts'

const dom = installDom ()

const rendered = (build: () => View): string => {
  const first = dom.box ()
  D.mount (first) (build ())
  return first.innerHTML
}

const laidOut = (html: string): HTMLElement => {
  const box = dom.box ()
  box.innerHTML = html
  return box
}

const marks = (box: HTMLElement): number => {
  let n = 0
  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === 8) n += 1
      walk (child)
    }
  }
  walk (box)
  return n
}

let owned = 0
let setups = 0

const Owning = D.component ((_p: void, _on: D.None, start: D.Start) => {
  setups += 1
  owned += 1
  start (S.disposable (() => owned -= 1))
  return H.p (['a'])
})

const Deep = D.component ((_p: void, _on: D.None, start: D.Start) => {
  setups += 1
  owned += 1
  start (S.disposable (() => owned -= 1))
  return H.p ([H.em (['a'])])
})

const counting = () => {
  owned = 0
  setups = 0
}

test ('hydrate: takes over the nodes instead of building new ones', () => {
  const build = () => H.div ({ class: 'card' }, ['head', H.span (['body'])])
  const box = laidOut (rendered (build))
  const before = box.querySelector ('span')
  D.hydrate (box) (build)
  assert.deepStrictEqual (box.querySelector ('span'), before)
})

test ('hydrate: the markup comes out unchanged', () => {
  const build = () => H.div ({ class: 'card' }, ['head', H.span (['body'])])
  const html = rendered (build)
  const box = laidOut (html)
  D.hydrate (box) (build)
  assert.deepStrictEqual (box.innerHTML, html)
})

test ('hydrate: props are bound to the adopted node', () => {
  let clicks = 0
  const build = () => H.button ({ 'on:click': () => clicks += 1 }, ['go'])
  const box = laidOut (rendered (build))
  D.hydrate (box) (build)
  box.querySelector ('button')?.dispatchEvent (new dom.Event ('click'))
  assert.deepStrictEqual (clicks, 1)
})

test ('hydrate: markup that diverges falls back to a render', () => {
  const build = () => H.div ({ class: 'card' }, ['body'])
  const box = laidOut ('<p>nothing like it</p>')
  D.hydrate (box) (build)
  assert.deepStrictEqual (box.querySelector ('p'), null)
  assert.deepStrictEqual (box.querySelector ('div.card') !== null, true)
})

test ('hydrate: a view needs no factory, markup that diverges or not', () => {
  const box = laidOut ('<p>nothing like it</p>')
  D.hydrate (box) (H.div (['body']))
  assert.deepStrictEqual (box.innerHTML, '<div>body</div>')
})

test ('hydrate: splits text the server ran together', () => {
  const build = () => H.div ({}, [['one', 'two'], 'three'])
  const html = rendered (build)
  const box = laidOut (html)
  const before = box.querySelector ('div')
  D.hydrate (box) (build)
  assert.deepStrictEqual (box.querySelector ('div'), before)
  assert.deepStrictEqual (dom.text (box), 'onetwothree')
})

test ('hydrate: the split leaves one node per string, in order', () => {
  const build = () => H.div ({}, [['one', 'two'], 'three'])
  const box = laidOut (rendered (build))
  D.hydrate (box) (build)

  const said = [...(box.querySelector ('div') as Element).childNodes]
    .filter ((n) => n.nodeType === 3)
    .map ((n) => (n as Text).data)
  assert.deepStrictEqual (said, ['one', 'two', 'three'])
})

test ('hydrate: the split asks the DOM for nothing optional', () => {
  const proto = Object.getPrototypeOf (
    dom.document.createTextNode (''),
  ) as { splitText?: unknown }
  const had = proto.splitText
  delete proto.splitText

  try {
    const build = () => H.div ({}, [['one', 'two'], 'three'])
    const box = laidOut (rendered (build))
    D.hydrate (box) (build)
    assert.deepStrictEqual (dom.text (box), 'onetwothree')
  } finally {
    proto.splitText = had
  }
})

test ('hydrate: an empty cell claims its region and leaves it empty', () => {
  const build = () =>
    H.div ({}, [D.when (() => H.span (['shown'])) (S.holdWith (false) (S.never ()))])
  const html = rendered (build)
  const box = laidOut (html)
  D.hydrate (box) (build)
  assert.deepStrictEqual (box.innerHTML, html)
})

test ('hydrate: a cell with contents adopts them', () => {
  const build = () =>
    H.div ({}, [
      'before',
      S.holdWith<Child> (H.span (['in'])) (S.never ()),
      'after',
    ])
  const box = laidOut (rendered (build))
  const before = box.querySelector ('span')
  D.hydrate (box) (build)
  assert.deepStrictEqual (box.querySelector ('span'), before)
})

test ('hydrate: an adopted cell is live, not merely in place', () => {
  let clicked = 0
  const build = () =>
    H.div ({}, [
      S.holdWith (
        H.button ({ 'on:click': () => clicked += 1 }, ['go']) as Child,
      ) (S.never<Child> ()),
    ])
  const box = laidOut (rendered (build))
  const before = box.querySelector ('button')
  D.hydrate (box) (build)
  box.querySelector ('button')!.dispatchEvent (new dom.Event ('click'))
  assert.deepStrictEqual ([box.querySelector ('button') === before, clicked], [true, 1])
})

test ('hydrate: a long list is adopted without recursing', () => {
  const N = 5000
  const build = () =>
    H.ul ({}, [Array.from ({ length: N }, (_, i) => H.li ({}, [`${i}`]))])
  const box = laidOut (rendered (build))
  const before = box.querySelectorAll ('li').length
  const dsp = D.hydrate (box) (build)
  assert.deepStrictEqual ([before, box.querySelectorAll ('li').length], [N, N])
  S.dispose (dsp)
  assert.deepStrictEqual (box.querySelectorAll ('li').length, 0)
})

test ('hydrate: a cell that diverges rebuilds itself alone', () => {
  const build = () =>
    H.div ({}, [
      'before',
      S.holdWith<Child> (H.span (['in'])) (S.never ()),
      'after',
    ])
  const box = laidOut (
    rendered (build).replace ('<span>in</span>', '<b>not it</b>'),
  )
  D.hydrate (box) (build)
  assert.deepStrictEqual (box.querySelector ('strong'), null)
  assert.deepStrictEqual (box.querySelector ('span') !== null, true)
  assert.deepStrictEqual (dom.text (box), 'beforeinafter')
})

test ('hydrate: the handle disposes what it adopted', () => {
  let clicks = 0
  const build = () => H.button ({ 'on:click': () => clicks += 1 }, ['go'])
  const box = laidOut (rendered (build))
  const dsp = D.hydrate (box) (build)
  S.dispose (dsp)
  box.querySelector ('button')?.dispatchEvent (new dom.Event ('click'))
  assert.deepStrictEqual (clicks, 0)
})

test ('hydrate: a string, a number, and an element get no comment marker', () => {
  const box = dom.box ()
  D.mount (box) (
    H.p ({ class: 'x' }, ['text', 42, H.strong ({}, ['deep']), D.el ('i')]),
  )
  assert.deepStrictEqual ([marks (box), dom.text (box)], [0, 'text42deep'])
})

test ('hydrate: an array and a Maybe get one marker, and a stream gets markers only among siblings', () => {
  const box = dom.box ()
  D.mount (box) (H.p ({}, [['a', 'b']]))
  assert.deepStrictEqual (marks (box), 1)

  const other = dom.box ()
  D.mount (other) (H.p ({}, [P.just ('here') as Child]))
  assert.deepStrictEqual (marks (other), 1)

  const third = dom.box ()
  D.mount (third) (H.p ({}, [S.holdWith<Child> ('x') (S.never<Child> ())]))
  assert.deepStrictEqual ([marks (third), dom.text (third)], [0, 'x'])

  const fourth = dom.box ()
  D.mount (fourth) (
    H.p ({}, ['before ', S.holdWith<Child> ('x') (S.never<Child> ())]),
  )
  assert.deepStrictEqual (marks (fourth), 2)
})

test ('hydrate: a static attribute already in the markup is left alone', () => {
  const box = laidOut ('<p class="from the server">x</p>')
  D.hydrate (box) (() => H.p ({ class: 'from the client' }, ['x']))
  assert.deepStrictEqual (box.querySelector ('p')?.getAttribute ('class'), 'from the server')
})

test ('hydrate: a prop that is not markup is still written', () => {
  const box = laidOut ('<input>')
  D.hydrate (box) (() => H.input ({ '.value': 'typed' }))
  assert.deepStrictEqual ((box.querySelector ('input') as HTMLInputElement).value, 'typed')
})

test ('hydrate: an element built beforehand is put in place of the markup', () => {
  const built = H.p ({}, ['text'])
  const made = D.node (built)
  const box = laidOut ('<p>text</p>')
  D.hydrate (box) (built)
  assert.deepStrictEqual ([box.firstChild === made, box.childNodes.length], [true, 1])
})

test ('hydrate: a cell alone in an element round-trips without markers', () => {
  const build = () =>
    H.div ({}, [
      H.span ({}, [S.holdWith<Child> ('one') (S.never<Child> ())]),
      H.span ({}, [S.holdWith<Child> ('two') (S.never<Child> ())]),
    ])
  const html = rendered (build)
  assert.deepStrictEqual (html.includes ('<!--'), false)
  const box = laidOut (html)
  const before = box.querySelectorAll ('span')[1]
  D.hydrate (box) (build)
  assert.deepStrictEqual (box.querySelectorAll ('span')[1], before)
  assert.deepStrictEqual (box.innerHTML, html)
})

test ('hydrate: a markerless cell keeps answering after it is adopted', () => {
  const build = (from: S.Source<Child>) => () => H.strong ({}, [from])
  const [changes, push] = S.bus<Child> ()
  const html = rendered (build (S.holdWith<Child> ('one') (S.never<Child> ())))
  const box = laidOut (html)
  D.hydrate (box) (build (S.holdWith<Child> ('one') (changes)))
  push ('two')
  assert.deepStrictEqual (dom.text (box), 'two')
})

test ('hydrate: a tree of every kind of child round-trips', () => {
  const build = () =>
    H.div ({ class: 'all' }, [
      'text',
      7,
      H.strong ({}, ['element']),
      ['one', 'two'],
      P.just ('maybe') as Child,
      P.nothing<Child> () as Child,
      S.holdWith<Child> ('cell') (S.never<Child> ()),
    ])
  const box = laidOut (rendered (build))
  const before = box.querySelector ('strong')
  D.hydrate (box) (build)
  assert.deepStrictEqual (box.querySelector ('strong'), before)
  assert.deepStrictEqual (dom.text (box), 'text7elementonetwomaybecell')
})

test ('hydrate: a list that came back shorter is caught', () => {
  const server = rendered (() => H.p ({}, [['a', 'b', 'c'], H.em ({}, ['end'])]))
  const box = laidOut (server)
  D.hydrate (box) (() => H.p ({}, [['a', 'b'], H.em ({}, ['end'])]))
  assert.deepStrictEqual (dom.text (box), 'abend')
  assert.deepStrictEqual (box.querySelectorAll ('em').length, 1)
})

test ('hydrate: a list caught short closes what it subscribed', () => {
  let live = 0
  const cell = S.heldStream<Child> ((sink, sch) => {
    live += 1
    sink.event (sch.currentTime (), 'cell')
    return S.disposable (() => live -= 1)
  })
  const first = dom.box ()
  const server = D.mount (first) (
    H.p ({}, [['a', cell as Child, 'c'], H.em ({}, ['end'])]),
  )
  const box = laidOut (first.innerHTML)
  S.dispose (server)
  assert.deepStrictEqual (live, 0)

  const dsp = D.hydrate (box) (() =>
    H.p ({}, [['a', cell as Child], H.em ({}, ['end'])]),
  )
  assert.deepStrictEqual ([dom.text (box), live], ['acellend', 1])
  S.dispose (dsp)
  assert.deepStrictEqual (live, 0)
})

test ('hydrate: a component before the divergence is adopted, set up once', () => {
  counting ()
  const box = laidOut ('<div><p>a</p><span>x</span></div>')
  const adopted = box.querySelector ('p')
  const dsp = D.hydrate (box) (() => H.div ([Owning (), H.em (['x'])]))
  assert.deepStrictEqual (
    [setups, owned, box.querySelector ('p') === adopted, box.innerHTML],
    [1, 1, true, '<div><p>a</p><em>x</em></div>'],
  )
  S.dispose (dsp)
  assert.deepStrictEqual (owned, 0)
})

test ('hydrate: a divergence inside an array keeps what came before it', () => {
  counting ()
  const box = laidOut ('<div><p>a</p><span>x</span><!----></div>')
  const adopted = box.querySelector ('p')
  const dsp = D.hydrate (box) (() => H.div ([[Owning (), H.em (['x'])]]))
  assert.deepStrictEqual (
    [setups, owned, box.querySelector ('p') === adopted, box.innerHTML],
    [1, 1, true, '<div><p>a</p><em>x</em><!----></div>'],
  )
  S.dispose (dsp)
  assert.deepStrictEqual (owned, 0)
})

test ('hydrate: a component whose markup diverges inside is set up once', () => {
  counting ()
  const box = laidOut ('<div><p><span>a</span></p></div>')
  const adopted = box.querySelector ('p')
  const dsp = D.hydrate (box) (() => H.div ([Deep ()]))
  assert.deepStrictEqual (
    [setups, owned, box.querySelector ('p') === adopted, box.innerHTML],
    [1, 1, true, '<div><p><em>a</em></p></div>'],
  )
  S.dispose (dsp)
  assert.deepStrictEqual (owned, 0)
})

test ('hydrate: a cell before the divergence is adopted and read once', () => {
  let reading = 0
  const cell = S.heldStream<Child> ((sink, sch) => {
    reading += 1
    sink.event (sch.currentTime (), 'cell')
    return S.disposable (() => reading -= 1)
  })
  const box = laidOut ('<div><!--[-->cell<!--]--><span>x</span></div>')
  const dsp = D.hydrate (box) (() => H.div ([cell as Child, H.em (['x'])]))
  assert.deepStrictEqual ([reading, box.innerHTML], [
    1,
    '<div><!--[-->cell<!--]--><em>x</em></div>',
  ])
  S.dispose (dsp)
  assert.deepStrictEqual (reading, 0)
})

test ('hydrate: a divergence inside an element stays inside it', () => {
  const box = laidOut ('<div><p><i>a</i></p><span>b</span></div>')
  const after = box.querySelector ('span')
  D.hydrate (box) (() => H.div ([H.p ([H.em (['a'])]), H.span (['b'])]))
  assert.deepStrictEqual (
    [box.querySelector ('span') === after, box.innerHTML],
    [true, '<div><p><em>a</em></p><span>b</span></div>'],
  )
})

test ('hydrate: a cell that diverges at once is rebuilt alone', () => {
  const build = () =>
    H.div ({}, [
      'before',
      S.holdWith<Child> (H.span (['in'])) (S.never ()),
      'after',
    ])
  const box = laidOut (rendered (build).replace ('<span>in</span>', '<b>in</b>'))
  const div = box.querySelector ('div')!
  const [first, last] = [div.firstChild, div.lastChild]
  D.hydrate (box) (build)
  assert.deepStrictEqual ([div.firstChild === first, div.lastChild === last], [true, true])
  assert.deepStrictEqual (box.querySelector ('span') !== null, true)
})

test ('hydrate: a divergence deep in a cell leaves what it adopted live', () => {
  const [changes, push] = S.bus<string> ()
  const build = () =>
    H.div ([
      'before',
      S.holdWith<Child> (
        H.div ([H.p ([S.holdWith ('one') (changes)]), H.em (['x'])]),
      ) (S.never ()),
      'after',
    ])
  const box = laidOut (rendered (build).replace ('<em>x</em>', '<b>x</b>'))
  const adopted = box.querySelector ('p')
  D.hydrate (box) (build)
  push ('two')
  assert.deepStrictEqual ([box.querySelector ('p') === adopted, dom.text (box)], [
    true,
    'beforetwoxafter',
  ])
})

test ('hydrate: rows before a diverging row are adopted and stay live', () => {
  type On = { readonly hit: S.Stream<Event> }
  const Row = D.component ((p: { name: string }, on: On, start: D.Start) => {
    setups += 1
    owned += 1
    start (S.disposable (() => owned -= 1))
    const hits = S.hold ((n: number) => n + 1, 0) (on.hit)
    return H.li ([H.button ([p.name]).use ({ hit: 'click' }), hits])
  })
  const build = () =>
    H.ul ([
      S.holdWith<Child> ([Row ({ name: 'a' }), Row ({ name: 'b' })]) (
        S.never (),
      ),
    ])
  const box = laidOut (
    rendered (build).replace ('<button>b</button>', '<button>B</button>'),
  )
  counting ()
  const rows = [...box.querySelectorAll ('li')]
  const dsp = D.hydrate (box) (build)
  assert.deepStrictEqual ([setups, owned], [2, 2])
  assert.deepStrictEqual ([...box.querySelectorAll ('li')], rows)
  for (const b of box.querySelectorAll ('button')) {
    b.dispatchEvent (new dom.Event ('click'))
  }
  assert.deepStrictEqual (dom.text (box), 'a1b1')
  S.dispose (dsp)
  assert.deepStrictEqual (owned, 0)
})

test ('hydrate: a component whose root diverges still gives what was taken', () => {
  type On = { readonly bumped: S.Stream<Event> }
  const Counter = D.component ((_p: void, on: On, start: D.Start) => {
    setups += 1
    owned += 1
    start (S.disposable (() => owned -= 1))
    const count = S.hold ((n: number) => n + 1, 0) (on.bumped)
    return H.button ([count]).use ({ bumped: 'click' }).output ({ count })
  })
  const build = () => {
    const counter = Counter ().use ({ counted: 'count' })
    return H.div ([
      S.holdWith<Child> (counter) (S.never ()),
      H.p ([counter[D.OUT].counted]),
    ])
  }
  const box = laidOut (
    rendered (build).replace ('<button>0</button>', '<a>0</a>'),
  )
  counting ()
  const dsp = D.hydrate (box) (build)
  assert.deepStrictEqual ([setups, owned], [1, 1])
  box.querySelector ('button')!.dispatchEvent (new dom.Event ('click'))
  assert.deepStrictEqual (box.querySelector ('p')!.textContent, '1')
  S.dispose (dsp)
  assert.deepStrictEqual (owned, 0)
})

test ('hydrateHost: a cell the server did not close claims nothing', () => {
  const box = laidOut ('<!--[--><i>stale</i>')
  const host = hydrateHost (box, box.firstChild, null)
  host.comment (null, '[')
  const claim = host.region (false)
  assert.deepStrictEqual ([claim, host.hydrating, box.innerHTML], [
    null,
    false,
    '<!--[-->',
  ])
})

test ('hydrateHost: a node built beforehand takes the place of the rest', () => {
  const box = laidOut ('<i></i><u></u>')
  const host = hydrateHost (box, box.firstChild, null)
  host.place (null, dom.document.createElement ('b'))
  assert.deepStrictEqual ([box.innerHTML, host.hydrating], ['<b></b>', false])
})

test ('hydrateHost: at the wrong tag it stops adopting and builds', () => {
  const box = laidOut ('<i></i><u></u>')
  const host = hydrateHost (box, box.firstChild, null)
  const made = host.element (null, 'b', null)
  assert.deepStrictEqual ([made.parentNode, box.innerHTML, host.hydrating], [
    null,
    '',
    false,
  ])
  host.place (null, made)
  assert.deepStrictEqual (box.innerHTML, '<b></b>')
})

test ('hydrateHost: text that says something else is written afresh', () => {
  const box = laidOut ('other<i></i>')
  const host = hydrateHost (box, box.firstChild, null)
  host.text (null, 'mine')
  assert.deepStrictEqual ([box.innerHTML, host.hydrating], ['mine', false])
})

test ('hydrateHost: what it builds goes before the stop, never past it', () => {
  const box = laidOut ('<i></i><!--c--><u>after</u>')
  const host = hydrateHost (box, box.firstChild, box.childNodes[1] as ChildNode)
  host.place (null, host.element (null, 'b', null))
  host.text (null, 'x')
  host.done ()
  assert.deepStrictEqual (box.innerHTML, '<b></b>x<!--c--><u>after</u>')
})

test ('hydrateHost: carries no methods of its own', () => {
  const box = laidOut ('<i></i>')
  const host = hydrateHost (box, box.firstChild, null) as unknown as Record<
    string,
    unknown
  >
  const own = Object.getOwnPropertyNames (host)
    .filter ((k) => typeof host[k] === 'function')
  assert.deepStrictEqual (own, [])
})

test ('hydrateHost: leftover markup is cleared when the walk is done', () => {
  const box = laidOut ('<i></i><b></b>')
  const host = hydrateHost (box, box.firstChild, null)
  host.element (null, 'i', null)
  host.done ()
  assert.deepStrictEqual (box.innerHTML, '<i></i>')
})

test ('hydrateIn: brings one bracketed stretch to life', () => {
  const box = laidOut (
    '<i>before</i><!--o--><span>in</span><!--c--><i>after</i>',
  )
  const nodes = [...box.childNodes]
  const open = nodes[1] as ChildNode
  const close = nodes[3] as ChildNode
  D.hydrateIn ({ parent: box, open, close }) (() => H.span (['in']))
  assert.deepStrictEqual (dom.text (box), 'beforeinafter')
})

test ('hydrateIn: a divergence stays between the brackets', () => {
  const box = laidOut (
    '<i>before</i><!--o--><span>in</span><b>stale</b><!--c--><i>after</i>',
  )
  const [before, open, , , close, after] = [...box.childNodes] as ChildNode[]
  D.hydrateIn ({ parent: box, open, close }) (() => H.em (['in']))
  assert.deepStrictEqual (
    [box.firstChild === before, box.lastChild === after, box.innerHTML],
    [true, true, '<i>before</i><!--o--><em>in</em><!--c--><i>after</i>'],
  )
})
