import type * as P from '@algosail/ply'
import * as S from '@algosail/plystream'

import type {
  Giving,
  KeepGiven,
  None,
  ON,
  OutputSink,
  OutputSource,
  Outs,
  Routes,
} from './output.ts'
import type { Child, View } from './view.ts'
import { NOTHING_TO_CLOSE } from './close.ts'
import {
  applyUse,
  NO_EVENT_ROUTE,
  OUT,
  PROVIDERS,
  ROUTES,
  setGiven,
  subscribeTo,
} from './output.ts'
import { isView } from './view.ts'

export type Branch<
  T extends S.Source<unknown>,
  O extends Outs,
  Let extends Outs = None,
> =
  & T
  & {
    readonly [OUT]: Let
    readonly [ON]: O & Let
    use<Self, N extends Record<string, keyof O & string>>(
      this: Self,
      spec: N,
    ): KeepGiven<Self, Branch<T, O, Let & { readonly [K in keyof N]: O[N[K]] }>>
    output<Self, G extends Outs>(this: Self, given: G): Self & Giving<G>
  }

export type BranchFrom<A, B, O extends Outs> = {
  (from: S.HeldStream<A>): Branch<S.HeldStream<B>, O>
  (from: S.Stream<A>): Branch<S.Stream<B>, O>
}

type BranchState = {
  input: S.Source<unknown>
  pick: (value: unknown) => Child
  shown: Shown
  [OUT]?: Record<string, S.Source<unknown>>
  [ROUTES]: Routes
}

class Shown implements OutputSource {
  view: View | null = null
  shownBy: object | null = null
  firstWatch: NameWatch | null = null
  used: Set<string> | null = null

  subscribe(names: readonly string[], sink: OutputSink): Disposable {
    const used = this.used
    const needed = used === null ? names : names.filter ((name) => !used.has (name))
    return needed.length === 0 ? NOTHING_TO_CLOSE : this.watch (needed, sink)
  }

  watch(names: readonly string[], sink: OutputSink): NameWatch {
    const watch = new NameWatch (this, names, sink)
    watch.next = this.firstWatch
    this.firstWatch = watch
    if (this.view !== null) watch.subscription = subscribeTo (this.view, names, sink)
    return watch
  }

  show(view: View | null, shownBy: object): void {
    this.view = view
    this.shownBy = shownBy
    for (let watch = this.firstWatch; watch !== null; watch = watch.next) {
      S.dispose (watch.subscription)
      watch.subscription = view === null
        ? NOTHING_TO_CLOSE
        : subscribeTo (view, watch.names, watch.sink)
    }
  }

  hide(shownBy: object): void {
    if (this.shownBy === shownBy) this.show (null, shownBy)
  }

  remove(gone: NameWatch): void {
    if (this.firstWatch === gone) {
      this.firstWatch = gone.next
      return
    }
    for (let watch = this.firstWatch; watch !== null; watch = watch.next) {
      if (watch.next === gone) {
        watch.next = gone.next
        return
      }
    }
  }
}

class NameWatch {
  shown: Shown
  names: readonly string[]
  sink: OutputSink
  subscription: Disposable = NOTHING_TO_CLOSE
  next: NameWatch | null = null

  constructor(shown: Shown, names: readonly string[], sink: OutputSink) {
    this.shown = shown
    this.names = names
    this.sink = sink
  }

  [Symbol.dispose](): void {
    S.dispose (this.subscription)
    this.subscription = NOTHING_TO_CLOSE
    this.shown.remove (this)
  }
}

class HeldBranch extends S.Held<Child> implements BranchState {
  declare [ROUTES]: Routes

  input: S.Source<unknown>
  pick: (value: unknown) => Child
  shown: Shown

  constructor(input: S.Source<unknown>, pick: (value: unknown) => Child) {
    super ()
    this.input = input
    this.pick = pick
    this.shown = new Shown ()
    this[ROUTES] = { [PROVIDERS]: [this.shown] }
  }

  use(spec: Record<string, string>): this {
    return wireUse (this, spec)
  }

