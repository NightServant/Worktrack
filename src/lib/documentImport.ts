import {
  assertContentMatchesExtension,
  assertWithinSizeLimit,
  assertZipWithinBudget,
  safeDocumentTitle,
} from '@/lib/uploadSafety'
import type { ResumeContent, ResumeMode } from '@/services/resumeService'
import {
  DEFAULT_GEOMETRY,
  NO_TYPOGRAPHY,
  readPageGeometry,
  readParagraphFormats,
  readTypography,
  ruleKey,
  type ParagraphFormat,
  type DocumentTypography,
  type PageGeometry,
} from './pageGeometry'

export interface ImportedDocument {
  mode: ResumeMode
  title: string
  content: ResumeContent
}

/**
 * Turns an uploaded file into a CV the editors can open.
 *
 * The extension decides the mode, not the content: a `.tex` file opens in the
 * LaTeX editor with its source intact, everything else opens in the Word
 * editor as paragraphs. Sniffing the body instead would guess wrong on a plain
 * CV that happens to contain a backslash.
 *
 * `.docx` goes through mammoth (BSD-2-Clause), which Gabe chose. A .docx is a
 * ZIP of WordprocessingML and reading one by hand means ZIP central-directory
 * parsing plus a document.xml walk; mammoth is the library that exists for
 * exactly this and it maps Word's STYLES rather than its formatting, which is
 * the distinction that matters here. Word marks a heading by naming a style,
 * not by making text big -- so a converter that reads formatting produces a CV
 * of bold paragraphs, and one that reads styles produces headings.
 *
 * `.doc` is still refused. It is the pre-2007 binary format, a different thing
 * entirely from `.docx`, and mammoth does not read it.
 */
export const IMPORTABLE_EXTENSIONS = ['.docx', '.tex', '.txt', '.md', '.markdown'] as const

/** What the file picker offers. `.doc` is listed so the rejection can explain itself. */
export const IMPORT_ACCEPT = '.docx,.tex,.txt,.md,.markdown,.doc'

export class UnsupportedDocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedDocumentError'
  }
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

/*
  `titleFromFilename` LIVED HERE AND IS GONE (2026-09-15). It did the same job
  as `safeDocumentTitle` in lib/uploadSafety -- strip the path, drop the
  extension, fall back -- WITHOUT the sanitising, and once the import switched
  to the safe one it had no callers left but its own test.

  Deleted rather than kept beside it, because two functions with the same
  signature and the same obvious name, one of which quietly passes a
  right-to-left override through into a stored title, is precisely how the
  unsafe one gets picked next time somebody needs a title from a filename.
*/

/**
 * Plain text into tiptap's document shape.
 *
 * A blank line separates paragraphs, which is the one convention every plain
 * CV and every Markdown file already agrees on. Markdown `#` headings become
 * real headings because that mapping is unambiguous; nothing else in Markdown
 * is translated, since a half-applied Markdown parser produces a document with
 * some syntax rendered and the rest left as literal asterisks, which is worse
 * than leaving all of it as text.
 */
export function textToWordContent(text: string): ResumeContent {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)

  const content = blocks.map((block) => {
    const heading = /^(#{1,3})\s+(.*)$/.exec(block)
    if (heading) {
      return {
        type: 'heading',
        attrs: { level: heading[1].length },
        content: [{ type: 'text', text: heading[2].trim() }],
      }
    }
    // A single newline inside a block is a line break, not a new paragraph --
    // address lines and "Title | Company" pairs depend on it.
    const lines = block.split('\n')
    const inline: Array<Record<string, unknown>> = []
    lines.forEach((line, i) => {
      if (i > 0) inline.push({ type: 'hardBreak' })
      if (line.length > 0) inline.push({ type: 'text', text: line })
    })
    return { type: 'paragraph', content: inline }
  })

  // tiptap rejects a doc with no content, and an imported empty file is a real
  // thing a person can pick, so it becomes one empty paragraph rather than a
  // document that throws when the editor mounts.
  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  } as ResumeContent
}

