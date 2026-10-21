# @algosail/plydom

Builds markup out of streams. An element is a value, its events are a stream,
and state is a fold of those streams. There are no nodes until a view is put on
the page with `mount` or taken over with `hydrate`.

Two entries:

```ts
import * as D from '@algosail/plydom'
import * as H from '@algosail/plydom/h'
```

`D` is the functions and types. `H` is one helper per tag. The package reads
streams from `@algosail/plystream` and values from `@algosail/ply`.

```ts
import * as S from '@algosail/plystream'
import * as D from '@algosail/plydom'
import * as H from '@algosail/plydom/h'

const [clicks, click] = S.bus<void>()
const count = S.hold((n: number) => n + 1, 0)(clicks)

D.mount(document.body)(
  H.button({ 'on:click': () => click() }, ['clicked ', count, ' times']),
)
```

## Markup

`H.button(children)` or `H.button(props, children)`.
`D.el(tag, props?,
children?)` and `D.svgEl` are the same call when the tag is
chosen at the call. SVG helpers create the element in the SVG namespace. `var`
is named `H.var_`. `H.output` is the `<output>` element. `.output()` on a
component is the door out of it.

The prop key decides where the value goes:

| key                                 | where                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `class`, `href`, `aria-hidden`, …   | attribute                                                                                      |
| `disabled`, `hidden`, `required`, … | boolean attribute: `true` sets it, `false` removes it                                          |
| `value`                             | both the attribute and the property; `null` and `undefined` become `''`                        |
| `checked`, `selected`, `muted`      | both the attribute and the property; `false` removes the attribute                             |
| `.scrollTop`, `.textContent`        | the DOM property only                                                                          |
| `style`                             | a CSS object: `{ color: 'red' }`. A string or a stream under this key is an ordinary attribute |
| `on:click`, `on:input`              | a listener. A stream under `on:` is an error                                                   |

`contenteditable`, `spellcheck`, `draggable`, and `aria-*` are not boolean
attributes: `false` is written as the string `"false"`. `null` and `undefined`
remove any attribute.

Any prop and any child may be a stream. An `S.HeldStream` answers as soon as it
is read, which is what a page needs where something must be there from the first
moment. A plain `S.Stream` leaves its place empty until the first event.

A child (`Child`) is a string, a number, a view, an array of children, a stream
of children, a `P.Maybe`, `null`, or `undefined`.

One view stands in one place. Putting the same view up a second time moves it.
Write the description again, as a call.

## use

An event becomes a stream when the element names it with `use`. The name travels
up to the parent.

```ts
const markup = H.div([
  H.form({}, [
    H.input({ name: 'title' }).use({ typed: 'input' }),
    H.button({ type: 'submit' }, ['add']),
  ]).use({ added: 'submit' }),
])

markup[D.OUT].typed // S.Stream<Event>
markup[D.OUT].added // S.Stream<Event>
```

Two elements under one name are one stream. On an element, `use` is always
`S.Stream<Event>`. A precise event type comes from `D.events<E>` and
`D.fromEvent<E>`.

`D.OUT` is what was written out with `use` or `output`. `D.ON` is what this
markup can be asked for, including the lists and branches under it.
`D.outsOf(view)` returns what it has said, or an empty record.

When the reader is right next to the element, the name is unnecessary:

```ts
import * as P from '@algosail/ply'

const more = H.button(['+'])
const count = S.hold((n: number) => n + 1, 0)(
  P.map(() => 1)(D.events('click')(more)),
)
```

A stream subscribes to nothing and builds no node until somebody reads it.

## act

`act` runs a function once the element's node exists, on mount and on hydrate.
The call itself builds nothing. The function receives that node and returns a
handle. The handle is disposed with the element: a row leaving, a `when` going
false, the view coming down.

Several calls run in the order they were written, and they run before the
element's `on:` and `use` listeners. A listener the action adds therefore runs
first, and a later `valueOf` reads the value that listener left. An event fired
inside the action is not seen by `use`: that listener is attached afterwards.
Later events are.

```ts
H.input().act((node) => {
  const input = node as HTMLInputElement
  input.lang = 'ja'
  return S.disposable(() => {
    input.removeAttribute('lang')
  })
}).use({ typed: 'input' })
```

This is where a binding that needs the real node goes, such as WanaKana's `bind`
and `unbind` on an input. Only an element has `act`. An option that changes is a
stream the action subscribes to and disposes with its handle.

`act`, `use`, and `output` are also functions, with the receiver last:

```ts
import * as P from '@algosail/ply'

P.pipe([
  D.use({ bumped: 'click' }),
  D.output({ count }),
])(H.button(['+']))
```

## Component

```ts
const Button = D.component((p: { label: string }) => H.button([p.label]))
Button({ label: 'ok' })

const Live = D.component(() => H.p(['here']))
Live()
```

