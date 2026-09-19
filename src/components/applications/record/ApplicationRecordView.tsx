'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BriefcaseIcon, CheckIcon } from '@/components/icons'
import { iconMotion } from '@/components/icons/motion'
import { assertJobFormDataValid } from '@/services/jobValidation'
import { fromLocalDateTimeInput, toLocalDateTimeInput } from '@/services/date'
import { cn } from '@/lib/utils'
import { ApplicationPipeline } from './ApplicationPipeline'
import { RecordAts } from './RecordAts'
import { RecordBasics } from './RecordBasics'
import { RecordDescription } from './RecordDescription'
import { useRecordDraft, type UseRecordDraftResult } from './useRecordDraft'
import { EMPTY_RECORD_DATA, type ApplicationRecordData } from './recordData'
import type { SupportedCurrency } from '@/services/userPreferences'
import type { Job, JobFormData } from '@/types'

/**
 * ONE APPLICATION, ONE SURFACE. It shows the record and it edits the record;
 * there is no view mode and no edit mode, and the separate edit dialog that
 * used to hold the other half is gone (Gabe, Worktrack Revisions items 2-4).
 *
 * TWO COLUMNS AT ONE TO TWO (Gabe, 2026-09-13). It was three of roughly equal
 * width, and the split was wrong in both directions at once: the first column
 * is a stack of ten labelled fields and had to scroll, while the posting and
 * the ATS match -- the two things you READ rather than fill in -- were 300px
 * slivers either side of it.
 *
 *   1. what the application IS -- editable in place, dropdowns included,
 *      and empty fields kept off the screen. See RecordBasics, plus the CV
 *      that was sent.
 *   2. what came back -- the ATS match, a hairline, then the posting.
 *
 * ATS ABOVE THE POSTING, and that order is the argument for combining them at
 * all: the verdict is the SUMMARY of the posting-against-CV question and the
 * posting is the REFERENCE you drop into when the description surprises you. The
 * posting is cut to a few blocks with a `read more…` into its own view of this
 * dialog, so the reference cannot push the description off the screen.
 *
 * THE COLUMNS ARE A CONTAINER QUERY, NOT A VIEWPORT ONE, and that distinction
 * is load-bearing: this record renders inside a dialog capped at 1040px on a
 * 1920px screen, and inside a bottom sheet on a phone. A viewport `xl:` would
 * have split a 976px dialog into three columns on the same screens where it
 * looks roomiest and left them at 280px each -- one of them a textarea holding
 * a job posting. The same mechanism `ui/ats-donut` and `ui/card` already use.
 *
 * THE PIPELINE BAR IS ON TOP because the first question anyone opens a record
 * to answer is "where is this one up to", and it is the only thing here that
 * cannot be read off a single field.
 *
 * SAVE LIVES AT THE FOOT OF THIS DIALOG (revision item 2). The header's edit
 * and delete buttons are gone with it -- editing is what this surface does,
 * and delete is on the row in the table where the rest of the row-level
 * actions are.
 */
export interface ApplicationRecordViewProps {
  job: Job | null
  data?: ApplicationRecordData
  defaultCurrency: SupportedCurrency
  saving?: boolean
  /**
   * Resolves `false` when the save was rejected, anything else when it landed.
   *
   * The view needs the ANSWER, not just the call: a save that worked has to
   * move the draft's baseline, or the record stays permanently dirty against
   * the values it opened with and every Escape from then on asks whether to
   * discard changes that are already stored.
   */
  onSubmit: (
    data: JobFormData,
    /**
     * The interview, as an instant to store — `undefined` when the field was
     * not touched, `null` when it was cleared.
     *
     * THREE STATES, NOT TWO, and the distinction is what stops this being
     * destructive. It rides beside the payload rather than inside it because
     * an interview is a row in `events`, not a column on `jobs` — the same
     * seam `resumeId` already runs through. `undefined` is the common case:
     * somebody fixing a salary must not have their calendar rewritten as a
     * side effect, and moving an application on to `offer` must not delete
     * the interview that got them there.
     */
    interviewAt?: string | null
  ) => void | boolean | Promise<void | boolean>
  onDirtyChange?: (dirty: boolean) => void
  /** The CVs available to the "cv used" field. */
  resumes?: { id: string; title: string }[]
  linkedResumeId?: string | null
  onLinkedResumeChange?: (resumeId: string | null) => void
  /** Set by the add wizard: every field open, and no pipeline bar to read yet. */
  layout?: 'record' | 'review'
  /**
   * Opens the posting's own view of this dialog. Also what turns the second
   * column's copy of the posting into a cut, read-only preview -- see
   * RecordDescription.
   */
  onReadMore?: () => void
  /**
   * A whole posting was pasted into the empty description box.
   *
   * THE ADD WIZARD ONLY. It runs the paste through the model there and then,
   * so the fields fill while the reader is still looking at them instead of
   * after the dialog has closed. Handed to `RecordDescription` untouched.
   */
  onPostingPasted?: (text: string) => void
  /**
   * Back from the posting to the record. The dialog owns which view is
   * showing, so it owns the way back; the control that calls this now lives in
   * the posting's own control row rather than in the dialog's header.
   */
  onBack?: () => void
  /**
   * Whether that view is the one showing.
   *
   * IT IS A PANEL OF THIS FORM, NOT A SECOND DIALOG, and it is rendered from
   * here rather than from ApplicationRecordDialog for one reason: the draft
   * lives in this component. The posting is edited in that view, and an editor
   * mounted outside the hook that owns `description` would have to write
   * through a prop chain back into it -- or the draft would have to move up,
   * which would cost the `key={job.id}` remount that guarantees switching rows
   * never carries one row's typed values into another's.
   *
   * The record's own columns are HIDDEN rather than unmounted while it is
   * open; see the `hidden` below.
   */
  postingOpen?: boolean
  /** Overrides the footer's label. The wizard saves a NEW application. */
  submitLabel?: string
  /** Lets the wizard drive the same draft it filled in. */
  form?: UseRecordDraftResult
  footer?: React.ReactNode
}

