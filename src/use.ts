import * as S from '@algosail/plystream'

import type { Branch } from './branch.ts'
import type { Made } from './component.ts'
import type { KeepGiven, Outs } from './output.ts'
import type { Listed, Tagged } from './rows.ts'
import type { Drawn, ElementView, View } from './view.ts'

type EventsOf<N extends Record<string, string>> = {
  readonly [K in keyof N]: S.Stream<Event>
}

type PartsOf<O, N extends Record<string, string>> = {
  readonly [K in keyof N]: N[K] extends keyof O ? O[N[K]] : never
}

type NotNamed<Name extends string> = { readonly notNamed: Name }

type Asked<N extends Record<string, string>> = N[keyof N] & string

type WhenNamed<N extends Record<string, string>, Have, Then> =
  Asked<N> extends keyof Have ? Then : NotNamed<Asked<N>>

type UseElement<V, N extends Record<string, string>, Exposed extends Outs, Askable extends Outs> =
  KeepGiven<V, ElementView<Exposed & EventsOf<N>, Askable & EventsOf<N>>>

type UseDrawn<V, N extends Record<string, string>, Exposed extends Outs, Askable extends Outs> =
  KeepGiven<V, Drawn<Exposed & EventsOf<N>, Askable & EventsOf<N>>>

type UseList<
  V,
  N extends Record<string, string>,
  T extends S.Source<View[]>,
  O extends Outs,
  K,
  Let extends Outs,
> = WhenNamed<N, O, KeepGiven<V, Listed<T, O, K, Let & Tagged<PartsOf<O, N>, K>>>>

type UseBranch<
  V,
  N extends Record<string, string>,
  T extends S.Source<unknown>,
  O extends Outs,
  Let extends Outs,
> = WhenNamed<N, O, KeepGiven<V, Branch<T, O, Let & PartsOf<O, N>>>>

type UseMade<N extends Record<string, string>, G extends Outs, Let extends Outs> =
  WhenNamed<N, G, Made<G, Let & PartsOf<G, N>>>

type UseOf<V, N extends Record<string, string>> = V extends
  ElementView<infer Exposed, infer Askable> ? UseElement<V, N, Exposed, Askable>
  : V extends Drawn<infer Exposed, infer Askable> ? UseDrawn<V, N, Exposed, Askable>
  : V extends Listed<infer T, infer O, infer K, infer Let> ? UseList<V, N, T, O, K, Let>
  : V extends Branch<infer T, infer O, infer Let> ? UseBranch<V, N, T, O, Let>
  : V extends Made<infer G, infer Let> ? UseMade<N, G, Let>
  : NotNamed<Asked<N>>

/**
 * Names what `spec` reads. The view, branch, list, or component comes last.
 * @example
 * ```ts
 * P.pipe ([
 *   D.use ({ bumped: 'click' }),
 *   D.output ({ count }),
 * ]) (H.button (['+']))
 * ```
 */
export function use<const N extends Record<string, string>>(spec: N) {
  return <V>(view: V): UseOf<V, N> =>
    (view as unknown as { use(spec: N): UseOf<V, N> }).use (spec)
}
