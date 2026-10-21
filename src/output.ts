import * as S from '@algosail/plystream'

import type { View } from './view.ts'
import { joinDisposables, NOTHING_TO_CLOSE } from './close.ts'

export const OUT: unique symbol = Symbol ('out')
export const ON: unique symbol = Symbol ('on')
export const ROUTES: unique symbol = Symbol ('routes')
export const GIVEN: unique symbol = Symbol ('given')
export const PROVIDERS: unique symbol = Symbol ('providers')

export type Outs = Record<string, unknown>

type Sources = Record<string, S.Source<unknown>>

export type None = Record<never, never>

export type Route = { readonly type: string; readonly view: View | null }

export type OutputSink = {
  accept(name: string, source: S.Source<unknown>): Disposable
}

export type OutputSource = {
  subscribe(names: readonly string[], sink: OutputSink): Disposable
}

type Providers = readonly OutputSource[]

export type Routes = Record<string, readonly Route[]> & { [PROVIDERS]?: Providers }

type Fields = {
  [OUT]?: Outs
  [ROUTES]?: Routes
  [GIVEN]?: Outs
}

export type Giving<G extends Outs> = { readonly [GIVEN]: G }

export type KeepGiven<Self, Next> = Self extends Giving<infer G> ? Next & Giving<G>
  : Next

type Gathered = {
  streams: Sources
  routes: Routes
}

export class NoSuchPart extends Error {}

export class AskedTooLate extends Error {}

const NO_OUTPUTS: Sources = {}
const NO_ROUTES: Record<string, readonly Route[]> = {}
const NO_EVENT = ''

export const NO_EVENT_ROUTE: Route = Object.freeze ({ type: NO_EVENT, view: null })

function mergeStreams(
  had: S.Source<unknown> | undefined,
  one: S.Source<unknown>,
): S.Source<unknown> {
  return had === undefined ? one : S.mergeArray ([had, one])
}

function fieldsOf(value: unknown): Fields | null {
  return typeof value === 'object' && value !== null ? value as Fields : null
}

function hasRun(value: unknown): value is S.Source<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'run' in value &&
    typeof value.run === 'function'
  )
}

function everySource(value: Outs): value is Sources {
  for (const name of Object.keys (value)) {
    if (!hasRun (value[name])) return false
  }
  return true
}

function concatProviders(had: Providers | undefined, more: Providers): Providers {
  if (had === undefined) return more
  return [...had, ...more]
}

function gatherFrom(value: unknown, into: Gathered | null): Gathered | null {
  const fields = fieldsOf (value)
  if (fields === null) return into
  if (Array.isArray (value)) {
    let gathered = into
    for (let i = 0; i < value.length; i++) gathered = gatherFrom (value[i], gathered)
    return gathered
  }
  const routes = fields[ROUTES]
  if (routes === undefined) return into
  return mergeGathered (into, fields, routes)
}

function mergeGathered(into: Gathered | null, fields: Fields, routes: Routes): Gathered {
  const gathered = into ?? { streams: {}, routes: {} }
  const providers = routes[PROVIDERS]
  if (providers !== undefined) {
    gathered.routes[PROVIDERS] = concatProviders (gathered.routes[PROVIDERS], providers)
  }
  const streams = fields[OUT]
  if (streams !== undefined && everySource (streams)) {
    for (const name of Object.keys (streams)) {
      gathered.streams[name] = mergeStreams (gathered.streams[name], streams[name])
    }
  }
  for (const name of Object.keys (routes)) {
    const had = gathered.routes[name]
    const more = routes[name]
    gathered.routes[name] = had === undefined ? more : [...had, ...more]
  }
  return gathered
}

function setOutputs(target: object, streams: Outs, routes: Routes): void {
  const fields = fieldsOf (target)
  if (fields === null) return
  fields[OUT] = streams
  fields[ROUTES] = routes
}

export function applyUse<T extends object>(
  target: T,
  spec: Record<string, string>,
  define: (name: string, from: string) => readonly [S.Source<unknown>, Route],
): T {
  const fields = fieldsOf (target)
  if (fields === null) return target
  const hadStreams = fields[OUT]
  const hadRoutes = fields[ROUTES]
  const streams: Sources = hadStreams !== undefined && everySource (hadStreams)
    ? { ...hadStreams }
    : {}
  const routes: Routes = hadRoutes === undefined ? {} : { ...hadRoutes }
  for (const name of Object.keys (spec)) {
    const [source, route] = define (name, spec[name])
    const had = routes[name]
    streams[name] = mergeStreams (streams[name], source)
    routes[name] = had === undefined ? [route] : [...had, route]
  }
  fields[OUT] = streams
  fields[ROUTES] = routes
  return target
}

export function setGiven<Self extends object, G extends Outs>(
  target: Self,
  given: G,
): Self & Giving<G> {
  const fields = fieldsOf (target)
  if (fields !== null) fields[GIVEN] = given
  return target as Self & Giving<G>
}

export function outsOf(target: View | S.Source<unknown>): Sources {
  const streams = fieldsOf (target)?.[OUT]
  return streams !== undefined && everySource (streams) ? streams : NO_OUTPUTS
}

export function givenOf(target: View | S.Source<unknown>): Sources {
  const given = fieldsOf (target)?.[GIVEN]
  return given !== undefined && everySource (given) ? given : NO_OUTPUTS
}

export function routesOf(
  target: View | S.Source<unknown>,
): Record<string, readonly Route[]> {
  return fieldsOf (target)?.[ROUTES] ?? NO_ROUTES
}

export function subscribeTo(
  target: View | S.Source<unknown>,
  names: readonly string[],
  sink: OutputSink,
): Disposable {
  const streams = outsOf (target)
  let held: Disposable[] | null = null
  for (const name of names) {
    const source = streams[name]
    if (source !== undefined) (held ??= []).push (sink.accept (name, source))
  }
  const opened = subscribeToProviders (target, names, sink)
  if (opened !== NOTHING_TO_CLOSE) (held ??= []).push (opened)
  return joinDisposables (held)
}

export function subscribeToProviders(
  target: View | S.Source<unknown>,
  names: readonly string[],
  sink: OutputSink,
): Disposable {
  const providers = providersOf (target)
  if (providers === undefined) return NOTHING_TO_CLOSE
  let held: Disposable[] | null = null
  for (const provider of providers) {
    const subscription = provider.subscribe (names, sink)
    if (subscription !== NOTHING_TO_CLOSE) (held ??= []).push (subscription)
  }
  return joinDisposables (held)
}

export function providersOf(value: unknown): readonly OutputSource[] | undefined {
  const fields = fieldsOf (value)
  return fields === null ? undefined : fields[ROUTES]?.[PROVIDERS]
}

export function takeChildOutputs(view: View, children: readonly unknown[]): View {
  if (children.length === 1) {
    const only = children[0]
    const fields = fieldsOf (only)
    if (fields !== null && !Array.isArray (only)) {
      const routes = fields[ROUTES]
      if (routes !== undefined) setOutputs (view, fields[OUT] ?? NO_OUTPUTS, routes)
      return view
    }
  }
  let gathered: Gathered | null = null
  for (let i = 0; i < children.length; i++) {
    gathered = gatherFrom (children[i], gathered)
  }
  if (gathered !== null) setOutputs (view, gathered.streams, gathered.routes)
  return view
}
