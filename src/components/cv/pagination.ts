import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Real page breaks: content is pushed past a boundary, not painted under one.
 *
 * WHY THE BACKGROUND VERSION HAD TO GO. The first attempt drew page edges with
 * a repeating gradient -- first a hairline, then a band of the well's colour to
 * give the "space between" that was asked for. Both are painted BEHIND the
 * text, so where a break fell mid-paragraph the band struck straight through a
 * line of it. Gabe's screenshot has a grey stripe across "Smart Human Resource
 * Management System", and "weird" was the right word: a page boundary that
 * crosses a sentence is not a page boundary, it is a stripe.
 *
 * Nothing about a background can fix that, because the content flows over it
 * regardless. The break has to MOVE the content.
 *
 * HOW IT WORKS. Every top-level block is measured, and their heights are
 * accumulated. When the next block would straddle a page edge, a widget
 * decoration is inserted before it, tall enough to fill the remainder of the
 * page plus the gap between sheets -- so the block starts at the top of the
 * next page and the space between is genuinely empty. That is what Word's
 * Print Layout does and why a heading never lands half over a page edge there.
 *
 * BLOCKS ARE MEASURED, NOT ESTIMATED. Line counts, character counts and
 * average line heights all fail on the document that matters: a CV mixes 16pt
 * headings, 11pt body and tight bullet lists, and a guess that is 5% out is a
 * page out by the third page. `offsetHeight` is what the browser actually laid
 * out.
 *
 * IT CONVERGES BECAUSE IT MEASURES BLOCKS, NOT POSITIONS. The naive version --
 * read each block's `offsetTop`, decide breaks, insert spacers, read again --
 * never settles, because inserting a spacer moves everything after it and
 * changes the answer. Accumulating intrinsic block heights and ignoring the
 * spacers gives the same result whether or not decorations are present, so the
 * second pass agrees with the first and it stops.
 *
 * A BLOCK TALLER THAN A PAGE IS LEFT ALONE. A single paragraph longer than a
 * page cannot be made to fit one, and pushing it to the next page would loop:
 * it would not fit there either. It starts where it starts and runs over, which
 * is what Word does with one too.
 */

export const paginationKey = new PluginKey('worktrack-pagination')

export interface PaginationOptions {
  /** Usable page height in CSS pixels: page height less both margins. */
  pageHeight: number
  /** The empty band between two sheets, in CSS pixels. */
  gap: number
  /**
   * The page's own margins, in CSS pixels.
   *
   * THE SHEET HAS MARGINS ONLY AT ITS TWO ENDS WITHOUT THESE. The editor pads
   * the whole editable area once, so the first page gets a top margin and the
   * last page a bottom one -- and every break in between had the text running
   * flush into the seam. Gabe's screenshot has "ACADEMIC AND PERSONAL
   * PROJECTS" sitting on the bottom edge of page one with its rule touching
   * the grey, and "AeroWeather" starting on the top edge of page two. A page
   * boundary is three bands, not one: the rest of this page's margin, the gap
   * between sheets, then the next page's margin.
   */
  marginTop: number
  marginBottom: number
}

/**
 * Where the breaks fall, given each block's height.
 *
 * Pure, so the rule can be tested without a browser: the caller measures and
 * this decides. Returns the INDEX of each block that should start a new page.
 */
export function breakIndexes(
  heights: number[],
  pageHeight: number
): number[] {
  if (pageHeight <= 0) return []
  const breaks: number[] = []
  let used = 0

  for (let i = 0; i < heights.length; i += 1) {
    const height = heights[i]

    // Taller than a page on its own: it cannot be made to fit, and moving it
    // would not help. Let it run over and start the next page after it.
    if (height > pageHeight) {
      used = 0
      continue
    }

    if (used + height > pageHeight && used > 0) {
      breaks.push(i)
      used = height
    } else {
      used += height
    }
  }

  return breaks
}

/** One thing the paginator may break before, and the page it consumes. */
export interface PageUnit {
  el: HTMLElement
  height: number
  /** Left padding of the list it sits in, so the seam can reach the sheet's edge. */
  inset: number
}

const px = (value: string | null | undefined) => Number.parseFloat(value || '0') || 0

/**
 * What the page is made of: top-level blocks, and each ITEM of a list.
 *
 * A LIST USED TO BE ONE BLOCK, so a break could only fall before or after all
 * of it. Gabe's 2026-10-18 CV breaks page one INSIDE a project's bullets, as
 * Word does; moving the whole list stranded the project's title and links at
 * the foot of page one above an empty band, with every bullet on page two.
 *
 * An item's share is measured from where it starts to where the next one
 * starts, in LAYOUT pixels (`offsetTop`, not `getBoundingClientRect`, which
 * the sheet's zoom would scale) and with any spacer already inside the list
 * taken back out -- so, like the blocks, the answer does not move when the
 * spacers it produces are drawn. The last item takes what is left of the
 * list's own height, so the items always add up to the list.
 */
export function pageUnits(dom: HTMLElement): PageUnit[] {
  const units: PageUnit[] = []
  for (const child of Array.from(dom.children) as HTMLElement[]) {
    if (child.hasAttribute('data-page-spacer')) continue
    const style = window.getComputedStyle(child)
    const outer = child.offsetHeight + px(style.marginTop) + px(style.marginBottom)
    const tag = child.tagName.toUpperCase()
    const items = tag === 'UL' || tag === 'OL' ? listUnits(child, outer, px(style.marginTop)) : null
    if (items) units.push(...items)
    else units.push({ el: child, height: outer, inset: 0 })
  }
  return units
}

