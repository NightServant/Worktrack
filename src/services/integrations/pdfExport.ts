import { createElement as h, type ReactElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import { Document, Font, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'
import {
  FALLBACK_NATURAL_LINE_HEIGHT,
  cssLineHeight,
  normalizeGeometry,
  normalizeTypography,
  type DocumentTypography,
  type PageGeometry,
} from '@/lib/pageGeometry'

/**
 * PDF export for the CV editor.
 *
 * TWO HOMES BEFORE THIS ONE, AND THE SECOND FAILURE IS WHY THIS IS THE THIRD.
 *
 * It began as a Supabase edge function driving headless Chromium, against a
 * runtime published at 256MB of memory and a 20MB bundle. Chromium clears
 * neither, so it was never deployable and never deployed -- the editor showed
 * "Failed to fetch" because the function did not exist. Moving it to a Vercel
 * route fixed the deployability and inherited the harder half: Chromium there
 * is `@sparticuz/chromium`, which extracts its shared libraries only when it
 * recognises the runtime, and on Node 24 it did not -- `libnss3.so: cannot
 * open shared object file`, in production, after the local render was fine.
 *
 * THE REASON THAT KEPT HAPPENING IS THE REASON THIS IS DIFFERENT. Every
 * Chromium failure lived on a code path that only exists inside Lambda, so no
 * amount of local verification could reach it and each fix had to be tested by
 * deploying and waiting. `@react-pdf/renderer` has no binary, no extraction
 * and no runtime detection: it lays the document out in JavaScript and writes
 * the PDF. What renders here renders in production, which is the property that
 * was missing.
 *
 * THE COST IS HONEST AND WORTH NAMING. There is no browser, so this is not
 * "the editor's HTML, printed" -- the layout is re-expressed below in
 * `@react-pdf/renderer`'s primitives, and anything the editor can do that is
 * not mapped here does not appear. That is a real ceiling, and the mapping is
 * deliberately small: the CV shapes the editor actually produces.
 *
 * WHICH IS WHY THE DOCUMENT'S OWN PAGE AND TYPE ARE READ HERE (2026-09-17,
 * Gabe: "when I am trying to save the document as PDF, format is not preserved
 * properly"). This file used to lay every CV out in Times on a Letter page at
 * 0.8in with a 24pt title, a 14pt section heading and an 11.5pt body --
 * regardless of what the document said. The .docx and .tex exports beside it
 * have read `pageGeometry` and `documentTypography` off the doc node since
 * they were written, and the editor has honoured them on screen since the
 * import started producing them, so the PDF was the one artefact that
 * disagreed with all three: a CV imported at Garamond 10pt with 0.35in margins
 * and eight ruled section headings, edited that way and previewed that way,
 * came out as a different document. Everything below that reads `sheet` exists
 * to close that gap.
 */

// ponytail: hyphenation off, because a hyphenated surname or job title in a CV
// reads as a typo. react-pdf hyphenates by default.
Font.registerHyphenationCallback((word) => [word])

/** PDF user space is 72 to the inch; CSS pixels are 96. */
const POINTS_PER_INCH = 72
const POINTS_PER_PX = 0.75

/** The editor's ink, so a heading rule matches the text above it. */
const INK = '#111827'

/**
 * The editor's own defaults, in points, for a document that states no type.
 *
 * READ OFF `WordResumeEditor`'s CLASS LIST rather than chosen here, and that
 * is the point of the comment: the sheet sets `--doc-h1-size` to `1.45em` and
 * `--doc-h2-size` to `1.05em` of the body, a paragraph to `0 0 0.5rem` and a
 * section heading to `1rem 0 0.25rem`. This file used to answer 24pt, 14pt and
 * 12pt to the same question, which is where the oversized title in the
 * exported PDF came from. A CV typed in this editor and never imported has no
 * typography attributes at all, so these numbers are what it gets -- and they
 * have to be the numbers on screen.
 */
const EDITOR = {
  /**
   * 16px, WHICH IS WHAT THE SHEET INHERITS. `editorProps` used to set
   * `text-[15px] leading-7` on the editable element and no longer does -- a
   * class there wins over the size an imported document puts on the wrapper --
   * so a document with no typography of its own is typed at the browser's own
   * 16px, and 16px is 12pt. This answered 11.5, which is the old 15px rounded.
   */
  body: 12,
  titleScale: 1.45,
  sectionScale: 1.05,
  /** `1rem` and `0.75rem` of heading space above, `0.25rem` below. */
  h2Before: 16 * POINTS_PER_PX,
  h3Before: 12 * POINTS_PER_PX,
  headingAfter: 4 * POINTS_PER_PX,
  /** `0.5rem` under a paragraph, `0.25rem` under a paragraph inside a list. */
  paragraphAfter: 8 * POINTS_PER_PX,
  listParagraphAfter: 4 * POINTS_PER_PX,
  /** `pl-6` on the list, and `border-b` + `pb-0.5` on a ruled heading. */
  listIndent: 24 * POINTS_PER_PX,
  rule: 1 * POINTS_PER_PX,
  rulePadding: 2 * POINTS_PER_PX,
}

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[]; marks?: Mark[] }
type Mark = { type?: string; attrs?: Record<string, unknown> }

/**
 * `11pt`, `14px` and `14` all mean a number of points here.
 *
 * The editor's font-size control writes whichever unit its menu used, and a
 * size that silently fails to parse is a line of the CV at the wrong size --
 * quiet, and only visible next to the rest.
 */
export function toPoints(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const match = /^\s*(\d+(?:\.\d+)?)\s*(pt|px|rem|em)?\s*$/i.exec(value)
  if (!match) return undefined
  const size = Number(match[1])
  const unit = (match[2] ?? 'pt').toLowerCase()
  if (unit === 'px') return size * POINTS_PER_PX
  if (unit === 'rem' || unit === 'em') return size * 12
  return size
}

/**
 * The three families a PDF can rely on, and which one a CSS stack means.
 *
 * `@react-pdf/renderer` ships the PDF standard fonts and nothing else; a real
 * face would have to be fetched and registered, which is a network call inside
 * a Lambda and exactly the class of failure this file was moved here to stop
 * having. So the document's family resolves to the closest of the three the
 * format guarantees -- which is a ceiling, and still the difference between a
 * CV set in Calibri exporting as a sans-serif and exporting as Times.
 *
 * THE SAME TEST AS THE LATEX EXPORT uses, deliberately: two exports that
 * disagree about whether Aptos is a sans-serif produce two different documents
 * from one source.
 */
export type PdfFamily = 'Times' | 'Helvetica' | 'Courier'

/** Regular, bold, italic, bold-italic. The standard names, which differ. */
const FACES: Record<PdfFamily, [string, string, string, string]> = {
  Times: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  Helvetica: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  Courier: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
}

export function familyFor(stack: string | null | undefined): PdfFamily {
  if (!stack) return 'Times'
  if (/mono|courier|consolas|menlo/i.test(stack)) return 'Courier'
  if (/sans|helvetica|arial|verdana|tahoma|calibri|aptos|segoe|roboto|system-ui/i.test(stack)) {
    return 'Helvetica'
  }
  return 'Times'
}

/**
 * The four faces of a family are one font to a reader and four names here.
 *
 * `@react-pdf/renderer` selects a face by NAME, not by `fontWeight`/
 * `fontStyle` -- so bold-inside-italic has to be resolved to `Times-BoldItalic`
 * before it is handed over, or it renders upright and nobody can see why. The
 * regular weight is the one that is not spelled consistently across the three:
 * `Times-Roman`, but plain `Helvetica` and `Courier`.
 */
export function faceFor(bold: boolean, italic: boolean, family: PdfFamily = 'Times'): string {
  const [regular, boldFace, italicFace, boldItalic] = FACES[family]
  if (bold && italic) return boldItalic
  if (bold) return boldFace
  if (italic) return italicFace
  return regular
}

/** The style one run of text carries, from its marks. */
export function styleForMarks(
  marks: Mark[] | undefined,
  baseBold = false,
  baseFamily: PdfFamily = 'Times'
): Style {
  const names = new Set((marks ?? []).map((mark) => mark?.type))
  // A run may name its own face; the document's is the default under it.
  const declared = (marks ?? []).find((mark) => mark?.type === 'textStyle')?.attrs?.fontFamily
  const family = typeof declared === 'string' ? familyFor(declared) : baseFamily

  // `baseBold` IS NOT A FLOURISH. Each run is its own <Text> nested inside the
  // block's <Text>, and a nested `fontFamily` WINS -- so a heading styled
  // Times-Bold rendered upright the moment its text run named Times-Roman,
  // which is every heading. The block passes its own weight down instead.
  const style: Style = {
    fontFamily: faceFor(names.has('bold') || baseBold, names.has('italic'), family),
  }

  // Both at once is a real combination and the type is a fixed union, so the
  // pair is spelled out rather than joined from an array of strings.
  const underline = names.has('underline')
  const strike = names.has('strike')
  if (underline && strike) style.textDecoration = 'line-through underline'
  else if (underline) style.textDecoration = 'underline'
  else if (strike) style.textDecoration = 'line-through'

  for (const mark of marks ?? []) {
    if (mark?.type === 'textStyle') {
      const size = toPoints(mark.attrs?.fontSize)
      if (size) style.fontSize = size
      if (typeof mark.attrs?.color === 'string') style.color = mark.attrs.color
    }
    if (mark?.type === 'highlight') {
      // The editor stores `null` for the default highlight.
      style.backgroundColor = typeof mark.attrs?.color === 'string' ? mark.attrs.color : '#fef08a'
    }
  }

  return style
}

/**
 * The page, and every block style on it, from what the document carries.
 *
 * ONE OBJECT THREADED THROUGH `block` rather than a module-level StyleSheet,
 * because none of these are constants any more: the body size, the leading,
 * the space under a paragraph and the size of a section heading are all the
 * document's to state. A `StyleSheet.create` at module scope is what made them
 * look like settled facts.
 */
export interface Sheet {
  page: Style
  family: PdfFamily
  heading: (level: number, ruled: boolean) => Style
  paragraph: (inList: boolean) => Style
  listRow: Style
  bullet: Style
  listBody: Style
}

export function sheetFor(geometry: PageGeometry, type: DocumentTypography): Sheet {
  const family = familyFor(type.fontFamily)
  const body = type.fontSize ?? EDITOR.body
  const inches = (value: number) => value * POINTS_PER_INCH

  /**
   * Word's line spacing is a multiple of SINGLE -- the font's own line box --
   * and react-pdf's `lineHeight`, like CSS's, multiplies the FONT SIZE. The
   * editor measures the resolved face to convert between them; there is no
   * browser here, so the serif fallback is the measurement. Unstated leaves
   * react-pdf's own default alone.
   */
  const lineHeight = cssLineHeight(type.lineHeight, FALLBACK_NATURAL_LINE_HEIGHT) ?? undefined

  const headingSize = (level: number) => {
    if (level === 1) return type.titleSize ?? body * EDITOR.titleScale
    if (level === 2) return type.sectionSize ?? body * EDITOR.sectionScale
    return type.sectionSize ?? body
  }

  return {
    page: {
      paddingTop: inches(geometry.margin.top),
      paddingRight: inches(geometry.margin.right),
      paddingBottom: inches(geometry.margin.bottom),
      paddingLeft: inches(geometry.margin.left),
      fontFamily: faceFor(false, false, family),
      fontSize: body,
      color: INK,
      ...(lineHeight ? { lineHeight } : {}),
    },
    family,
    heading: (level, ruled) => ({
      fontSize: headingSize(level),
      fontFamily: faceFor(true, false, family),
      // `h1` HAS NO SPACE ABOVE IT even when the document states heading
      // spacing, because the editor's rule is `margin-block: 0 var(...)` for
      // the title and `var(--doc-h-before, 1rem) 0 var(...)` for a section.
      // A CV's name sits at the top of the page.
      marginTop:
        level === 1
          ? 0
          : (type.headingSpaceBefore ?? (level === 2 ? EDITOR.h2Before : EDITOR.h3Before)),
      marginBottom: type.headingSpaceAfter ?? EDITOR.headingAfter,
      ...(ruled
        ? {
            // THE RULE UNDER A SECTION HEADING. Word draws it as a border on
            // the paragraph, the import reads it out of `w:pBdr`, the editor
            // draws it from `[data-ruled]` and the .docx export writes it back
            // -- and this dropped it, so every exported PDF lost the eight
            // lines that make a CV look like a CV.
            borderBottomWidth: EDITOR.rule,
            borderBottomColor: INK,
            paddingBottom: EDITOR.rulePadding,
          }
        : {}),
    }),
    paragraph: (inList) => ({
      marginTop: 0,
      marginBottom:
        type.paragraphSpacing ?? (inList ? EDITOR.listParagraphAfter : EDITOR.paragraphAfter),
    }),
    // `pl-6` on the editor's list, split between the bullet's column and the
    // indent before it, so the text starts where the browser starts it.
    listRow: { flexDirection: 'row', paddingLeft: EDITOR.listIndent / 2 },
    bullet: { width: EDITOR.listIndent / 2 },
    listBody: { flex: 1 },
  }
}

/**
 * The line spacing the ribbon writes, which is a MARK and not a block attr.
 *
 * `LineHeight` from `@tiptap/extension-text-style` is a global attribute on
 * `textStyle`, rendered as an inline `line-height` on the run -- so a
 * paragraph set to double spacing carries it on its text, not on itself.
 * Applied to the block, because spacing between lines is not something one
 * run of a paragraph can have. Unlike the document's own value this one is
 * already a CSS multiple of the font size, so it is used as it is written.
 */
function lineHeightOf(node: Node): number | undefined {
  for (const child of node.content ?? []) {
    for (const mark of child.marks ?? []) {
      if (mark?.type !== 'textStyle') continue
      const value = Number.parseFloat(String(mark.attrs?.lineHeight ?? ''))
      if (Number.isFinite(value) && value > 0) return value
    }
  }
  return undefined
}

/** The text runs of a block, each as its own styled <Text>. */
function inlines(node: Node, keyPrefix: string, sheet: Sheet, baseBold = false): ReactElement[] {
  return (node.content ?? []).flatMap((child, index) => {
    if (child?.type !== 'text' || typeof child.text !== 'string') return []
    return [
      h(
        Text,
        {
          key: `${keyPrefix}-t${index}`,
          style: styleForMarks(child.marks, baseBold, sheet.family),
        },
        child.text
      ),
    ]
  })
}

/**
 * The space Word puts above and below THIS block, where it states any.
 *
 * PER BLOCK, NOT PER DOCUMENT, and that distinction is the whole reason the
 * attributes exist: an imported CV writes eight different `w:after` values --
 * 0.5pt under a bullet, 4pt between skills lines, 8pt under the contact line
 * -- and one number for all of them is half an inch of page in the wrong
 * place. See `components/cv/editorExtensions`.
 */
function spacingOf(node: Node): Style {
  const points = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
  const before = points(node.attrs?.spaceBefore)
  const after = points(node.attrs?.spaceAfter)
  return {
    ...(before !== undefined ? { marginTop: before } : {}),
    ...(after !== undefined ? { marginBottom: after } : {}),
  }
}

/**
 * One block of the document. Returns null for anything unmapped.
 *
 * `inList` drops the paragraph's vertical margin: inside a list item that
 * margin pushes the text down while the bullet beside it stays put, so every
 * bullet floated above its own line.
 */
function block(node: Node, key: string, sheet: Sheet, inList = false): ReactElement | null {
  const align = node.attrs?.textAlign
  const alignment: Style =
    align === 'center' || align === 'right' || align === 'justify' ? { textAlign: align } : {}
  const leading = lineHeightOf(node)
  const spacing: Style = {
    ...alignment,
    ...(leading ? { lineHeight: leading } : {}),
    ...spacingOf(node),
  }

  if (node.type === 'heading') {
    const level = Number(node.attrs?.level ?? 1)
    return h(
      Text,
      { key, style: [sheet.heading(level, node.attrs?.ruled === true), spacing] },
      inlines(node, key, sheet, true)
    )
  }

  if (node.type === 'paragraph') {
    // An empty paragraph is the editor's blank line and has to keep its height.
    const runs = inlines(node, key, sheet)
    return h(Text, { key, style: [sheet.paragraph(inList), spacing] }, runs.length ? runs : ' ')
  }

  if (node.type === 'bulletList' || node.type === 'orderedList') {
    const ordered = node.type === 'orderedList'
    return h(
      View,
      { key },
      (node.content ?? []).map((item, index) =>
        h(
          View,
          { key: `${key}-i${index}`, style: sheet.listRow },
          h(Text, { style: sheet.bullet }, ordered ? `${index + 1}.` : '•'),
          h(
            View,
            { style: sheet.listBody },
            (item.content ?? []).map((child, childIndex) =>
              block(child, `${key}-i${index}-${childIndex}`, sheet, true)
            )
          )
        )
      )
    )
  }

  return null
}

/**
 * The document tree, ready to render.
 *
 * Exported so the mapping can be asserted without producing a PDF: a test that
 * has to read binary output to find out whether bold survived is a test nobody
 * writes twice.
 */
export function buildDocument(content: unknown, title: string): ReactElement<DocumentProps> {
  const root = (content ?? {}) as Node
  // THE PAGE THE DOCUMENT CARRIES, not a fixed Letter at 0.8in. A CV imported
  // at 0.35in margins and exported at 0.8in wraps every paragraph earlier and
  // grows by several lines: the file a recruiter opens is not the file that
  // was uploaded. Same read as the .docx and .tex exports.
  const geometry = normalizeGeometry(root.attrs?.pageGeometry)
  const sheet = sheetFor(geometry, normalizeTypography(root.attrs?.documentTypography))

  const blocks = (root.content ?? [])
    .map((node, index) => block(node, `b${index}`, sheet))
    .filter((element): element is ReactElement => element !== null)

  return h(
    Document,
    { title },
    h(
      Page,
      {
        size: [geometry.width * POINTS_PER_INCH, geometry.height * POINTS_PER_INCH],
        style: sheet.page,
      },
      blocks
    )
  )
}

export async function buildPdf(content: unknown, title: string): Promise<Uint8Array> {
  const buffer = await renderToBuffer(buildDocument(content, title))
  return new Uint8Array(buffer)
}