/**
 * The gutter every tab panel leaves on its trailing edge.
 *
 * THE SAME 12px THE SCROLLING COLUMN USES, and for the same reason: a
 * scrollbar is laid out at the inline-end edge of the PADDING box, so this is
 * what stands between the track and whatever the panel's last element is --
 * an input border in the form, a chip in the ATS lists.
 */
const PANEL_GUTTER = 'pr-3'

/**
 * The mark that says which tab you are on.
 *
 * SETTINGS ALREADY SOLVED THIS AND THIS IS ITS TREATMENT, verbatim in
 * substance (see SettingsPage). Two things were wrong with the `line` variant's
 * own marker and both are why Gabe could not see it (2026-09-13: "make sure the
 * status mark is visible"):
 *
 *   IT SAT BELOW THE RULE. The variant draws its `::after` at `bottom: -5px`,
 *   five pixels under the trigger -- so on a list that carries its own
 *   `border-b` the marker floated past the hairline instead of landing on it,
 *   reading as a stray dash rather than as an underline. At `bottom-0` it sits
 *   ON the rule, which is what an underlined tab means.
 *
 *   IT WAS THE FOREGROUND COLOUR, near-white in dark mode. This system marks
 *   "the current thing" in the accent -- the status marker and the active nav
 *   item both do -- and a white rule says nothing about state.
 */
const TAB = cn(
  'relative h-auto flex-none shrink-0 rounded-none border-0 px-0 pb-2 text-body-m',
  'transition-colors duration-(--duration-fast)',
  'text-text-muted hover:text-text-primary',
  'data-active:bg-transparent data-active:text-text-primary data-active:shadow-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default',
  // The variant's own marker off, and ours on the hairline the list carries.
  'after:hidden',
  'data-active:after:absolute data-active:after:inset-x-0 data-active:after:bottom-0',
  'data-active:after:block data-active:after:h-[2px] data-active:after:bg-accent-default'
)

/**
 * The tabbed side of the record.
 *
 * TWO TABS BESIDE THE FORM, THREE INSTEAD OF IT (Gabe, 2026-09-13: "within the
 * 2/3 layout, implement a tab navigation for job description and ATS matching",
 * then "use three tabs for tablet and mobile screens"). One component builds
 * both, because the only difference is whether the application form is a
 * COLUMN or a TAB -- and writing that twice is how the two arrangements start
 * disagreeing about what the panels are called.
 *
 * WHY TABS AT ALL. The posting and the score were stacked with a rule between
 * them, and both are long: the four-block preview plus a ring plus two hundred
 * chips is more than the frame holds, so the column scrolled and the ring
 * scrolled away from the tags it was about. They are also alternatives rather
 * than a sequence -- you are reading the advert or you are checking the match,
 * never both at once -- which is exactly what a tab is for.
 *
 * `variant="line"` because this system separates with rules. The filled-pill
 * default would put a grey block behind the active label, which is the one
 * thing the design vocabulary here does not do.
 *
 * NO HEADINGS INSIDE THE PANELS. The tab IS the heading, and `job description`
 * printed 40px under a tab reading `job description` is the duplicate header
 * this dialog has had removed from it twice.
 */
