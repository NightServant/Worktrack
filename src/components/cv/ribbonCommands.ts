import type { ComponentType } from 'react'
import type { Editor } from '@tiptap/core'
import type { IconName } from '@/components/icons'
import {
  AlignCenterGlyph,
  AlignLeftGlyph,
  AlignRightGlyph,
  BulletListGlyph,
  HighlightGlyph,
  IndentGlyph,
  JustifyGlyph,
  OrderedListGlyph,
  OutdentGlyph,
} from './ribbonGlyphs'

/**
 * Word's Home tab, as data, in Word's own shape.
 *
 * TWO ROWS PER GROUP. That is the single most defining thing about Word's
 * ribbon and the first two attempts both missed it -- they laid everything
 * out in one long line, which is a toolbar, not a ribbon. Font is two rows of
 * six-to-eight controls; Paragraph is two rows of five. It is also what makes
 * the bar FIT: the same controls in one row overflowed a 1200px column, and in
 * two rows they occupy half the width at the same height as the styles
 * gallery beside them.
 *
 * NO GROUP CAPTIONS. The reference (Word for Mac, Home tab) prints none --
 * groups are told apart by the vertical rule between them and nothing else.
 * The previous version captioned every band, which added a row of nine
 * uppercase labels that Word does not have.
 *
 * WHAT THE DESIGN SYSTEM CHANGES, AND WHAT IT DOES NOT. Word raises its
 * buttons and bands its groups in gradients; none of that survives, and none
 * of it is what makes a ribbon legible. What survives is the STRUCTURE -- the
 * same commands, in the same groups, in the same two-row arrangement, with a
 * hairline where Word draws a separator. Controls are capped at 4px, nothing
 * has a shadow, and the accent marks the ACTIVE format only, which is exactly
 * the "current action" the accent is reserved for.
 *
 * WHAT IS DELIBERATELY ABSENT, so the gaps read as decisions:
 *   CLIPBOARD (paste, cut, copy, format painter). Browsers do not let a page
 *   read the clipboard without a permission prompt, so a Paste button would
 *   be a button that sometimes cannot paste. Cmd-V already works and always
 *   will.
 *   SHADING, BORDERS, SORT, MULTILEVEL LIST, TEXT EFFECTS. No extension backs
 *   any of them, and a control that calls nothing is worse than no control.
 */

export interface RibbonCommand {
  id: string
  label: string
  /** Rendered when there is no icon or glyph: the letter IS the control. */
  text?: string
  icon?: IconName
  /** A drawn mark, for the things the icon set has no word for. */
  glyph?: ComponentType
  shortcut?: string
  run: (editor: Editor) => void
  isActive?: (editor: Editor) => boolean
  isDisabled?: (editor: Editor) => boolean
}

export interface RibbonGroup {
  id: string
  /**
   * Lowest breakpoint at which the group appears.
   *
   * RESPONSIVENESS IS DROPPING GROUPS, NOT WRAPPING THEM: on a phone the
   * sheet is the point, and a ribbon that grows to four rows eats the
   * document it sits above. Font is never dropped; everything droppable has a
   * keyboard shortcut, so a narrow screen loses a button and not a capability.
   */
  visibility: string
  /** Word stacks its controls two deep. Each entry is one row. */
  rows: RibbonCommand[][]
}

