/**
 * The page a .docx was written for: its size and its margins.
 *
 * THE BUG THIS FIXES, measured on Gabe's own CV (2026-09-11). The editor's
 * sheet was hard-coded to 8.5in wide with 0.8in margins on every side. His
 * ATS CV declares:
 *
 *   <w:pgSz  w:w="12240" w:h="15840"/>     8.5in x 11in
 *   <w:pgMar w:top="504" w:bottom="504"
 *            w:left="936" w:right="936"/>  0.35in and 0.65in
 *
 * A tight margin is not decoration on an ATS CV -- it is how three pages of
 * experience fit on two. Rendering it at 0.8in narrows the text column from
 * 7.2in to 6.9in, so every paragraph wraps earlier, the document grows several
 * lines, and what is on screen stops matching what Word showed. That is the
 * "format breaks" report: nothing failed, the page was simply the wrong page.
 *
 * TWIPS ARE THE UNIT WORD STORES, twentieths of a point, 1440 to the inch.
 * Every number that comes out of `document.xml` is in them and every number
 * that goes into CSS is not, so the conversion happens here, once.
 *
 * THE FALLBACK IS THIS APP'S OWN SHEET, NOT WORD'S DEFAULT. A .docx with no
 * `sectPr`, a pasted document, or a CV typed in this editor has no geometry to
 * read, and the honest answer there is the page the editor has always drawn:
 * US Letter at 0.8in. Using Word's 1in instead would have been more "correct"
 * in the abstract and would have silently re-margined every CV already in the
 * database the next time it was opened or exported -- a bigger change than the
 * bug this file fixes, applied to documents that never had the bug.
 */

export const TWIPS_PER_INCH = 1440

export interface PageGeometry {
  /** Inches. */
  width: number
  height: number
  margin: { top: number; right: number; bottom: number; left: number }
}

/** The sheet this editor has always drawn. See the docblock for why not 1in. */
export const DEFAULT_GEOMETRY: PageGeometry = {
  width: 8.5,
  height: 11,
  margin: { top: 0.8, right: 0.8, bottom: 0.8, left: 0.8 },
}

function inches(twips: string | undefined, fallback: number): number {
  const value = Number.parseFloat(twips ?? '')
  if (!Number.isFinite(value)) return fallback
  const asInches = value / TWIPS_PER_INCH
  // A negative margin is legal OOXML (Word uses them for headers that bleed
  // into the body) and is nonsense as page padding, so it clamps at zero.
  // The upper bound stops a malformed file producing a page of pure margin.
  return Math.min(Math.max(asInches, 0), 20)
}

/**
 * Read the page setup out of a `word/document.xml`.
 *
 * PARSED WITH A REGEX, DELIBERATELY, and it is worth saying why rather than
 * leaving it to look lazy. The two elements wanted are empty, attribute-only
 * and appear once in a `sectPr` at the end of the body; there is no nesting to
 * track and no text content to decode. Running a whole XML parse over a 40KB
 * document to read six numbers off two self-closing tags would cost more than
 * it explains. A malformed match falls back rather than throwing.
 *
 * THE LAST `sectPr` WINS. A document with section breaks has one per section,
 * and the final one carries the body's own setup -- which is what the editor
 * renders, since it has no notion of sections.
 */
export function readPageGeometry(documentXml: string): PageGeometry {
  const sizeMatch = [...documentXml.matchAll(/<w:pgSz\b([^>]*)\/?>/g)].pop()
  const marginMatch = [...documentXml.matchAll(/<w:pgMar\b([^>]*)\/?>/g)].pop()

  const attr = (source: string | undefined, name: string): string | undefined =>
    source?.match(new RegExp(`w:${name}="([^"]+)"`))?.[1]

  const size = sizeMatch?.[1]
  const margin = marginMatch?.[1]

  return {
    width: inches(attr(size, 'w'), DEFAULT_GEOMETRY.width),
    height: inches(attr(size, 'h'), DEFAULT_GEOMETRY.height),
    margin: {
      top: inches(attr(margin, 'top'), DEFAULT_GEOMETRY.margin.top),
      right: inches(attr(margin, 'right'), DEFAULT_GEOMETRY.margin.right),
      bottom: inches(attr(margin, 'bottom'), DEFAULT_GEOMETRY.margin.bottom),
      left: inches(attr(margin, 'left'), DEFAULT_GEOMETRY.margin.left),
    },
  }
}