function RecordPanels({
  applicationPanel,
  descriptionPanel,
  atsPanel,
}: {
  /** Present only when the form is a tab rather than the column beside it. */
  applicationPanel?: React.ReactNode
  descriptionPanel: React.ReactNode
  atsPanel: React.ReactNode
}) {
  return (
    <Tabs
      defaultValue={applicationPanel ? 'application' : 'posting'}
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      {/* `justify-start` and `flex-none` triggers: the list defaults to
          stretching its tabs to equal widths, which on a 780px panel leaves two
          labels marooned at the ends of a very wide bar. Left-aligned and
          content-width, they read as a heading row. */}
      {/* `gap-4`, AND NO `overflow-x-auto` (Gabe, 2026-09-13: "remove the
          scroll in tab navigation and make sure the status mark is visible").
          The two go together: the active tab is marked by a 2px rule drawn as
          an `::after` sitting BELOW the trigger's box, and a scroll container
          clips anything outside its content box -- so the scrollbar bought
          insurance against an overflow that does not happen and paid for it by
          cutting off the one thing that says which tab you are on.

          Measured rather than guessed: three labels at a 24px gap came to
          380px against a 375px phone, which is why the gap is 16 -- at that
          width the list is 341px in 341px and there is nothing to scroll. */}
      <TabsList
        variant="line"
        className="h-auto w-full shrink-0 justify-start gap-4 rounded-none border-b border-border-subtle p-0"
      >
        {applicationPanel && (
          <TabsTrigger value="application" className={TAB}>
            the application
          </TabsTrigger>
        )}
        <TabsTrigger value="posting" className={TAB}>
          job description
        </TabsTrigger>
        <TabsTrigger value="ats" className={TAB}>
          ATS match
        </TabsTrigger>
      </TabsList>

      {/* `min-h-0` on every panel, so whatever scrolls inside one has a height
          to scroll against. The panels themselves scroll only where the record
          is stacked -- beside the form they are a fixed frame, which is what
          `RecordAts` lays itself out against.

          `PANEL_GUTTER` ON ALL THREE, scrolling or not (Gabe, 2026-09-13:
          "scroll for the application in default laptop screens and tablets
          must have a proper padding/margin"). Stacked, these panels are the
          scrollports -- the `the application` tab is a form of a dozen fields
          -- and a bar against the input borders is the same defect the 1/3
          column had, so it gets the same 12px answer.

          It is unconditional rather than applied only where a bar appears,
          because the alternative shifts the content sideways when you change
          tabs: one panel inset by its gutter and its neighbour not is a 12px
          jump on a control that is supposed to swap two views of one record.
          Reserving it everywhere costs nothing and holds the columns still. */}
      {applicationPanel && (
        <TabsContent value="application" className={cn('min-h-0 flex-1 overflow-y-auto', PANEL_GUTTER)}>
          {applicationPanel}
        </TabsContent>
      )}
      <TabsContent
        value="posting"
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          PANEL_GUTTER,
          applicationPanel ? 'overflow-y-auto' : 'overflow-hidden'
        )}
      >
        {descriptionPanel}
      </TabsContent>
      {/* THE ATS PANEL SCROLLS WHEN IT HAS TO, in both arrangements, and that
          is a safety net rather than a change of heart about the column. The
          band is a fixed height and the term lists fold, so at the widths this
          dialog is designed for nothing moves. But a panel that clips is a
          panel that can hide the missing-keyword list with no way to reach it,
          which is what a 1024px laptop was doing -- and unreachable content is
          worse than a scrollbar that almost never appears. */}
      <TabsContent value="ats" className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', PANEL_GUTTER)}>
        {atsPanel}
      </TabsContent>
    </Tabs>
  )
}

