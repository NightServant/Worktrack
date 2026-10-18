import { describe, it, expect } from 'vitest'
import mammoth from 'mammoth'
import { buildDocx, sectionsFrom, type TipTapNode } from '../docxExport'

const DOC: TipTapNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'ELIJAH GABE CERVANTES' }] },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Front-end developer', marks: [{ type: 'bold' }] }],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'EXPERIENCE' }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shipped the rewrite' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cut load time 40%' }] }] },
      ],
    },
  ],
}

/** A .docx is a zip; every zip starts `PK`. */
function isZip(buffer: Buffer): boolean {
  return buffer.subarray(0, 2).toString('latin1') === 'PK'
}

/**
 * Read the file back the way a consumer would.
 *
 * A .docx is a DEFLATE zip, so the text is not visible in the raw bytes -- the
 * first version of these tests grepped the buffer and failed against a
 * perfectly good file. `mammoth` is already a dependency (the app uses it to
 * import Word CVs), and reading the export back through it makes these
 * ROUND-TRIP tests: what a parser gets out, not what the packer thinks it put
 * in.
 */
async function readBack(buffer: Buffer): Promise<{ text: string; html: string }> {
  const [{ value: text }, { value: html }] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }),
  ])
  return { text, html }
}

describe('exporting the Word CV', () => {
  it('produces a real .docx, not a renamed text file', async () => {
    const buffer = await buildDocx(DOC, 'Gabe CV (ATS)')
    expect(isZip(buffer)).toBe(true)
    // A trivially small file means the packer produced an empty shell.
    expect(buffer.length).toBeGreaterThan(4000)
  })

  it('keeps every line of the CV', async () => {
    // The failure this catches is a converter that walks the tree wrongly and
    // silently drops a branch -- the file still opens, still looks like a CV,
    // and is missing a job. Asserted against the packed XML rather than the
    // intermediate objects, so it covers the packing step too.
    const { text } = await readBack(await buildDocx(DOC, 'CV'))
    for (const line of [
      'ELIJAH GABE CERVANTES',
      'Front-end developer',
      'EXPERIENCE',
      'Shipped the rewrite',
      'Cut load time 40%',
    ]) {
      expect(text, `"${line}" did not survive the export`).toContain(line)
    }
  })

  it('makes list items real Word lists, not hyphens typed into the text', async () => {
    // A literal "- " is part of the sentence as far as a parser is concerned.
    // Word list structure is something it can strip, which is the whole reason
    // .docx is worth exporting for ATS uploads.
    const { html, text } = await readBack(await buildDocx(DOC, 'CV'))
    // mammoth renders real Word list structure as <ul><li>. If the bullets had
    // been typed as literal hyphens, this would be <p>- Shipped...</p>.
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>Shipped the rewrite</li>')
    expect(text).not.toContain('- Shipped the rewrite')
  })

  it('preserves heading structure, which is what an ATS reads sections from', async () => {
    // Section headings are how a parser knows where EXPERIENCE starts. Flat
    // paragraphs would still look right on screen and parse as one blob.
    const { html } = await readBack(await buildDocx(DOC, 'CV'))
    expect(html).toContain('<h1>ELIJAH GABE CERVANTES</h1>')
    expect(html).toContain('<h2>EXPERIENCE</h2>')
  })

  it('keeps bold emphasis rather than flattening it', async () => {
    const { html } = await readBack(await buildDocx(DOC, 'CV'))
    expect(html).toMatch(/<strong>Front-end developer<\/strong>/)
  })

  it('survives an empty or malformed document instead of throwing', async () => {
    // This runs behind an export button. A throw there is an unhandled
    // rejection and a control stuck on "exporting".
    for (const input of [null, undefined, {}, { type: 'doc' }, { type: 'doc', content: [] }]) {
      const buffer = await buildDocx(input, 'CV')
      expect(isZip(buffer)).toBe(true)
    }
  })

  it('keeps the editor\'s own page margins', async () => {
    // 0.8in all round, the same as the letter preview on screen -- so what was
    // on screen is what comes out. 1152 twips = 0.8in.
    const [section] = sectionsFrom(DOC)
    expect(section.properties?.page?.margin).toMatchObject({
      top: 1152,
      right: 1152,
      bottom: 1152,
      left: 1152,
    })
  })

  it('ignores node types it does not know rather than losing their text', async () => {
    const odd = {
      type: 'doc',
      content: [{ type: 'someFutureNode', content: [{ type: 'text', text: 'still here' }] }],
    }
    const { text } = await readBack(await buildDocx(odd, 'CV'))
    expect(text).toContain('still here')
  })
})