/** Anything that is not a usable geometry becomes the default. */
export function normalizeGeometry(raw: unknown): PageGeometry {
  if (!raw || typeof raw !== 'object') return DEFAULT_GEOMETRY
  const candidate = raw as Partial<PageGeometry>
  const margin = candidate.margin
  if (
    typeof candidate.width !== 'number' ||
    typeof candidate.height !== 'number' ||
    candidate.width <= 0 ||
    candidate.height <= 0 ||
    !margin ||
    typeof margin !== 'object'
  ) {
    return DEFAULT_GEOMETRY
  }
  const side = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback

  return {
    width: candidate.width,
    height: candidate.height,
    margin: {
      top: side(margin.top, DEFAULT_GEOMETRY.margin.top),
      right: side(margin.right, DEFAULT_GEOMETRY.margin.right),
      bottom: side(margin.bottom, DEFAULT_GEOMETRY.margin.bottom),
      left: side(margin.left, DEFAULT_GEOMETRY.margin.left),
    },
  }
}

/** The printable column, which is what actually decides where text wraps. */
export function textColumnInches(geometry: PageGeometry): number {
  return Math.max(0, geometry.width - geometry.margin.left - geometry.margin.right)
}

/**
 * The type a .docx was set in: face, size, line height, paragraph spacing.
 *
 * THE SECOND HALF OF THE SAME BUG. Fixing the margins made the page right and
 * left the CONTENT wrong, because mammoth converts a document to semantic HTML
 * -- p, strong, em, ul -- and discards every run property on the way. So an
 * imported CV rendered in whatever the editor's stylesheet said rather than
 * what its author chose. Measured on the reported file:
 *
 *   the document   Garamond, 11pt, paragraph spacing 2-8pt
 *   the editor     its own sans-serif, 15px, 8px after every paragraph
 *
 * Nothing about that is subtle on screen, and it is the whole of "no borders,
 * font, spacing are not rendered properly".
 *
 * THE DOMINANT RUN WINS, not the document default, and the difference matters
 * on this very file: `docDefaults` says Times New Roman and not one run uses
 * it -- all 109 are Garamond. Word writes the default and then overrides it
 * everywhere, so reading `docDefaults` alone gets the answer exactly wrong.
 * Counting what the runs actually say gets it right.
 *
 * ONE FACE FOR THE WHOLE SHEET, which is a real simplification and is stated
 * rather than hidden. Per-run fidelity would mean walking `document.xml`
 * instead of using mammoth at all. A CV is set in one family -- this one has
 * a single face across every run -- so the dominant face applied to the sheet
 * is right for the documents this editor is for, and wrong only for a document
 * that mixes families deliberately.
 */
export interface DocumentTypography {
  /** CSS font-family stack, already quoted where it needs to be. */
  fontFamily: string | null
  /** Points. */
  fontSize: number | null
  /** Unitless line-height multiplier. */
  lineHeight: number | null
  /** Points of space after a paragraph. */
  paragraphSpacing: number | null
  /**
   * Points, for the document's own heading sizes.
   *
   * READ RATHER THAN GUESSED, which is the fix this field exists for. The
   * first version took the body size from the document and then set headings
   * as `em` multiples of it -- 1.45em for the title, 1.05em for a section.
   * On the reported CV that renders the name at 13.8pt where Word draws 16,
   * and a section heading at 10pt where Word draws 11. The document states all
   * three sizes; nothing needs inventing.
   */
  titleSize: number | null
  sectionSize: number | null
  /**
   * Points of space above and below a section heading.
   *
   * READ FROM THE HEADINGS THEMSELVES, not guessed, for the same reason as
   * their size. The reported CV sets every section heading to `before=6.5pt
   * after=2.5pt`; the editor's `mt-4` is 12pt, nearly double, and that gap
   * repeated eight times down a page is most of what "margin issues" meant.
   */
  headingSpaceBefore: number | null
  headingSpaceAfter: number | null
}