  output<G extends Outs>(given: G): this & Giving<G> {
    return setGiven (this, given)
  }

  override run(
    sink: S.Sink<Child>,
    scheduler: S.Scheduler = S.defaultScheduler (),
  ): Disposable {
    return readBranch (this, sink, scheduler)
  }
}

class PlainBranch extends S.Plain<Child> implements BranchState {
  declare [ROUTES]: Routes

  input: S.Source<unknown>
  pick: (value: unknown) => Child
  shown: Shown

  constructor(input: S.Source<unknown>, pick: (value: unknown) => Child) {
    super ()
    this.input = input
    this.pick = pick
    this.shown = new Shown ()
    this[ROUTES] = { [PROVIDERS]: [this.shown] }
  }

  use(spec: Record<string, string>): this {
    return wireUse (this, spec)
  }

  output<G extends Outs>(given: G): this & Giving<G> {
    return setGiven (this, given)
  }

  override run(
    sink: S.Sink<Child>,
    scheduler: S.Scheduler = S.defaultScheduler (),
  ): Disposable {
    return readBranch (this, sink, scheduler)
  }
}

class Picking implements S.Sink<unknown>, Disposable {
  downstream: S.Sink<Child>
  pick: (value: unknown) => Child
  shown: Shown
  subscription: Disposable = NOTHING_TO_CLOSE

  constructor(
    downstream: S.Sink<Child>,
    pick: (value: unknown) => Child,
    shown: Shown,
  ) {
    this.downstream = downstream
    this.pick = pick
    this.shown = shown
  }

  event(time: S.Time, value: unknown): void {
    const child = this.pick (value)
    this.shown.show (viewIn (child), this)
    this.downstream.event (time, child)
  }

  end(time: S.Time): void {
    this.downstream.end (time)
  }

  [Symbol.dispose](): void {
    S.dispose (this.subscription)
    this.shown.hide (this)
  }
}

class AttachSink implements OutputSink {
  attach: (source: S.Source<unknown>) => Disposable

  constructor(attach: (source: S.Source<unknown>) => Disposable) {
    this.attach = attach
  }

  accept(_name: string, source: S.Source<unknown>): Disposable {
    return this.attach (source)
  }
}

function readBranch(
  branch: BranchState,
  sink: S.Sink<Child>,
  scheduler: S.Scheduler,
): Disposable {
  const picking = new Picking (sink, branch.pick, branch.shown)
  picking.subscription = branch.input.run (picking, scheduler)
  return picking
}

function viewIn(child: Child): View | null {
  if (isView (child)) return child
  return (child as P.Maybe<View>).match (() => null, (view: View) => view)
}

function wireUse<B extends BranchState>(branch: B, spec: Record<string, string>): B {
  const shown = branch.shown
  const used = shown.used ?? (shown.used = new Set ())
  return applyUse (branch, spec, (name, sourceName) => {
    const [stream, attach] = S.relayed<unknown> ()
    shown.watch ([sourceName], new AttachSink (attach))
    used.add (name)
    return [stream, NO_EVENT_ROUTE]
  })
}

function makeBranch<A, T extends S.Source<Child>, O extends Outs>(
  source: S.Source<A>,
  pick: (value: A) => Child,
): Branch<T, O> {
  const input = source as S.Source<unknown>
  const pickChild = pick as (value: unknown) => Child
  const branch = S.isHeld (source)
    ? new HeldBranch (input, pickChild)
    : new PlainBranch (input, pickChild)
  return branch as unknown as Branch<T, O>
}

const skipUnchanged = S.skipRepeats ((a: unknown, b: unknown) => a === b) as {
  <A>(from: S.HeldStream<A>): S.HeldStream<A>
  <A>(from: S.Stream<A>): S.Stream<A>
}

export function branchOn<A, B extends Child, O extends Outs>(
  pick: (value: A) => B,
): BranchFrom<A, B, O> {
  return ((from: S.HeldStream<A>) =>
    makeBranch (skipUnchanged (from), pick)) as unknown as BranchFrom<A, B, O>
}