/**
 * Bold has to SURVIVE the trip, and the way it stopped was invisible from the
 * outside: the file opened, the text was right, and every heading was light.
 *
 * `bold: false` on a run emits `<w:b w:val="false"/>`, and a run-level
 * property BEATS the paragraph style in Word. So every heading was un-bolded
 * by its own text -- the Heading style said bold, the run said "specifically
 * not", and Word believes the run. Gabe: "Word documents missed the bold
 * letters."
 *
 * Asserted on the XML because that is the contract. A test that only checked
 * `buildDocx` returned bytes passed throughout the bug.
 */
describe('bold survives the Word export', () => {
  async function documentXml(doc: unknown): Promise<string> {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(Buffer.from(await buildDocx(doc, 'CV')))
    return (await zip.file('word/document.xml')?.async('string')) ?? ''
  }

  function runFor(xml: string, text: string): string {
    const runs = xml.match(/<w:r>[\s\S]*?<\/w:r>/g) ?? []
    const run = runs.find((candidate) => candidate.includes(`>${text}<`))
    return run ?? ''
  }

  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'HEADING' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', marks: [{ type: 'bold' }], text: 'BOLDED' },
          { type: 'text', text: 'PLAIN' },
          { type: 'text', marks: [{ type: 'italic' }], text: 'SLANTED' },
        ],
      },
    ],
  }

  it('never writes a bold override onto a heading run', async () => {
    const run = runFor(await documentXml(doc), 'HEADING')
    expect(run).not.toContain('w:val="false"')
    // No run properties at all is the point: it inherits the Heading style.
    expect(run).not.toContain('<w:b ')
  })

  it('still marks a genuinely bold run', async () => {
    expect(runFor(await documentXml(doc), 'BOLDED')).toContain('<w:b/>')
  })

  it('leaves unmarked text to inherit rather than forcing it upright', async () => {
    const run = runFor(await documentXml(doc), 'PLAIN')
    expect(run).not.toContain('<w:b')
    expect(run).not.toContain('<w:i')
  })

  it('still marks a genuinely italic run', async () => {
    expect(runFor(await documentXml(doc), 'SLANTED')).toContain('<w:i/>')
  })

  it('makes the Heading styles bold even with no typography attributes', async () => {
    // Templates carry no doc attrs at all, and the bold used to ride along
    // with the heading SIZE -- so those documents got neither.
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(Buffer.from(await buildDocx(doc, 'CV')))
    const styles = (await zip.file('word/styles.xml')?.async('string')) ?? ''
    const heading1 = /<w:style [^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/.exec(styles)?.[0] ?? ''
    expect(heading1).toContain('<w:b/>')
  })
})

describe('a right-tabbed date and a ruled paragraph, written back (2026-10-18)', () => {
  // Gabe's new CV sets each entry as "Title<tab>Date" on a right tab stop at
  // the margin, and rules the line under its summary. Both come in through
  // the import; this is the other half of the round trip.
  async function documentXml(doc: unknown): Promise<string> {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(Buffer.from(await buildDocx(doc, 'CV')))
    return (await zip.file('word/document.xml')?.async('string')) ?? ''
  }
  const doc = {
    type: 'doc',
    attrs: { pageGeometry: { width: 8.5, height: 11, margin: { top: 0.5, right: 0.6, bottom: 0.5, left: 0.6 } } },
    content: [
      { type: 'paragraph', attrs: { ruled: true }, content: [{ type: 'text', text: 'Summary line.' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Clover', marks: [{ type: 'bold' }] },
          { type: 'rightTab' },
          { type: 'text', text: 'Aug 2026', marks: [{ type: 'italic' }] },
        ],
      },
    ],
  }

  it('puts a right tab stop at the text column, and a real tab before the date', async () => {
    const xml = await documentXml(doc)
    const entry = (xml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []).find((p) => p.includes('Clover'))!
    // 8.5in less 1.2in of margin is 7.3in: 10512 twips, what Word wrote.
    expect(entry).toMatch(/<w:tab w:val="right" w:pos="10512"\/>/)
    expect(entry.indexOf('<w:tab/>')).toBeGreaterThan(entry.indexOf('Clover'))
    expect(entry.indexOf('<w:tab/>')).toBeLessThan(entry.indexOf('Aug 2026'))
  })

  it('draws the rule under a plain paragraph', async () => {
    const xml = await documentXml(doc)
    const summary = (xml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []).find((p) => p.includes('Summary line.'))!
    expect(summary).toMatch(/<w:pBdr>[\s\S]*<w:bottom w:val="single"/)
  })
})