/**
 * `Blob.text()` where it exists, `FileReader` where it does not.
 *
 * Not only a test convenience: `Blob.text()` landed in Safari 14, so a reader
 * on an older iPad would hit the same `file.text is not a function` this
 * fallback was written for. FileReader has been universal since forever.
 */
function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsText(file)
  })
}

/** The `arrayBuffer` half of the same story, for mammoth. */
function readArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Reads a picked file into a draft. Throws `UnsupportedDocumentError` with
 * copy meant to be shown to the reader.
 */
export async function importDocument(file: File): Promise<ImportedDocument> {
  const extension = extensionOf(file.name)

  /*
    THE GATES RUN IN THIS ORDER FOR A REASON, and the order is "cheapest and
    most informative first".

    SIZE, before the extension check and before a single byte is read. A 500MB
    file named `.exe` should be refused for being 500MB, not sent away with
    advice about picking a .txt -- and the size is the check that stops the tab
    freezing whichever advice it gives.

    EXTENSION, next, because it decides which parser is even a candidate.

    CONTENT, last of the three and before any parser sees the file: the
    extension is a claim by whoever named it, and this is where a renamed PDF
    or an actual executable is caught. It costs one 8-byte disk read.

    All three live in lib/uploadSafety, shared with the two CSV pickers, which
    had no checks at all.
  */
  assertWithinSizeLimit(file, 'document')

  if (extension === '.doc') {
    throw new UnsupportedDocumentError(
      'That is the old .doc format, which cannot be read. Open it in Word and save it as .docx, then import that.'
    )
  }

  if (!(IMPORTABLE_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new UnsupportedDocumentError(
      `${extension || 'That file type'} cannot be imported. Pick a .tex, .txt or .md file.`
    )
  }

  await assertContentMatchesExtension(file, extension)

  // `safeDocumentTitle`, not `titleFromFilename`. The filename becomes a stored
  // title, is rendered on /documents, and ends up in a Content-Disposition on
  // export -- so a right-to-left override or a newline in it is somebody
  // else's problem three screens away. See lib/uploadSafety.
  const title = safeDocumentTitle(file.name)

  if (extension === '.docx') {
    return { mode: 'word', title, content: await docxToWordContent(file) }
  }

  const text = await readText(file)

  // `.tex` STILL IMPORTS, as text. The LaTeX editor is gone (2026-09-13), so
  // there is nothing to hand source to -- but refusing the extension outright
  // would turn "we dropped an editor" into "your file is not supported", and
  // the text of a CV is still the useful half of a .tex file.

  return { mode: 'word', title, content: textToWordContent(text) }
}


/**
 * Word's own style names, mapped to what the editor can show. Without this,
 * "Title" and "Heading 1" both arrive as plain paragraphs.
 *
 * EXPORTED SO THE TEST CONVERTS THE SAME WAY. mammoth ships two builds: the
 * browser one takes an `arrayBuffer` and the Node one takes a `buffer`, and
 * only the handle differs. Sharing the options means a test running under Node
 * exercises the real conversion rather than a second, drifting copy of it.
 */
export const MAMMOTH_OPTIONS = {
  styleMap: [
    // `.doc-title` so a Title-style name is never counted or shifted with the
    // Heading 1 sections; see `sectionsFromHeadingOne`.
    "p[style-name='Title'] => h1.doc-title:fresh",
    "p[style-name='Heading 1'] => h1:fresh",
    "p[style-name='Heading 2'] => h2:fresh",
    "p[style-name='Heading 3'] => h3:fresh",
    // mammoth ignores underline unless asked. Gabe's CV underlines its links.
    'u => u',
  ],
  convertImage: undefined,
}

/**
 * A .docx into the Word editor's content, via mammoth.
 *
 * mammoth produces HTML; this walks that HTML into tiptap's JSON. It does NOT
 * hand the HTML to the editor to parse, because the import happens on
 * /documents where no editor is mounted -- creating one, parsing, and throwing
 * it away to convert a file would be a strange amount of machinery.
 *
 * Only the nodes StarterKit actually renders are emitted. Anything else --
 * tables above all, which Word CVs are full of -- is FLATTENED to paragraphs
 * rather than dropped: a two-column Word CV laid out in an invisible table
 * would otherwise import as an empty document, which looks exactly like a
 * broken importer. Flattened text is imperfect and present, which beats
 * perfect and absent.
 *
 * Images are discarded. mammoth would inline them as base64 data URIs, and
 * StarterKit has no image node to put them in, so they would land in the JSON
 * as content nothing can render and the row would carry the weight of the
 * pictures forever.
 */
async function docxToWordContent(file: File): Promise<ResumeContent> {
  // Imported here rather than at module scope: mammoth is the largest thing in
  // this file's dependency graph and only one of five extensions needs it, so
  // a reader importing a .txt should not pay to download it.
  const mammoth = await import('mammoth')
  const arrayBuffer = await readArrayBuffer(file)

  /*
    THE BOMB CHECK, AND IT HAS TO HAPPEN BEFORE MAMMOTH. A .docx is a zip, and
    a zip declares how large it becomes -- ten kilobytes can declare four
    gigabytes. The 8MB file cap says nothing about that, and both consumers
    below decompress without asking: `readSetupFromDocx` for the page setup and
    mammoth for the content.

    It is checked HERE rather than inside `readSetupFromDocx` because that
    function is wrapped in a try/catch that falls back to Word's defaults on
    any failure -- correct for a corrupt package, and exactly wrong for a bomb:
    it would swallow the refusal and hand the same buffer to mammoth anyway.
    This throw is meant to escape.
  */
  const JSZipForBudget = (await import('jszip')).default
  assertZipWithinBudget((await JSZipForBudget.loadAsync(arrayBuffer)).files)
  // THE PAGE THE DOCUMENT WAS WRITTEN FOR, read before the content. mammoth
  // converts the body and discards the section setup entirely, so the margins
  // have to come out of the package directly -- and without them every import
  // renders at the editor's hard-coded 0.8in, which is what "the format
  // breaks" meant. See `pageGeometry`.
  const setup = await readSetupFromDocx(arrayBuffer)

  const { value: html } = await mammoth.convertToHtml({ arrayBuffer }, MAMMOTH_OPTIONS)

  return withSetup(htmlToWordContent(html, setup.formats, setup.typography.fontSize), setup)
}

/**
 * Pull `word/document.xml` out of the package and read its section setup.
 *
 * JSZIP IS ALREADY HERE, pulled in by `docx` for the export side, so this
 * costs no new dependency. Any failure -- a corrupt zip, a package with no
 * document part -- falls back to Word's own default rather than failing an
 * import over page margins, which would turn a cosmetic problem into a
 * blocking one.
 */
async function readSetupFromDocx(
  arrayBuffer: ArrayBuffer
): Promise<{ geometry: PageGeometry; typography: DocumentTypography; formats: ParagraphFormat[] }> {
  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(arrayBuffer)
    const documentXml = await zip.file('word/document.xml')?.async('string')
    // `styles.xml` is optional and only supplies the fallback face, so a
    // package without one still reads its geometry and its run fonts.
    const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? ''
    if (!documentXml) return { geometry: DEFAULT_GEOMETRY, typography: NO_TYPOGRAPHY, formats: [] }
    return {
      geometry: readPageGeometry(documentXml),
      typography: readTypography(documentXml, stylesXml),
      formats: readParagraphFormats(documentXml, stylesXml),
    }
  } catch {
    return { geometry: DEFAULT_GEOMETRY, typography: NO_TYPOGRAPHY, formats: [] }
  }
}

