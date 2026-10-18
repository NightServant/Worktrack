import {
  AlignmentType,
  Document,
  BorderStyle,
  HeadingLevel,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  type IStylesOptions,
  type ISectionOptions,
} from 'docx'
import { TWIPS_PER_INCH, normalizeGeometry, normalizeTypography } from '@/lib/pageGeometry'

/**
 * Turns the Word editor's TipTap document into a real .docx.
 *
 * WHY A GENERATOR AND NOT docx-editor.dev's AUTOMATION API. That library's
 * core is Apache-2.0 and fits this app, but it is BROWSER-ONLY and its
 * Office.js-compatible automation API (`@docx-editor.dev/editor-api`) is under
 * the EigenPal Pro Licence at $500/month. Gabe's call was the free editor for
 * editing plus the `docx` package for output, which is what this is: a pure
 * function over the editor's own JSON, no licence and no browser required.
 *
 * WHY .docx AT ALL when the app already exports PDF: ATS parsers still handle
 * Word more reliably than PDF, and a large share of application forms accept
 * .doc/.docx only. A CV that cannot be uploaded is not a CV.
 *
 * IT IS DELIBERATELY PLAIN. No colours, no tables, no text boxes, no columns,
 * no headers or footers -- every one of those is a known ATS parsing hazard,
 * and this file exists to produce something a parser can read rather than
 * something that looks designed. `atsLint` already enforces the same rule on
 * the content side.
 */

/** The subset of TipTap's JSON this reads. Anything else is ignored, not thrown on. */
export interface TipTapNode {
  type?: string
  text?: string
  marks?: { type?: string; attrs?: Record<string, unknown> }[]
  content?: TipTapNode[]
  attrs?: Record<string, unknown>
}

function runsFrom(node: TipTapNode): TextRun[] {
  // A real tab, which the paragraph's right tab stop (see `tabStopsFrom`)
  // carries to the margin -- the shape Word wrote the imported CV in.
  if (node.type === 'rightTab') return [new TextRun({ children: [new Tab()] })]
  if (typeof node.text === 'string') {
    const marks = new Set((node.marks ?? []).map((m) => m.type))
    // A size the import read off the document -- the 11pt sub-title under a
    // name, against a 10pt body. Without it the export flattens back to one
    // size and the round trip loses what the import had just recovered.
    const fontSize = (node.marks ?? []).find((m) => m.type === 'textStyle')?.attrs?.fontSize
    const points = Number.parseFloat(String(fontSize ?? '').replace('pt', ''))
    return [
      new TextRun({
        text: node.text,
        // OMITTED WHEN ABSENT, NOT SET TO FALSE, and that distinction is the
        // whole of a real bug: `bold: false` emits `<w:b w:val="false"/>` on
        // the run, and a run-level property BEATS the paragraph style. Every
        // heading was therefore un-bolded by its own text -- the style said
        // bold, the run said "specifically not", and Word believes the run.
        // Gabe: "Word documents missed the bold letters."
        //
        // Absent, the run inherits: body text from a document default that is
        // not bold, a heading from a Heading style that is. There is no way to
        // say "not bold inside a bold heading" any more, which is not a shape
        // the editor can produce.
        ...(marks.has('bold') ? { bold: true } : {}),
        ...(marks.has('italic') ? { italics: true } : {}),
        // `w:sz` is half-points, which is what `size` takes as a number.
        ...(Number.isFinite(points) && points > 0 ? { size: Math.round(points * 2) } : {}),
      }),
    ]
  }
  return (node.content ?? []).flatMap(runsFrom)
}

/**
 * The space above and below a paragraph, back in twips.
 *
 * Word stores these on the paragraph and the import reads them there, so an
 * export that dropped them would hand back a document whose sections all sat
 * at one spacing -- the same shape of loss as exporting at the wrong page
 * size, on a different property.
 */
function spacingFrom(node: TipTapNode): { spacing: { before?: number; after?: number } } | undefined {
  const twips = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.round(value * 20)
      : undefined
  const before = twips(node.attrs?.spaceBefore)
  const after = twips(node.attrs?.spaceAfter)
  if (before === undefined && after === undefined) return undefined
  return { spacing: { ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) } }
}

