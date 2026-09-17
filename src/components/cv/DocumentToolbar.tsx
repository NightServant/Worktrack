'use client'

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { cn } from '@/lib/utils'
import { icons } from '@/components/icons'
import { Select } from '@/components/ui/select'
import {
  FONT_FAMILIES,
  FONT_SIZES,
  LINE_SPACINGS,
  RIBBON_GROUPS,
  STYLE_PRESETS,
  currentFontPt,
  currentLineHeight,
  type RibbonCommand,
} from './ribbonCommands'

/**
 * Word's Home ribbon.
 *
 * THE THIRD ATTEMPT, and the two before it missed the same thing: Word's
 * ribbon is TWO ROWS PER GROUP with a STYLES GALLERY, not one row of buttons
 * with a style dropdown. Gabe put the reference on screen twice before this
 * landed, so the corrections are worth recording rather than quietly fixing:
 *
 *   ATTEMPT 1 -- fourteen bare buttons in a single flat row. No font, no
 *   size, no groups at all.
 *   ATTEMPT 2 -- groups, but NINE of them, each captioned, still one row.
 *   That overflowed a 1200px column and clipped the last band, and Word has
 *   no "script" or "spacing" group to begin with.
 *   THIS ONE -- Font and Paragraph as two stacked rows, a real Styles
 *   gallery, no captions, three bands.
 *
 * THE TWO-ROW SHAPE IS ALSO WHAT MAKES IT FIT. The same controls in one line
 * needed ~1200px; stacked they need about half that, at the height the styles
 * gallery already sets.
 *
 * NO GROUP CAPTIONS, because the reference has none -- bands are told apart by
 * the vertical rule between them, which is what this design system reaches for
 * anyway.
 *
 * THE GALLERY SHOWS EACH STYLE IN ITS OWN TYPE, which is the one thing a
 * dropdown cannot do and the entire reason Word spends that much ribbon on it.
 * The active card takes an accent BORDER rather than a fill: it marks the
 * current action without turning a state into a filled block.
 */

/**
 * AND THE SECOND LAYOUT, for the phone dock (2026-09-13, Gabe on what shipped:
 * "what the hell is this").
 *
 * THE MEASUREMENT THAT FORCED IT, taken at 390x844 with the `format` tab open:
 *
 *   [data-ribbon-group=history]   0x0
 *   [data-ribbon-group=font]      420x94   (in a 366px panel -- it scrolled)
 *   [data-ribbon-group=paragraph] 0x0
 *   [data-ribbon-group=styles]    0x0
 *
 * One band out of four, overflowing sideways, inside a panel 379px tall. No
 * lists, no alignment, no styles, no undo, and ~261px of nothing under a 94px
 * toolbar.
 *
 * THE CAUSE IS THAT `visibility` IS A RIBBON RULE BEING READ IN A PANEL. Those
 * strings (`hidden lg:flex`, `hidden md:flex`) say "drop this band before the
 * bar overflows sideways", which is the right answer for a horizontal ribbon
 * pinned above a document and the wrong one for a vertical sheet the user
 * opened BY TAPPING `format`. So `stacked` ignores them outright: every band
 * renders, because in a column there is nothing to overflow and nothing to
 * protect the document from -- height is what the dock caps, not this.
 *
 * WHAT CHANGES, AND ONLY THIS:
 *   - bands are full-width sections down the panel, not columns across a bar;
 *   - the rule between them is a `border-t` hairline, the ribbon's vertical
 *     separator being meaningless once they are stacked;
 *   - rows `flex-wrap`, so a row too wide for 366px takes a second line
 *     instead of a horizontal scrollbar. `overflow-x-auto` appears nowhere in
 *     this mode except the styles gallery, which keeps it deliberately: the
 *     cards are 76px each and twelve of them wrapped would be a four-row block
 *     out of what is meant to be a strip you flick through.
 *
 * EACH STACKED BAND IS CAPTIONED, which is the one place this file disagrees
 * with Word and with its own docblock above. The reference prints no captions
 * because its bands are told apart by the vertical rule between them; a
 * vertical panel has no such cue -- `border-t` separates but does not name --
 * so without a caption the panel reads as one undifferentiated pile of
 * buttons. The caption earns its place HERE and nowhere else, and the ribbon
 * is untouched.
 *
 * `ribbon` IS THE DEFAULT so the desktop chrome renders exactly what it did
 * before this file gained a second mode.
 */