/**
 * Attach the geometry to the document JSON.
 *
 * ON THE DOC NODE'S `attrs`, which is the one place tiptap preserves across a
 * round trip -- the schema declares the attribute, so `getJSON()` gives it
 * back after an edit and the page a CV was imported at survives being typed
 * in and saved. A sibling key beside `type: 'doc'` would be dropped the first
 * time the editor re-serialised.
 */
function withSetup(
  content: ResumeContent,
  setup: { geometry: PageGeometry; typography: DocumentTypography; formats: ParagraphFormat[] }
): ResumeContent {
  return {
    ...(content as object),
    attrs: {
      ...((content as { attrs?: object }).attrs ?? {}),
      pageGeometry: setup.geometry,
      documentTypography: setup.typography,
    },
  } as ResumeContent
}

type TipTapNode = { type: string; attrs?: Record<string, unknown>; content?: TipTapNode[]; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; text?: string }

/** Exported for tests: the HTML walk, without the file reading around it. */
export function htmlToWordContent(
  html: string,
  formats: ParagraphFormat[] = [],
  /** The document's body size in points, which a title has to exceed. */
  bodySize: number | null = null
): ResumeContent {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  sectionsFromHeadingOne(doc)
  const blocks: TipTapNode[] = []
  collectBlocks(doc.body, blocks)
  titleBySize(blocks, applyFormats(blocks, formats), formats, bodySize)

  return {
    type: 'doc',
    content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }],
  } as unknown as ResumeContent
}


