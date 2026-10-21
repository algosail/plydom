import * as S from '@algosail/plystream'

function observed<A>(
  start: (emit: (a: A) => void) => { disconnect(): void },
): S.Stream<A> {
  return S.stream<A> ((snk, sch) => {
    const observer = start ((a) => snk.event (sch.currentTime (), a))
    return S.disposable (() => observer.disconnect ())
  })
}

function resizeOf(
  element: Element,
  options?: ResizeObserverOptions,
): S.Stream<ResizeObserverEntry[]> {
  return observed ((emit) => {
    const observer = new ResizeObserver (emit)
    observer.observe (element, options)
    return observer
  })
}

/**
 * DOM events from a target.
 * @example
 * ```ts
 * import * as D from '@algosail/plydom'
 * import * as S from '@algosail/plystream'
 *
 * const target = new EventTarget ()
 * const seen: string[] = []
 * const sub = S.subscribe ((_t: S.Time, e: Event) => seen.push (e.type)) (
 *   D.fromEvent ('click') (target),
 * )
 * target.dispatchEvent (new Event ('click'))
 * S.dispose (sub)
 * target.dispatchEvent (new Event ('click'))
 * seen // => ['click']
 * ```
 */
export function fromEvent<E extends Event = Event>(
  type: string,
  options?: AddEventListenerOptions | boolean,
) {
  return (element: EventTarget): S.Stream<E> =>
    S.stream<E> ((snk, sch) => {
      const handler = (e: Event) => snk.event (sch.currentTime (), e as E)
      element.addEventListener (type, handler, options)
      return S.disposable (() =>
        element.removeEventListener (type, handler, options),
      )
    })
}

/**
 * `ResizeObserver` entries.
 * @example
 * ```ts ignore
 * D.fromResize(box)
 * D.fromResize({ box: 'border-box' })(box)
 * ```
 */
export function fromResize(
  element: Element,
  options?: ResizeObserverOptions,
): S.Stream<ResizeObserverEntry[]>
export function fromResize(
  options: ResizeObserverOptions,
): (element: Element) => S.Stream<ResizeObserverEntry[]>
export function fromResize(
  elementOrOptions: Element | ResizeObserverOptions,
  options?: ResizeObserverOptions,
):
  | S.Stream<ResizeObserverEntry[]>
  | ((element: Element) => S.Stream<ResizeObserverEntry[]>) {
  if ((elementOrOptions as Node).nodeType === 1) {
    return resizeOf (elementOrOptions as Element, options)
  }
  const init = elementOrOptions as ResizeObserverOptions
  return (element: Element) => resizeOf (element, init)
}

export function fromIntersection(
  options?: IntersectionObserverInit,
): (element: Element) => S.Stream<IntersectionObserverEntry[]> {
  return (element: Element) =>
    observed ((emit) => {
      const observer = new IntersectionObserver (emit, options)
      observer.observe (element)
      return observer
    })
}

export function fromMutation(
  options?: MutationObserverInit,
): (element: Node) => S.Stream<MutationRecord[]> {
  return (element: Node) =>
    observed ((emit) => {
      const observer = new MutationObserver (emit)
      observer.observe (element, options)
      return observer
    })
}

export const valueOf = (e: Event): string =>
  (e.target as HTMLInputElement).value

export const checkedOf = (e: Event): boolean =>
  (e.target as HTMLInputElement).checked

export const prevented = <E extends Event>(e: E): E => (e.preventDefault (), e)

export const fieldOf = (name: string) => (e: Event): string => {
  const field = (e.target as Element).querySelector (`[name="${name}"]`)
  return field === null ? '' : (field as HTMLInputElement).value ?? ''
}
