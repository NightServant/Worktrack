'use client'

import * as React from 'react'
import { flushSync } from 'react-dom'
import { AppDialog } from '@/components/ui/app-dialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  DocumentsIcon,
  ExternalIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/icons'
import { ICON_MOTION_GROUP, iconMotion } from '@/components/icons/motion'
import { cn } from '@/lib/utils'
import {
  addSection,
  parsePosting,
  removeSection,
  replaceSectionBody,
  sectionTitle,
  type PostingSection,
} from './postingSections'

/**
 * The posting itself: a preview beside the record, and a document of its own.
 *
 * THERE IS NO `tidy and summarise` BUTTON (Gabe, 2026-09-10: "the model
 * auto-summarizes the job description"). The add wizard runs the digest on
 * every posting it fetches, so by the time a description reaches a record it
 * has already been tidied and summarised -- a button asking for it again was
 * offering work that had been done.
 *
 * THERE IS NO SUMMARY BLOCK ANY MORE (Gabe, 2026-09-14: "I highly request to
 * remove the job summary section specifically in the job description of the
 * application preview dialog"), and the reason it had stopped earning its
 * place is worth keeping. The digest now returns the posting RESTRUCTURED --
 * it opens with `Role overview:`, which is the same two sentences the summary
 * rule printed, written from the same source by the same model. A labelled
 * blurb above a section that says it again is the same information twice, 40px
 * apart, and the reader has to notice they are the same before they can stop
 * reading one of them.
 *
 * It was never stored either: `jobs` has no column for it, so a record opened
 * the next day showed the posting without it -- one more reason the structure
 * is the better home for it than a block that only ever existed in the add
 * flow.
 *
 * IT IS NOT A TEXTAREA AT REST (Gabe, 2026-09-09: "Remove the text area but
 * display the job description with proper format"). A scraped posting has
 * headings, bullets and paragraphs, and a textarea flattens all three.
 *
 * IT HAS TWO SIZES. Passing `onReadMore` makes this the PREVIEW under the
 * record's second column -- the first few blocks, read-only, and a control
 * that opens the posting's own view of the dialog. Leaving it off is the full
 * view, which is where the posting is read and written.
 *
 * THE FULL VIEW IS SECTIONS NOW, AND THAT IS THE WHOLE CHANGE (Gabe,
 * 2026-09-13: "implement section layout for the job description with proper
 * titles -- make sure each title has an edit CTA at the farthest right").
 * Before this it was one run of blocks that became ONE textarea holding the
 * entire advert, so changing a bullet under `key responsibilities` meant
 * hunting for it inside eight hundred words of plain text and risking the
 * other nine sections on every keystroke. Each section is now addressable:
 * `postingSections` finds where it starts and ends, `edit` on its title turns
 * that section alone into a field, and `replaceSectionBody` writes it back
 * with its neighbours byte-identical.
 *
 * WHAT AN EDIT COVERS IS THE BODY, NOT THE HEADING. A field that contained its
 * own title would have to hide the title row it sits under, which is the one
 * piece of orientation somebody editing a long advert has. Renaming a section
 * is rare; if it is ever asked for, the field is the place to widen, not the
 * title row.
 *
 * `postingBlocks` renders a body and invents nothing: it groups lines that are
 * already there. The tidying that produced those lines is
 * `services/postingFormat`, which runs before anything is stored.
 */
export interface RecordDescriptionProps {
  value: string
  onChange: (value: string) => void
  /**
   * Opens the posting's own view. PRESENT MEANS PREVIEW.
   *
   * One prop rather than a `variant`, because there is exactly one thing a
   * preview can do that the full text cannot, and it is this.
   */
  onReadMore?: () => void
  /**
   * The full view's heading is the DIALOG's title, so it suppresses this one.
   * Printing `job description` twice, 40px apart, is the duplicate header Gabe
   * had removed from this dialog once already.
   */
  showHeading?: boolean
  /**
   * Back to the record. Present only on the posting's own view of the dialog,
   * and what makes the control row below render at all.
   */
  onBack?: () => void
  /** The employer's own page. Opens in a new tab from the control row. */
  postingUrl?: string | null
  className?: string
}