/**
 * Put each paragraph's own spacing, rule and size back onto mammoth's blocks.
 *
 * MAMMOTH CONVERTS A .DOCX TO SEMANTIC HTML and drops every formatting
 * property on the way -- that is its design, and it is the right one for
 * reading a document's STRUCTURE. It leaves the layout to be recovered
 * separately, which is what `readParagraphFormats` reads and this reattaches.
 *
 * PAIRED BY TEXT, WALKING FORWARD. A `Map` keyed on text would be wrong on a
 * CV: "Relevant Coursework: ..." appears under both schools with different
 * spacing. A cursor pairs the first occurrence with the first, and a block
 * that matches nothing is stepped over WITHOUT consuming an entry -- so a
 * table mammoth flattened into paragraphs cannot shift every format after it.
 *
 * A MATCHED PARAGRAPH TAKES BOTH NUMBERS, including the zeroes. Word treats an
 * unstated `w:before` as no space at all, so leaving the attribute null would
 * let the editor's own default show through on exactly the paragraphs the
 * document is most specific about.
 */
function applyFormats(blocks: TipTapNode[], formats: ParagraphFormat[]): Map<TipTapNode, ParagraphFormat> {
  const matched = new Map<TipTapNode, ParagraphFormat>()
  if (formats.length === 0) return matched
  let cursor = 0
  let previous: TipTapNode | null = null

  for (const block of textBlocksOf(blocks)) {
    const key = ruleKey(textOf(block))
    if (!key) continue
    const index = formats.findIndex((format, i) => i >= cursor && format.key === key)
    if (index === -1) {
      previous = block
      continue
    }
    const format = formats[index]
    cursor = index + 1
    matched.set(block, format)
    // A line ABOVE this paragraph is the same line as one under the paragraph
    // before it, which the editor and both exports already draw.
    if (format.ruledAbove && previous) previous.attrs = { ...(previous.attrs ?? {}), ruled: true }
    previous = block

    block.attrs = {
      ...(block.attrs ?? {}),
      spaceBefore: format.spaceBefore ?? 0,
      spaceAfter: format.spaceAfter ?? 0,
      // Paragraphs as well as headings since 2026-10-18: the line under the
      // summary on Gabe's new CV is a border on a plain paragraph.
      ...(format.ruled ? { ruled: true } : {}),
    }

    // Headings already take their size from the document's own heading scale,
    // so marking their runs as well would say the same thing twice.
    if (format.fontSize !== null && block.type === 'paragraph') {
      setFontSize(block.content ?? [], `${format.fontSize}pt`)
    }
    // After the size, which replaces the textStyle mark the colour joins.
    if (format.runs) block.content = colorRuns(block.content ?? [], format.runs)
    if (format.rightTab) block.content = rightTabs(block.content ?? [])
  }
  return matched
}

/**
 * The colours mammoth drops, put back on the text they belong to.
 *
 * ALIGNED BY TEXT, NOT BY RUN COUNT. mammoth merges and splits runs on its
 * own terms (a proofing mark splits one, a shared format merges two), so the
 * n-th run here is not the n-th text node there. Each text node is found in
 * the paragraph's own text from where the last one ended, and takes the
 * colour of the characters it covers -- split where that colour changes.
 * A node that cannot be found keeps its text and no colour.
 */