/** Word's own face list, trimmed to what a CV is ever set in. */
export const FONT_FAMILIES = [
  { label: 'Aptos (Body)', value: 'Aptos, Calibri, system-ui, sans-serif' },
  { label: 'Calibri', value: 'Calibri, system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Garamond', value: 'Garamond, Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
]

/** Word's size dropdown. */
export const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36']

export const LINE_SPACINGS = ['1', '1.15', '1.5', '2']

/** Word's default body size, and what grow/shrink step from when none is set. */
export const DEFAULT_FONT_PT = 12

/**
 * The size under the caret, IN POINTS, which is what the dropdown says.
 *
 * THE BUG THIS FIXES (Gabe, 2026-09-17: "font size 18 looks small in my
 * system"). `FONT_SIZES` is Word's list -- 8 through 36 -- and Word's list is
 * points, but this control wrote `18px`. A CSS pixel is 1/96in against a
 * point's 1/72, so picking 18 set the text at 13.5pt: every size in the menu
 * came out a quarter small, and the PDF faithfully reproduced the wrong
 * number because `toPoints` converted the px it was given. Nothing else in the
 * app spoke pixels -- the templates state `documentTypography.fontSize` in
 * points and the .docx import writes `${pt}pt` marks -- so this control was
 * the only pixel in a document measured in points.
 *
 * A `px` VALUE IS STILL READ, and converted rather than believed: text sized
 * by this control before today carries one, and reporting `18` for something
 * drawing 13.5 is the same lie in the other direction.
 */
export function currentFontPt(editor: Editor | null): number {
  const raw = String(editor?.getAttributes('textStyle').fontSize ?? '').trim()
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FONT_PT
  return raw.toLowerCase().endsWith('px') ? parsed * 0.75 : parsed
}

/**
 * The spacing under the caret, or `''` for the document's own.
 *
 * READ OFF THE `textStyle` MARK, because that is where the LineHeight
 * extension writes it: a global attribute on `textStyle`, rendered as an
 * inline `line-height`, not an attribute on the paragraph. Empty means no mark
 * sets one, so the sheet's own spacing applies -- which is a real choice in
 * the dropdown and not merely "nothing selected".
 */
export function currentLineHeight(editor: Editor | null): string {
  const raw = editor?.getAttributes('textStyle').lineHeight as string | undefined
  return raw ? String(raw) : ''
}

/** Word's A↑ / A↓ walk the size list rather than adding a fixed amount. */
function stepFontSize(editor: Editor, direction: 1 | -1) {
  const sizes = FONT_SIZES.map(Number)
  const current = currentFontPt(editor)
  const index = sizes.findIndex((s) => s >= current)
  const at = index === -1 ? sizes.length - 1 : index
  const next = sizes[Math.min(sizes.length - 1, Math.max(0, at + direction))]
  editor.chain().focus().setFontSize(`${next}pt`).run()
}

/**
 * Word's `Aa` button, which has no Tiptap command behind it.
 *
 * Implemented as a read-transform-write over the selection: take the selected
 * text, case it, and put it back. `insertContent` rather than a mark, because
 * case is not a mark -- it is the characters themselves, which is also why
 * undo treats it as one edit like any other typing.
 */
export type CaseMode = 'upper' | 'lower' | 'title'

export function applyCase(editor: Editor, mode: CaseMode) {
  const { from, to, empty } = editor.state.selection
  if (empty) return
  const text = editor.state.doc.textBetween(from, to, ' ')
  if (!text) return

  const cased =
    mode === 'upper'
      ? text.toUpperCase()
      : mode === 'lower'
        ? text.toLowerCase()
        : text.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())

  editor.chain().focus().insertContentAt({ from, to }, cased).run()
}