/**
 * A posting body, rendered as the document it is.
 *
 * THE RULES ARE MECHANICAL, deliberately -- this is a view, and a view that
 * guesses at meaning is a view that will one day be wrong about somebody's job
 * advert. A line is a bullet if it starts with a bullet glyph or a number;
 * otherwise it is a paragraph. Nothing is reordered, reworded or dropped.
 *
 * Consecutive bullets collapse into one list, which is the only structural
 * claim made here and the one that matters: eight `<p>` elements each starting
 * with a dash is not a list, it just looks like one until you copy it.
 *
 * HEADINGS ARE NOT ITS JOB IN THE FULL VIEW: `postingSections` takes those out
 * before this sees the text. The preview still feeds it the whole posting, so
 * the heading case stays.
 */
function postingBlocks(text: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = []
  const lines = text.split(/\r?\n/)
  let bullets: string[] = []

  const flush = (key: number) => {
    if (bullets.length === 0) return
    blocks.push(
      <ul
        key={`ul-${key}`}
        className="flex list-disc flex-col gap-1 pl-5 text-body-m text-text-secondary"
      >
        {bullets.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    )
    bullets = []
  }

  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line) {
      flush(index)
      return
    }
    const bullet = line.match(/^(?:[-–—•·*]|\d+[.)])\s+(.*)$/)
    if (bullet) {
      bullets.push(bullet[1])
      return
    }
    flush(index)
    // A heading is short and ends in a colon. Long lines ending in a colon are
    // sentences that happen to introduce something, and setting them in bold
    // would emphasise a paragraph rather than name a section.
    if (line.length <= 80 && line.endsWith(':')) {
      blocks.push(
        <h4 key={index} className="text-label-caps uppercase text-text-secondary">
          {line.replace(/:$/, '')}
        </h4>
      )
      return
    }
    blocks.push(
      <p key={index} className="text-body-m text-text-secondary">
        {line}
      </p>
    )
  })
  flush(lines.length)

  return blocks
}

/**
 * ONE SECTION: its title, its edit control, and its body or its field.
 *
 * THE CONTROL IS ON THE TITLE ROW, AT THE FAR RIGHT, which is what was asked
 * for and is also the only place it can go without moving: a control under the
 * body would sit at a different height for every section, so the eye would
 * have to find it again each time.
 *
 * ONE PER ROW. These briefly flowed into newspaper columns to use the width of
 * a 1680px dialog; Gabe read it back and asked for the plain vertical document
 * instead (2026-09-13: "I prefer vertical scrolling in the job description --
 * not column behavior, row behavior"). He is right about the reading: columns
 * mean the eye has to find the top of the next one, and a section you are
 * editing can be half a screen from the field you typed into. The width is
 * answered by the dialog being narrower now, not by splitting the text.
 */
