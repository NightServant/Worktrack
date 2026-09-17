import { describe, it, expect } from 'vitest'
import { buildDocument, buildPdf, faceFor, familyFor, styleForMarks, toPoints } from '../pdfExport'

/**
 * The mapping, not the bytes.
 *
 * `buildPdf` produces a PDF and reading one back to find out whether bold
 * survived is a test nobody writes twice -- so the pieces that decide what a
 * run of text looks like are asserted directly, and `buildPdf` itself is
 * checked only for "it produced a PDF and did not throw".
 */
describe('toPoints', () => {
  it.each([
    ['11pt', 11],
    ['14px', 10.5],
    ['1rem', 12],
    ['11', 11],
  ])('reads %s as %s points', (input, expected) => {
    expect(toPoints(input)).toBe(expected)
  })

  it('returns undefined rather than NaN for a size it cannot read', () => {
    // A NaN fontSize renders a line at the wrong size instead of failing, and
    // it is only visible next to the rest of the CV.
    expect(toPoints('inherit')).toBeUndefined()
    expect(toPoints(undefined)).toBeUndefined()
    expect(toPoints(12)).toBe(12)
  })
})

/**
 * The four Times faces are one family to a reader and four names here:
 * `@react-pdf/renderer` selects a face by NAME, not by fontWeight/fontStyle.
 */
describe('faceFor', () => {
  it.each([
    [false, false, 'Times-Roman'],
    [true, false, 'Times-Bold'],
    [false, true, 'Times-Italic'],
    [true, true, 'Times-BoldItalic'],
  ])('bold=%s italic=%s -> %s', (bold, italic, expected) => {
    expect(faceFor(bold, italic)).toBe(expected)
  })

  /**
   * The regular weight is the name that is not spelled the same way twice, and
   * the slanted one is called Oblique outside Times. A name the standard set
   * does not contain is not an error anyone sees -- the text simply comes out
   * in the wrong face.
   */
  it('names the faces of the other two standard families', () => {
    expect(faceFor(false, false, 'Helvetica')).toBe('Helvetica')
    expect(faceFor(true, true, 'Helvetica')).toBe('Helvetica-BoldOblique')
    expect(faceFor(false, true, 'Courier')).toBe('Courier-Oblique')
  })
})

/**
 * A CV set in Calibri that exports as Times is the report this file exists to
 * answer, on the one property a PDF cannot simply carry over: there are three
 * families to choose from and the document names a CSS stack.
 */
describe('familyFor', () => {
  it.each([
    ["'Helvetica Neue', Helvetica, Arial, sans-serif", 'Helvetica'],
    ['Aptos, Calibri, system-ui, sans-serif', 'Helvetica'],
    ['"Times New Roman", Times, serif', 'Times'],
    ['Garamond, Georgia, serif', 'Times'],
    ['"Courier New", monospace', 'Courier'],
    [null, 'Times'],
  ])('reads %s as %s', (stack, expected) => {
    expect(familyFor(stack)).toBe(expected)
  })
})

describe('styleForMarks', () => {
  it('carries bold, italic, underline and strike', () => {
    expect(styleForMarks([{ type: 'bold' }, { type: 'italic' }]).fontFamily).toBe('Times-BoldItalic')
    expect(styleForMarks([{ type: 'underline' }]).textDecoration).toBe('underline')
    expect(styleForMarks([{ type: 'strike' }]).textDecoration).toBe('line-through')
    expect(styleForMarks([{ type: 'underline' }, { type: 'strike' }]).textDecoration).toBe(
      'line-through underline'
    )
  })

  /**
   * FOUND BY LOOKING AT THE OUTPUT (2026-09-15). Every heading rendered
   * upright. Each run of text is its own <Text> nested inside the block's
   * <Text>, and a nested `fontFamily` WINS -- so a heading styled Times-Bold
   * lost its weight the moment its own text run named Times-Roman, which is
   * every heading with no bold mark on it. The block passes its weight down.
   */
  it('keeps the block weight when the run itself is unmarked', () => {
    expect(styleForMarks(undefined, true).fontFamily).toBe('Times-Bold')
    expect(styleForMarks([{ type: 'italic' }], true).fontFamily).toBe('Times-BoldItalic')
    expect(styleForMarks(undefined, false).fontFamily).toBe('Times-Roman')
  })

  it('reads size and colour off textStyle, which is what the toolbar writes', () => {
    const style = styleForMarks([
      { type: 'textStyle', attrs: { fontSize: '13pt', color: '#ff0000' } },
    ])
    expect(style.fontSize).toBe(13)
    expect(style.color).toBe('#ff0000')
  })

  it('gives an uncoloured highlight a colour, since null means the default', () => {
    expect(styleForMarks([{ type: 'highlight', attrs: { color: null } }]).backgroundColor).toBe(
      '#fef08a'
    )
    expect(styleForMarks([{ type: 'highlight', attrs: { color: '#ffff00' } }]).backgroundColor).toBe(
      '#ffff00'
    )
  })
})