export const NO_TYPOGRAPHY: DocumentTypography = {
  fontFamily: null,
  fontSize: null,
  lineHeight: null,
  paragraphSpacing: null,
  titleSize: null,
  sectionSize: null,
  headingSpaceBefore: null,
  headingSpaceAfter: null,
}

/** The value that appears most often, or null when there are none. */
function dominant(values: string[]): string | null {
  if (values.length === 0) return null
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/** Median, so one 16pt heading does not drag the body size up. */
function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Twips into points, or null when the attribute is missing or nonsense. */
function points(raw: string | undefined): number | null {
  const value = Number.parseInt(raw ?? '', 10) / 20
  return Number.isFinite(value) && value >= 0 && value < 100 ? value : null
}

/**
 * Word's own default when `docDefaults` states no size at all: 20 half-points.
 *
 * NOT AN INVENTED FALLBACK -- it is what the OOXML default is, and it is the
 * size Word draws. Gabe's CV relies on it: `docDefaults` there carries a face
 * and a line rule and no `w:sz` whatever, so every body run is 10pt by
 * omission.
 */
const IMPLICIT_SIZE_HALF_POINTS = 20

/**
 * The `docDefaults` run properties, and ONLY those.
 *
 * THE ELEMENT HAS TO BE CLOSED FIRST, which is not fussiness. `<w:rPrDefault>`
 * followed by a lazy `[\s\S]*?` does not stop at `</w:rPrDefault>` -- it keeps
 * scanning into the style definitions after it and returns the first `w:sz`
 * it finds anywhere in the file. On the reported CV that is a heading style at
 * 16pt, so every unsized body run resolved to 16 and the median came out
 * 16pt: a document rendered entirely in its own title size. Cutting the
 * element out first bounds the search.
 */
function defaultRunProps(stylesXml: string): string {
  return stylesXml.match(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/)?.[0] ?? ''
}

/** The size a run gets when it states none, in points. */
function defaultSizePt(stylesXml: string): number {
  const half = Number.parseInt(
    defaultRunProps(stylesXml).match(/<w:sz w:val="(\d+)"/)?.[1] ?? '',
    10
  )
  return (Number.isFinite(half) && half > 0 ? half : IMPLICIT_SIZE_HALF_POINTS) / 2
}

/**
 * The EFFECTIVE size of every run that carries text, in points.
 *
 * THE BUG THIS FIXES, measured on the reported CV (2026-09-11). The first
 * version read only the `w:sz` elements that are actually written down, and
 * took their median as the body size. On that file 24 runs of 109 state a
 * size -- 14 at 9.5pt, 9 at 11pt, 1 at 16pt -- so the median came out 9.5pt
 * and the body rendered there. The other 85 runs, which ARE the body, state
 * nothing and inherit 10pt. The document Word draws is 10pt and the editor
 * drew it 5% small.
 *
 * The fix is to count what every run RESOLVES to rather than what it declares,
 * which also makes the median mean what it says: the size most of the
 * document is set in.
 *
 * RUNS WITHOUT TEXT ARE SKIPPED. An empty `w:r` holding only a bookmark or a
 * proofing mark occupies no line and would drag the median toward whatever
 * size it happened to inherit.
 */
function runSizes(xml: string, fallback: number): number[] {
  // `<w:r\b` cannot match `<w:rPr` or `<w:rFonts`: `r` and the letter after
  // it are both word characters, so there is no boundary between them.
  const runs = xml.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g) ?? []
  const sizes: number[] = []
  for (const run of runs) {
    if (!/<w:t[\s>]/.test(run)) continue
    const half = Number.parseInt(run.match(/<w:sz w:val="(\d+)"/)?.[1] ?? '', 10)
    const explicit = half / 2
    sizes.push(Number.isFinite(explicit) && explicit > 0 && explicit < 100 ? explicit : fallback)
  }
  return sizes
}

