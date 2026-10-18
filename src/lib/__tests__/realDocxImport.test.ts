import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import JSZip from 'jszip'
import {
  readPageGeometry,
  readParagraphFormats,
  readTypography,
  ruleKey,
  textColumnInches,
} from '../pageGeometry'
import { Document, Packer } from 'docx'
import { sectionsFrom } from '@/services/integrations/docxExport'
import { htmlToWordContent, MAMMOTH_OPTIONS } from '../documentImport'
import mammoth from 'mammoth'

/**
 * Driven by a real Word export rather than a hand-written fixture, because the
 * bug was in what Word actually puts in a package -- tight `pgMar` values and
 * no manual page break at all -- which a sample written to pass would not have
 * reproduced.
 *
 * THE PATH COMES FROM AN ENV VAR AND THE TEST SKIPS WITHOUT IT. The document
 * that reported this is a personal CV living outside the repo, and a CV does
 * not belong in version control; hard-coding its path would also publish one
 * machine's directory layout in a public repository and make the test
 * unrunnable for anyone else. Point `WORKTRACK_TEST_DOCX` at any .docx to run
 * these three against it:
 *
 *   WORKTRACK_TEST_DOCX=/path/to/cv.docx npx vitest run realDocxImport
 *
 * The page-size cases below need no file and always run.
 */
const FILE = process.env.WORKTRACK_TEST_DOCX
const present = !!FILE && existsSync(FILE)