/** Flatten a node's text, for the cases where runs are not needed. */
function textOf(node: TipTapNode): string {
  if (typeof node.text === 'string') return node.text
  return (node.content ?? []).map(textOf).join('')
}

/**
 * A right tab stop at the text column's edge, for a block holding a
 * `rightTab`. `position` is twips from the left margin, so the column width
 * puts the date flush with the right margin as the editor draws it.
 */
function tabStopsFrom(
  node: TipTapNode,
  column: number
): { tabStops: { type: (typeof TabStopType)['RIGHT']; position: number }[] } | undefined {
  return (node.content ?? []).some((child) => child.type === 'rightTab')
    ? { tabStops: [{ type: TabStopType.RIGHT, position: column }] }
    : undefined
}

/** The rule Word draws under a section heading, or under any paragraph. */
const RULE = {
  border: {
    // `size: 6` is eighths of a point, matching what Word wrote.
    bottom: { style: BorderStyle.SINGLE, size: 6, color: '1A1A1A', space: 2 },
  },
}

const HEADING_FOR: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
}

/**
 * The paragraph's alignment, back in Word's vocabulary.
 *
 * WHY IT HAD TO BE ADDED (2026-09-15). The editor has carried `textAlign`
 * since the ribbon shipped -- TextAlign is configured for headings and
 * paragraphs in editorExtensions -- and this export silently dropped it, so a
 * centred name exported left. That was survivable while every document was
 * typed from a template that centred nothing. It stopped being survivable the
 * moment the templates started using alignment to tell themselves apart: three
 * of the six CVs now centre their header block, and without this all three
 * would export as the same left-aligned page as the other three.
 *
 * `left` RETURNS NOTHING rather than `AlignmentType.LEFT`. It is Word's
 * default, and writing it into every paragraph would put an explicit
 * `w:jc="left"` on documents that never asked for one -- which is a real
 * difference when the file is opened somewhere with a right-to-left default.
 */
function alignmentFrom(node: TipTapNode): { alignment: (typeof AlignmentType)[keyof typeof AlignmentType] } | undefined {
  switch (node.attrs?.textAlign) {
    case 'center':
      return { alignment: AlignmentType.CENTER }
    case 'right':
      return { alignment: AlignmentType.RIGHT }
    case 'justify':
      return { alignment: AlignmentType.JUSTIFIED }
    default:
      return undefined
  }
}

function paragraphsFrom(node: TipTapNode, column: number): Paragraph[] {
  switch (node.type) {
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return [
        new Paragraph({
          heading: HEADING_FOR[level] ?? HeadingLevel.HEADING_3,
          children: runsFrom(node),
          ...spacingFrom(node),
          ...alignmentFrom(node),
          // THE RULE UNDER A SECTION HEADING, WRITTEN BACK. Word draws it as
          // a border on the paragraph; the import reads it out of `w:pBdr`
          // and marks the heading, and without this the export would drop it
          // again -- so a document imported with eight section rules would
          // come back out with none, which is the page-setup bug repeating on
          // a different property.
          ...(node.attrs?.ruled ? RULE : {}),
          ...tabStopsFrom(node, column),
        }),
      ]
    }
    case 'paragraph': {
      // An empty paragraph is spacing the author put there on purpose.
      const runs = runsFrom(node)
      return [
        new Paragraph({
          children: runs.length > 0 ? runs : [new TextRun('')],
          ...spacingFrom(node),
          ...alignmentFrom(node),
          // A paragraph's rule too, since 2026-10-18 (the line under the
          // summary on Gabe's new CV).
          ...(node.attrs?.ruled ? RULE : {}),
          ...tabStopsFrom(node, column),
        }),
      ]
    }
    case 'bulletList':
    case 'orderedList':
      return (node.content ?? []).flatMap((item) =>
        // REAL LIST NUMBERING, not a literal "- " prefix. A hyphen typed into
        // the text is what an ATS sees as part of the sentence; a Word list is
        // structure it can strip.
        (item.content ?? []).map(
          (block) =>
            new Paragraph({
              children: runsFrom(block),
              // A bullet's spacing lives on the paragraph inside the item,
              // which is where the import put it.
              ...spacingFrom(block),
              ...tabStopsFrom(block, column),
              ...(node.type === 'bulletList'
                ? { bullet: { level: 0 } }
                : { numbering: { reference: 'cv-numbering', level: 0 } }),
            })
        )
      )
    case 'hardBreak':
      return [new Paragraph({ children: [new TextRun('')] })]
    default: {
      if (node.content) return node.content.flatMap((child) => paragraphsFrom(child, column))
      const text = textOf(node)
      return text ? [new Paragraph({ children: [new TextRun(text)] })] : []
    }
  }
}