export function readTypography(documentXml: string, stylesXml = ''): DocumentTypography {
  const faces = [...documentXml.matchAll(/<w:rFonts\b[^>]*w:ascii="([^"]+)"/g)].map((m) => m[1])
  const face =
    dominant(faces) ??
    // Only if no run says anything: the document default, which on the
    // reported file is a face nothing actually uses.
    defaultRunProps(stylesXml).match(/<w:rFonts\b[^>]*w:ascii="([^"]+)"/)?.[1] ??
    null

  // `w:sz` is HALF-points, so 22 is 11pt -- and a run that states none is 10pt
  // by omission, which is most of this document. See `runSizes`.
  const sizes = runSizes(documentXml, defaultSizePt(stylesXml))

  // `w:line` with `lineRule="auto"` is 240ths of a line, so 235 is 0.98.
  const line = documentXml.match(/<w:spacing[^>]*w:line="(\d+)"[^>]*w:lineRule="auto"/)?.[1]
    ?? stylesXml.match(/<w:pPrDefault>[\s\S]*?<w:spacing[^>]*w:line="(\d+)"/)?.[1]
  const lineHeight = line ? Number.parseInt(line, 10) / 240 : null

  // `w:after` is twips; 20 to the point.
  const afters = [...documentXml.matchAll(/<w:spacing[^>]*w:after="(\d+)"/g)]
    .map((m) => Number.parseInt(m[1], 10) / 20)
    .filter((n) => Number.isFinite(n) && n >= 0 && n < 100)

  /**
   * The spacing on the SECTION HEADINGS specifically, taken from the
   * paragraphs Word underlines. They are the blocks whose spacing is most
   * visible -- eight of them down a page -- and they are consistent, so the
   * first one found is the document's answer rather than an average of
   * everything.
   */
  const headingParagraph = (documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []).find(
    (paragraph) => /<w:pBdr>[\s\S]*?<w:bottom\b[^>]*w:val="(?!nil|none)/.test(paragraph)
  )
  /**
   * THE DISTINCT SIZES, LARGEST FIRST, which is how the headings are found.
   *
   * A CV uses a handful of sizes with obvious roles: one for the name, one for
   * section headings, one for the body. The reported file is 16 / 11 / 9.5,
   * and the body is the median because it is what most runs are set in. The
   * title is the largest; a section heading is the largest size that is not
   * the title and not the body.
   *
   * Each is NULL rather than a fallback when the document does not distinguish
   * them -- a CV set entirely in one size gets the editor's own heading scale
   * rather than three identical levels.
   */
  const body = median(sizes)
  const distinct = [...new Set(sizes)].sort((a, b) => b - a)
  const title = distinct.length > 1 && body !== null && distinct[0] > body ? distinct[0] : null
  const section =
    body !== null ? (distinct.find((size) => size > body && size !== title) ?? null) : null

  return {
    fontFamily: face ? `"${face}", Georgia, serif` : null,
    fontSize: body,
    lineHeight: lineHeight && lineHeight > 0.5 && lineHeight < 4 ? lineHeight : null,
    paragraphSpacing: median(afters),
    titleSize: title,
    sectionSize: section,
    headingSpaceBefore: points(headingParagraph?.match(/w:before="(\d+)"/)?.[1]),
    headingSpaceAfter: points(headingParagraph?.match(/w:after="(\d+)"/)?.[1]),
  }
}