function listUnits(list: HTMLElement, outer: number, marginTop: number): PageUnit[] | null {
  const items: HTMLElement[] = []
  const spacersBefore: number[] = []
  let spacers = 0
  for (const el of Array.from(list.children) as HTMLElement[]) {
    if (el.hasAttribute('data-page-spacer')) {
      spacers += el.offsetHeight
      continue
    }
    if (el.tagName.toUpperCase() !== 'LI') continue
    items.push(el)
    spacersBefore.push(spacers)
  }
  if (items.length < 2) return null

  // Items measure from their offsetParent; the list's own top is 0 when the
  // list is that parent, and its offsetTop when it is not.
  const listTop = (items[0].offsetParent === list ? 0 : list.offsetTop) - marginTop
  const top = (i: number) => items[i].offsetTop - spacersBefore[i]
  const inset = px(window.getComputedStyle(list).paddingLeft)

  let used = 0
  const units = items.map((el, i) => {
    const height = i < items.length - 1 ? top(i + 1) - (i === 0 ? listTop : top(i)) : outer - spacers - used
    used += height
    return { el, height, inset }
  })
  return units
}

/** How much of the page is still empty when the break falls, in pixels. */
export function remainingOnPage(
  heights: number[],
  breakIndex: number,
  pageHeight: number
): number {
  let used = 0
  for (let i = 0; i < breakIndex; i += 1) {
    const height = heights[i]
    if (height > pageHeight) {
      used = 0
      continue
    }
    if (used + height > pageHeight && used > 0) used = height
    else used += height
  }
  return Math.max(0, pageHeight - used)
}

export const Pagination = Extension.create<PaginationOptions>({
  name: 'worktrackPagination',

  addOptions() {
    return { pageHeight: 0, gap: 24, marginTop: 0, marginBottom: 0 }
  },

  addProseMirrorPlugins() {
    // Captured by value rather than aliasing `this`: the plugin's `view` runs
    // long after this call, and tiptap re-creates the extension when its
    // options change -- so holding a reference to the instance would read a
    // stale one. `getOptions` reads through the live extension each time.
    const getOptions = (): PaginationOptions => this.options

    return [
      new Plugin({
        key: paginationKey,

        view(editorView) {
          let decorations = DecorationSet.empty
          let frame = 0

          const recompute = () => {
            const { pageHeight, gap, marginTop, marginBottom } = getOptions()
            const dom = editorView.dom as HTMLElement
            if (!pageHeight || pageHeight <= 0) return

            // Blocks and list items, spacers skipped: their height is a
            // result of this calculation, so counting them would feed the
            // answer back into itself. See `pageUnits`.
            const units = pageUnits(dom)
            const heights = units.map((unit) => unit.height)

            const indexes = breakIndexes(heights, pageHeight)
            const next = indexes.map((index) => {
              const remaining = remainingOnPage(heights, index, pageHeight)
              const { el, inset } = units[index]
              const pos = editorView.posAtDOM(el, 0)
              return Decoration.widget(
                Math.max(0, pos - 1),
                () => {
                  const spacer = document.createElement('div')
                  spacer.setAttribute('data-page-spacer', '')
                  spacer.setAttribute('aria-hidden', 'true')
                  spacer.style.pointerEvents = 'none'
                  // PADDING, NOT MARGIN, ON THE WHITE BANDS. A child's top
                  // margin collapses straight out through a parent that has
                  // no border or padding, which would move the spacer itself
                  // rather than the seam inside it.
                  spacer.style.paddingTop = `${remaining + marginBottom}px`
                  spacer.style.paddingBottom = `${marginTop}px`

                  // The seam shows the well through the sheet, so two pages
                  // read as two sheets rather than one long one. Only this
                  // band is coloured: the padding above and below it is the
                  // page's own margin and stays white.
                  const seam = document.createElement('div')
                  seam.style.height = `${gap}px`
                  seam.style.background = 'var(--color-bg-inset)'
                  // A seam between two bullets starts inside the list's
                  // indent, so it reaches back across that too.
                  seam.style.marginLeft = `calc(-1 * var(--page-margin-left, 0px) - ${inset}px)`
                  seam.style.marginRight = 'calc(-1 * var(--page-margin-right, 0px))'
                  spacer.appendChild(seam)
                  return spacer
                },
                // `side: -1` puts the spacer before the block rather than
                // after the previous one, which matters when the break lands
                // between two blocks that a transaction is editing.
                { side: -1, key: `page-${index}-${Math.round(remaining)}` }
              )
            })

            const set = DecorationSet.create(editorView.state.doc, next)
            // Only dispatch when something actually changed: a no-op
            // transaction on every measurement would re-enter this forever.
            if (set.find().length !== decorations.find().length) {
              decorations = set
              editorView.dispatch(editorView.state.tr.setMeta(paginationKey, set))
              return
            }
            decorations = set
          }

          const schedule = () => {
            cancelAnimationFrame(frame)
            // One frame later, so the measurement reads a laid-out document
            // rather than the one being replaced.
            frame = requestAnimationFrame(recompute)
          }

          schedule()
          const observer = new ResizeObserver(schedule)
          observer.observe(editorView.dom as HTMLElement)

          return {
            update: schedule,
            destroy() {
              cancelAnimationFrame(frame)
              observer.disconnect()
            },
          }
        },

        state: {
          init: () => DecorationSet.empty,
          apply(tr, value) {
            const meta = tr.getMeta(paginationKey) as DecorationSet | undefined
            if (meta) return meta
            return value.map(tr.mapping, tr.doc)
          },
        },

        props: {
          decorations(state) {
            return paginationKey.getState(state) as DecorationSet
          },
        },
      }),
    ]
  },
})
