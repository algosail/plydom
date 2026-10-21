import * as P from '@algosail/ply'
import * as S from '@algosail/plystream'
import type { BranchFrom } from './branch.ts'
import type { Made, Setup, Start } from './component.ts'
import type { ElementBuilder } from './element.ts'
import type { Bracket } from './hosts/host.ts'
import type { Giving, None, ON, Outs } from './output.ts'
import type { Listed } from './rows.ts'
import type { Child, Drawn, On, View } from './view.ts'
import { branchOn } from './branch.ts'
import { mountChild } from './child.ts'
import { ComponentView } from './component.ts'
import { elementIn } from './element.ts'
import { buildHost } from './hosts/build.ts'
import { hydrateWith } from './hosts/hydrate.ts'
import { listRows } from './rows.ts'
import { eventsOf, ExistingView, lazyView, NODE } from './view.ts'

export type {
  Action,
  Child,
  Drawn,
  ElementView,
  Merge,
  On,
  Props,
  View,
} from './view.ts'
export type { Giving, None, Outs } from './output.ts'
export type { ElementBuilder } from './element.ts'
export type { Branch } from './branch.ts'
export type { Listed, Tagged } from './rows.ts'
export type { Made, Start } from './component.ts'
export type { Bracket } from './hosts/host.ts'
export type { Backend } from './backend.ts'

export { getBackend, setBackend } from './backend.ts'

export { DuplicateKey } from './keyed.ts'

export {
  checkedOf,
  fieldOf,
  fromEvent,
  fromIntersection,
  fromMutation,
  fromResize,
  prevented,
  valueOf,
} from './read.ts'

type RowsOf<A, O extends Outs, K> = <I extends S.Source<readonly A[]>>(
  items: I,
) => Listed<I extends S.HeldStream<readonly A[]> ? S.HeldStream<View[]> : S.Stream<View[]>,
  O,
  K
>

type Missing<H> = { readonly ['markup does not answer on']: H }

type MustAnswer<R, H> = R extends Giving<Outs>
  ? R extends { readonly [ON]: infer Hd }
    ? [Hd] extends [H] ? unknown : Missing<H>
  : Missing<H>
  : unknown

type MadeOf<R> = R extends Giving<infer G> ? Made<G> : View

const SVG_NS = 'http://www.w3.org/2000/svg'
const adopting = hydrateWith<View> (mountChild)

export const el: ElementBuilder = elementIn (null)
export const svgEl: ElementBuilder = elementIn (SVG_NS)

export function view(domNode: Node, disposables: Disposable[] = []): Drawn {
  return new ExistingView ({
    node: domNode,
    disposables,
    adopted: false,
  }) as unknown as Drawn
}

export function comment(data: string): Drawn {
  return lazyView ((host, anchor) => ({
    node: host.comment (anchor, data),
    disposables: [],
    adopted: true,
  }))
}

export { isView } from './view.ts'

export function node(v: View): Node {
  return v[NODE]
}

export { AskedTooLate, NoSuchPart, ON, OUT, outsOf } from './output.ts'

export { act } from './act.ts'

export { use } from './use.ts'

export { output } from './output.ts'

/**
 * Show `onTrue` while the stream is true, and nothing while it is false.
 * @example
 * ```ts ignore
 * D.when(() => H.div(['open']))(isOpen)
 * ```
 */
export function when<V extends View>(
  onTrue: () => V,
): BranchFrom<boolean, P.Maybe<View>, On<[V]>> {
  return branchOn ((cond: boolean) => cond ? P.just<View> (onTrue ()) : P.nothing<View> ())
}

/**
 * Show one view or the other.
 * @example
 * ```ts ignore
 * D.ifElse(() => H.p(['on']))(() => H.p(['off']))(flag)
 * ```
 */
export function ifElse<T extends View>(onTrue: () => T) {
  return <F extends View>(onFalse: () => F): BranchFrom<boolean, View, On<[T, F]>> =>
    branchOn<boolean, View, On<[T, F]>> ((cond: boolean) => cond ? onTrue () : onFalse ())
}

/**
 * Show the factory stored under the current key, or nothing.
 * @example
 * ```ts ignore
 * D.match({ home: () => Home(), about: () => About() })(tab)
 * ```
 */
export function match<
  K extends string | number,
  C extends Readonly<P.StrMap<() => View>> = Readonly<P.StrMap<() => View>>,
>(
  cases: C,
): BranchFrom<K, P.Maybe<View>, On<ReturnType<C[keyof C]>[]>> {
  return branchOn ((key: K) =>
    P.map ((factory: () => View) => factory ()) (P.lookup (String (key)) (cases)),
  )
}

/**
 * One node per key.
 * @example
 * ```ts ignore
 * const Row = (entry: S.HeldStream<Todo>, id: number) =>
 *   H.li([String(id), entry, H.button(['×']).use({ dropped: 'click' })])
 *
 * D.rows((todo: Todo) => todo.id)(Row)(items)
 * ```
 */
export function rows<A, K>(
  keyFn: (a: A, i: number) => K,
): <O extends Outs = None>(
  row: (entry: S.HeldStream<A>, key: K) => View & { readonly [ON]?: O },
) => RowsOf<A, O, K> {
  return <O extends Outs = None>(
    row: (entry: S.HeldStream<A>, key: K) => View & { readonly [ON]?: O },
  ) =>
    ((items: S.Source<readonly A[]>) => listRows (keyFn, row, items)) as unknown as RowsOf<A, O, K>
}

/**
 * `(props, on, start) => markup`.
 * @example
 * ```ts ignore
 * const Counter = D.component((
 *   p: { from: number },
 *   on: { bumped: S.Stream<Event> },
 * ) => {
 *   const count = S.hold((n: number) => n + 1, p.from)(on.bumped)
 *   return H.p([
 *     H.button(['+']).use({ bumped: 'click' }),
 *     count,
 *   ]).output({ count })
 * })
 * ```
 */
export function component<Pr = void, H extends Outs = Outs, R = View>(
  setup: (props: Pr, on: H, start: Start) => R & MustAnswer<R, H>,
): (props: Pr) => MadeOf<R>
export function component<Pr>(setup: Setup<Pr>): (props: Pr) => View {
  return (props) => new ComponentView (setup, props)
}

/**
 * Events of a view, as a stream.
 * @example
 * ```ts ignore
 * const more = H.button(['+'])
 * S.hold((n: number) => n + 1, 0)(D.events('click')(more))
 * ```
 */
export function events<E extends Event = Event>(
  type: string,
  options?: AddEventListenerOptions | boolean,
) {
  return (v: View): S.Stream<E> => eventsOf<E> (v, type, options)
}

/**
 * Put a view into `parent`.
 */
export function mount(parent: Node): (v: Child) => Disposable {
  return (v: Child): Disposable => mountChild (buildHost (parent), null, v)
}

/**
 * Adopt server markup already in `parent`.
 */
export const hydrate: (parent: Node) =>
  (source: View | (() => View)) => Disposable = adopting.hydrate

/**
 * Adopt the markup from `open` up to `close`.
 * @example
 * ```ts ignore
 * D.hydrateIn({ parent, open, close })(() => Counter({ from: 3 }))
 * ```
 */
export const hydrateIn: (bracket: Bracket) =>
    (source: View | (() => View)) => Disposable = adopting.hydrateIn