/** The document body, exposed so it can be asserted without packing a zip. */
export function sectionsFrom(doc: unknown): ISectionOptions[] {
  const root = (doc ?? {}) as TipTapNode
  const geometry = normalizeGeometry(root.attrs?.pageGeometry)
  const twips = (inches: number) => Math.round(inches * TWIPS_PER_INCH)
  // The text column, where a right tab stop has to sit to reach the margin.
  const column = twips(geometry.width - geometry.margin.left - geometry.margin.right)
  const children = (root.content ?? []).flatMap((node) => paragraphsFrom(node, column))

  /**
   * THE PAGE THE DOCUMENT CARRIES, not a fixed one.
   *
   * This used to write 0.8in on every side and no size at all, which meant
   * every export came out US Letter with margins the author never chose. On
   * an imported CV that is the import bug in reverse: a document read at
   * 0.35in margins, edited, and exported at 0.8in has had its page setup
   * replaced twice over -- and the file a recruiter opens is not the file
   * that was uploaded.
   *
   * `pageGeometry` rides on the doc node (see components/cv/editorExtensions
   * for why it has to be an attribute), so by the time a document reaches
   * here it is either the page it was imported at or Word's default.
   */

  return [
    {
      properties: {
        page: {
          size: { width: twips(geometry.width), height: twips(geometry.height) },
          margin: {
            top: twips(geometry.margin.top),
            right: twips(geometry.margin.right),
            bottom: twips(geometry.margin.bottom),
            left: twips(geometry.margin.left),
          },
        },
      },
      children: children.length > 0 ? children : [new Paragraph({ children: [new TextRun('')] })],
    },
  ]
}

/**
 * The document's own face, size and spacing, as Word's DEFAULT STYLES.
 *
 * WHY THE EXPORT HAD TO LEARN THIS (2026-09-15). `documentTypography` has
 * ridden on the doc node since the import started reading it, and the EDITOR
 * has always honoured it -- see WordResumeEditor, which turns it into CSS
 * custom properties on the sheet. This function did not, so the face and the
 * sizes stopped at the screen: a CV imported in Garamond 11pt was edited in
 * Garamond 11pt and exported in Word's own default, which is the round-trip
 * loss `pageGeometry` and `ruled` each already have a paragraph about.
 *
 * It became urgent when the templates started using type to tell themselves
 * apart. Gabe: "CV and Cover Letter templates felt the same. Implement
 * different typography, spacing, and format in every template." Six CVs that
 * differ by face, body size and leading on screen and export as six identical
 * files would be a distinction that exists only in the preview -- and the
 * exported file is the one that reaches an employer.
 *
 * DEFAULT STYLES, NOT PER-RUN PROPERTIES, and that is the important half. Word
 * resolves a run with no explicit font to the document default, so setting it
 * here means every paragraph inherits -- including paragraphs the person types
 * later. Writing the face onto each run instead would freeze the document at
 * the template's choice and make "select all, change font" a no-op on
 * everything already there.
 *
 * THE UNITS ARE WORD'S AND EACH ONE IS DIFFERENT:
 *   `size`   half-points. 11pt is 22.
 *   `line`   240ths of a line, where 240 is single spacing.
 *   `before` / `after`  twips, at 20 to the point.
 * Getting any of them wrong produces a document that is subtly, unfixably off
 * rather than obviously broken, which is why they are named here.
 *
 * NULLS FALL THROUGH, which is what keeps this safe for every document that
 * predates it. `normalizeTypography` returns all-null for a document with no
 * typography, every branch below is conditional, and a `styles.default` with
 * no properties in it is what Word already does.
 */