describe('buildPdf', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Name' }] },
      {
        type: 'paragraph',
        attrs: { textAlign: 'right' },
        content: [
          {
            type: 'text',
            marks: [{ type: 'textStyle', attrs: { fontSize: '11pt' } }, { type: 'bold' }],
            text: 'Role',
          },
        ],
      },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Did a thing.' }] }] },
        ],
      },
    ],
  }

  it('produces a PDF', async () => {
    const pdf = await buildPdf(doc, 'CV')
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(500)
  })

  it('does not throw on an empty or unmapped document', async () => {
    // A node type this does not model is skipped, not fatal -- the export must
    // not die on a document the editor was perfectly happy to save.
    await expect(buildPdf({ type: 'doc', content: [] }, 'CV')).resolves.toBeDefined()
    await expect(
      buildPdf({ type: 'doc', content: [{ type: 'horizontalRule' }, { type: 'table' }] }, 'CV')
    ).resolves.toBeDefined()
    await expect(buildPdf({}, 'CV')).resolves.toBeDefined()
  })
})

/**
 * THE DOCUMENT'S OWN PAGE AND TYPE, which is the whole of "format is not
 * preserved" (Gabe, 2026-09-17).
 *
 * Asserted on the element tree rather than on the PDF, for the reason at the
 * top of this file: what is worth checking is that the margins, the sizes, the
 * rule and the per-block spacing were READ -- and a test that has to
 * decompress a content stream to find a line width is a test nobody maintains.
 */
describe('buildDocument', () => {
  const imported = {
    type: 'doc',
    attrs: {
      pageGeometry: { width: 8.5, height: 11, margin: { top: 0.35, right: 0.65, bottom: 0.4, left: 0.65 } },
      documentTypography: {
        fontFamily: 'Calibri, sans-serif',
        fontSize: 10,
        lineHeight: 1,
        paragraphSpacing: 2,
        titleSize: 16,
        sectionSize: 11,
        headingSpaceBefore: 6.5,
        headingSpaceAfter: 2.5,
      },
    },
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Name' }] },
      { type: 'heading', attrs: { level: 2, ruled: true }, content: [{ type: 'text', text: 'EDUCATION' }] },
      { type: 'paragraph', attrs: { spaceBefore: 1, spaceAfter: 8 }, content: [{ type: 'text', text: 'A line.' }] },
    ],
  }

  type Rendered = { props: { style?: unknown; size?: unknown; children?: unknown } }

  /** The Page, and each block on it, out of the tree. */
  const pageOf = (doc: unknown): Rendered =>
    (buildDocument(doc, 'CV') as unknown as { props: { children: Rendered } }).props.children
  const blocksOf = (doc: unknown) => (pageOf(doc).props.children ?? []) as Rendered[]
  const styleOf = (element: Rendered): Record<string, number | string> =>
    Object.assign(
      {},
      ...((Array.isArray(element.props.style) ? element.props.style : [element.props.style]) as object[])
    ) as Record<string, number | string>

  it('sizes the page and its margins from the document, in points', () => {
    // 0.35in of margin rendered at 0.8in wraps every paragraph early and grows
    // the CV by several lines: the file sent is not the file that was uploaded.
    const page = pageOf(imported)
    expect(page.props.size).toEqual([612, 792])
    const style = styleOf(page)
    expect(style).toMatchObject({ paddingTop: 25.2, paddingBottom: 28.8, fontSize: 10, fontFamily: 'Helvetica' })
    expect(style.paddingLeft).toBeCloseTo(46.8)
    expect(style.paddingRight).toBeCloseTo(46.8)
  })

  it('falls back to the editor’s own sheet when the document carries none', () => {
    const page = pageOf({ type: 'doc', content: [] })
    expect(page.props.size).toEqual([612, 792])
    // DEFAULT_GEOMETRY is 0.8in, which is the sheet the editor draws.
    expect(styleOf(page)).toMatchObject({ paddingTop: 57.6, paddingLeft: 57.6 })
  })

  it('takes the heading sizes the document states rather than a fixed scale', () => {
    const [title, section] = blocksOf(imported)
    // This used to be 24pt and 14pt for every CV ever exported.
    expect(styleOf(title)).toMatchObject({ fontSize: 16, fontFamily: 'Helvetica-Bold', marginTop: 0 })
    expect(styleOf(section)).toMatchObject({ fontSize: 11, marginTop: 6.5, marginBottom: 2.5 })
  })

  it('draws the rule under a ruled section heading', () => {
    // Word draws it as a border on the paragraph and it is most of what makes
    // a CV look like a CV; the PDF dropped all eight of them.
    const [title, section] = blocksOf(imported)
    expect(styleOf(section).borderBottomWidth).toBeGreaterThan(0)
    expect(styleOf(title).borderBottomWidth).toBeUndefined()
  })

  it('keeps each block’s own spacing, which is not the document’s median', () => {
    const paragraph = blocksOf(imported)[2]
    expect(styleOf(paragraph)).toMatchObject({ marginTop: 1, marginBottom: 8 })
  })

  it('lets the sheet’s spacing stand where the block states none', () => {
    const paragraph = blocksOf({
      ...imported,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A line.' }] }],
    })[0]
    expect(styleOf(paragraph).marginBottom).toBe(2)
  })
})