export const RIBBON_GROUPS: RibbonGroup[] = [
  {
    /**
     * UNDO/REDO, WHICH WORD PUTS IN THE TITLE BAR AND NOT IN HOME.
     *
     * A deliberate deviation from the reference, and the reason is that this
     * app's title row is already full -- versions, reset, two exports, save,
     * delete -- so there is nowhere to put Word's Quick Access Toolbar. The
     * alternative was no visible undo at all, which for a web editor is a
     * real loss: a document people do not think of as "a file" is one they
     * expect a visible undo for. Dropped first at narrow widths, because
     * Cmd-Z works regardless.
     */
    id: 'history',
    visibility: 'hidden lg:flex',
    rows: [
      [{ id: 'undo', label: 'undo', icon: 'RotateCcw', shortcut: '⌘Z', run: (e) => e.chain().focus().undo().run(), isDisabled: (e) => !e.can().undo() }],
      [{ id: 'redo', label: 'redo', icon: 'ArrowRight', shortcut: '⇧⌘Z', run: (e) => e.chain().focus().redo().run(), isDisabled: (e) => !e.can().redo() }],
    ],
  },
  {
    id: 'font',
    // NEVER HIDDEN. If one group survives at 320px it is this one.
    visibility: 'flex',
    rows: [
      // Row 1 is the SELECTS plus size stepping; the component renders the
      // two dropdowns and splices these in beside them, as Word does.
      [
        { id: 'grow', label: 'grow font', text: 'A▲', run: (e) => stepFontSize(e, 1) },
        { id: 'shrink', label: 'shrink font', text: 'A▼', run: (e) => stepFontSize(e, -1) },
        { id: 'upper', label: 'uppercase', text: 'AA', run: (e) => applyCase(e, 'upper'), isDisabled: (e) => e.state.selection.empty },
        { id: 'title', label: 'title case', text: 'Aa', run: (e) => applyCase(e, 'title'), isDisabled: (e) => e.state.selection.empty },
        { id: 'clear', label: 'clear formatting', icon: 'Close', run: (e) => e.chain().focus().unsetAllMarks().clearNodes().run() },
      ],
      [
        { id: 'bold', label: 'bold', text: 'B', shortcut: '⌘B', run: (e) => e.chain().focus().toggleBold().run(), isActive: (e) => e.isActive('bold') },
        { id: 'italic', label: 'italic', text: 'I', shortcut: '⌘I', run: (e) => e.chain().focus().toggleItalic().run(), isActive: (e) => e.isActive('italic') },
        { id: 'underline', label: 'underline', text: 'U', shortcut: '⌘U', run: (e) => e.chain().focus().toggleUnderline().run(), isActive: (e) => e.isActive('underline') },
        { id: 'strike', label: 'strikethrough', text: 'S', run: (e) => e.chain().focus().toggleStrike().run(), isActive: (e) => e.isActive('strike') },
        { id: 'sub', label: 'subscript', text: 'X₂', run: (e) => e.chain().focus().toggleSubscript().run(), isActive: (e) => e.isActive('subscript') },
        { id: 'sup', label: 'superscript', text: 'X²', run: (e) => e.chain().focus().toggleSuperscript().run(), isActive: (e) => e.isActive('superscript') },
        { id: 'highlight', label: 'highlight', glyph: HighlightGlyph, run: (e) => e.chain().focus().toggleHighlight().run(), isActive: (e) => e.isActive('highlight') },
      ],
    ],
  },
  {
    id: 'paragraph',
    visibility: 'hidden md:flex',
    rows: [
      [
        { id: 'bullets', label: 'bulleted list', glyph: BulletListGlyph, run: (e) => e.chain().focus().toggleBulletList().run(), isActive: (e) => e.isActive('bulletList') },
        { id: 'ordered', label: 'numbered list', glyph: OrderedListGlyph, run: (e) => e.chain().focus().toggleOrderedList().run(), isActive: (e) => e.isActive('orderedList') },
        // Indent is a LIST operation here and nothing else, so it is disabled
        // outside one rather than silently doing nothing.
        { id: 'outdent', label: 'decrease indent', glyph: OutdentGlyph, run: (e) => e.chain().focus().liftListItem('listItem').run(), isDisabled: (e) => !e.can().liftListItem('listItem') },
        { id: 'indent', label: 'increase indent', glyph: IndentGlyph, run: (e) => e.chain().focus().sinkListItem('listItem').run(), isDisabled: (e) => !e.can().sinkListItem('listItem') },
        { id: 'quote', label: 'block quote', text: '❝', run: (e) => e.chain().focus().toggleBlockquote().run(), isActive: (e) => e.isActive('blockquote') },
      ],
      [
        { id: 'left', label: 'align left', glyph: AlignLeftGlyph, run: (e) => e.chain().focus().setTextAlign('left').run(), isActive: (e) => e.isActive({ textAlign: 'left' }) },
        { id: 'center', label: 'align centre', glyph: AlignCenterGlyph, run: (e) => e.chain().focus().setTextAlign('center').run(), isActive: (e) => e.isActive({ textAlign: 'center' }) },
        { id: 'right', label: 'align right', glyph: AlignRightGlyph, run: (e) => e.chain().focus().setTextAlign('right').run(), isActive: (e) => e.isActive({ textAlign: 'right' }) },
        { id: 'justify', label: 'justify', glyph: JustifyGlyph, run: (e) => e.chain().focus().setTextAlign('justify').run(), isActive: (e) => e.isActive({ textAlign: 'justify' }) },
        { id: 'code', label: 'inline code', icon: 'Code', run: (e) => e.chain().focus().toggleCode().run(), isActive: (e) => e.isActive('code') },
      ],
    ],
  },
]

