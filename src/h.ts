import type { ElementBuilder } from './element.ts'
import type { Child, ElementView, Merge, On, Props } from './view.ts'
import { elementIn } from './element.ts'

/** Call with children, or with props and then children. */
export type ElementFn = {
  <const Ks extends readonly Child[]>(
    children: Ks,
  ): ElementView<Merge<Ks>, On<Ks>>
  <const Ks extends readonly Child[]>(
    props?: Props,
    children?: Ks,
  ): ElementView<Merge<Ks>, On<Ks>>
}

const NO_PROPS: Props = Object.freeze ({})
const NO_KIDS: Child[] = Object.freeze ([]) as unknown as Child[]

function tagFn(build: ElementBuilder): (tag: string) => ElementFn {
  return (tag) =>
    ((first: Child[] | Props = NO_PROPS, second: Child[] = NO_KIDS) =>
      Array.isArray (first)
        ? build (tag, NO_PROPS, first)
        : build (tag, first, second)) as ElementFn
}

const SVG_NS = 'http://www.w3.org/2000/svg'

const createElementFn = tagFn (elementIn (null))
const createSvgElementFn = tagFn (elementIn (SVG_NS))

export const div: ElementFn = createElementFn ('div')
export const span: ElementFn = createElementFn ('span')
export const ul: ElementFn = createElementFn ('ul')
export const li: ElementFn = createElementFn ('li')
export const ol: ElementFn = createElementFn ('ol')
export const dl: ElementFn = createElementFn ('dl')
export const dt: ElementFn = createElementFn ('dt')
export const dd: ElementFn = createElementFn ('dd')
export const main: ElementFn = createElementFn ('main')
export const header: ElementFn = createElementFn ('header')
export const footer: ElementFn = createElementFn ('footer')
export const section: ElementFn = createElementFn ('section')
export const article: ElementFn = createElementFn ('article')
export const aside: ElementFn = createElementFn ('aside')
export const nav: ElementFn = createElementFn ('nav')

export const details: ElementFn = createElementFn ('details')
export const summary: ElementFn = createElementFn ('summary')
export const a: ElementFn = createElementFn ('a')
export const button: ElementFn = createElementFn ('button')
export const input: ElementFn = createElementFn ('input')
export const output: ElementFn = createElementFn ('output')
export const textarea: ElementFn = createElementFn ('textarea')
export const select: ElementFn = createElementFn ('select')
export const option: ElementFn = createElementFn ('option')
export const optgroup: ElementFn = createElementFn ('optgroup')
export const label: ElementFn = createElementFn ('label')
export const form: ElementFn = createElementFn ('form')
export const progress: ElementFn = createElementFn ('progress')
export const meter: ElementFn = createElementFn ('meter')
export const fieldset: ElementFn = createElementFn ('fieldset')
export const legend: ElementFn = createElementFn ('legend')
export const datalist: ElementFn = createElementFn ('datalist')

export const figure: ElementFn = createElementFn ('figure')
export const figcaption: ElementFn = createElementFn ('figcaption')
export const img: ElementFn = createElementFn ('img')
export const picture: ElementFn = createElementFn ('picture')
export const source: ElementFn = createElementFn ('source')
export const video: ElementFn = createElementFn ('video')
export const audio: ElementFn = createElementFn ('audio')
export const iframe: ElementFn = createElementFn ('iframe')
export const embed: ElementFn = createElementFn ('embed')

export const time: ElementFn = createElementFn ('time')
export const mark: ElementFn = createElementFn ('mark')
export const p: ElementFn = createElementFn ('p')
export const h1: ElementFn = createElementFn ('h1')
export const h2: ElementFn = createElementFn ('h2')
export const h3: ElementFn = createElementFn ('h3')
export const h4: ElementFn = createElementFn ('h4')
export const h5: ElementFn = createElementFn ('h5')
export const h6: ElementFn = createElementFn ('h6')
export const code: ElementFn = createElementFn ('code')
export const pre: ElementFn = createElementFn ('pre')
export const blockquote: ElementFn = createElementFn ('blockquote')
export const var_: ElementFn = createElementFn ('var')
export const kbd: ElementFn = createElementFn ('kbd')
export const samp: ElementFn = createElementFn ('samp')
export const cite: ElementFn = createElementFn ('cite')
export const dfn: ElementFn = createElementFn ('dfn')
export const abbr: ElementFn = createElementFn ('abbr')
export const small: ElementFn = createElementFn ('small')
export const strong: ElementFn = createElementFn ('strong')
export const em: ElementFn = createElementFn ('em')
export const br: ElementFn = createElementFn ('br')
export const hr: ElementFn = createElementFn ('hr')

export const table: ElementFn = createElementFn ('table')
export const caption: ElementFn = createElementFn ('caption')
export const colgroup: ElementFn = createElementFn ('colgroup')
export const col: ElementFn = createElementFn ('col')
export const tbody: ElementFn = createElementFn ('tbody')
export const thead: ElementFn = createElementFn ('thead')
export const tfoot: ElementFn = createElementFn ('tfoot')
export const tr: ElementFn = createElementFn ('tr')
export const td: ElementFn = createElementFn ('td')
export const th: ElementFn = createElementFn ('th')

export const style: ElementFn = createElementFn ('style')
export const script: ElementFn = createElementFn ('script')
export const noscript: ElementFn = createElementFn ('noscript')
export const template: ElementFn = createElementFn ('template')
export const slot: ElementFn = createElementFn ('slot')

export const svg: ElementFn = createSvgElementFn ('svg')
export const g: ElementFn = createSvgElementFn ('g')
export const path: ElementFn = createSvgElementFn ('path')
export const circle: ElementFn = createSvgElementFn ('circle')
export const rect: ElementFn = createSvgElementFn ('rect')
export const line: ElementFn = createSvgElementFn ('line')
export const polyline: ElementFn = createSvgElementFn ('polyline')
export const polygon: ElementFn = createSvgElementFn ('polygon')
export const ellipse: ElementFn = createSvgElementFn ('ellipse')
export const defs: ElementFn = createSvgElementFn ('defs')
export const clipPath: ElementFn = createSvgElementFn ('clipPath')
export const mask: ElementFn = createSvgElementFn ('mask')
export const pattern: ElementFn = createSvgElementFn ('pattern')
export const linearGradient: ElementFn = createSvgElementFn ('linearGradient')
export const radialGradient: ElementFn = createSvgElementFn ('radialGradient')
export const stop: ElementFn = createSvgElementFn ('stop')
export const use: ElementFn = createSvgElementFn ('use')