function stylesFrom(doc: unknown): IStylesOptions | undefined {
  const root = (doc ?? {}) as { attrs?: { documentTypography?: unknown } }
  const type = normalizeTypography(root.attrs?.documentTypography)

  const halfPoints = (points: number | null) =>
    points === null ? undefined : Math.round(points * 2)
  const twentieths = (points: number | null) =>
    points === null ? undefined : Math.round(points * 20)

  const run = {
    ...(type.fontFamily ? { font: firstFamily(type.fontFamily) } : {}),
    ...(type.fontSize !== null ? { size: halfPoints(type.fontSize) } : {}),
  }
  const paragraphSpacing = {
    ...(type.lineHeight !== null ? { line: Math.round(type.lineHeight * 240) } : {}),
    ...(type.paragraphSpacing !== null ? { after: twentieths(type.paragraphSpacing) } : {}),
  }

  const headingSpacing = {
    ...(type.headingSpaceBefore !== null
      ? { before: twentieths(type.headingSpaceBefore) }
      : {}),
    ...(type.headingSpaceAfter !== null ? { after: twentieths(type.headingSpaceAfter) } : {}),
  }

  const heading = (size: number | null) => {
    const style = {
      // BOLD REGARDLESS OF SIZE. It used to ride along with the size, so a
      // document carrying no typography attributes -- which is every template,
      // and every import that had none to read -- produced headings that were
      // neither larger nor bolder than body text. The size is genuinely
      // optional; a heading being bold is not.
      run: { bold: true, ...(size !== null ? { size: halfPoints(size) } : {}) },
      ...(Object.keys(headingSpacing).length > 0
        ? { paragraph: { spacing: headingSpacing } }
        : {}),
    }
    return Object.keys(style).length > 0 ? style : undefined
  }

  const defaults = {
    ...(Object.keys(run).length > 0 || Object.keys(paragraphSpacing).length > 0
      ? {
          document: {
            ...(Object.keys(run).length > 0 ? { run } : {}),
            ...(Object.keys(paragraphSpacing).length > 0
              ? { paragraph: { spacing: paragraphSpacing } }
              : {}),
          },
        }
      : {}),
    ...(heading(type.titleSize) ? { heading1: heading(type.titleSize)! } : {}),
    ...(heading(type.sectionSize) ? { heading2: heading(type.sectionSize)! } : {}),
  }

  return Object.keys(defaults).length > 0 ? { default: defaults } : undefined
}

/**
 * The first family out of a CSS stack, unquoted.
 *
 * `fontFamily` is a CSS value -- `"Times New Roman", Times, serif` -- because
 * that is what the editor puts on the sheet. Word wants ONE name and has no
 * concept of a fallback list, so handing it the whole stack writes a font
 * called `"Times New Roman", Times, serif` into the file, which resolves to
 * nothing and silently falls back to Calibri. The fallbacks are the browser's
 * business; the .docx gets the face that was actually asked for.
 */
function firstFamily(stack: string): string {
  return (stack.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '')
}

export async function buildDocx(doc: unknown, title: string): Promise<Buffer> {
  const styles = stylesFrom(doc)
  const document = new Document({
    // Written into the file's properties so a recruiter's file manager and
    // Word's own title bar show the CV's name rather than "Document1".
    title: title.trim() || 'CV',
    description: 'Generated by Worktrack',
    numbering: {
      config: [
        {
          reference: 'cv-numbering',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'left' }],
        },
      ],
    },
    ...(styles ? { styles } : {}),
    sections: sectionsFrom(doc),
  })
  return Packer.toBuffer(document)
}
