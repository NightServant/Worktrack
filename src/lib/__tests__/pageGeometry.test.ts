import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GEOMETRY,
  normalizeGeometry,
  readPageGeometry,
  textColumnInches,
} from '../pageGeometry'

/** Lifted verbatim from Gabe's own CV, which is the document that reported this. */
const REAL_SECTPR =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="504" w:right="936" w:bottom="504" w:left="936" ' +
  'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'

describe('readPageGeometry', () => {
  it('reads the real CV that reported the bug', () => {
    const g = readPageGeometry(REAL_SECTPR)
    expect(g.width).toBe(8.5)
    expect(g.height).toBe(11)
    expect(g.margin.top).toBeCloseTo(0.35, 3)
    expect(g.margin.left).toBeCloseTo(0.65, 3)
  })

  it('shows the mismatch that broke the layout', () => {
    // The editor hard-coded 0.8in on every side. On this document that is a
    // 6.9in text column against the 7.2in it was written for, so every
    // paragraph wraps earlier and the document grows.
    const real = textColumnInches(readPageGeometry(REAL_SECTPR))
    const hardCoded = 8.5 - 0.8 * 2
    expect(real).toBeCloseTo(7.2, 3)
    expect(hardCoded).toBeCloseTo(6.9, 3)
    expect(real).toBeGreaterThan(hardCoded)
  })

  it('falls back to the editor\'s own sheet when there is no sectPr', () => {
    // Deliberately 0.8in and not Word's 1in: every CV already in the database
    // was written against this sheet, and switching the fallback would
    // re-margin all of them on their next open.
    expect(readPageGeometry('<w:body><w:p/></w:body>')).toEqual(DEFAULT_GEOMETRY)
    expect(DEFAULT_GEOMETRY.margin.top).toBe(0.8)
  })

  it('takes the LAST sectPr, which carries the body setup', () => {
    const two =
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>' + REAL_SECTPR
    expect(readPageGeometry(two).width).toBe(8.5)
  })

  it('reads A4 as well as Letter', () => {
    const a4 = '<w:pgSz w:w="11906" w:h="16838"/>'
    const g = readPageGeometry(a4)
    expect(g.width).toBeCloseTo(8.27, 1)
    expect(g.height).toBeCloseTo(11.69, 1)
  })

  it('clamps a negative margin, which OOXML allows and CSS cannot use', () => {
    // Word uses negative margins for headers that bleed into the body.
    const g = readPageGeometry('<w:pgMar w:top="-720" w:left="936"/>')
    expect(g.margin.top).toBe(0)
    expect(g.margin.left).toBeCloseTo(0.65, 3)
  })

  it('survives a malformed tag rather than throwing', () => {
    for (const xml of ['<w:pgSz>', '<w:pgSz w:w="abc" w:h=""/>', '']) {
      expect(() => readPageGeometry(xml)).not.toThrow()
    }
    expect(readPageGeometry('<w:pgSz w:w="abc"/>').width).toBe(DEFAULT_GEOMETRY.width)
  })
})

describe('normalizeGeometry', () => {
  it('passes a good geometry through', () => {
    const g = readPageGeometry(REAL_SECTPR)
    expect(normalizeGeometry(g)).toEqual(g)
  })

  it('replaces anything unusable with the default', () => {
    for (const bad of [null, undefined, 'letter', 42, {}, { width: 0, height: 11, margin: {} }]) {
      expect(normalizeGeometry(bad), String(bad)).toEqual(DEFAULT_GEOMETRY)
    }
  })

  it('fills in a missing side rather than rejecting the whole page', () => {
    const partial = { width: 8.5, height: 11, margin: { top: 0.5 } }
    const g = normalizeGeometry(partial)
    expect(g.margin.top).toBe(0.5)
    expect(g.margin.left).toBe(DEFAULT_GEOMETRY.margin.left)
  })
})

import { NO_TYPOGRAPHY, normalizeTypography, readTypography } from '../pageGeometry'