describe.skipIf(!present)('a real .docx from Word', () => {
  const load = async () => {
    const zip = await JSZip.loadAsync(readFileSync(FILE!))
    return (await zip.file('word/document.xml')!.async('string'))
  }

  it('reads a real page setup rather than assuming the editor default', async () => {
    const g = readPageGeometry(await load())
    expect(g.width).toBeGreaterThan(0)
    expect(g.height).toBeGreaterThan(0)
    // The reported document declared 0.35in top and 0.65in sides, against the
    // editor's hard-coded 0.8in. Asserted as "read something real" so any
    // .docx can drive this, not only that one.
    expect(Number.isFinite(g.margin.top)).toBe(true)
    expect(Number.isFinite(g.margin.left)).toBe(true)
  })

  it('yields a usable text column', async () => {
    // On the reported CV this was 7.2in written against 6.9in rendered: every
    // paragraph wrapped early, so the document grew and stopped matching Word.
    const column = textColumnInches(readPageGeometry(await load()))
    expect(column).toBeGreaterThan(0)
    expect(column).toBeLessThan(readPageGeometry(await load()).width)
  })

  it('reads the type the document is actually set in', async () => {
    // The half of the bug that survived fixing the margins: mammoth drops
    // every run property, so the CV rendered in the editor's stylesheet
    // instead of its author's face. On the reported file this is Garamond
    // 11pt against sans-serif 15px.
    const zip = await JSZip.loadAsync(readFileSync(FILE!))
    const documentXml = await zip.file('word/document.xml')!.async('string')
    const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? ''
    const t = readTypography(documentXml, stylesXml)

    expect(t.fontFamily).toBeTruthy()
    expect(t.fontSize).toBeGreaterThan(5)
    expect(t.fontSize).toBeLessThan(30)
    // Whatever the face is, it must come from the RUNS when they name one. On
    // the reported file docDefaults says Times New Roman and no run uses it.
    // A document whose runs name no face (Gabe's 2026-10-18 CV sets Garamond
    // once, in docDefaults) must take the docDefaults face instead.
    const runFaces = [...documentXml.matchAll(/<w:rFonts\b[^>]*w:ascii="([^"]+)"/g)].map((m) => m[1])
    const defaultFace = stylesXml
      .match(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/)?.[0]
      .match(/<w:rFonts\b[^>]*w:ascii="([^"]+)"/)?.[1]
    expect(t.fontFamily).toContain(runFaces[0] ?? defaultFace)
  })

  it('finds the rules Word draws under each section heading', async () => {
    // The last unfixed part of "no borders, font, spacing". Word draws these
    // with `w:pBdr` on the paragraph, and mammoth carries no borders at all --
    // its paragraph object exposes only type, children, styleId, styleName,
    // numbering, alignment and indent, probed directly.
    const documentXml = await load()
    const ruled = readParagraphFormats(documentXml).filter((format) => format.ruled)

    expect(ruled.length).toBeGreaterThan(0)
    // Every one is a real heading rather than a stray bordered paragraph.
    for (const heading of ruled) {
      expect(heading.key.trim().length).toBeGreaterThan(2)
      expect(heading.key.length).toBeLessThan(80)
      expect(heading.key).toBe(ruleKey(heading.key))
    }
    // Keys normalise, which is how they are matched back to mammoth's output.
    expect(new Set(ruled.map((format) => format.key)).size).toBe(ruled.length)
  })

  it('reads the body size from what runs RESOLVE to, not what they declare', async () => {
    // The reported CV states a size on 24 of its 109 runs -- headings and
    // dates -- and nothing on the 85 that are the body. Counting only the
    // stated ones put the median on a date size and rendered the whole
    // document a size small.
    const zip = await JSZip.loadAsync(readFileSync(FILE!))
    const documentXml = await zip.file('word/document.xml')!.async('string')
    const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? ''

    const stated = [...documentXml.matchAll(/<w:sz w:val="(\d+)"/g)].length
    const runs = (documentXml.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g) ?? []).length
    // Only meaningful on a document that leaves most runs unsized, which is
    // the normal shape and the one that reproduced this.
    if (stated < runs) {
      const size = readTypography(documentXml, stylesXml).fontSize!
      const declared = new Set(
        [...documentXml.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => Number(m[1]) / 2)
      )
      expect(declared.has(size)).toBe(false)
    }
  })

  it('keeps each paragraph its own spacing rather than one median', async () => {
    // A CV separates a bullet from a heading with different gaps, and the
    // median of them fitted more onto page one than Word does.
    const formats = readParagraphFormats(await load())
    expect(formats.length).toBeGreaterThan(0)
    const afters = new Set(formats.map((format) => format.spaceAfter))
    expect(afters.size).toBeGreaterThan(1)
  })

  it('writes each paragraph\'s spacing back out', async () => {
    const [before, after] = [6.5, 2.5]
    const sections = sectionsFrom({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, spaceBefore: before, spaceAfter: after },
          content: [{ type: 'text', text: 'EDUCATION' }],
        },
      ],
    })
    const zip = await JSZip.loadAsync(await Packer.toBuffer(new Document({ sections })))
    const xml = await zip.file('word/document.xml')!.async('string')
    // Points back into the twips Word stores.
    expect(xml).toContain(`w:before="${before * 20}"`)
    expect(xml).toContain(`w:after="${after * 20}"`)
  })

  it('carries the whole of it through mammoth and into the editor JSON', async () => {
    // END TO END, because every part of this has been right in isolation and
    // wrong once assembled: the readers parse a package, mammoth throws the
    // formatting away, and the two are paired back up by text. This is the
    // only case that exercises the pairing against a real document.
    // `{ buffer }` rather than `{ arrayBuffer }` only because this runs under
    // Node, where mammoth's build takes the other handle. The options are the
    // production ones.
    const { value: html } = await mammoth.convertToHtml(
      { buffer: readFileSync(FILE!) },
      MAMMOTH_OPTIONS
    )
    const documentXml = await load()
    const zip = await JSZip.loadAsync(readFileSync(FILE!))
    const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? ''
    const imported = {
      content: htmlToWordContent(html, readParagraphFormats(documentXml, stylesXml)),
    }

    type Block = { type?: string; attrs?: Record<string, unknown>; content?: Block[] }
    const walk = (nodes: Block[]): Block[] =>
      nodes.flatMap((node) => [node, ...walk(node.content ?? [])])
    const blocks = walk((imported.content as unknown as { content: Block[] }).content)
    expect(blocks.length).toBeGreaterThan(20)

    // Only the blocks a .docx would call a paragraph: lists and text nodes
    // are tiptap's own nesting and have no counterpart to be paired with.
    const paragraphs = blocks.filter((b) => b.type === 'paragraph' || b.type === 'heading')
    const spaced = paragraphs.filter((b) => typeof b.attrs?.spaceAfter === 'number')
    // NEARLY ALL of them find their own formatting. A low number here means
    // the pairing drifted, which is the failure that matters and the one a
    // count of distinct values alone would not catch.
    expect(spaced.length).toBeGreaterThan(paragraphs.length * 0.9)
    // And they are not all the same number, which was the bug.
    expect(new Set(spaced.map((b) => b.attrs!.spaceAfter)).size).toBeGreaterThan(1)

    // The heading rules survive the same pairing.
    expect(blocks.some((b) => b.type === 'heading' && b.attrs?.ruled === true)).toBe(true)
  })

  it('exports back at its own page, not at the editor default', async () => {
    const geometry = readPageGeometry(await load())
    const [section] = sectionsFrom({ type: 'doc', attrs: { pageGeometry: geometry }, content: [] })
    const page = section.properties!.page!
    // Round-tripped through twips and back to the same numbers the file
    // declares -- which is the half of the bug that would otherwise have
    // re-margined the document on the way OUT.
    expect(page.margin).toMatchObject({
      top: Math.round(geometry.margin.top * 1440),
      left: Math.round(geometry.margin.left * 1440),
    })
    expect(page.size).toMatchObject({
      width: Math.round(geometry.width * 1440),
      height: Math.round(geometry.height * 1440),
    })
  })
})

