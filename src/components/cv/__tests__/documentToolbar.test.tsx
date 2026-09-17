import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Editor } from '@tiptap/core'
import { chooseOption, selectedLabel } from '@/test/select'
import { DocumentToolbar } from '../DocumentToolbar'
import { WORD_EDITOR_EXTENSIONS } from '../editorExtensions'

/**
 * Driven against a REAL Tiptap editor rather than a mock, because the thing
 * worth testing is that each button actually changes the document. A mocked
 * editor would assert that a click calls a spy, which is true of a toolbar
 * wired to the wrong commands as well as a right one.
 */
function editorWith(html = '<p>hello world</p>') {
  // THE SAME EXTENSIONS THE REAL EDITOR SHIPS. A StarterKit-only editor
  // here made half the ribbon's commands 'not a function'.
  return new Editor({ content: html, extensions: WORD_EDITOR_EXTENSIONS })
}

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
  cleanup()
})

describe('the formatting ribbon', () => {
  it('applies the mark the button names, to the real document', async () => {
    editor = editorWith()
    editor.commands.selectAll()
    render(<DocumentToolbar editor={editor} />)

    await userEvent.click(screen.getByRole('button', { name: 'bold' }))
    expect(editor.isActive('bold')).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'underline' }))
    expect(editor.isActive('underline')).toBe(true)
  })

  it('carries Word\'s Home commands, including the ones that needed extensions', async () => {
    // Half of these had no extension installed before 2026-09-11, so the
    // ribbon could not have offered them honestly. This fails if a command is
    // dropped from the ribbon OR if its extension is removed from the editor.
    editor = editorWith()
    render(<DocumentToolbar editor={editor} />)

    for (const name of [
      'underline',
      'strikethrough',
      'subscript',
      'superscript',
      'highlight',
      'numbered list',
      'align left',
      'align centre',
      'align right',
      'justify',
      'block quote',
      'inline code',
      'clear formatting',
      'increase indent',
      'decrease indent',
      'grow font',
      'shrink font',
      'uppercase',
      'title case',
      'undo',
      'redo',
    ]) {
      expect(screen.getByRole('button', { name }), name).toBeInTheDocument()
    }
  })

  it('offers the two controls Word puts first, which the old ribbon lacked entirely', () => {
    // Font face and size are the most-reached-for controls in a word
    // processor and simply were not there: `@tiptap/extension-text-style` was
    // not installed, so there was nothing to call.
    editor = editorWith()
    render(<DocumentToolbar editor={editor} />)
    expect(screen.getByLabelText('font')).toBeInTheDocument()
    expect(screen.getByLabelText('font size')).toBeInTheDocument()
  })

  it('applies a font family to the real document', async () => {
    editor = editorWith()
    editor.commands.selectAll()
    render(<DocumentToolbar editor={editor} />)

    const user = userEvent.setup({ delay: null })
    await chooseOption(user, screen.getByLabelText('font'), 'Georgia')
    // Asserted on the DOCUMENT, not on the mark under the cursor: `focus()`
    // moves the selection, so `getAttributes` can read a caret that is no
    // longer inside the text that changed.
    expect(editor.getHTML()).toContain('Georgia, serif')
  })

  /**
   * THE MENU SAYS 18 AND THE DOCUMENT HAS TO BE SET IN 18 POINTS (Gabe,
   * 2026-09-17: "font size 18 looks small in my system").
   *
   * `FONT_SIZES` is Word's list, and Word's list is points -- but this control
   * wrote `18px`, which is 13.5pt. Every size in the menu came out a quarter
   * small, on screen and in the exported PDF, while the templates and the
   * .docx import had been writing points all along.
   */
  it("sets the size in points, because that is the unit the menu's numbers are", async () => {
    editor = editorWith()
    editor.commands.selectAll()
    render(<DocumentToolbar editor={editor} />)

    const user = userEvent.setup({ delay: null })
    const size = screen.getByLabelText('font size')
    await chooseOption(user, size, '18')
    expect(editor.getHTML()).toContain('font-size: 18pt')
    expect(editor.getHTML()).not.toContain('px')
    expect(selectedLabel(size)).toBe('18')
  })

  it('sets line spacing, and shows the spacing the caret is already in', async () => {
    // The control used to be uncontrolled with a bare ↕ option, so it never
    // reported anything -- it could only send. Being controlled is the part
    // worth a test: the value has to come back out of the document.
    editor = editorWith()
    editor.commands.selectAll()
    render(<DocumentToolbar editor={editor} />)

    const user = userEvent.setup({ delay: null })
    const spacing = screen.getByLabelText('line spacing')
    await chooseOption(user, spacing, '1.5')
    expect(editor.getHTML()).toContain('line-height: 1.5')
    expect(selectedLabel(spacing)).toBe('1.5')

    // `spacing` is the paragraph's own, which means unsetting the mark.
    await chooseOption(user, spacing, 'spacing')
    expect(editor.getHTML()).not.toContain('line-height')
  })

  it('names every group, which is what makes a ribbon findable', () => {
    // Word prints its group captions under each band, and they are the
    // difference between "the list buttons" being a place and being a shape
    // you have to recognise.
    editor = editorWith()
    const { container } = render(<DocumentToolbar editor={editor} />)
    const groups = [...container.querySelectorAll('[data-ribbon-group]')].map((g) =>
      g.getAttribute('data-ribbon-group')
    )
    // Word's bands, not the nine the second attempt printed across the bar.
    expect(groups).toEqual(expect.arrayContaining(['font', 'paragraph', 'styles']))
    expect(groups.length).toBeLessThanOrEqual(4)
  })

  it('reflects the cursor position, not just the last click', async () => {
    // `aria-pressed` has to track the DOCUMENT. A toolbar that only toggles
    // its own state lies the moment the caret moves into different text.
    editor = editorWith('<p><strong>bold text</strong></p>')
    editor.commands.selectAll()
    const { rerender } = render(<DocumentToolbar editor={editor} />)
    rerender(<DocumentToolbar editor={editor} />)

    expect(screen.getByRole('button', { name: 'bold' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('disables undo when there is nothing to undo', () => {
    editor = editorWith()
    render(<DocumentToolbar editor={editor} />)
    expect(screen.getByRole('button', { name: 'undo' })).toBeDisabled()
  })

  it('renders every control disabled, not absent, before the editor exists', () => {
    // The editor mounts asynchronously. A toolbar that renders nothing until
    // then makes the whole chrome jump once it arrives.
    render(<DocumentToolbar editor={null} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(10)
    for (const button of buttons) expect(button).toBeDisabled()
  })

  it('keeps text formatting at every width, and hides only what a shortcut covers', () => {
    // RESPONSIVENESS IS ASSERTED ON THE CLASSES because jsdom has no viewport.
    // The rule being protected: bold/italic and the headings are never hidden,
    // and anything that IS hidden has a keyboard shortcut, so narrow screens
    // lose a button rather than a capability.
    editor = editorWith()
    const { container } = render(<DocumentToolbar editor={editor} />)
    const groups = [...container.querySelectorAll('[data-ribbon-group]')]

    const always = groups.filter((g) => !g.className.includes('hidden'))
    const labels = always.flatMap((g) =>
      [...g.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
    )
    // Bold and italic survive at any width; the style select does too, because
    // heading level is the single most-used control in a CV.
    expect(labels).toEqual(expect.arrayContaining(['bold', 'italic']))
    expect(screen.getByLabelText('font')).toBeInTheDocument()

    // Undo is hidden on the smallest screens; it is ⌘Z regardless. Scoped to
    // the GROUP, because the button's nearest div is the row inside it.
    const undo = screen.getByRole('button', { name: 'undo' })
    expect(undo.getAttribute('title')).toContain('⌘Z')
    expect(undo.closest('[data-ribbon-group]')?.className).toContain('hidden')
  })

  it('is a labelled toolbar that points at the sheet it formats', () => {
    editor = editorWith()
    render(<DocumentToolbar editor={editor} />)
    const toolbar = screen.getByRole('toolbar', { name: 'formatting' })
    expect(toolbar).toHaveAttribute('aria-controls', 'document-sheet')
  })
})

describe('the styles gallery', () => {
  it('is CARDS with a live sample, not a dropdown', () => {
    // The one thing a `<select>` cannot do, and the entire reason Word spends
    // that much ribbon on it: seeing what a style looks like before choosing.
    const e = editorWith()
    const { container } = render(<DocumentToolbar editor={e} />)
    const cards = [...container.querySelectorAll('[data-style-card]')]
    expect(cards.length).toBeGreaterThan(4)
    for (const card of cards) {
      expect(card.textContent).toContain('AaBbCc')
    }
    e.destroy()
  })

  it('applies its style to the real document, and marks itself active', async () => {
    const e = editorWith('<p>hello</p>')
    const { rerender } = render(<DocumentToolbar editor={e} />)

    await userEvent.click(screen.getByRole('button', { name: 'Heading 1' }))
    expect(e.isActive('heading', { level: 2 })).toBe(true)

    rerender(<DocumentToolbar editor={e} />)
    expect(screen.getByRole('button', { name: 'Heading 1' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    e.destroy()
  })

  it('stacks each band two rows deep, which is what makes it a ribbon', () => {
    // The shape both earlier attempts missed. A single row of the same
    // controls overflowed a 1200px column; stacked they need about half.
    const e = editorWith()
    const { container } = render(<DocumentToolbar editor={e} />)
    const font = container.querySelector('[data-ribbon-group="font"]')!
    expect(font.children.length).toBe(2)
    e.destroy()
  })
})

/**
 * THE PHONE DOCK'S LAYOUT (Gabe, 2026-09-13: "what the hell is this").
 *
 * WHAT THIS PROTECTS is the measurement that caused it. At 390x844 with the
 * `format` tab open, `[data-ribbon-group]` read:
 *
 *   history 0x0 | font 420x94 (in a 366px panel) | paragraph 0x0 | styles 0x0
 *
 * One band of four, and that one scrolling sideways. The cause was the
 * ribbon's own `visibility` strings -- `hidden lg:flex`, `hidden md:flex` --
 * being obeyed inside a vertical panel, where there is no bar to overflow and
 * nothing to protect the document from.
 *
 * ASSERTED ON THE CLASSES, for the reason the responsiveness test above gives:
 * jsdom has no viewport, so `hidden lg:flex` and `flex` measure the same. The
 * class is the rule; the browser measurement is in the commit message.
 */
describe('the stacked layout, for the phone dock', () => {
  it('renders every band, because a panel has nothing to hide from', () => {
    editor = editorWith()
    const { container } = render(<DocumentToolbar editor={editor} layout="stacked" />)
    const groups = [...container.querySelectorAll('[data-ribbon-group]')]

    // Font first, history last: the ribbon drops history first when width runs
    // out, which is this codebase already saying undo is the most expendable
    // band on the bar.
    expect(groups.map((g) => g.getAttribute('data-ribbon-group'))).toEqual([
      'font',
      'paragraph',
      'styles',
      'history',
    ])
    for (const group of groups) {
      expect(group.className, group.getAttribute('data-ribbon-group')!).not.toContain('hidden')
    }
  })

  it('reflows its rows instead of scrolling sideways', () => {
    // The font band's first row is 420px of controls in a 366px panel. Wrapping
    // is what the ribbon cannot do (a fourth row there eats the document) and
    // what a panel you opened on purpose can.
    editor = editorWith()
    const { container } = render(<DocumentToolbar editor={editor} layout="stacked" />)
    const root = container.querySelector('[data-document-toolbar]')!
    expect(root.className).toContain('flex-col')
    expect(root.className).not.toContain('overflow-x-auto')

    const rows = [...container.querySelectorAll('[data-ribbon-group="paragraph"] > div')]
    expect(rows.length).toBe(2)
    for (const row of rows) expect(row.className).toContain('flex-wrap')
  })

  it('keeps the styles gallery a strip, the one thing that still scrolls sideways', () => {
    // Twelve 76px cards wrapped at 366px is a four-row block out of something
    // meant to be flicked through.
    editor = editorWith()
    render(<DocumentToolbar editor={editor} layout="stacked" />)
    expect(screen.getByRole('group', { name: 'styles' }).className).toContain('overflow-x-auto')
  })

  it('captions each band, which the ribbon deliberately does not', () => {
    // Word tells its bands apart with the vertical rule between them. Stacked
    // there is no rule, only a hairline, and a hairline separates without
    // naming -- so the caption earns its place here and only here.
    editor = editorWith()
    const { container } = render(<DocumentToolbar editor={editor} layout="stacked" />)
    for (const id of ['font', 'paragraph', 'styles', 'history']) {
      const caption = container.querySelector(`[data-ribbon-group="${id}"] > p`)
      expect(caption?.textContent, id).toBe(id)
    }

    cleanup()
    editor.destroy()
    editor = editorWith()
    const ribbon = render(<DocumentToolbar editor={editor} />).container
    expect(ribbon.querySelectorAll('[data-ribbon-group] > p').length).toBe(0)
  })

  it('gives undo and redo one row rather than two of one button', () => {
    // History's "two rows" are one button each: a 2-deep column beside the
    // ribbon's rule, and two orphaned lines in a captioned panel section.
    editor = editorWith()
    const { container } = render(<DocumentToolbar editor={editor} layout="stacked" />)
    const rows = [...container.querySelectorAll('[data-ribbon-group="history"] > div')]
    expect(rows.length).toBe(1)
    expect(rows[0].querySelectorAll('button').length).toBe(2)
  })

  it('leaves the ribbon exactly as it was when nothing is passed', () => {
    // `ribbon` is the default so the desktop chrome renders what it always did.
    editor = editorWith()
    const { container } = render(<DocumentToolbar editor={editor} />)
    const root = container.querySelector('[data-document-toolbar]')!
    expect(root.className).toContain('overflow-x-auto')
    expect(root.className).not.toContain('flex-col')
    expect(
      container.querySelector('[data-ribbon-group="history"]')!.className
    ).toContain('hidden lg:flex')
  })
})