/**
 * The Styles gallery.
 *
 * CARDS WITH A LIVE PREVIEW, not a dropdown, because that is what the gallery
 * IS -- "AaBbCcDdE" set in the style it applies, with the name underneath.
 * The previous version collapsed all of this into a `<select>`, which loses
 * the one thing the gallery is for: seeing what a style looks like before
 * choosing it. `preview` carries the type treatment for each card.
 */
export interface StylePreset {
  id: string
  label: string
  /** Classes applied to the "AaBbCcDdE" sample so the card shows the style. */
  preview: string
  apply: (editor: Editor) => void
  isActive: (editor: Editor) => boolean
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'normal',
    label: 'Normal',
    preview: 'text-[11px] font-normal',
    apply: (e) => e.chain().focus().setParagraph().run(),
    isActive: (e) => e.isActive('paragraph') && !e.isActive('blockquote'),
  },
  {
    id: 'title',
    label: 'Title',
    preview: 'text-[15px] font-bold tracking-tight',
    apply: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    isActive: (e) => e.isActive('heading', { level: 1 }),
  },
  {
    id: 'heading1',
    label: 'Heading 1',
    preview: 'text-[13px] font-semibold',
    apply: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (e) => e.isActive('heading', { level: 2 }),
  },
  {
    id: 'heading2',
    label: 'Heading 2',
    preview: 'text-[12px] font-medium',
    apply: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (e) => e.isActive('heading', { level: 3 }),
  },
  {
    id: 'emphasis',
    label: 'Emphasis',
    preview: 'text-[11px] italic',
    apply: (e) => e.chain().focus().toggleItalic().run(),
    isActive: (e) => e.isActive('italic'),
  },
  {
    id: 'strong',
    label: 'Strong',
    preview: 'text-[11px] font-bold',
    apply: (e) => e.chain().focus().toggleBold().run(),
    isActive: (e) => e.isActive('bold'),
  },
  {
    id: 'quote',
    label: 'Quote',
    preview: 'text-[11px] italic text-text-muted',
    apply: (e) => e.chain().focus().toggleBlockquote().run(),
    isActive: (e) => e.isActive('blockquote'),
  },
  // The rest of Word's gallery, and they are here for a reason beyond
  // completeness: once the gallery stopped being capped it grew to fill the
  // ribbon, and seven cards left the band stretched over empty space. Word's
  // gallery has twelve. These are the ones this editor can actually apply.
  {
    id: 'subtitle',
    label: 'Subtitle',
    preview: 'text-[11px] tracking-wide text-text-secondary',
    apply: (e) => e.chain().focus().setParagraph().setFontSize('14pt').run(),
    isActive: () => false,
  },
  {
    id: 'subtle',
    label: 'Subtle Emph.',
    preview: 'text-[11px] italic text-text-muted',
    apply: (e) => e.chain().focus().toggleItalic().setColor('#71717a').run(),
    isActive: () => false,
  },
  {
    id: 'intense',
    label: 'Intense Emph.',
    preview: 'text-[11px] font-semibold italic text-accent-default',
    apply: (e) => e.chain().focus().toggleItalic().toggleBold().run(),
    isActive: (e) => e.isActive('italic') && e.isActive('bold'),
  },
  {
    id: 'nospacing',
    label: 'No Spacing',
    preview: 'text-[11px] leading-none',
    apply: (e) => e.chain().focus().setParagraph().setLineHeight('1').run(),
    isActive: () => false,
  },
  {
    id: 'code',
    label: 'Code',
    preview: 'font-mono text-[10px]',
    apply: (e) => e.chain().focus().toggleCode().run(),
    isActive: (e) => e.isActive('code'),
  },
]