export type ToolbarLayout = 'ribbon' | 'stacked'

/**
 * The ribbon's dropdowns are `ui/select`, and the height is the only thing
 * this has to say about them.
 *
 * NO NATIVE `<select>` IN HERE ANY MORE. Three of them survived the 2026-09-05
 * move because they are small and the ribbon is dense -- but the option list
 * of a native select is drawn by macOS, so clicking font or size in a Word
 * ribbon rendered in black, white and orange opened a dark grey system panel
 * with system checkmarks. `ui/select` already owns that popup; these were the
 * last three controls that did not use it.
 *
 * The trigger ships at `h-10` for form rows. The ribbon runs at 28px, so each
 * one is handed the row height and the tighter padding, and wrapped in a fixed
 * width because the component is `w-full` by design.
 */
const TRIGGER = 'h-7 rounded-[4px] px-2 pr-2 text-body-s'

const BUTTON =
  'inline-flex h-7 min-w-7 items-center justify-center rounded-[4px] border px-1.5 ' +
  'text-body-s leading-none transition-colors duration-(--duration-fast) active:scale-[0.97] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-40'

function CommandButton({ command, editor }: { command: RibbonCommand; editor: Editor | null }) {
  const Icon = command.icon ? icons[command.icon] : null
  const Glyph = command.glyph
  const active = editor && command.isActive ? command.isActive(editor) : false
  const disabled = !editor || (command.isDisabled ? command.isDisabled(editor) : false)

  return (
    <button
      type="button"
      aria-label={command.label}
      aria-pressed={command.isActive ? active : undefined}
      title={command.shortcut ? `${command.label} (${command.shortcut})` : command.label}
      disabled={disabled}
      onClick={() => editor && command.run(editor)}
      className={cn(
        BUTTON,
        active
          ? 'border-accent-default bg-accent-default text-accent-on-accent'
          : 'border-border-default bg-bg-canvas text-text-secondary hover:bg-bg-inset'
      )}
    >
      {Glyph ? (
        <Glyph />
      ) : Icon ? (
        <Icon size={13} aria-hidden />
      ) : (
        <span aria-hidden>{command.text}</span>
      )}
    </button>
  )
}

/**
 * A band of the ribbon: stacked rows, with a rule before it.
 *
 * IN `stacked` IT IS A SECTION OF THE PANEL INSTEAD, and three things go:
 * `visibility` (the whole point -- see the 0x0 measurement above), the
 * vertical rule, and the 16px side padding that the dock's own `px-3` already
 * provides. The caption is the band's `id`, because every one of them --
 * history, font, paragraph, styles -- is already the word a person would use
 * for it, and a second `caption` prop would only be a chance for the two to
 * disagree.
 */
function Band({
  id,
  visibility,
  stacked,
  first,
  grow,
  children,
}: {
  id: string
  visibility: string
  stacked?: boolean
  first?: boolean
  /** Takes the remaining width. Exactly one band should. Ribbon only. */
  grow?: boolean
  children: React.ReactNode
}) {
  if (stacked) {
    return (
      <div
        data-ribbon-group={id}
        // `first:` rather than the `first` prop: in this mode the bands are
        // the only children and none of them is display:none, so the CSS
        // answer and the JS one agree. In the ribbon they do not -- `history`
        // is `hidden` below lg and still `:first-child` -- which is why that
        // branch keeps the prop.
        className="flex flex-col gap-1.5 border-t border-border-subtle py-2 first:border-t-0 first:pt-0"
      >
        <p className="text-label-caps uppercase text-text-muted">{id}</p>
        {children}
      </div>
    )
  }

  return (
    <div
      data-ribbon-group={id}
      className={cn(
        // ROOM TO BREATHE (Gabe, 2026-09-13: "unwanted space in the toolbar,
        // allow properties to breathe in desktop and laptop screens"). The
        // file commands left the ribbon for a menu in the same change, which
        // gave back about 500px; `px-5` and the wider row gap below spend part
        // of it on the bands themselves instead of leaving it as one gap at
        // the end of the bar.
        'flex-col justify-center gap-2 px-5',
        grow ? 'min-w-0 flex-1' : 'shrink-0',
        visibility,
        !first && 'border-l border-border-subtle'
      )}
    >
      {children}
    </div>
  )
}

const ROW = 'flex items-center gap-1.5'