describe('readTypography', () => {
  // Lifted from the reported file: docDefaults say Times New Roman and not one
  // run uses it -- every run is Garamond.
  const STYLES =
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman"/></w:rPr>' +
    '</w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="235" w:lineRule="auto"/>' +
    '</w:pPr></w:pPrDefault></w:docDefaults>'
  // Real paragraph markup rather than loose fragments: a run's size is only
  // meaningful inside the run it belongs to, which is how it is now read.
  const para = (after: string, half: string, text: string) =>
    `<w:p><w:pPr><w:spacing w:after="${after}"/></w:pPr><w:r>` +
    `<w:rPr><w:rFonts w:ascii="Garamond"/><w:sz w:val="${half}"/></w:rPr>` +
    `<w:t>${text}</w:t></w:r></w:p>`
  const DOC = para('40', '22', 'one') + para('60', '22', 'two') + para('160', '32', 'three')

  it('TAKES THE FACE THE RUNS USE, not the one the defaults declare', () => {
    // The trap this test exists for: reading docDefaults alone returns Times
    // New Roman for a document set entirely in Garamond.
    expect(readTypography(DOC, STYLES).fontFamily).toContain('Garamond')
    expect(readTypography(DOC, STYLES).fontFamily).not.toContain('Times')
  })

  it('falls back to the default face only when no run says anything', () => {
    expect(readTypography('<w:p/>', STYLES).fontFamily).toContain('Times New Roman')
  })

  it('converts half-points to points, and takes the median', () => {
    // 22 half-points is 11pt. The median keeps one 16pt heading from dragging
    // the body size up.
    expect(readTypography(DOC).fontSize).toBe(11)
  })

  it('counts a run that states NO size at the document default', () => {
    // The bug: only the sizes actually written down were counted. On the
    // reported CV 24 runs of 109 state one -- the headings and the dates --
    // and their median came out 9.5pt, so the body rendered 5% small. The 85
    // runs that are the body state nothing and resolve to 10pt.
    const body = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
    const heading = `<w:p><w:r><w:rPr><w:sz w:val="32"/></w:rPr><w:t>NAME</w:t></w:r></w:p>`
    expect(readTypography(heading + body('a') + body('b') + body('c')).fontSize).toBe(10)
    // And the stated default wins over the implicit one when there is one.
    const styles = '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>'
    expect(readTypography(body('a') + body('b'), styles).fontSize).toBe(12)
  })

  it('does not read a heading style as the document default', () => {
    // `<w:rPrDefault>` with a lazy scan after it runs straight past its own
    // closing tag into the style definitions. On the reported CV that found a
    // 16pt heading style, so every unsized body run resolved to 16 and the
    // whole document rendered in its own title size.
    const styles =
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman"/></w:rPr>' +
      '</w:rPrDefault></w:docDefaults>' +
      '<w:style w:styleId="Title"><w:rPr><w:rFonts w:ascii="Cambria"/><w:sz w:val="32"/></w:rPr></w:style>'
    const body = '<w:p><w:r><w:t>plain body text</w:t></w:r></w:p>'
    expect(readTypography(body, styles).fontSize).toBe(10)
    expect(readTypography(body, styles).fontFamily).toContain('Times New Roman')
  })

  it('ignores a run carrying no text, which occupies no line', () => {
    const bookmark = '<w:p><w:r><w:rPr><w:sz w:val="96"/></w:rPr></w:r><w:r><w:t>body</w:t></w:r></w:p>'
    expect(readTypography(bookmark).fontSize).toBe(10)
  })

  it('converts w:line 240ths into a multiplier', () => {
    expect(readTypography('<w:spacing w:line="235" w:lineRule="auto"/>').lineHeight)
      .toBeCloseTo(0.979, 3)
    expect(readTypography('<w:spacing w:line="480" w:lineRule="auto"/>').lineHeight).toBe(2)
  })

  it('converts w:after twips into points', () => {
    // 40, 60 and 160 twips are 2, 3 and 8pt; the median is 3.
    expect(readTypography(DOC).paragraphSpacing).toBe(3)
  })

  it('returns nothing readable for a document that declares nothing', () => {
    expect(readTypography('<w:body/>')).toEqual(NO_TYPOGRAPHY)
  })

  it('rejects absurd values rather than styling a page with them', () => {
    expect(readTypography('<w:sz w:val="9999"/>').fontSize).toBeNull()
    expect(readTypography('<w:spacing w:line="9999" w:lineRule="auto"/>').lineHeight).toBeNull()
  })
})