describe('the editor adapts to other page sizes', () => {
  // Gabe: "make sure that the editor adapts different page sizes".
  const cases = [
    { name: 'A4', xml: '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>', w: 8.27, h: 11.69 },
    { name: 'Legal', xml: '<w:pgSz w:w="12240" w:h="20160"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>', w: 8.5, h: 14 },
    { name: 'A5', xml: '<w:pgSz w:w="8391" w:h="11906"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>', w: 5.83, h: 8.27 },
    { name: 'Letter landscape', xml: '<w:pgSz w:w="15840" w:h="12240"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>', w: 11, h: 8.5 },
  ]

  it.each(cases)('reads $name at the right size', ({ xml, w, h }) => {
    const g = readPageGeometry(xml)
    expect(g.width).toBeCloseTo(w, 1)
    expect(g.height).toBeCloseTo(h, 1)
  })

  it.each(cases)('exports $name back at the same size', ({ xml }) => {
    const geometry = readPageGeometry(xml)
    const [section] = sectionsFrom({ type: 'doc', attrs: { pageGeometry: geometry }, content: [] })
    const size = section.properties!.page!.size!
    expect(size.width).toBe(Math.round(geometry.width * 1440))
    expect(size.height).toBe(Math.round(geometry.height * 1440))
  })

  it('derives a typing area that follows the page, not a fixed 9.4in', () => {
    // The old hard-code was 11in minus 0.8in margins. On A4 that is wrong by
    // a third of an inch and on Legal by three.
    const body = (xml: string) => {
      const g = readPageGeometry(xml)
      return g.height - g.margin.top - g.margin.bottom
    }
    expect(body(cases[0].xml)).toBeCloseTo(9.69, 1) // A4 at 1in
    expect(body(cases[1].xml)).toBeCloseTo(12, 1)   // Legal at 1in
    expect(body(cases[1].xml)).not.toBeCloseTo(9.4, 1)
  })
})

describe('a heading rule survives the round trip', () => {
  it('writes w:pBdr back into the packed file, for ruled headings only', async () => {
    // Without this the export drops the eight section rules a document was
    // imported with -- the page-setup bug repeating on a different property.
    //
    // ASSERTED ON THE PACKED XML rather than on the Paragraph object, because
    // `docx` does not expose its options and a test against internals would
    // pass while the file came out blank.
    const sections = sectionsFrom({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, ruled: true }, content: [{ type: 'text', text: 'EDUCATION' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plain' }] },
      ],
    })
    const zip = await JSZip.loadAsync(await Packer.toBuffer(new Document({ sections })))
    const xml = await zip.file('word/document.xml')!.async('string')

    // Exactly one: the ruled heading, not the plain one beside it.
    expect(xml.match(/<w:pBdr>/g) ?? []).toHaveLength(1)
    expect(xml).toContain('<w:bottom w:val="single"')
    // And it is attached to the heading that carried the mark.
    expect(xml).toMatch(/<w:pBdr>[\s\S]*?<\/w:pPr>[\s\S]*?EDUCATION/)
  })
})