/** Anything unusable becomes "use the editor's own styles". */
export function normalizeTypography(raw: unknown): DocumentTypography {
  if (!raw || typeof raw !== 'object') return NO_TYPOGRAPHY
  const t = raw as Partial<DocumentTypography>
  const num = (v: unknown, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > lo && v < hi ? v : null
  return {
    fontFamily: typeof t.fontFamily === 'string' && t.fontFamily.trim() ? t.fontFamily : null,
    fontSize: num(t.fontSize, 3, 100),
    lineHeight: num(t.lineHeight, 0.5, 4),
    paragraphSpacing: num(t.paragraphSpacing, -1, 100),
    titleSize: num(t.titleSize, 3, 100),
    sectionSize: num(t.sectionSize, 3, 100),
    headingSpaceBefore: num(t.headingSpaceBefore, -1, 100),
    headingSpaceAfter: num(t.headingSpaceAfter, -1, 100),
  }
}

/**
 * `&amp;` back to `&`, which is what mammoth's HTML already says.
 *
 * THE BUG THIS FIXES, and it predates the paragraph formats: the heading rule
 * under "CERTIFICATIONS, TRAININGS & AWARDS" never appeared, because the key
 * read out of the package was "...trainings &amp; awards" and the key read out
 * of mammoth's output was "...trainings & awards". Four paragraphs on the
 * reported CV contain an ampersand and all four silently failed to pair.
 *
 * FIVE NAMED ENTITIES AND THE NUMERIC FORMS ARE ALL XML HAS -- the long HTML
 * list does not apply here, so there is nothing further to reach for.
 */
function decodeXml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Last, so a doubly-escaped "&amp;lt;" does not decode twice.
    .replace(/&amp;/g, '&')
}

/**
 * Every paragraph's own formatting, in document order.
 *
 * WHY THE DOCUMENT'S SPACING CANNOT BE ONE NUMBER, measured on the reported CV
 * (2026-09-11). `readTypography` takes the MEDIAN `w:after` and applies it to
 * every block, and that file writes eight different values:
 *
 *   0.5pt  x29   the bullets under each project
 *   1pt    x7    a project's title line
 *   2pt    x3    the name, and the coursework lines
 *   2.5pt  x8    the section headings
 *   3pt          the sub-title under the name
 *   4pt    x12   TECHNICAL SKILLS and CORE COMPETENCIES
 *   5pt          the professional summary
 *   8pt          the contact line
 *
 * The median of that is 1pt, so the twelve skills paragraphs rendered 3pt
 * tight EACH -- half an inch of page gone from one section, and the reason the
 * editor fitted more onto page one than Word did. A CV's spacing is not a
 * document-wide setting, it is how the author separates a bullet from a
 * heading, and flattening it is what "the format breaks" looks like once the
 * face and the margins are right.
 *
 * ALSO CARRIES THE HEADING RULE, which used to be read by a second walk over
 * the same paragraphs. Word draws it with `w:pBdr` -- a border on the
 * PARAGRAPH, not a horizontal rule between paragraphs -- and it is most of
 * what makes a CV look like a CV: eight rules under PROFESSIONAL SUMMARY,
 * TECHNICAL SKILLS, EDUCATION and the rest. mammoth cannot carry any of this;
 * its paragraph object exposes exactly `type`, `children`, `styleId`,
 * `styleName`, `numbering`, `alignment` and `indent`, probed directly.
 *
 * KEYED BY TEXT, WHICH IS RELIABLE FOR EXACTLY THIS. Matching by index would
 * break the moment mammoth drops an empty paragraph or flattens a table, and
 * matching by style name fails because these paragraphs carry none. A CV's
 * lines are long and near-unique, so their text is a good key -- and a
 * collision costs one paragraph the wrong spacing, not a corrupted document.
 */
