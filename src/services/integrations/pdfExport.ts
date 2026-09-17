import { createElement as h, type ReactElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import { statSync } from 'node:fs'
import { join } from 'node:path'
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
 * THE FACES THIS CAN ACTUALLY DRAW, AND WHY FOUR OF THEM ARE FILES IN THE REPO.
 *
 * `@react-pdf/renderer` ships the PDF standard 14 and nothing else, so until
 * 2026-09-17 every document collapsed onto Times, Helvetica or Courier --
 * which is correct for Times New Roman and Arial (the standard faces ARE those
 * metrics) and wrong for everything else. A CV set in Garamond printed in
 * Times: different shapes, different widths, different line breaks, a
 * different number of pages. That is the "font is not rendering the original"
 * report, and there is no way to answer it without the actual outlines.
 *
 * METRIC-COMPATIBLE CLONES, WHICH IS THE SAME TRADE THE UI ALREADY MAKES.
 * Calibri, Cambria and Georgia cannot be redistributed, and `src/app/layout`
 * already answers that for the interface: it serves Arimo because it is
 * metric-compatible with Arial "so it holds the same line breaks". Same
 * reasoning, same licence:
 *
 *   Carlito      Calibri           advance widths match, so lines wrap where
 *   Caladea      Cambria           Word wraps them and the page count holds
 *   Gelasio      Georgia
 *   EB Garamond  Garamond          a redrawing rather than a metric clone --
 *                                  the closest free thing to the face, which
 *                                  is what an imported CV most often asks for
 *
 * All four are SIL OFL 1.1; the licences sit beside the files in `fonts/`.
 *
 * REGISTRATION IS FAIL-SOFT, ON PURPOSE. These files reach production through
 * `outputFileTracingIncludes` (see next.config, and `pdfFontTracing.test`),
 * which is a Lambda-only path -- exactly the class of failure that cost three
 * deploys when this export ran Chromium. So every file is STATTED here, up
 * front: a family whose files are not on disk is dropped from the set and the
 * document falls back to the standard face it used before, which is the
 * behaviour this file shipped with. A missing font is a plainer PDF, never a
 * 500. (`src` has to be a path -- react-pdf reads it with fontkit at render
 * time and does not accept bytes -- so proving it exists is the whole of what
 * can be checked early, and it is the thing that would actually go wrong.)
 */
export type FamilyName = 'Times' | 'Helvetica' | 'Courier' | 'Carlito' | 'Caladea' | 'Gelasio' | 'EB Garamond'

/** What a run hands to react-pdf: a face name, or a family plus its variant. */
export interface Face {
  fontFamily: string
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
}

interface FamilyDefinition {
  /** The CSS family names this one answers to, in a stack. */
  aliases: RegExp
  /**
   * `line-height: normal` for the face, from its own `hhea` table --
   * `(ascent - descent + lineGap) / unitsPerEm`, measured with fontkit rather
   * than guessed. It is what Word calls SINGLE spacing, and the multiplier a
   * document states is a multiple of it.
   */
  natural: number
  /** Regular, bold, italic, bold-italic. */
  faces: [Face, Face, Face, Face]
  /** The four files, for a family this has to register itself. */
  files?: [string, string, string, string]
}

const standard = (regular: string, bold: string, italic: string, boldItalic: string): [Face, Face, Face, Face] => [
  { fontFamily: regular },
  { fontFamily: bold },
  { fontFamily: italic },
  { fontFamily: boldItalic },
]

const bundled = (family: string): [Face, Face, Face, Face] => [
  { fontFamily: family, fontWeight: 'normal', fontStyle: 'normal' },
  { fontFamily: family, fontWeight: 'bold', fontStyle: 'normal' },
  { fontFamily: family, fontWeight: 'normal', fontStyle: 'italic' },
  { fontFamily: family, fontWeight: 'bold', fontStyle: 'italic' },
]

/**
 * ORDER IS RESOLUTION ORDER and the specific faces come first, because a
 * browser resolving `"Garamond", Georgia, serif` stops at the first family it
 * has. `Aptos` sits with Carlito deliberately: it is Word's current default
 * body face and Calibri's successor, close enough in width that a document set
 * in it keeps its line breaks, and much closer than Helvetica.
 */
const FAMILIES: Record<FamilyName, FamilyDefinition> = {
  Carlito: {
    aliases: /^(carlito|calibri|aptos)$/i,
    natural: 1.2207,
    faces: bundled('Carlito'),
    files: ['Carlito-Regular.ttf', 'Carlito-Bold.ttf', 'Carlito-Italic.ttf', 'Carlito-BoldItalic.ttf'],
  },
  Caladea: {
    aliases: /^(caladea|cambria)$/i,
    natural: 1.15,
    faces: bundled('Caladea'),
    files: ['Caladea-Regular.ttf', 'Caladea-Bold.ttf', 'Caladea-Italic.ttf', 'Caladea-BoldItalic.ttf'],
  },
  Gelasio: {
    aliases: /^(gelasio|georgia)$/i,
    natural: 1.2695,
    faces: bundled('Gelasio'),
    files: ['Gelasio-Regular.ttf', 'Gelasio-Bold.ttf', 'Gelasio-Italic.ttf', 'Gelasio-BoldItalic.ttf'],
  },
  'EB Garamond': {
    aliases: /garamond/i,
    natural: 1.305,
    faces: bundled('EB Garamond'),
    files: [
      'EBGaramond-Regular.ttf',
      'EBGaramond-Bold.ttf',
      'EBGaramond-Italic.ttf',
      'EBGaramond-BoldItalic.ttf',
    ],
  },
  // The standard 14. Times and Helvetica ARE Times New Roman's and Arial's
  // metrics, so these are not substitutions -- there is nothing to bundle.
  Times: {
    aliases: /^(times|times new roman|liberation serif|tinos|serif)$/i,
    natural: FALLBACK_NATURAL_LINE_HEIGHT,
    faces: standard('Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'),
  },
  Helvetica: {
    aliases: /^(helvetica|helvetica neue|arial|arimo|liberation sans|verdana|tahoma|segoe ui|roboto|system-ui|sans-serif)$/i,
    natural: FALLBACK_NATURAL_LINE_HEIGHT,
    faces: standard('Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'),
  },
  Courier: {
    aliases: /^(courier|courier new|consolas|menlo|monaco|cousine|monospace)$/i,
    natural: 1.13,
    faces: standard('Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'),
  },
}

/** Resolution order: the bundled faces first, then the generic fallbacks. */
const RESOLUTION_ORDER: FamilyName[] = [
  'Carlito',
  'Caladea',
  'Gelasio',
  'EB Garamond',
  'Times',
  'Helvetica',
  'Courier',
]

/** Families whose files failed to load. Empty until something goes wrong. */
const unavailable = new Set<FamilyName>()
let registered = false

/**
 * Loads the bundled faces once, reading each file before trusting it.
 *
 * `process.cwd()` is the project root in `next dev` and the function root on
 * Vercel, where `outputFileTracingIncludes` puts these files back at the same
 * relative path. Read into Buffers rather than handed over as paths so that a
 * file which is not there fails HERE, with a fallback ready, instead of inside
 * the renderer halfway down a document.
 */
export const FONT_DIRECTORY = 'src/services/integrations/fonts'

function registerFonts(): void {
  if (registered) return
  registered = true

  for (const name of RESOLUTION_ORDER) {
    const definition = FAMILIES[name]
    if (!definition.files) continue
    try {
      const sources = definition.files.map((file) => {
        const path = join(process.cwd(), FONT_DIRECTORY, file)
        if (statSync(path).size === 0) throw new Error(`${file} is empty`)
        return path
      })
      Font.register({
        family: name,
        fonts: [
          { src: sources[0], fontWeight: 'normal', fontStyle: 'normal' },
          { src: sources[1], fontWeight: 'bold', fontStyle: 'normal' },
          { src: sources[2], fontWeight: 'normal', fontStyle: 'italic' },
          { src: sources[3], fontWeight: 'bold', fontStyle: 'italic' },
        ],
      })
    } catch (err) {
      // Named, because the symptom -- a CV in Times that should be in Garamond
      // -- looks like a mapping bug rather than a deployment one.
      console.error(`[cv/pdf] ${name} is not available; falling back`, err)
      unavailable.add(name)
    }
  }
}

/**
 * The family a CSS stack resolves to, walked in order like a browser does.
 *
 * `"Garamond", Georgia, serif` is three answers in preference order, and the
 * first version of this took the whole string and pattern-matched it for the
 * word "serif" -- so a document naming two real faces got neither. Each name
 * is now tried in turn, and a generic keyword only decides it if no real
 * family in the list is one this can draw.
 */
export function familyFor(stack: string | null | undefined): FamilyName {
  if (!stack) return 'Times'
  for (const raw of stack.split(',')) {
    const name = raw.trim().replace(/^['"]|['"]$/g, '')
    if (!name) continue
    const match = RESOLUTION_ORDER.find(
      (family) => !unavailable.has(family) && FAMILIES[family].aliases.test(name)
    )
    if (match) return match
  }
  return 'Times'
}

/** `line-height: normal` for a family, which is what Word calls single. */
export function naturalLineHeightOf(family: FamilyName): number {
  return FAMILIES[family].natural
}

/**
 * The four faces of a family are one font to a reader and four entries here.
 *
 * `@react-pdf/renderer` picks a STANDARD face by name -- `Times-Bold`, not
 * Times plus a weight -- and a REGISTERED one by family plus `fontWeight` and
 * `fontStyle`. Both shapes come out of the same table so a caller never has to
 * know which kind it got, and both are spelled out in full: a nested `<Text>`
 * that omits `fontWeight` does not inherit the block's, it resets it.
 */
export function faceFor(bold: boolean, italic: boolean, family: FamilyName = 'Times'): Face {
  const [regular, boldFace, italicFace, boldItalic] = FAMILIES[family].faces
  if (bold && italic) return boldItalic
  if (bold) return boldFace
  if (italic) return italicFace
  return regular
}

/** The style one run of text carries, from its marks. */
export function styleForMarks(
  marks: Mark[] | undefined,
  baseBold = false,
  baseFamily: FamilyName = 'Times'
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
    ...faceFor(names.has('bold') || baseBold, names.has('italic'), family),
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
  family: FamilyName
  heading: (level: number, ruled: boolean) => Style
  paragraph: (inList: boolean) => Style
  listRow: Style
  bullet: Style
  listBody: Style
}

export function sheetFor(
  geometry: PageGeometry,
  type: DocumentTypography,
  /**
   * What `line-height: normal` resolved to IN THE BROWSER, for the face the
   * editor actually drew -- measured by `useNaturalLineHeight` and sent with
   * the export.
   *
   * WHY IT IS NOT COMPUTED HERE. Word stores line spacing as a multiple of
   * SINGLE, single is the font's own line box, and that box differs per face:
   * 1.15 for Times, 1.22 for Calibri, 1.31 for EB Garamond. The editor knows
   * which face resolved on the machine looking at it; this process does not,
   * and a PDF that converts 0.98-of-single through a different ratio than the
   * preview used is a page of text at a visibly different density from the one
   * on screen. Absent -- an older client, a direct API call -- the drawn
   * family's own metric is the honest second answer.
   */
  naturalLineHeight?: number
): Sheet {
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
  const natural =
    naturalLineHeight && Number.isFinite(naturalLineHeight) && naturalLineHeight > 0.5 && naturalLineHeight < 4
      ? naturalLineHeight
      : naturalLineHeightOf(family)
  const lineHeight = cssLineHeight(type.lineHeight, natural) ?? undefined

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
      ...faceFor(false, false, family),
      fontSize: body,
      color: INK,
      ...(lineHeight ? { lineHeight } : {}),
    },
    family,
    heading: (level, ruled) => ({
      fontSize: headingSize(level),
      ...faceFor(true, false, family),
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

/**
 * The text runs of a block, each as its own styled <Text>.
 *
 * A `hardBreak` IS A LINE OF THE DOCUMENT, and dropping it was this file's
 * quietest bug (Gabe, 2026-09-17: "spacing ... is not rendering the
 * original"). Everything that was not a text node was discarded here, and
 * shift+enter is how every two-line block in this app is built: the sender
 * block at the top of all five cover letters, and EVERY entry
 * `templatePersonalization` generates from a LinkedIn profile -- job title
 * over employer, degree over school. Twenty-four of them across the templates
 * alone. So a PDF quietly ran each pair together on one line: one line of
 * spacing lost per entry, and two facts welded into a sentence that was never
 * written. `docxExport` and `latexExport` have both carried it since they were
 * written; this is the third exporter to be taught the same thing.
 *
 * A NEWLINE, NOT A SECOND <Text>. react-pdf breaks a line inside a `<Text>` on
 * `\n`, which keeps the break INSIDE the paragraph -- so the two lines share
 * the block's leading and its spacing, exactly as they do in the editor, and
 * the break cannot be separated from the run it follows.
 */
function inlines(node: Node, keyPrefix: string, sheet: Sheet, baseBold = false): ReactElement[] {
  return (node.content ?? []).flatMap((child, index) => {
    const key = `${keyPrefix}-t${index}`
    if (child?.type === 'hardBreak') return [h(Text, { key }, '\n')]
    if (child?.type !== 'text' || typeof child.text !== 'string') return []
    return [
      h(
        Text,
        {
          key,
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
export function buildDocument(
  content: unknown,
  title: string,
  naturalLineHeight?: number
): ReactElement<DocumentProps> {
  // BEFORE ANYTHING RESOLVES A FAMILY. Registration is what decides whether
  // Garamond is available at all, and `familyFor` skips a family whose files
  // did not load -- so a document asking for one would otherwise be answered
  // before the answer is known.
  registerFonts()
  const root = (content ?? {}) as Node
  // THE PAGE THE DOCUMENT CARRIES, not a fixed Letter at 0.8in. A CV imported
  // at 0.35in margins and exported at 0.8in wraps every paragraph earlier and
  // grows by several lines: the file a recruiter opens is not the file that
  // was uploaded. Same read as the .docx and .tex exports.
  const geometry = normalizeGeometry(root.attrs?.pageGeometry)
  const sheet = sheetFor(geometry, normalizeTypography(root.attrs?.documentTypography), naturalLineHeight)

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

export async function buildPdf(
  content: unknown,
  title: string,
  naturalLineHeight?: number
): Promise<Uint8Array> {
  const buffer = await renderToBuffer(buildDocument(content, title, naturalLineHeight))
  return new Uint8Array(buffer)
}
