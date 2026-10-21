import type * as P from '@algosail/ply'
import * as S from '@algosail/plystream'
import { disposeEach, isNil } from './close.ts'

const BOOLEAN = new Set ([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'disablepictureinpicture',
  'disableremoteplayback',
  'download',
  'formnovalidate',
  'hidden',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
  'shadowrootclonable',
  'shadowrootdelegatesfocus',
  'shadowrootserializable',
])

const LIVE = new Set (['value', 'checked', 'selected', 'muted'])

const ON = 'on:'
const ON_HEAD = ON.charCodeAt (0)
const DOT = '.'.charCodeAt (0)

class Attr {
  element: Element
  key: string

  constructor(element: Element, key: string) {
    this.element = element
    this.key = key
  }

  event(_time: S.Time, value: unknown): void {
    setAttribute (this.element, this.key, value)
  }

  end(): void {}
}

class Prop {
  element: Element
  key: string

  constructor(element: Element, key: string) {
    this.element = element
    this.key = key
  }

  event(_time: S.Time, value: unknown): void {
    setByKey (this.element, this.key, value)
  }

  end(): void {}
}

class Styling {
  style: object
  key: string

  constructor(style: object, key: string) {
    this.style = style
    this.key = key
  }

  event(_time: S.Time, value: unknown): void {
    setByKey (this.style, this.key, value ?? '')
  }

  end(): void {}
}

class Live {
  element: Element
  key: string

  constructor(element: Element, key: string) {
    this.element = element
    this.key = key
  }

  event(_time: S.Time, value: unknown): void {
    writeLive (this.element, this.key, value)
  }

  end(): void {}
}

function setByKey(target: object, key: string, value: unknown): void {
  const bag = target as Record<string, unknown>
  bag[key] = value
}

function setAttribute(element: Element, key: string, value: unknown): void {
  if (isNil (value) || (value === false && BOOLEAN.has (key))) {
    element.removeAttribute (key)
  } else {
    element.setAttribute (
      key,
      value === true && BOOLEAN.has (key) ? '' : String (value),
    )
  }
}

function writeLive(element: Element, key: string, value: unknown): void {
  if (key === 'value') {
    const text = isNil (value) ? '' : String (value)
    setByKey (element, key, text)
    element.setAttribute (key, text)
    return
  }
  setByKey (element, key, value)
  setAttribute (element, key, value)
}

function reading(
  value: S.Source<unknown>,
  into: S.Sink<unknown>,
): Disposable {
  return value.run (into, S.defaultScheduler ())
}

function isBlock(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !S.isSource (value)
}

function bindEvent(
  element: Element,
  type: string,
  handler: EventListener,
): Disposable {
  element.addEventListener (type, handler)
  return S.disposable (() => element.removeEventListener (type, handler))
}

function bindProperty(
  element: Element,
  prop: string,
  value: unknown,
): Disposable {
  if (!S.isSource (value)) {
    setByKey (element, prop, value)
    return S.disposeNone ()
  }
  return reading (value, new Prop (element, prop))
}

function bindStyle(
  element: Element,
  block: P.StrMap<unknown>,
  adopted: boolean,
): Disposable {
  const style = (element as HTMLElement).style
  const names = Object.keys (block)
  if (names.length === 0) return S.disposeNone ()

  const held: Disposable[] = []
  for (const name of names) {
    const value = block[name]
    if (!S.isSource (value)) {
      if (!adopted) setByKey (style, name, value ?? '')
      continue
    }
    held.push (reading (value, new Styling (style, name)))
  }
  if (held.length === 0) return S.disposeNone ()
  return S.disposable (() => disposeEach (held))
}

function bindAttribute(
  element: Element,
  key: string,
  value: unknown,
  adopted: boolean,
): Disposable {
  if (!S.isSource (value)) {
    if (!adopted) setAttribute (element, key, value)
    return S.disposeNone ()
  }
  return reading (value, new Attr (element, key))
}

function bindLive(
  element: Element,
  key: string,
  value: unknown,
  adopted: boolean,
): Disposable {
  if (!S.isSource (value)) {
    if (!adopted) writeLive (element, key, value)
    return S.disposeNone ()
  }
  return reading (value, new Live (element, key))
}

export function applyProp(
  element: Element,
  key: string,
  value: unknown,
  adopted = false,
): Disposable {
  const mark = key.charCodeAt (0)
  if (mark === ON_HEAD && key.startsWith (ON)) {
    if (typeof value === 'function') {
      return bindEvent (element, key.slice (ON.length), value as EventListener)
    }
    if (S.isSource (value)) {
      throw new TypeError (`${key} wants an event handler, found a stream`)
    }
  }
  if (mark === DOT) {
    return bindProperty (element, key.slice (1), value)
  }
  if (key === 'style' && isBlock (value)) {
    return bindStyle (element, value as P.StrMap<unknown>, adopted)
  }
  if (LIVE.has (key) && key in element) {
    return bindLive (element, key, value, adopted)
  }
  return bindAttribute (element, key, value, adopted)
}