function Section({
  section,
  index,
  editing,
  onEdit,
  onDone,
  onChangeBody,
  onDelete,
}: {
  section: PostingSection
  index: number
  editing: boolean
  onEdit: () => void
  onDone: () => void
  onChangeBody: (body: string) => void
  onDelete: () => void
}) {
  // `overview` for the run of text before the first heading. It needs a title
  // because it needs an edit control, and an untitled row with a button on it
  // reads as a control belonging to whatever is above it.
  const title = section.heading ? sectionTitle(section.heading) : 'overview'
  const fieldId = `posting-section-${index}`

  return (
    <section
      data-posting-section
      className="flex flex-col gap-2"
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-4 border-b border-border-subtle pb-1.5">
        <h4 className="min-w-0 truncate text-label-caps uppercase text-text-secondary">{title}</h4>
        {/* EDIT, THEN DELETE, and the order is the safety (Gabe, 2026-09-13:
            "add delete CTA after edit"). The harmless action leads and the
            destructive one follows, the same arrangement the applications
            table uses for `view` / `delete`.

            THE DANGER TREATMENT IS `DangerZone`'S, not a new one: the rejected
            hue on a ghost button. This system paints destructive intent in
            that colour and reserves the accent for "the current action", so a
            filled red control here would shout louder than Save does.

            THE ACCESSIBLE NAMES CARRY THE SECTION. Eight buttons all
            announcing "edit" is a list nobody can navigate, and each label
            opens with the visible word so the name still contains it
            (WCAG 2.5.3). */}
        <div className="flex shrink-0 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="s"
            className="px-0"
            aria-label={`${editing ? 'done editing' : 'edit'} ${title}`}
            onClick={editing ? onDone : onEdit}
            aria-expanded={editing}
            aria-controls={fieldId}
          >
            {editing ? (
              <CheckIcon size={16} aria-hidden className={iconMotion('none')} />
            ) : (
              <PencilIcon size={16} aria-hidden className={iconMotion('edit')} />
            )}
            {editing ? 'done' : 'edit'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="s"
            className="px-0 text-status-rejected-mark hover:text-status-rejected-mark"
            aria-label={`delete ${title}`}
            onClick={onDelete}
          >
            <TrashIcon size={16} aria-hidden className={iconMotion('lid')} />
            delete
          </Button>
        </div>
      </div>

      {editing ? (
        <Textarea
          id={fieldId}
          aria-label={`${title} text`}
          value={section.body}
          onChange={(e) => onChangeBody(e.target.value)}
          autoFocus
          autoSize
          className="min-h-32"
          placeholder="what this section says."
        />
      ) : section.body.trim() ? (
        <div className="flex flex-col gap-3">{postingBlocks(section.body)}</div>
      ) : (
        <p className="text-body-s text-text-muted">nothing under this heading yet.</p>
      )}
    </section>
  )
}

/**
 * NAMING THE SECTION BEFORE IT EXISTS (Gabe, 2026-09-18: "no pop-up dialog for
 * naming a section ... this dialog must be used to name a particular section").
 *
 * WHAT IT REPLACES. `add a new section` appended a section literally called
 * `New section` and dropped the reader straight into its body field, so every
 * posting that used the control ended up with a heading nobody had asked for
 * and no way to change it -- the edit control opens the BODY, never the
 * heading, which is the one thing this screen cannot rename. A placeholder
 * heading in a document that cannot rename headings is a permanent placeholder.
 *
 * A DIALOG RATHER THAN AN INLINE FIELD, and that is the ask rather than a
 * preference -- but it is also the shape that survives the surface it opens
 * over: the posting is a scrolling document eight hundred words long, and an
 * inline row at the end of it is a field somebody has to scroll to find after
 * pressing a control at the top.
 *
 * IT IS A SECOND MODAL OVER THE RECORD, which this file's neighbours are
 * careful about: `AddApplicationDialog` says plainly that a failed read must
 * not open one, because that failure arrived unasked. This one is asked for --
 * it opens on a press, it holds one field, and closing it puts the reader back
 * exactly where they were. Base UI stacks it above the record and gives the
 * inner dialog Escape first, so the posting's own `Escape means back` is
 * untouched while this is open.
 */
function NameSectionDialog({
  open,
  onOpenChange,
  onAdd,
  fieldId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (name: string) => void
  /** The field this dialog is about to create, for focus on the way out. */
  fieldId: string
}) {
  const [name, setName] = React.useState('')
  const [error, setError] = React.useState('')

  // Empty on every open, not on every close: a dialog that clears as it
  // animates out is a field blanking in front of the reader.
  React.useEffect(() => {
    if (open) {
      setName('')
      setError('')
    }
  }, [open])

  const submit = () => {
    // THE ONE RULE WORTH ENFORCING. Everything else about a heading is
    // normalised by `addSection`; a heading with no text in it is the one
    // thing it cannot fix, and it would render as a rule with nothing above
    // it and an edit control belonging to whatever came before.
    if (!name.trim()) {
      setError('Give the section a name.')
      return
    }
    // FLUSHED, SO THE FIELD EXISTS BEFORE THE DIALOG ASKS WHERE FOCUS GOES.
    // Base UI reads `finalFocus` while handling this very click, and React
    // would otherwise batch the new section into the same commit as the close
    // -- so the lookup ran against a DOM that did not have the section yet,
    // returned null, and focus fell back to the record's own trigger, a
    // control BEHIND the dialog. Measured in the browser, twice.
    flushSync(() => onAdd(name))
    onOpenChange(false)
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="name the section"
      icon="Documents"
      description="It becomes the heading above the text you are about to write."
      // INTO THE FIELD IT JUST CREATED, not back to the control that opened
      // this. Base UI's default returns focus to what the record had before
      // the dialog, which is a control BEHIND the record dialog -- measured in
      // the browser, it landed on the applications table's row button. Cancel
      // finds nothing under this id and falls back to that default, which is
      // correct there: nothing was created, so there is nowhere else to be.
      finalFocus={() => document.getElementById(fieldId)}
    >
      <div className="flex flex-col gap-4" data-posting-name-dialog>
        <Field
          id="posting-section-name"
          label="section name"
          hint="what this part of the posting is about — responsibilities, benefits, how to apply."
        >
          <Input
            id="posting-section-name"
            value={name}
            autoFocus
            onChange={(event) => {
              setName(event.target.value)
              setError('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
            error={error || undefined}
            placeholder="benefits"
          />
        </Field>

        {/* THE ORDER THE REST OF THE APP USES: the way out on the left, the
            thing this dialog is for on the right, and only the second one is
            filled. See ConfirmDialog. */}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" size="s" onClick={() => onOpenChange(false)}>
            <CloseIcon size={16} aria-hidden className={iconMotion('none')} />
            cancel
          </Button>
          <Button type="button" size="s" onClick={submit} data-posting-name-confirm>
            <PlusIcon size={16} aria-hidden className={iconMotion('open')} />
            add section
          </Button>
        </div>
      </div>
    </AppDialog>
  )
}

export function RecordDescription({
  value,
  onChange,
  onReadMore,
  showHeading = true,
  onBack,
  postingUrl,
  className,
}: RecordDescriptionProps) {
  const preview = onReadMore !== undefined
  const sections = React.useMemo(() => parsePosting(value), [value])
  /** Which section is a field. `null` is the reading state. */
  const [editing, setEditing] = React.useState<number | null>(null)

  /**
   * Whether the preview is actually cutting anything off.
   *
   * IT USED TO BE A COUNT -- four blocks, whatever the frame was -- and that
   * left the awkward space Gabe reported: four short blocks in a 560px panel
   * finished a third of the way down and the rest was blank, while four long
   * ones overflowed it. A block count cannot know how tall a block is.
   *
   * The preview fills its frame instead and is clipped by it, so the answer to
   * "is there more" is a MEASUREMENT rather than a guess -- which is what keeps
   * the control's label honest. `read more…` over a posting with nothing more
   * to read is a lie the reader only discovers by pressing it.
   *
   * The 4px tolerance is for sub-pixel layout: a body that rounds to half a
   * pixel taller than its box is not a posting with more to read.
   */
  const bodyRef = React.useRef<HTMLDivElement | null>(null)
  const [clipped, setClipped] = React.useState(false)
  React.useEffect(() => {
    const el = bodyRef.current
    if (!preview || !el || typeof ResizeObserver === 'undefined') return
    const measure = () => setClipped(el.scrollHeight - el.clientHeight > 4)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [preview, value])

  // The preview is read-only; the full view is where the posting is written.
  // Guarded rather than assumed, so a preview can never land in edit state.
  const editingIndex = preview ? null : editing

  const blocks = preview && value.trim() ? postingBlocks(value) : []

  /**
   * WHICH INDEX the naming dialog is about to fill, or `null` when it is shut.
   *
   * AN INDEX RATHER THAN A BOOLEAN, and that is not tidiness: the field the
   * dialog hands focus to is `posting-section-<index>`, and the section is
   * added while the dialog is still closing -- so a `fieldId` derived from
   * `sections.length` becomes the NEXT index mid-close, and focus was handed to
   * a field that will not exist until somebody adds another section. Measured
   * in the browser: the lookup asked for `posting-section-2` immediately after
   * creating `posting-section-1`. Captured at open, it cannot move.
   */
  const [naming, setNaming] = React.useState<number | null>(null)

  const add = (name: string) => {
    onChange(addSection(sections, name))
    // Straight into the body of the section just named: the heading is
    // settled, so the only thing left to do with it is write under it.
    setEditing(sections.length)
  }

  return (
    <div
      className={cn('flex flex-col gap-4', preview && 'min-h-0 flex-1', className)}
      aria-label="Job description"
    >
      {showHeading && (
        <h3 className="flex items-center gap-2 text-heading-s text-text-primary">
          <DocumentsIcon size={16} aria-hidden className="shrink-0 text-text-muted" />
          job description
        </h3>
      )}

      {/* THE CONTROL ROW, AND IT IS A ROW OF ITS OWN (Gabe, 2026-09-13: "back
          to application redirect, see posting and add a new section must be a
          new row with justify-between").

          It moved out of the dialog's header, where `back to application` and
          `show posting` had been sitting opposite the title. Two reasons it
          reads better here: the header is chrome that belongs to the DIALOG
          while these three belong to the POSTING, and `add a new section` could
          never have joined them up there -- it would have been an editing
          control in a title bar.

          NAVIGATION LEFT, CREATION RIGHT. `justify-between` separates the two
          things you can do with this surface: leave it (back, or out to the
          employer's own page) or add to it. Grouping back and see-posting is
          what makes the split read as two kinds rather than three buttons in a
          row.

          It sits ABOVE the sections rather than below them. A posting runs to
          eight hundred words; a way back at the foot of it is a way back you
          have to scroll to find. */}
      {!preview && (onBack || sections.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            {onBack && (
              <Button
                type="button"
                variant="ghost"
                size="s"
                className="px-0"
                // The control that opened this view has just been hidden, so
                // without this focus falls to the body of a trapped dialog.
                autoFocus
                onClick={onBack}
                data-posting-back
              >
                <ChevronLeftIcon size={16} aria-hidden className={iconMotion('back')} />
                back to application
              </Button>
            )}
            {postingUrl && (
              <a
                href={postingUrl}
                target="_blank"
                rel="noreferrer"
                className={`${ICON_MOTION_GROUP} flex shrink-0 items-center gap-1 text-body-s text-text-secondary hover:text-text-primary hover:underline`}
              >
                see posting
                <ExternalIcon size={14} className={iconMotion('forward', { press: false })} />
              </a>
            )}
          </div>

          {/* `add a new section` ONLY WHERE THERE IS SOMETHING TO ADD TO. On an
              empty posting the paste field below is already the way in, and
              offering both would be two controls for one job. */}
          {sections.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="s"
              className="px-0"
              onClick={() => setNaming(sections.length)}
              data-posting-add-section
            >
              <PlusIcon size={16} aria-hidden className={iconMotion('open')} />
              add a new section
            </Button>
          )}
        </div>
      )}

      {preview ? (
        blocks.length > 0 ? (
          /*
           * FILLS THE FRAME, AND IS CLIPPED BY IT (Gabe, 2026-09-13: "job
           * description must be filled to remove the awkward space. Read more
           * CTA will be preserved since all text must not be rendered").
           *
           * `min-h-0 flex-1 overflow-hidden` is the whole mechanism: the
           * posting renders in full and the panel's own height decides how much
           * of it you see, so there is never a gap under it and never a scroll
           * inside it. The previous version rendered a fixed four blocks, which
           * is a guess about height made in units of paragraphs.
           *
           * THE FADE IS WHAT MAKES THE CUT READ AS DELIBERATE. Without it a
           * line is simply sliced in half and looks like a rendering fault; a
           * gradient to the dialog's own ground says "this continues", which is
           * what the control under it then offers. It is drawn only when
           * something really is cut off -- over a short posting it would be a
           * gradient over nothing, and `aria-hidden` because it is a picture of
           * an edge rather than content.
           */
          <div
            ref={bodyRef}
            className="relative min-h-0 flex-1 overflow-hidden"
            data-posting-body
          >
            <div className="flex flex-col gap-3">{blocks}</div>
            {clipped && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-bg-canvas to-transparent"
              />
            )}
          </div>
        ) : (
          <p className="text-body-s text-text-muted">
            No description saved. It is what the ATS match reads.
          </p>
        )
      ) : sections.length > 0 ? (
        /*
         * ROWS, SCROLLED VERTICALLY (Gabe, 2026-09-13: "I prefer vertical
         * scrolling in the job description -- not column behavior, row
         * behavior").
         *
         * It was `columns-[28rem]`, which fitted three newspaper columns into a
         * 1680px dialog and got the whole advert onto one screen. The reading
         * was the problem: a column layout asks the eye to find the top of the
         * next column, and the section you are editing can end up half a screen
         * from the field you are typing into. A document scrolls.
         *
         * The width that motivated the columns is answered at the dialog
         * instead -- it is 1280px now, so a line here is a readable measure
         * without anything splitting it. See app-dialog.
         */
        <div className="flex flex-col gap-6" data-posting-body>
          {sections.map((section, index) => (
            <Section
              key={index}
              section={section}
              index={index}
              editing={editingIndex === index}
              onEdit={() => setEditing(index)}
              onDone={() => setEditing(null)}
              onChangeBody={(body) => onChange(replaceSectionBody(sections, index, body))}
              onDelete={() => {
                onChange(removeSection(sections, index))
                // A field open on the section that just went would be a field
                // bound to an index that no longer exists.
                setEditing(null)
              }}
            />
          ))}
        </div>
      ) : (
        /*
         * AN EMPTY POSTING IS A FIELD, NOT A MESSAGE. There are no sections to
         * hang an edit control off yet, and a person looking at a blank surface
         * should not have to work out that a button turns it into one. This is
         * also the paste target: a whole advert goes in here and comes back out
         * as sections the moment it is parsed.
         */
        <Textarea
          id="description"
          aria-label="job description"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoSize
          className="min-h-64"
          placeholder="paste the posting here, or let the link fill it in."
        />
      )}

      {/* ALWAYS ON THE PREVIEW, never on the full text. Its label says which
          of the three things it is about to do, because a control that reads
          `read more…` over a posting with nothing more to read is a lie the
          reader only discovers by pressing it -- and one that disappears over
          a short posting takes the only way in to the editor with it. */}
      {preview && (
        <Button
          type="button"
          variant="ghost"
          size="s"
          className="self-start px-0"
          onClick={onReadMore}
          // THE HOOK THE RECORD FOCUSES ON THE WAY BACK. Coming out of the
          // posting's panel destroys the `back to application` button that has
          // focus, and this control -- the one it conceptually returns to --
          // was only un-`hidden`, never remounted, so React reuses its DOM node
          // and nothing moves focus to it. A keyboard user landed on `<body>`
          // inside a trapped dialog. See ApplicationRecordView.
          data-posting-read-more
        >
          {blocks.length === 0 ? 'add a description' : clipped ? 'read more…' : 'open the posting'}
          <ArrowRightIcon size={16} aria-hidden className={iconMotion('forward')} />
        </Button>
      )}

      {/* MOUNTED ONLY WHILE IT IS OPEN. Base UI unmounts a closed dialog's
          children anyway, but the whole component is cheaper to leave out of
          the preview's tree entirely -- and the preview can never open it. */}
      {!preview && naming !== null && (
        <NameSectionDialog
          open
          onOpenChange={(open) => setNaming(open ? naming : null)}
          onAdd={add}
          fieldId={`posting-section-${naming}`}
        />
      )}
    </div>
  )
}