function colorRuns(content: TipTapNode[], runs: { text: string; color: string | null }[]): TipTapNode[] {
  const text = runs.map((run) => run.text).join('')
  const colors = runs.flatMap((run) => Array.from(run.text, () => run.color))
  let cursor = 0
  return content.flatMap((node) => {
    if (typeof node.text !== 'string') return [node]
    const at = text.indexOf(node.text, cursor)
    if (at === -1) return [node]
    cursor = at + node.text.length
    const pieces: TipTapNode[] = []
    let start = 0
    for (let i = 1; i <= node.text.length; i++) {
      if (i < node.text.length && colors[at + i] === colors[at + start]) continue
      const color = colors[at + start]
      const piece: TipTapNode = { ...node, text: node.text.slice(start, i) }
      pieces.push(color ? withTextStyle(piece, { color }) : piece)
      start = i
    }
    return pieces
  })
}

/** Merge attributes into a node's textStyle mark, adding one if it has none. */
function withTextStyle(node: TipTapNode, attrs: Record<string, unknown>): TipTapNode {
  const marks = node.marks ?? []
  const existing = marks.find((mark) => mark.type === 'textStyle')
  return {
    ...node,
    marks: [
      ...marks.filter((mark) => mark !== existing),
      { type: 'textStyle', attrs: { ...(existing?.attrs ?? {}), ...attrs } },
    ],
  }
}

/**
 * Each tab in a paragraph with a right tab stop, as a `rightTab` node.
 *
 * mammoth writes a tab as a literal `\t` inside the text ("<em>\tJune 2025
 * </em>"), so the node is cut out of the run it sits in and the run's marks
 * stay on the text either side.
 */
function rightTabs(content: TipTapNode[]): TipTapNode[] {
  return content.flatMap((node) => {
    if (typeof node.text !== 'string' || !node.text.includes('\t')) return [node]
    return node.text.split('\t').flatMap((part, index) => [
      ...(index > 0 ? [{ type: 'rightTab' }] : []),
      ...(part ? [{ ...node, text: part }] : []),
    ])
  })
}

/**
 * Heading 1 read as a SECTION when the document uses it more than once.
 *
 * THE EDITOR'S h1 IS THE NAME, drawn at the document's title size, and h2 is
 * a section (see `--doc-h1-size` / `--doc-h2-size`). Word's own convention is
 * Title for the name and Heading 1 for each section, and Gabe's 2026-10-18 CV
 * follows it: mapped one-to-one, its eight sections drew at the name's 18pt.
 *
 * COUNTED, NOT ASSUMED, because Worktrack's own export writes the name as
 * Heading 1 and the sections as Heading 2, and re-importing that must not
 * shift. A CV has one name, so one Heading 1 is the name and several are
 * sections. A Title-style paragraph (`.doc-title`) is the name either way and
 * is left out of both the count and the shift.
 */
function sectionsFromHeadingOne(doc: Document): void {
  if (doc.body.querySelectorAll('h1:not(.doc-title)').length < 2) return
  for (const heading of Array.from(doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    if (heading.classList.contains('doc-title')) continue
    const level = Math.min(Number(heading.tagName.slice(1)) + 1, 6)
    const shifted = doc.createElement(`h${level}`)
    shifted.append(...Array.from(heading.childNodes))
    heading.replaceWith(shifted)
  }
}

/**
 * The first line becomes the title when the document sets it in its largest
 * size and nothing else is the title already.
 *
 * Gabe's new CV, like the VA one before it, types the name as a plain bold
 * paragraph at 18pt with no Word style, so the bold-caps rule made it a
 * SECTION and it drew at 11pt. The size is the document saying which line is
 * the name; the first-line condition stops a large figure further down from
 * being promoted, and a first line that is merely a section heading is never
 * the largest size.
 */
function titleBySize(
  blocks: TipTapNode[],
  matched: Map<TipTapNode, ParagraphFormat>,
  formats: ParagraphFormat[],
  bodySize: number | null
): void {
  if (blocks.some((block) => block.type === 'heading' && block.attrs?.level === 1)) return
  const first = blocks[0]
  const size = first ? matched.get(first)?.fontSize : null
  if (!first || !size || (first.type !== 'heading' && first.type !== 'paragraph')) return
  // LARGER THAN THE BODY, not only the largest stated size: a stated size can
  // be SMALLER than the default, and a 10pt sender line over an 11pt letter
  // is the largest size any paragraph states without being anyone's name.
  if (bodySize === null || size <= bodySize) return
  if (formats.some((format) => (format.fontSize ?? 0) > size)) return
  first.type = 'heading'
  first.attrs = { ...(first.attrs ?? {}), level: 1 }
  // The heading carries the title size and weight; bold or a size mark on its
  // runs would say the same thing twice.
  first.content = stripMarks(first.content ?? [])
}

/**
 * The blocks that hold text, in document order, list items included.
 *
 * A .docx has no nesting here -- a bullet is a paragraph carrying a numbering
 * reference -- so the tiptap tree has to be flattened back to that shape
 * before it can be paired with one.
 */
function* textBlocksOf(nodes: TipTapNode[]): Generator<TipTapNode> {
  for (const node of nodes) {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      for (const item of node.content ?? []) yield* textBlocksOf(item.content ?? [])
      continue
    }
    yield node
  }
}