export function DocumentToolbar({
  editor,
  layout = 'ribbon',
}: {
  editor: Editor | null
  layout?: ToolbarLayout
}) {
  // Re-render on selection and document change, so every `isActive` below
  // reflects the CARET rather than the last button anyone pressed. Without
  // this a ribbon lies the moment you click into differently formatted text.
  const [, force] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    if (!editor) return
    editor.on('selectionUpdate', force)
    editor.on('transaction', force)
    return () => {
      editor.off('selectionUpdate', force)
      editor.off('transaction', force)
    }
  }, [editor])

  const stacked = layout === 'stacked'
  // WRAPPING IS THE FIX FOR THE SIDEWAYS SCROLL, and it is safe here for the
  // reason it is not safe in the ribbon: a ribbon that grows a row eats the
  // document under it, while this panel is a surface you opened on purpose and
  // closes again on the next tap. Measured before: the font band's row 1 is
  // 420px of controls in a 366px panel.
  const row = cn(ROW, stacked && 'flex-wrap gap-y-1.5')

  const currentFamily = (editor?.getAttributes('textStyle').fontFamily as string | undefined) ?? ''
  const fontPt = currentFontPt(editor)
  const history = RIBBON_GROUPS[0]
  const [fontRow, markRow] = RIBBON_GROUPS[1].rows
  const paragraph = RIBBON_GROUPS[2]

  const bands: Record<string, React.ReactNode> = {
    history: (
      <Band key="history" id="history" visibility={history.visibility} stacked={stacked} first>
        {/* ONE ROW WHEN STACKED. History's "two rows" are one button each --
            a 2-deep column beside the ribbon's rule, which is correct there
            and reads as two orphaned lines in a captioned panel section. */}
        {(stacked ? [history.rows.flat()] : history.rows).map((commands, index) => (
          <div key={index} className={row}>
            {commands.map((command) => (
              <CommandButton key={command.id} command={command} editor={editor} />
            ))}
          </div>
        ))}
      </Band>
    ),

    /* FONT: the selects and size stepping above, the marks below --
       Word's arrangement exactly. */
    font: (
      <Band key="font" id="font" visibility="flex" stacked={stacked}>
        <div className={row}>
          <div className="w-[128px]">
            {/* THE PLACEHOLDER IS THE DOCUMENT'S OWN VALUE (found in review,
                2026-09-13). `Select` shows `placeholder` whenever `value`
                matches no item, and its default is the word `select` -- so a
                caret in imported text set in a face this list does not carry
                (mammoth hands back whatever the .docx declared) made the
                control read "select", which looks like an instruction rather
                than a report. Naming the face is the truth: this ribbon cannot
                offer it as an option, but it can say what it is. */}
            <Select
              aria-label="font"
              value={currentFamily}
              placeholder={currentFamily ? currentFamily.split(',')[0].replace(/["']/g, '') : '(default)'}
              disabled={!editor}
              onValueChange={(value) =>
                value
                  ? editor?.chain().focus().setFontFamily(value).run()
                  : editor?.chain().focus().unsetFontFamily().run()
              }
              items={[{ value: '', label: '(default)' }, ...FONT_FAMILIES]}
              className={TRIGGER}
            />
          </div>
          <div className="w-[76px]">
            {/* Same reason as the face above: `FONT_SIZES` is Word's list and
                an imported document is under no obligation to use it. 13pt and
                11.5pt are ordinary in a .docx; both would have read "select". */}
            <Select
              aria-label="font size"
              value={String(fontPt)}
              placeholder={String(fontPt)}
              disabled={!editor}
              onValueChange={(value) => editor?.chain().focus().setFontSize(`${value}pt`).run()}
              items={FONT_SIZES.map((size) => ({ value: size, label: size }))}
              className={TRIGGER}
            />
          </div>
          {fontRow.map((command) => (
            <CommandButton key={command.id} command={command} editor={editor} />
          ))}
        </div>
        <div className={row}>
          {markRow.map((command) => (
            <CommandButton key={command.id} command={command} editor={editor} />
          ))}
        </div>
      </Band>
    ),

    /* PARAGRAPH: lists and indents above, alignment below. */
    paragraph: (
      <Band key="paragraph" id="paragraph" visibility={paragraph.visibility} stacked={stacked}>
        <div className={row}>
          {paragraph.rows[0].map((command) => (
            <CommandButton key={command.id} command={command} editor={editor} />
          ))}
        </div>
        <div className={row}>
          {paragraph.rows[1].map((command) => (
            <CommandButton key={command.id} command={command} editor={editor} />
          ))}
          {/* `spacing` rather than the old bare ↕, which was a glyph chosen to
              fit a 52px native control and read as nothing at all to a screen
              reader. It means the paragraph's own spacing, so choosing it
              unsets the mark rather than setting a number. */}
          <div className="w-[76px]">
            <Select
              aria-label="line spacing"
              value={currentLineHeight(editor)}
              disabled={!editor}
              onValueChange={(value) =>
                value
                  ? editor?.chain().focus().setLineHeight(value).run()
                  : editor?.chain().focus().unsetLineHeight().run()
              }
              items={[
                { value: '', label: 'spacing' },
                ...LINE_SPACINGS.map((value) => ({ value, label: value })),
              ]}
              className={TRIGGER}
            />
          </div>
        </div>
      </Band>
    ),

    /* STYLES: the gallery, spanning the band's height as Word's does. */
    /* THE GALLERY TAKES THE REST OF THE BAR (Gabe, 2026-09-11: "toolbar has
       unused space at the right side"). It was capped at a fixed width,
       which left 341px empty at 1440 and 101px at 1200 -- measured, not
       guessed. Growing fills that AND is what Word does: a wider window
       shows more style cards rather than more blank ribbon. It still
       scrolls internally, so a narrow column shows fewer cards instead of
       pushing the other bands off. */
    styles: (
      <Band key="styles" id="styles" visibility="hidden lg:flex" stacked={stacked} grow>
        <div
          role="group"
          aria-label="styles"
          // THE ONE `overflow-x-auto` STACKED MODE KEEPS. Twelve 76px cards
          // wrapped at 366px is a four-row block, which turns a strip you
          // flick through into the tallest thing in the panel.
          className={cn('flex items-center gap-1 overflow-x-auto', !stacked && 'h-full')}
        >
          {STYLE_PRESETS.map((preset) => {
            const active = editor ? preset.isActive(editor) : false
            return (
              <button
                key={preset.id}
                type="button"
                aria-label={preset.label}
                aria-pressed={active}
                title={preset.label}
                disabled={!editor}
                onClick={() => editor && preset.apply(editor)}
                data-style-card={preset.id}
                className={cn(
                  'flex h-[46px] w-[76px] shrink-0 flex-col items-center justify-center gap-1',
                  'rounded-[4px] border px-1 transition-colors duration-(--duration-fast)',
                  'active:scale-[0.98] focus-visible:outline-none',
                  'focus-visible:ring-2 focus-visible:ring-accent-default/30',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                  active
                    ? 'border-accent-default bg-bg-surface'
                    : 'border-border-default bg-bg-canvas hover:bg-bg-inset'
                )}
              >
                {/* THE SAMPLE, SET IN THE STYLE IT APPLIES. This is the whole
                    reason the gallery is cards and not a dropdown. */}
                <span aria-hidden className={cn('leading-none text-text-primary', preset.preview)}>
                  AaBbCc
                </span>
                <span className="w-full truncate text-center text-[9px] leading-none text-text-muted">
                  {preset.label}
                </span>
              </button>
            )
          })}
        </div>
      </Band>
    ),
  }

  /**
   * HISTORY GOES LAST IN THE PANEL, not first.
   *
   * The ribbon's order is Word's, left to right. Stacked, the order is a
   * ranking instead, and the ribbon already published one: `visibility` drops
   * history first when width runs out, which is this file saying undo is the
   * most expendable band on the bar (it is ⌘Z regardless). So it sits at the
   * end, under the three a thumb came here for.
   */
  const order = stacked
    ? ['font', 'paragraph', 'styles', 'history']
    : ['history', 'font', 'paragraph', 'styles']

  return (
    <div
      role="toolbar"
      aria-label="formatting"
      aria-controls="document-sheet"
      // Ribbon: scrolls rather than clips when the column is narrower than the
      // bands. Wrapping is not the alternative there -- a ribbon that grows to
      // four rows eats the document it sits above.
      //
      // Stacked: a column, and NO horizontal scroll at any level. The panel
      // has a width and the rows reflow inside it.
      className={cn('flex min-w-0', stacked ? 'flex-col' : 'items-stretch overflow-x-auto')}
      data-document-toolbar
      data-toolbar-layout={layout}
    >
      {order.map((id) => bands[id])}
    </div>
  )
}
