import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { WORD_EDITOR_EXTENSIONS } from '../editorExtensions'

/**
 * The document's own spacing, as the browser will actually see it.
 *
 * ASSERTED ON RENDERED MARKUP, NOT ON THE JSON, because the risk is entirely
 * in the rendering. `spaceBefore` and `spaceAfter` are two separate attributes
 * that each return a `style`, and whether tiptap MERGES those two styles or
 * lets the second overwrite the first is the difference between a paragraph
 * that keeps both its gaps and one that silently loses the top. A test over
 * the JSON would pass either way.
 */
const render = (node: Record<string, unknown>) => {
  const editor = new Editor({
    content: { type: 'doc', content: [node] },
    extensions: WORD_EDITOR_EXTENSIONS,
  })
  const html = editor.getHTML()
  editor.destroy()
  return html
}

describe('a paragraph carrying the spacing Word declared', () => {
  it('renders both gaps, so neither style overwrites the other', () => {
    const html = render({
      type: 'paragraph',
      attrs: { spaceBefore: 6.5, spaceAfter: 2.5 },
      content: [{ type: 'text', text: 'a skills line' }],
    })
    expect(html).toContain('padding-top: 6.5pt')
    expect(html).toContain('margin-bottom: 2.5pt')
  })

  it('zeroes the top margin it replaces', () => {
    // The editor's stylesheet sets a heading margin from the document's
    // heading spacing. Without this the two stack and every section heading
    // sits at double its gap.
    const html = render({
      type: 'heading',
      attrs: { level: 2, spaceBefore: 6.5, spaceAfter: 2.5 },
      content: [{ type: 'text', text: 'EDUCATION' }],
    })
    expect(html).toContain('margin-top: 0')
    expect(html).toContain('padding-top: 6.5pt')
  })

  it('and a heading keeps its rule alongside them', () => {
    const html = render({
      type: 'heading',
      attrs: { level: 2, ruled: true, spaceAfter: 2.5 },
      content: [{ type: 'text', text: 'EDUCATION' }],
    })
    expect(html).toContain('data-ruled="true"')
    expect(html).toContain('margin-bottom: 2.5pt')
  })

  it('renders nothing extra for a document that declared none', () => {
    const html = render({ type: 'paragraph', content: [{ type: 'text', text: 'typed here' }] })
    expect(html).not.toContain('padding-top')
    expect(html).not.toContain('margin-bottom')
  })

  it('a zero gap is a real instruction, not a missing one', () => {
    // Word treats an unstated `w:before` as no space at all, and the import
    // writes that 0 down. Rendering nothing for it would let the editor's own
    // default show through on the paragraphs the document is most specific
    // about.
    const html = render({
      type: 'paragraph',
      attrs: { spaceBefore: 0, spaceAfter: 0 },
      content: [{ type: 'text', text: 'the last line' }],
    })
    expect(html).toContain('padding-top: 0pt')
    expect(html).toContain('margin-bottom: 0pt')
  })
})

describe('a right-tabbed date and a ruled paragraph in the editor (2026-10-18)', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { ruled: true },
        content: [
          { type: 'text', text: 'Clover' },
          { type: 'rightTab' },
          { type: 'text', text: 'Aug 2026' },
        ],
      },
    ],
  }

  it('renders the tab as the spacer the stylesheet pushes the date with, and the rule', () => {
    const editor = new Editor({ content: doc, extensions: WORD_EDITOR_EXTENSIONS })
    const html = editor.getHTML()
    expect(html).toContain('data-right-tab')
    expect(html).toContain('data-ruled="true"')
    editor.destroy()
  })

  it('reads as a tab in getText, so the score and tailoring see two words, not one', () => {
    const editor = new Editor({ content: doc, extensions: WORD_EDITOR_EXTENSIONS })
    expect(editor.getText()).toBe('Clover\tAug 2026')
    editor.destroy()
  })

  it('survives a save: the JSON the editor writes back still holds the tab and the rule', () => {
    const editor = new Editor({ content: doc, extensions: WORD_EDITOR_EXTENSIONS })
    expect(editor.getJSON()).toMatchObject(doc)
    editor.destroy()
  })
})