function textOf(node: TipTapNode): string {
  if (typeof node.text === 'string') return node.text
  return (node.content ?? []).map(textOf).join('')
}

/** A `textStyle` mark on every text node, which is how tiptap carries a size. */
function setFontSize(content: TipTapNode[], size: string): void {
  for (const node of content) {
    if (typeof node.text === 'string') {
      const marks = (node.marks ?? []).filter((m) => m.type !== 'textStyle')
      node.marks = [...marks, { type: 'textStyle', attrs: { fontSize: size } }]
      continue
    }
    if (node.content) setFontSize(node.content, size)
  }
}

const HEADINGS: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 3, H5: 3, H6: 3 }

function collectBlocks(parent: Element, out: TipTapNode[]): void {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 3) {
      // A bare text node between blocks -- Word's HTML has these around
      // tables. Kept as its own paragraph rather than dropped.
      const text = (node.textContent ?? '').trim()
      if (text) out.push({ type: 'paragraph', content: [{ type: 'text', text }] })
      continue
    }
    if (node.nodeType !== 1) continue
    const el = node as Element
    const tag = el.tagName.toUpperCase()

    if (tag in HEADINGS) {
      const content = inlineContent(el)
      if (content.length > 0) {
        out.push({ type: 'heading', attrs: { level: HEADINGS[tag] }, content })
      }
      continue
    }
    if (tag === 'P') {
      const content = inlineContent(el)
      // An empty <p> is Word's spacing, not a paragraph anyone wrote.
      if (content.length === 0) continue
      out.push(
        looksLikeSectionTitle(content)
          ? { type: 'heading', attrs: { level: 2 }, content: stripMarks(content) }
          : { type: 'paragraph', content }
      )
      continue
    }
    if (tag === 'UL' || tag === 'OL') {
      const items = Array.from(el.children)
        .filter((li) => li.tagName.toUpperCase() === 'LI')
        .map((li) => {
          const nested = listItemBlocks(li)
          return {
            type: 'listItem',
            content: nested.length > 0 ? nested : [{ type: 'paragraph' }],
          }
        })
      if (items.length > 0) {
        out.push({ type: tag === 'UL' ? 'bulletList' : 'orderedList', content: items })
      }
      continue
    }
    // Everything else -- tables, divs, sections -- is walked through rather
    // than emitted. A Word CV laid out in an invisible table would otherwise
    // import as nothing at all.
    collectBlocks(el, out)
  }
}

const BLOCK_TAGS = new Set(['P', 'UL', 'OL', 'TABLE', 'DIV', ...Object.keys(HEADINGS)])

/**
 * A list item's content, with its inline runs kept as ONE paragraph.
 *
 * mammoth writes a bullet as `<li><strong>2nd Place</strong>, Tarlac</li>`,
 * with no `<p>`. Walked as blocks, every inline piece became its own
 * paragraph, so each certificate on Gabe's 2026-10-18 CV split across two
 * lines at the end of its bold lead-in. Inline nodes are gathered until a
 * block (a nested list, most often) and emitted together.
 */