The setup is one function. It names only the arguments it uses: props, `on`,
`start`. With no props the factory is called as `Live()`. To reach `start` while
reading no markup, write the middle argument as `D.None`.

```ts
type On = { readonly bumped: S.Stream<Event> }

const Counter = D.component((p: { from: number }, on: On) => {
  const count = S.hold((n: number) => n + 1, p.from)(on.bumped)
  return H.p([
    H.button(['+']).use({ bumped: 'click' }),
    count,
  ]).output({ count })
})

const counter = Counter({ from: 3 }).use({ counted: 'count' })
counter[D.OUT].counted // S.HeldStream<number>
```

`on` is an input, and its type is written by hand. The markup has to answer
every name in it, or the `component(...)` call does not typecheck. The setup
runs when the view is first built, which is later than the factory call.

`.output({ count })` is the only door out. `use` on the built component names a
part that was given, which is a reading from the model. A name that was not
given is `NoSuchPart`. A parent does not see the names of the markup inside.
Both `.output().use()` and `.use().output()` keep what was given.

`start` holds what has to be let go with the view: a socket, a timer, a listener
on `document`. What goes in comes back out, so the same value is read on the
next line.

```ts
type Line = Disposable & {
  readonly said: S.HeldStream<string>
  readonly send: (text: string) => void
}

const openLine = (url: string): Line => {
  const [incoming, hear] = S.bus<string>()
  const ws = new WebSocket(url)
  ws.addEventListener('message', (event: MessageEvent) => {
    hear(String(event.data))
  })
  return {
    said: S.holdWith('')(incoming),
    send(text: string): void {
      if (ws.readyState === WebSocket.OPEN) ws.send(text)
    },
    [Symbol.dispose](): void {
      ws.close()
    },
  }
}

const Desk = D.component((_p: void, _on: D.None, start: D.Start) => {
  const line = start(openLine('wss://example.test/feed'))
  return H.section([
    H.p([line.said]),
    H.button({ 'on:click': () => line.send('ping') }, ['ping']),
  ])
})

D.mount(document.body)(Desk())
```

`Desk()` does not open the socket. `openLine` runs when the view is first built.
The paragraph subscribes to `line.said` and that subscription ends with the
view, but the listener sits on the socket, not on the node. `start` keeps `line`
and calls `ws.close()` when the component leaves.

After `output`, an element stays a view. A branch and a list stay streams:
`mount` accepts them, and `hydrate` and `node` do not. `Giving<G>` marks what
`output` handed over. `Made<G>` is a built component whose parts can be named
with `use`.

## Lists

```ts
const Row = (entry: S.HeldStream<Todo>, id: number) =>
  H.li([
    P.map((t: Todo) => t.title)(entry),
    H.button(['×']).use({ dropped: 'click' }),
  ])

const list = D.rows((t: Todo) => t.id)(Row)(items)
  .use({ dropped: 'dropped' })
list[D.OUT].dropped // S.Stream<readonly [number, Event]>
```

`rows(key)(row)(items)`. The row receives its entry as a stream that holds the
value, and the key. The node is built once per key, and a new value arrives in
that same node. The list holds when `items` holds: a subscription receives the
current rows at once.

A name in the rows is read through `use` on the list, or through a component's
`on`, together with the key of the row that said it. A row that leaves takes its
node and everything it said. Two items with one key are `DuplicateKey`.

Asking a list for a name after its rows are already built is `AskedTooLate`.
`use` and `on` are written before the build.

`Listed` is the type of a list among children. `Tagged<O, K>` is its names: a
stream of `[key, value]` pairs.

## Branches

```ts
D.when(() => H.small(['press +']))(atZero)
D.ifElse(() => H.p(['yes']))(() => H.p(['no']))(flag)
D.match({ home: () => Home(), about: () => About() })(tab)
```

All three take functions. The function for the current case runs when that case
becomes the one shown, and again when the branch leaves and comes back. While
the answer stays the same, the view stays, and a field keeps what was typed.
While `when` is false, its function is not called.

`when` and `match` produce a view or nothing, and nothing takes no room.
`ifElse` produces one of the two views. `match` looks only at the object's own
keys. `Branch` is the type of a branch among children. A name said inside is let
out with `use` on the branch.

## On the page

```ts
const stop = D.mount(document.body)(app)
S.dispose(stop)

D.hydrate(root)(() => App())
D.hydrate(root)(App())

D.hydrateIn({ parent, open, close })(() => Counter({ from: 3 }))
```

`mount(parent)(child)` puts a view or a stream of children in place and returns
the handle that takes it all off: nodes, listeners, and folds.

`hydrate(parent)` takes over markup already lying in the parent. Where the
markup and the view part ways, what is left in that element is built afresh.
`hydrateIn` does the same for one stretch. `Bracket` is
`{ parent, open,
close }`. `close: null` claims everything after `open`.