export interface ParagraphFormat {
  /** `ruleKey` of the paragraph's text, for matching mammoth's output back. */
  key: string
  /** Points above and below, as Word writes them. Null means "unstated". */
  spaceBefore: number | null
  spaceAfter: number | null
  /** Word drew a bottom border on this paragraph. */
  ruled: boolean
  /**
   * Points, only when every text run in the paragraph agrees on ONE size and
   * it is not the document default.
   *
   * DELIBERATELY CONSERVATIVE. A paragraph mixing sizes -- "Bachelor of
   * Science in Computer Science | Aug 2022" sets the degree at 10pt and the
   * date at 9.5 -- gets nothing rather than a guess, because mammoth's HTML
   * has no run boundaries to hang two sizes on. What this does catch is the
   * whole-paragraph case, which on the reported CV is the 11pt sub-title under
   * the name and the 9.5pt coursework lines: both rendered at body size.
   */
  fontSize: number | null
}

export function readParagraphFormats(documentXml: string, stylesXml = ''): ParagraphFormat[] {
  const fallback = defaultSizePt(stylesXml)
  const formats: ParagraphFormat[] = []

  for (const paragraph of documentXml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? []) {
    const text = decodeXml(
      [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')
    ).trim()
    // A paragraph with no text is Word's spacing; mammoth drops it and there
    // is nothing to match it against.
    if (!text) continue

    const pPr = paragraph.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)?.[1] ?? ''
    const spacing = pPr.match(/<w:spacing\b[^>]*>/)?.[0] ?? ''
    const sizes = runSizes(paragraph, fallback)
    const uniform = new Set(sizes).size === 1 ? sizes[0] : null

    formats.push({
      key: ruleKey(text),
      spaceBefore: points(spacing.match(/w:before="(\d+)"/)?.[1]),
      spaceAfter: points(spacing.match(/w:after="(\d+)"/)?.[1]),
      // A bottom border specifically: Word also uses `w:pBdr` for boxes and
      // for the line above a footnote separator, and neither is a heading rule.
      ruled: /<w:pBdr>[\s\S]*?<w:bottom\b[^>]*w:val="(?!nil|none)/.test(pPr),
      fontSize: uniform !== null && uniform !== fallback ? uniform : null,
    })
  }

  return formats
}

/**
 * Word's line spacing into a CSS `line-height`.
 *
 * THE UNIT IS NOT WHAT IT LOOKS LIKE, and taking it at face value is the bug
 * this fixes. `w:line="235" w:lineRule="auto"` is 235/240 = 0.979 of SINGLE
 * spacing, and Word's single is the font's own line box -- what CSS calls
 * `line-height: normal`, around 1.15 for a serif. The first version handed
 * 0.979 straight to CSS, where it means 0.979 times the FONT SIZE: every line
 * on the reported CV was set about 15% tighter than Word sets it, which over a
 * 60-line page is nine lines of drift and a page break in the wrong place.
 *
 * `natural` is measured in the browser rather than assumed, because it is a
 * property of whichever face actually resolved -- Garamond where it is
 * installed, the fallback serif where it is not.
 */
/**
 * A serif's typical line box, for anywhere the browser cannot be asked.
 *
 * LIVES HERE RATHER THAN BESIDE THE HOOK because it now has two callers that
 * cannot share a DOM: `useNaturalLineHeight` measures the real face and falls
 * back to this, and the PDF export has no browser to measure in at all -- it
 * lays out in JavaScript, so this IS its natural line height.
 */
export const FALLBACK_NATURAL_LINE_HEIGHT = 1.15

export function cssLineHeight(multipleOfSingle: number | null, natural: number): number | null {
  if (multipleOfSingle === null || !Number.isFinite(natural) || natural <= 0) return null
  return multipleOfSingle * natural
}

/** Compared case- and space-insensitively, since mammoth normalises runs. */
export function ruleKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}