describe('normalizeTypography', () => {
  it('passes a real reading through', () => {
    const t = readTypography('<w:rFonts w:ascii="Garamond"/><w:sz w:val="22"/>')
    expect(normalizeTypography(t)).toEqual(t)
  })

  it('turns anything unusable into "use the editor\'s own styles"', () => {
    for (const bad of [null, 'garamond', 42, { fontSize: -3 }]) {
      expect(normalizeTypography(bad).fontSize, String(bad)).toBeNull()
    }
  })
})

import { cssLineHeight, readParagraphFormats, ruleKey } from '../pageGeometry'

describe('readParagraphFormats', () => {
  const ruled = (text: string) =>
    `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="1A1A1A"/></w:pBdr>` +
    `</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
  const plain = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
  const keys = (xml: string) => readParagraphFormats(xml).filter((f) => f.ruled).map((f) => f.key)

  it('finds the headings Word underlines with a paragraph border', () => {
    const xml = ruled('PROFESSIONAL SUMMARY') + plain('body text') + ruled('EDUCATION')
    expect(keys(xml)).toEqual([ruleKey('PROFESSIONAL SUMMARY'), ruleKey('EDUCATION')])
  })

  it('joins a heading split across runs, which Word does constantly', () => {
    // Word splits a run at every formatting change, so "TECHNICAL SKILLS" can
    // arrive as three <w:t> elements.
    const split =
      '<w:p><w:pPr><w:pBdr><w:bottom w:val="single"/></w:pBdr></w:pPr>' +
      '<w:r><w:t>TECH</w:t></w:r><w:r><w:t>NICAL </w:t></w:r><w:r><w:t>SKILLS</w:t></w:r></w:p>'
    expect(keys(split)).toEqual([ruleKey('TECHNICAL SKILLS')])
  })

  it('ignores a border that is explicitly none', () => {
    const none = '<w:p><w:pPr><w:pBdr><w:bottom w:val="nil"/></w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
    expect(keys(none)).toEqual([])
  })

  it('ignores a paragraph with no text, which mammoth drops anyway', () => {
    const empty = '<w:p><w:pPr><w:pBdr><w:bottom w:val="single"/></w:pBdr></w:pPr></w:p>'
    expect(readParagraphFormats(empty)).toEqual([])
  })

  it('returns nothing for a document with no borders at all', () => {
    expect(keys(plain('just text'))).toEqual([])
  })

  it('decodes the entities the package escapes, so an ampersand can pair', () => {
    // The rule under "CERTIFICATIONS, TRAININGS & AWARDS" never appeared: the
    // key from the package read "&amp;" and the key from mammoth read "&", so
    // the two never matched. Four paragraphs on the reported CV do this.
    const xml = ruled('CERTIFICATIONS, TRAININGS &amp; AWARDS')
    expect(readParagraphFormats(xml)[0].key).toBe(ruleKey('CERTIFICATIONS, TRAININGS & AWARDS'))
  })

  it('keeps each paragraph its OWN spacing, not the document median', () => {
    // The bug: one median `w:after` applied to every block made the twelve
    // skills paragraphs 3pt tight each -- half an inch off one section.
    const xml =
      '<w:p><w:pPr><w:spacing w:before="130" w:after="50"/></w:pPr><w:r><w:t>HEADING</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:t>a skills line</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:spacing w:after="10"/></w:pPr><w:r><w:t>a bullet</w:t></w:r></w:p>'
    expect(readParagraphFormats(xml).map((f) => [f.spaceBefore, f.spaceAfter])).toEqual([
      [6.5, 2.5],
      [null, 4],
      [null, 0.5],
    ])
  })

  it('reads a paragraph size only when every run agrees on one', () => {
    // 22 half-points is 11pt, against the 10pt a run inherits by stating
    // nothing. A paragraph mixing the two gets null rather than a guess,
    // because mammoth's HTML has no run boundaries to hang two sizes on.
    const uniform = '<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>sub-title</w:t></w:r></w:p>'
    const mixed =
      '<w:p><w:r><w:t>degree</w:t></w:r>' +
      '<w:r><w:rPr><w:sz w:val="19"/></w:rPr><w:t> | Aug 2022</w:t></w:r></w:p>'
    expect(readParagraphFormats(uniform)[0].fontSize).toBe(11)
    expect(readParagraphFormats(mixed)[0].fontSize).toBeNull()
    // And a paragraph at the document default gets null: it needs no override.
    expect(readParagraphFormats(plain('body'))[0].fontSize).toBeNull()
  })

  it('reads a tab as a space, so a title-and-date line still pairs', () => {
    // Gabe's 2026-10-18 CV sets every entry as "Title<tab>Date" on a right tab
    // stop. The key read "mis officejune 2025" while mammoth's text, which
    // keeps the tab, read "mis office june 2025", so no entry line got its
    // spacing. The tab STOP in pPr has attributes and must add nothing.
    const xml =
      '<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="10512"/></w:tabs></w:pPr>' +
      '<w:r><w:t>MIS Office</w:t></w:r><w:r><w:tab/><w:t>June 2025</w:t></w:r></w:p>'
    expect(readParagraphFormats(xml)[0].key).toBe(ruleKey('MIS Office June 2025'))
  })

  it("falls back to the paragraph style's spacing, as Word does", () => {
    // The same CV's section headings state no spacing of their own: it lives
    // on the Heading 1 style (10pt before, 4pt after), so they imported at 0.
    const styles =
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:spacing w:after="160"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Sub"><w:basedOn w:val="Heading1"/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style>'
    const p = (pPr: string) => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>x</w:t></w:r></w:p>`
    const xml =
      p('<w:pStyle w:val="Heading1"/>') +
      // Its own after wins; before still comes from the style.
      p('<w:pStyle w:val="Heading1"/><w:spacing w:after="20"/>') +
      // basedOn is followed for the side the style does not state.
      p('<w:pStyle w:val="Sub"/>') +
      // No pStyle is the default paragraph style.
      p('')
    expect(readParagraphFormats(xml, styles).map((f) => [f.spaceBefore, f.spaceAfter])).toEqual([
      [10, 4],
      [10, 1],
      [10, 2],
      [null, 8],
    ])
  })

  it('drops inherited spacing under contextual spacing, so a list stays tight', () => {
    // Word's List Paragraph is based on Normal (8pt after) and turns on
    // contextualSpacing, which removes that gap between bullets. Inheriting
    // the 8pt without the rule would space every bullet apart.
    const styles =
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:spacing w:after="160"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:basedOn w:val="Normal"/><w:pPr><w:contextualSpacing/></w:pPr></w:style>'
    const xml = '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r><w:t>a bullet</w:t></w:r></w:p>'
    expect(readParagraphFormats(xml, styles).map((f) => [f.spaceBefore, f.spaceAfter])).toEqual([[null, null]])
  })
})

describe('cssLineHeight', () => {
  it('scales Word\'s multiple of SINGLE by the font\'s own line box', () => {
    // `w:line="235"` is 0.98 of single spacing, and single is the font's line
    // box. Handing 0.98 to CSS means 0.98 of the FONT SIZE -- about 15%
    // tighter than Word, which is nine lines of drift down a page.
    expect(cssLineHeight(235 / 240, 1.15)).toBeCloseTo(1.126, 3)
    expect(cssLineHeight(null, 1.15)).toBeNull()
    // A probe that never laid out must not collapse every line to nothing.
    expect(cssLineHeight(1, 0)).toBeNull()
  })
})

describe('ruleKey', () => {
  it('matches across the whitespace and case mammoth normalises', () => {
    expect(ruleKey('  PROFESSIONAL   SUMMARY ')).toBe(ruleKey('Professional Summary'))
  })
})