## Events

```ts
D.events('click')(view)
D.events<MouseEvent>('click')(view)
D.fromEvent('keydown')(document)
D.fromEvent<KeyboardEvent>('keydown')(document)

D.fromResize(element)
D.fromResize(element, { box: 'content-box' })
D.fromResize({ box: 'border-box' })(element)
D.fromIntersection({ threshold: 0.5 })(element)
D.fromMutation({ childList: true })(node)
```

Readings of one event are functions. They are mapped over the stream in the
model:

```ts
P.map(D.valueOf)(on.typed) // the field's string
P.map(D.checkedOf)(on.set) // the checkbox
P.map(D.prevented)(on.sent) // preventDefault, then the same event
P.map(D.fieldOf('title'))(on.added) // a named field of the form
```

`fieldOf` finds the field with `querySelector` inside the form the event came
from.

## Nodes

```ts
D.view(document.createElement('div'), []) // the node already exists; it takes no part in hydration
D.comment('open') // a lazy comment; it takes part in hydration
D.node(view) // the node; a view that is not built yet gets built
D.isView(value) // whether the value is a view
```

A branch and a list are not views.

## Backend

Nodes are created by the current backend. The default reads `document`.

```ts
const previous = D.setBackend(next)
D.setBackend(previous)
D.getBackend()
```

`Backend` has four methods: `element`, `elementNS`, `text`, `comment`.

## Exports of `@algosail/plydom`

Functions:

| name               | call                                                       |
| ------------------ | ---------------------------------------------------------- |
| `el`               | `(tag, props?, children?)`                                 |
| `svgEl`            | the same, in the SVG namespace                             |
| `view`             | `(node, handles?)`                                         |
| `comment`          | `(text)`                                                   |
| `node`             | `(view)`                                                   |
| `isView`           | `(value)`                                                  |
| `outsOf`           | `(view)`                                                   |
| `when`             | `(show)(stream)`                                           |
| `ifElse`           | `(yes)(no)(stream)`                                        |
| `match`            | `(cases)(stream)`                                          |
| `rows`             | `(key)(row)(items)`                                        |
| `component`        | `(setup) → (props) → view`                                 |
| `events`           | `(type, options?)(view)`                                   |
| `fromEvent`        | `(type, options?)(target)`                                 |
| `fromResize`       | `(element)`, `(element, options)`, or `(options)(element)` |
| `fromIntersection` | `(options?)(element)`                                      |
| `fromMutation`     | `(options?)(node)`                                         |
| `valueOf`          | `(event) → string`                                         |
| `checkedOf`        | `(event) → boolean`                                        |
| `prevented`        | `(event) → event`                                          |
| `fieldOf`          | `(name)(event) → string`                                   |
| `mount`            | `(parent)(child)`                                          |
| `hydrate`          | `(parent)(view or factory)`                                |
| `hydrateIn`        | `(bracket)(view or factory)`                               |
| `getBackend`       | `()`                                                       |
| `setBackend`       | `(backend) → the previous one`                             |

Errors: `NoSuchPart`, `AskedTooLate`, `DuplicateKey`.

Symbols: `OUT`, `ON`.

Types: `Child`, `View`, `Drawn`, `ElementView`, `Action`, `Props`, `Outs`,
`None`, `Giving`, `Merge`, `On`, `ElementBuilder`, `Branch`, `Listed`, `Tagged`,
`Made`, `Start`, `Bracket`, `Backend`.

## Exports of `@algosail/plydom/h`

`ElementFn` is the type of one helper.

HTML: `div`, `span`, `ul`, `li`, `ol`, `dl`, `dt`, `dd`, `main`, `header`,
`footer`, `section`, `article`, `aside`, `nav`, `details`, `summary`, `a`,
`button`, `input`, `output`, `textarea`, `select`, `option`, `optgroup`,
`label`, `form`, `progress`, `meter`, `fieldset`, `legend`, `datalist`,
`figure`, `figcaption`, `img`, `picture`, `source`, `video`, `audio`, `iframe`,
`embed`, `time`, `mark`, `p`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `code`, `pre`,
`blockquote`, `var_`, `kbd`, `samp`, `cite`, `dfn`, `abbr`, `small`, `strong`,
`em`, `br`, `hr`, `table`, `caption`, `colgroup`, `col`, `tbody`, `thead`,
`tfoot`, `tr`, `td`, `th`, `style`, `script`, `noscript`, `template`, `slot`.

SVG: `svg`, `g`, `path`, `circle`, `rect`, `line`, `polyline`, `polygon`,
`ellipse`, `defs`, `clipPath`, `mask`, `pattern`, `linearGradient`,
`radialGradient`, `stop`, `use`.