function listItemBlocks(li: Element): TipTapNode[] {
  const out: TipTapNode[] = []
  let inline = li.ownerDocument.createElement('span')
  const flush = () => {
    const content = inlineContent(inline)
    if (content.length > 0) out.push({ type: 'paragraph', content })
    inline = li.ownerDocument.createElement('span')
  }
  for (const node of Array.from(li.childNodes)) {
    if (node.nodeType === 1 && BLOCK_TAGS.has((node as Element).tagName.toUpperCase())) {
      flush()
      const holder = li.ownerDocument.createElement('div')
      holder.append(node.cloneNode(true))
      collectBlocks(holder, out)
    } else {
      inline.append(node.cloneNode(true))
    }
  }
  flush()
  return out
}

/**
 * Whether a paragraph is really a section title wearing bold.
 *
 * The style map above only fires when the author used Word's Heading styles.
 * Gabe's own ATS CV does not: mammoth returns forty `<p>` for it, with
 * `<strong>` marking "PROFESSIONAL SUMMARY" and "TECHNICAL SKILLS". That is
 * the normal shape of an ATS-oriented CV, so importing one without this
 * produces a wall of undifferentiated paragraphs.
 *
 * Three conditions, all required, and each one is there to keep something out:
 *
 * - ENTIRELY bold. "**Programming Languages:** Solid day-to-day command of..."
 *   is a bold lead-in on a body paragraph, not a heading.
 * - No lowercase letters. Section titles in these CVs are set in caps;
 *   requiring it excludes a bold job title like "Front-End Developer".
 * - Short. A bold all-caps sentence is emphasis, not a section.
 *
 * It will still promote a company name typed in bold caps on its own line.
 * That is the known cost, it is one heading too many rather than lost text,
 * and the alternative -- no headings at all on the CVs most likely to be
 * imported -- is worse.
 */
const SECTION_TITLE_MAX = 48

function looksLikeSectionTitle(content: TipTapNode[]): boolean {
  if (content.length === 0) return false
  if (!content.every((node) => node.type === 'text' && node.marks?.some((m) => m.type === 'bold')))
    return false
  const text = content.map((node) => node.text ?? '').join('')
  if (text.trim().length === 0 || text.length > SECTION_TITLE_MAX) return false
  // Uppercase-only: no lowercase letter anywhere.
  return !/\p{Ll}/u.test(text)
}

/** A heading carries its own weight; keeping the bold mark would double it. */
function stripMarks(content: TipTapNode[]): TipTapNode[] {
  return content.map(({ marks: _marks, ...node }) => node)
}

/**
 * A link's address, only when it is one a reader can safely follow.
 *
 * THE FILE IS UPLOADED, SO ITS LINKS ARE UNTRUSTED. A .docx can carry a
 * `javascript:` hyperlink as easily as an https one, and a link mark renders
 * as a real anchor in the editor. Web and mail addresses only; anything else
 * keeps its text and loses the link. In-document anchors (`#bookmark`) point
 * at nothing once the text is in the editor, so they go too.
 */
function safeHref(raw: string | null): string | null {
  const href = raw?.trim() ?? ''
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null
}

/** Text with the marks StarterKit renders: bold, italic, underline, links. */
function inlineContent(el: Element, marks: Array<{ type: string; attrs?: Record<string, unknown> }> = []): TipTapNode[] {
  const out: TipTapNode[] = []
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      const text = node.textContent ?? ''
      if (text.trim().length > 0) {
        out.push(marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text })
      }
      continue
    }
    if (node.nodeType !== 1) continue
    const child = node as Element
    const tag = child.tagName.toUpperCase()
    if (tag === 'BR') {
      out.push({ type: 'hardBreak' })
      continue
    }
    const href = tag === 'A' ? safeHref(child.getAttribute('href')) : null
    const next =
      tag === 'STRONG' || tag === 'B'
        ? [...marks, { type: 'bold' }]
        : tag === 'EM' || tag === 'I'
          ? [...marks, { type: 'italic' }]
          : tag === 'U'
            ? [...marks, { type: 'underline' }]
            : href
              ? [...marks, { type: 'link', attrs: { href } }]
              : marks
    out.push(...inlineContent(child, next))
  }
  return out
}
