import * as S from '@algosail/plystream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  checkedOf,
  fieldOf,
  fromEvent,
  fromIntersection,
  fromMutation,
  fromResize,
  prevented,
  valueOf,
} from '../src/read.ts'
import { installDom } from './test_util.ts'

const dom = installDom ()

const collect = <A>(strm: S.Stream<A>): [A[], Disposable] => {
  const seen: A[] = []
  return [seen, S.subscribe ((_t: S.Time, a: A) => seen.push (a)) (strm)]
}

const withObserver = (
  name: 'ResizeObserver' | 'IntersectionObserver' | 'MutationObserver',
  run: (calls: { options: unknown[]; disconnects: number }) => void,
): void => {
  const calls = { options: [] as unknown[], disconnects: 0 }
  const real = globalThis[name]
  class Fake {
    observe(_target: unknown, options?: unknown): void {
      calls.options.push (options)
    }
    unobserve(): void {}
    disconnect(): void {
      calls.disconnects += 1
    }
  }
  (globalThis as unknown as Record<string, unknown>)[name] = Fake
  try {
    run (calls)
  } finally {
    (globalThis as unknown as Record<string, unknown>)[name] = real
  }
}

const withEmit = (
  name: 'ResizeObserver' | 'IntersectionObserver' | 'MutationObserver',
  run: (emit: (value: unknown) => void) => void,
): void => {
  let emit: ((value: unknown) => void) | null = null
  class Fake {
    constructor(cb: (value: unknown) => void) {
      emit = cb
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  const real = globalThis[name]
  ;(globalThis as unknown as Record<string, unknown>)[name] = Fake
  try {
    run ((value) => {
      assert (emit !== null)
      emit (value)
    })
  } finally {
    (globalThis as unknown as Record<string, unknown>)[name] = real
  }
}

test ('fromEvent: events of that name reach the stream, and others do not', () => {
  const target = new EventTarget ()
  const [seen] = collect (fromEvent ('ping') (target))
  target.dispatchEvent (new Event ('ping'))
  target.dispatchEvent (new Event ('ping'))
  target.dispatchEvent (new Event ('pong'))
  assert.deepStrictEqual (seen.length, 2)
})

test ('fromEvent: disposing the subscription removes the listener', () => {
  const target = new EventTarget ()
  const [seen, sub] = collect (fromEvent ('ping') (target))
  target.dispatchEvent (new Event ('ping'))
  S.dispose (sub)
  target.dispatchEvent (new Event ('ping'))
  assert.deepStrictEqual (seen.length, 1)
})

test ('fromEvent: each subscription receives the event', () => {
  const target = new EventTarget ()
  const stream = fromEvent ('ping') (target)
  const [first] = collect (stream)
  const [second] = collect (stream)
  target.dispatchEvent (new Event ('ping'))
  assert.deepStrictEqual ([first.length, second.length], [1, 1])
})

test ('fromEvent: listener options are used to add and to remove', () => {
  const target = new EventTarget ()
  const added: unknown[] = []
  const removed: unknown[] = []
  const add = target.addEventListener.bind (target)
  const drop = target.removeEventListener.bind (target)
  target.addEventListener = ((
    type: string,
    fn: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ) => {
    added.push (options)
    add (type, fn, options)
  }) as typeof target.addEventListener
  target.removeEventListener = ((
    type: string,
    fn: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ) => {
    removed.push (options)
    drop (type, fn, options)
  }) as typeof target.removeEventListener
  const options = { capture: true }
  const [, sub] = collect (fromEvent ('ping', options) (target))
  S.dispose (sub)
  assert.deepStrictEqual ([added, removed], [[options], [options]])
})

test ('fromResize: accepts the element, the element with options, or options then the element', () => {
  withObserver ('ResizeObserver', (calls) => {
    const el = dom.document.createElement ('div')
    const [, direct] = collect (fromResize (el))
    const [, withBox] = collect (fromResize (el, { box: 'content-box' }))
    const [, curried] = collect (fromResize ({ box: 'border-box' }) (el))
    S.dispose (direct)
    S.dispose (withBox)
    S.dispose (curried)
    assert.deepStrictEqual (calls.options, [undefined, { box: 'content-box' }, {
      box: 'border-box',
    }])
    assert.deepStrictEqual (calls.disconnects, 3)
  })
})

test ('fromResize: an observation reaches the stream', () => {
  withEmit ('ResizeObserver', (emit) => {
    const [seen] = collect (fromResize (dom.document.createElement ('div')))
    emit ([])
    assert.deepStrictEqual (seen.length, 1)
  })
})

test ('fromIntersection: passes the options to the observer and disconnects on dispose', () => {
  const built: unknown[] = []
  let disconnects = 0
  const real = globalThis.IntersectionObserver
  class Fake {
    constructor(_cb: unknown, options?: IntersectionObserverInit) {
      built.push (options)
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      disconnects += 1
    }
  }
  globalThis.IntersectionObserver =
    Fake as unknown as typeof IntersectionObserver
  try {
    const el = dom.document.createElement ('div')
    const [, given] = collect (fromIntersection ({ threshold: 0.5 }) (el))
    const [, omitted] = collect (fromIntersection () (el))
    S.dispose (given)
    S.dispose (omitted)
    assert.deepStrictEqual (built, [{ threshold: 0.5 }, undefined])
    assert.deepStrictEqual (disconnects, 2)
  } finally {
    globalThis.IntersectionObserver = real
  }
})

test ('fromIntersection: an observation reaches the stream', () => {
  withEmit ('IntersectionObserver', (emit) => {
    const [seen] = collect (
      fromIntersection () (dom.document.createElement ('div')),
    )
    emit ([])
    assert.deepStrictEqual (seen.length, 1)
  })
})

test ('fromMutation: passes the options and disconnects on dispose', () => {
  withObserver ('MutationObserver', (calls) => {
    const el = dom.document.createElement ('div')
    const [, sub] = collect (fromMutation ({ childList: true }) (el))
    S.dispose (sub)
    assert.deepStrictEqual (calls.options, [{ childList: true }])
    assert.deepStrictEqual (calls.disconnects, 1)
  })
})

test ('fromMutation: an observation reaches the stream', () => {
  withEmit ('MutationObserver', (emit) => {
    const [seen] = collect (
      fromMutation ({ childList: true }) (dom.document.createElement ('div')),
    )
    emit ([])
    assert.deepStrictEqual (seen.length, 1)
  })
})

test ('valueOf: reads the value of the control the event came from', () => {
  const input = dom.document.createElement ('input')
  input.value = 'Ada'
  let seen = ''
  input.addEventListener ('input', (e) => {
    seen = valueOf (e)
  })
  input.dispatchEvent (new dom.Event ('input'))
  assert.deepStrictEqual (seen, 'Ada')
})

test ('checkedOf: reads whether the control is checked', () => {
  const input = dom.document.createElement ('input')
  input.type = 'checkbox'
  input.checked = true
  let seen = false
  input.addEventListener ('change', (e) => {
    seen = checkedOf (e)
  })
  input.dispatchEvent (new dom.Event ('change'))
  const on = seen
  input.checked = false
  input.dispatchEvent (new dom.Event ('change'))
  assert.deepStrictEqual ([on, seen], [true, false])
})

test ('prevented: calls preventDefault and returns the same event', () => {
  const event = new dom.Event ('submit', { cancelable: true })
  assert.deepStrictEqual (prevented (event), event)
  assert.deepStrictEqual (event.defaultPrevented, true)
})

test ('fieldOf: reads a named field of the form, or an empty string when it is missing', () => {
  const form = dom.document.createElement ('form')
  const input = dom.document.createElement ('input')
  input.name = 'title'
  input.value = 'Ada'
  form.append (input)
  let found = ''
  let missing = 'untouched'
  form.addEventListener ('submit', (e) => {
    found = fieldOf ('title') (e)
    missing = fieldOf ('absent') (e)
  })
  form.dispatchEvent (new dom.Event ('submit'))
  assert.deepStrictEqual ([found, missing], ['Ada', ''])
})
