import * as P from '@algosail/ply'
import * as D from '@algosail/plydom'
import * as H from '@algosail/plydom/h'
import * as S from '@algosail/plystream'

type Props = { readonly from: number }
type On = {
  readonly down: S.Stream<Event>
  readonly up: S.Stream<Event>
  readonly reset: S.Stream<Event>
}

type Step = (n: number) => number
type KeyActionLookup = (k: string) => (m: P.StrMap<Step>) => P.Maybe<Step>

const inc = P.add (1)
const dec = P.sub (1)
const reset = P.K (0)
const isZero = P.equals<number> (0)

const fromKeydown = D.fromEvent<KeyboardEvent> ('keydown')
const getKey = (e: KeyboardEvent) => e.key

const keyboardAction = P.pipe ([
  getKey,
  P.flip<KeyActionLookup> (P.lookup) ({
    ArrowUp: inc,
    ArrowDown: dec,
  }),
])

const applyStep = (n: number, apply: Step) => apply (n)

const Counter = D.component ((props: Props, on: On) => {
  const steps = S.mergeArray<Step> ([
    P.map (P.K (dec)) (on.down),
    P.map (P.K (inc)) (on.up),
    P.map (P.K (reset)) (on.reset),
    P.filterMap (keyboardAction) (fromKeydown (document)),
  ])

  const count = S.hold (applyStep, props.from) (steps)
  const atZero = P.map (isZero) (count)

  const outputClass = P.map
    (P.pipe ([P.lt (0), P.boolean ('value') ('value below')]))
    (count)

  return H.section ({ class: 'counter' }, [
    H.button (['\u2212']).use ({ down: 'click' }),

    H.output ({ class: outputClass }, [count]),

    H.button (['+']).use ({ up: 'click' }),
    H.button (['reset']).use ({ reset: 'click' }),

    H.p ({ class: 'hint' }, [
      D.when (() => H.span (['press + or \u2191 to begin'])) (atZero),
    ]),
  ])
})

D.mount (document.body) (Counter ({ from: 0 }))