export function ApplicationRecordView({
  job,
  data = EMPTY_RECORD_DATA,
  defaultCurrency,
  saving = false,
  onSubmit,
  onDirtyChange,
  resumes = [],
  linkedResumeId = null,
  onLinkedResumeChange,
  layout = 'record',
  onReadMore,
  onPostingPasted,
  onBack,
  postingOpen = false,
  submitLabel,
  form: providedForm,
  footer,
}: ApplicationRecordViewProps) {
  // The wizard owns a draft across four steps and hands it in; the dialog has
  // no step before this one, so it makes its own. Hooks are unconditional
  // either way -- the provided one simply wins.
  // What is already on the calendar, in the shape the control wants. The
  // record seeds from it and compares against it; see `handleSubmit`.
  const interviewSeed = data.interview ? toLocalDateTimeInput(data.interview.starts_at) : ''
  const ownForm = useRecordDraft(job, defaultCurrency, onDirtyChange, interviewSeed)
  const form = providedForm ?? ownForm
  const { draft, set, payload, errors, attempt, commit, dirty } = form

  /**
   * NOTHING TO SAVE IS NOT A THING TO OFFER (Gabe, 2026-09-10).
   *
   * On the RECORD only. The wizard's review step reaches Save with a draft
   * that may be entirely model-filled and therefore "clean" against its own
   * empty baseline -- disabling it there would make a fetched application
   * unsavable, which is the one path the whole four-step flow exists for.
   *
   * `dirty` compares the payload against the values the record opened with, so
   * typing a character and deleting it again correctly leaves this disabled --
   * and a successful save re-baselines, which is what stops the button coming
   * back to life over values that are already stored.
   */
  const [resumeId, setResumeId] = React.useState(linkedResumeId ?? '')
  React.useEffect(() => setResumeId(linkedResumeId ?? ''), [linkedResumeId])

  /**
   * THE CV COUNTS AS A CHANGE (Gabe, 2026-09-11: "CV dropdown ... is not
   * functioning when I select the new CV").
   *
   * `dirty` compares the `jobs` payload against what the record opened with,
   * and which CV was sent is not a column on `jobs` -- it is a row in
   * `application_documents` held in the state above. So picking a different CV
   * and changing nothing else left `dirty` false: the Save button stayed
   * disabled, the status line said "everything is saved", and there was no way
   * to store the pick at all. The field looked broken because it was
   * unreachable, not because the select was.
   */
  const resumeDirty = resumeId !== (linkedResumeId ?? '')
  const unsaved = dirty || resumeDirty

  /**
   * And the DIALOG has to hear about it too, or picking a CV and pressing
   * Escape drops it with no prompt -- which is the same silent loss the
   * discard confirmation exists to prevent.
   *
   * Reported from here rather than from `useRecordDraft`, which knows only
   * about the payload. This effect is declared after that hook's, so React
   * runs it second and the combined answer is the one the parent keeps.
   */
  React.useEffect(() => {
    onDirtyChange?.(unsaved)
    // `onDirtyChange` is a fresh closure on every parent render and including
    // it would report on every keystroke -- the same reason `useRecordDraft`
    // depends only on its own flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsaved])

  /**
   * Coming back from the posting puts focus where the reader left it.
   *
   * FOUND IN REVIEW (2026-09-13), and it is the mirror of a fix that was
   * already paid for in the other direction: the dialog `autoFocus`es its
   * `back to application` control on the way IN, because the button that
   * opened the panel has just been hidden. On the way OUT the same thing
   * happens in reverse -- `back to application` unmounts -- but the control it
   * returns to was only un-`hidden`, so React reuses that DOM node and no
   * mount-time `autoFocus` ever fires. Focus fell to `<body>` inside a
   * focus-trapped dialog: a keyboard user had to Tab from the top and a screen
   * reader got silence.
   *
   * Queried out of the form rather than threaded down as a ref, because the
   * control is three components away and its existence is conditional (a
   * posting short enough not to be cut still renders it, an add-wizard review
   * step does not). A ref chain through two optional props to focus one button
   * is more moving parts than the query it replaces.
   */
  const formRef = React.useRef<HTMLFormElement>(null)
  const wasPostingOpen = React.useRef(postingOpen)
  React.useEffect(() => {
    const closed = wasPostingOpen.current && !postingOpen
    wasPostingOpen.current = postingOpen
    if (!closed) return
    formRef.current
      ?.querySelector<HTMLElement>('[data-posting-read-more]')
      ?.focus()
  }, [postingOpen])

  const nothingToSave = layout === 'record' && !unsaved

  /**
   * Where the record earns two columns, in pixels, because a ResizeObserver
   * cannot read a container query.
   *
   * 72rem, AND IT IS DERIVED RATHER THAN CHOSEN. It was 56rem (896px) and that
   * was too eager: Gabe on a 1024px laptop got a record of 928px, which
   * cleared 896 and split -- leaving the second column ~595px, which is under
   * the 42rem `RecordAts` needs to lay its band out horizontally. So the band
   * stacked, the ring took the height the term lists needed, and the lists were
   * clipped by a column that deliberately does not scroll. Content nobody could
   * reach ("weird behavior in default laptop screens").
   *
   * The arithmetic, so the next person can redo it rather than guess: the ATS
   * panel is `2/3 of the record, less the 24px after the divider`, and it wants
   * 672px. `(672 + 24) / (2/3)` is 1044, so 72rem (1152) is the first round
   * container size that clears it with room to spare. A 1280px window gives a
   * 1184px record and splits; a 1024px window gives 928 and takes the three-tab
   * arrangement instead, where every surface gets the full width.
   *
   * ONE NUMBER FOR BOTH ARRANGEMENTS. Every other breakpoint here is a
   * CONTAINER query -- the dialog is 1280px on a 1920px screen and a bottom
   * sheet on a phone, so a viewport query would split a roomy dialog on the
   * same screens where it looks widest. Which TABS exist cannot be a container
   * query (it is a tree, not a style), so it is measured here against the same
   * 72rem the `@6xl/record:` rules below use. Change one and you must change
   * the other, or there is a width where the layout and the tabs disagree.
   */
  const COLUMNS_AT = 1152

  /**
   * DESKTOP-FIRST, like `useBelowDesktop`. The first paint on the server has no
   * element to measure; assuming the roomy layout means a wide screen never
   * flashes the stacked one, and a narrow screen corrects itself on the first
   * observation rather than the other way round.
   */
  const [wide, setWide] = React.useState(true)
  React.useEffect(() => {
    const el = formRef.current
    if (!el) return
    const measure = () => {
      const width = el.getBoundingClientRect().width
      // ZERO IS "UNMEASURED", NOT "NARROW". jsdom lays nothing out and reports
      // 0 for every element, and a detached or display:none subtree does the
      // same in a real browser -- so treating it as a width would collapse the
      // record to its phone arrangement wherever it is rendered without a
      // layout. There is no such thing as a 0px record; keeping the default
      // is the honest answer to a measurement that did not happen.
      if (width === 0) return
      setWide(width >= COLUMNS_AT)
    }

    // MEASURED ONCE HERE, THEN OBSERVED -- and the first line is not
    // belt-and-braces. A ResizeObserver is delivered as part of the rendering
    // lifecycle, so an environment that is not painting never calls it: found
    // 2026-09-13 in a hidden browser pane, where a laid-out 923px element got
    // zero callbacks in 1.5 seconds and the record stayed in its default
    // desktop arrangement at every width. Anything that throttles frames --
    // a background tab, a thumbnailer, a headless capture -- does the same.
    // `getBoundingClientRect` asks the layout directly and cannot be starved.
    measure()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /**
   * The three surfaces, built once and placed by the arrangement.
   *
   * As NODES rather than as a second copy of the JSX in each branch: they are
   * the same panels either way, and two copies is two places for `onReadMore`
   * or `onChange` to be forgotten.
   */
  const applicationPanel = (
    <>
      {/* THE COLUMN HAD NO HEADING and the others did, so the record read as a
          form with two panels bolted to it. Suppressed where the form is a TAB,
          because the tab already says this. */}
      {layout === 'record' && wide && (
        <h3 className="flex items-center gap-2 text-heading-s text-text-primary">
          <BriefcaseIcon size={16} aria-hidden className="shrink-0 text-text-muted" />
          the application
        </h3>
      )}
      {/* WHICH CV WENT WITH IT IS ONE OF THE BASICS and is rendered as one. What
          stays here is the callback, because the CV link is a row in
          `application_documents` rather than a column on `jobs` and must not
          travel inside the draft. */}
      <RecordBasics
        form={form}
        showAll={layout === 'review'}
        resumes={resumes}
        resumeId={resumeId}
        onResumeIdChange={(next) => {
          setResumeId(next)
          // '' is "none", and it has to reach the caller as null: that is the
          // difference between "no CV" and "leave the link alone", and only the
          // former unpins.
          onLinkedResumeChange?.(next || null)
        }}
      />
    </>
  )

  const descriptionPanel = (
    <RecordDescription
      showHeading={false}
      value={draft.description}
      onChange={(next) => set('description', next)}
      // STRAIGHT THROUGH, AND OPTIONAL. Only the add wizard passes this: it is
      // what lets a pasted posting be read the moment the reader clicks away,
      // rather than at save. An existing record has no reading left to do.
      onPostingPasted={onPostingPasted}
      onReadMore={onReadMore}
    />
  )

  const atsPanel = (
    <RecordAts match={data.match} links={data.links} error={data.atsError} />
  )

  const [formError, setFormError] = React.useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    attempt()
    setFormError('')
    /*
      A SILENT RETURN IS A BUTTON THAT DOES NOTHING (2026-09-15). This branch
      used to be a bare `return`: `attempt()` turned on the per-field marks and
      the submit stopped, which is correct as far as it goes -- and on this
      surface it goes nowhere useful. The record is a TWO-COLUMN dialog with
      its own scrollport, so the field that is wrong is very often above the
      fold, and the Save button is in a bar pinned below it. Pressing Save and
      seeing nothing change at all is indistinguishable from a broken button;
      the person presses it again.

      So the form says, at the form's own level, that there is something to
      fix and how many -- and it says it in the SAME place a failed save
      already speaks, three lines above the button, which is the one part of
      this dialog that never scrolls away.

      NAMED, NOT COUNTED ONLY. "check company and salary" sends somebody
      straight to the field; "2 fields need fixing" sends them hunting. Three
      at most, because the list is a pointer rather than a report and the
      per-field messages are the report.
    */
    const invalid = Object.keys(errors)
    if (invalid.length > 0) {
      const named = invalid.slice(0, 3).join(', ')
      setFormError(
        invalid.length > 3
          ? `Check ${named} and ${invalid.length - 3} more before saving.`
          : `Check ${named} before saving.`
      )
      return
    }
    try {
      assertJobFormDataValid(payload)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'This application could not be saved.')
      return
    }
    // UNCHANGED MEANS UNTOUCHED. Only a real edit to the field reaches the
    // events table, so an ordinary save costs no event write at all.
    const interviewAt =
      draft.interviewAt === interviewSeed ? undefined : fromLocalDateTimeInput(draft.interviewAt)
    const ok = await onSubmit(payload, interviewAt)
    // A REJECTED SAVE STAYS DIRTY, which is the point: the values are still
    // only in this dialog, so closing it must still ask before dropping them.
    if (ok !== false) commit()
  }

  return (
    // The container the grid queries. Declared on the OUTER element: an
    // element cannot query its own container, so putting `@container/record`
    // and `@6xl/record:` on one div would resolve against some ancestor
    // instead -- silently, and looking right in whichever layout happened to
    // match.
    <form
      ref={formRef}
      onSubmit={(e) => void handleSubmit(e)}
      className={cn(
        '@container/record flex flex-col gap-3',
        // THE RECORD IS A FIXED FRAME, from `sm` up. The dialog hands
        // scrolling to this form (`bodyScroll={false}`), which passes it on to
        // the grid below -- so the pipeline and the Save row hold their place
        // and only the columns move. `min-h-0` is what lets a flex child
        // shrink below its content; without it the grid never becomes
        // scrollable and the whole dialog grows instead.
        //
        // Below 640 none of it applies: the sheet stacks, the pipeline is a
        // 299px column, and freezing that as chrome leaves a phone nothing to
        // read in. There the whole record flows and the body scrolls it.
        layout === 'record' && 'sm:min-h-0 sm:flex-1'
      )}
      data-application-record
    >
      {/* CHROME, not a passenger. It used to be `position: sticky` inside a
          scrolling record, which worked and brought two defects with it: at
          `z-10` it tied with `Input`'s absolutely-positioned leading glyphs
          (input.tsx) and the field icons painted straight through it, and
          below 640 the steps stack into a 299px column that pinning made
          taller than the record it headed.

          Making the grid the scrollport removes the whole class of problem
          rather than patching it -- there is nothing to pin, nothing to
          out-rank, and nothing passes underneath at any width. Gabe's call
          (2026-09-10): "the problem should start at the three column layout".

          `-mb-3` cancels the form's gap so the grid begins ON this block's
          bottom border, which is what the column rules hang from.
          `py-5` is the padding he asked to keep here and only here, widened
          from 12 to 20 on 2026-09-10: the bar is a band of four labelled steps
          rather than a line of text, and it is the one thing on this dialog
          that has to be readable at a glance. */}
      {/* UNMOUNTED, not hidden, while the posting is open -- unlike the grid
          below. It holds no state of its own: every pixel of it is derived
          from `status` and `history`, so it comes back identical. What must
          survive is the FIELDS, and they are in the grid. */}
      {layout === 'record' && !postingOpen && (
        <ApplicationPipeline
          status={draft.status}
          history={data.history}
          className="-mx-gutter -mb-3 shrink-0 border-b border-border-subtle px-gutter py-5"
        />
      )}

      {/* `gap-x-6` and a matching `pl-6` on the columns, down from 40 and 40
          (Gabe: "reduce the margin for both job description and ATS match. It
          is not centered properly"). Eighty pixels between one column's text
          and the next reads as three panels that happen to share a dialog; at
          24 either side of the rule they read as one record in columns.

          The rule above the columns is the pipeline's own `border-b`, not a
          border here: it has to travel with the bar. */}
      <div
        // HIDDEN, NOT UNMOUNTED, while the posting has the dialog. `hidden`
        // rather than a conditional render because this subtree holds state
        // nothing else does -- whether `add more details` is open, where the
        // column is scrolled to -- and because `[hidden] { display: none }`
        // takes it out of the accessibility tree too, so a screen reader (or a
        // test) never finds two `company` fields.
        //
        // Tailwind's preflight sets that rule `!important`, which is what lets
        // it beat the `flex-1` below; a plain `[hidden]` rule would lose to any
        // class here on specificity.
        hidden={postingOpen}
        className={cn(
          layout === 'review'
            ? 'grid gap-8 @2xl/record:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]'
            : // A FRAME, NOT A SCROLLPORT (Gabe, 2026-09-13: "scroll should be
              // applied only to the 1/3 column. 2/3 column should remove the
              // scrolling"). It used to be the one thing that scrolled, which
              // moved BOTH columns together -- so reading to the bottom of the
              // posting took the form off the screen with it, and the ring
              // scrolled away from the tags it was about. Each column owns its
              // own overflow now; this only stops the pair growing the dialog.
              'flex min-h-0 flex-col -mx-gutter px-gutter sm:flex-1 sm:overflow-hidden'
        )}
      >
        {layout === 'review' ? (
          <>
            <div className="flex flex-col gap-4">{applicationPanel}</div>
            <RecordDescription
              className="@2xl/record:border-l @2xl/record:border-border-subtle @2xl/record:pl-6"
              value={draft.description}
              onChange={(next) => set('description', next)}
              // THE REVIEW STEP IS THE PASTE TARGET. This layout renders its
              // own copy rather than the shared `descriptionPanel`, so the
              // wizard's hook has to be passed here too -- wiring only the
              // shared one left the add wizard, the single surface that uses
              // this prop, without it.
              onPostingPasted={onPostingPasted}
            />
          </>
        ) : wide ? (
          /*
           * WIDE: the form beside a two-tab panel.
           *
           * `grid-rows-[minmax(0,1fr)]` is what makes a column scrollable at
           * all. A grid row is `auto` by default, which means "as tall as the
           * content" -- so a column with `overflow-y-auto` inside it never has
           * a height to overflow and simply grows instead. Pinning the single
           * row to the frame's height is the whole mechanism.
           */
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-x-0 @6xl/record:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            {/* THE ONE THING THAT SCROLLS.

                WHICH SIDE THE PADDING LANDS ON IS THE FIRST HALF OF THIS, and
                it took three passes (Gabe, 2026-09-13: "there should be a left
                padding for the scrollbar"). A scrollbar is laid out at the
                inline-end edge of the PADDING box, not the border box -- so
                `padding-right` here does not push the bar inward at all. It
                opens a gap on the bar's LEFT, between the last field and the
                track.

                THE BAR AND THE RULE STICK TOGETHER, which is the second half
                (Gabe, 2026-09-13: "I want scroll and divider ... to stick
                together"). `gap-x-0` on the grid, so the second column's
                `border-l` lands immediately against the scrollbar and the two
                read as ONE edge -- the boundary of the scrolling column,
                stated once. Every version with space between them made the
                bar look like it had drifted off its own column and stranded
                itself in the gutter; 24px did it and so did 12.

                So the space is all on the outside of that edge, and the two
                gutters are deliberately unequal because they separate
                different things. 12px between the fields and the bar -- enough
                that the track is not against the input borders, and no more,
                because the bar belongs to the column it scrolls. 24px after
                the rule (`pl-6` on the second column), which is the gutter
                between the two columns' CONTENT.

                `pt-6` is on the COLUMN and never on the grid, or the columns
                would clear the pipeline's border and the vertical rule would
                stop short of it. */}
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-3 pt-6">
              {applicationPanel}
            </div>

            {/* The hairline between columns, drawn once, top to bottom. */}
            {/* `pl-6` -- the whole gutter between the two columns' content,
                and it all sits on this side because the rule is flush against
                the scrollbar on the other (`gap-x-0` above). The rule belongs
                to this column's leading edge, so the space after it is this
                column's to set. */}
            <div className="flex min-h-0 flex-col overflow-hidden pt-6 @6xl/record:border-l @6xl/record:border-border-subtle @6xl/record:pl-6">
              <RecordPanels
                descriptionPanel={descriptionPanel}
                atsPanel={atsPanel}
              />
            </div>
          </div>
        ) : (
          /*
           * NARROW: three tabs (Gabe, 2026-09-13: "use three tabs for tablet
           * and mobile screens").
           *
           * Below the breakpoint the two columns stack, and a stacked record is
           * a form with two long panels under it -- you scroll past every field
           * to reach the posting and past the posting to reach the score. The
           * form becomes the third tab instead, so one surface is on screen at
           * a time and the pipeline above it stays the only orientation needed.
           */
          <div className="flex min-h-0 flex-1 flex-col pt-6">
            <RecordPanels
              applicationPanel={<div className="flex flex-col gap-4">{applicationPanel}</div>}
              descriptionPanel={descriptionPanel}
              atsPanel={atsPanel}
            />
          </div>
        )}
      </div>

      {/* THE POSTING'S OWN VIEW, in the space the columns just gave up. No
          heading: the dialog's title says `job description` while this is
          open, and printing it again 40px below is the duplicate header this
          dialog had removed from it once already.

          IT TAKES THE WHOLE WIDTH NOW (Gabe, 2026-09-13: "weird layout for the
          job description, increase width"). It was capped at `max-w-[80ch]` --
          about 620px against a 1680px dialog -- so the advert sat in a narrow
          strip at the left with two thirds of the surface empty beside it, and
          still ran a page and a half of scroll. The cap is gone and the
          posting flows into columns instead; `RecordDescription` documents why
          that is the fix rather than simply setting a wider line. */}
      {postingOpen && (
        <div className="-mx-gutter px-gutter sm:min-h-0 sm:flex-1 sm:overflow-y-auto">
          <RecordDescription
            showHeading={false}
            value={draft.description}
            onChange={(next) => set('description', next)}
            onBack={onBack}
            postingUrl={draft.url || null}
          />
        </div>
      )}

      {formError && (
        <p role="alert" className="text-body-s text-status-rejected-mark">
          {formError}
        </p>
      )}

      {/* THE FRAME'S LAST ROW, not a sticky overlay. It was
          `sticky bottom-[-gutter]` because the whole record scrolled under it;
          with the grid owning the scroll it simply sits below the scrollport
          and never moves, which is the same result with none of the inset
          arithmetic. `-mx-gutter ... px-gutter pb-gutter` still bleeds it to
          the dialog's edges, and `-mb-gutter` gives the height back so the
          body does not grow by a gutter. */}
      <div
        className={cn(
          // `-mt-3` cancels the form's gap so this bar's top border sits ON the
          // scrollport's bottom edge -- which is where the column rules
          // end, so they meet it (Gabe, 2026-09-10: "bottom CTA bar separator
          // should also stick to the vertical separators"). At a 12px gap the
          // verticals stopped just short and the frame came apart at the foot
          // the same way it did at the head.
          //
          // `py-3`, down from 16 above and 33 below. The dialog body gives up
          // its bottom padding for this bar (see AppDialog's `bodyScroll`), so
          // what is left is the bar's own -- even on both sides, and on the
          // same 12px rhythm as every rule in this dialog.
          'z-20 -mx-gutter -mt-3 flex shrink-0 items-center gap-3 border-t border-border-subtle bg-bg-canvas px-gutter py-3',
          'max-sm:[&_button]:h-11 max-sm:[&_button]:flex-1'
        )}
      >
        {/* THE STATE, THEN THE ACTION. `Save application` used to sit alone on
            the leading edge and go grey with nothing to explain it -- a
            disabled primary with no adjacent reason reads as broken rather
            than as satisfied. Saying which of the two it is costs one line and
            turns the grey into an answer.

            `aria-live="polite"` because this is the only feedback a save
            gives: the dialog deliberately stays open (the row is derived from
            `jobs`, so the new values simply arrive), which means a screen
            reader would otherwise get silence where a sighted user gets a
            button greying out. */}
        {layout === 'record' && (
          <p
            aria-live="polite"
            data-record-save-state
            className="min-w-0 text-body-s text-text-muted max-sm:sr-only"
          >
            {saving ? 'saving…' : unsaved ? 'unsaved changes' : 'everything is saved'}
          </p>
        )}

        {/* `ms-auto` on the record only. A dialog's primary action belongs on
            the trailing edge, where the eye finishes; the wizard's review step
            keeps its own arrangement, because there the save is the end of a
            four-step flow rather than one of the things this surface does. */}
        {/* `loading` + `loadingText`, NOT THE HAND-ROLLED PENDING STATE this
            carried until 2026-09-15. It rendered its own `CssSpinner`, swapped
            its own label and passed `saving` into `disabled` -- which is three
            of the four things `Button` does, and the fourth is `aria-busy`,
            which this was quietly missing. It also swapped the label with a
            ternary, so the control changed width the moment it was pressed;
            `Button` keeps both strings in one grid cell and does not.

            `disabled` now carries only `nothingToSave`. `Button` derives the
            rest: a button that is loading is disabled by construction, which
            is what makes a double submit unrepresentable rather than merely
            discouraged. */}
        <Button
          type="submit"
          loading={saving}
          loadingText="Saving..."
          disabled={nothingToSave}
          className={cn(layout === 'record' && 'ms-auto')}
        >
          {!saving && <CheckIcon size={16} aria-hidden className={iconMotion('none')} />}
          {submitLabel ?? 'Save application'}
        </Button>
        {footer}
      </div>
    </form>
  )
}
