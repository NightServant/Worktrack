'use client'

import * as React from 'react'
import { AnalyzingDocument } from '@/components/ui/analyzing-document'
import { RotatingText } from '@/components/ui/status-state'
import { AppDialog } from '@/components/ui/app-dialog'
import { Button } from '@/components/ui/button'
import { CssSpinner } from '@/components/ui/css-spinner'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { AlertCircleIcon, ArrowRightIcon } from '@/components/icons'
import { ICON_STATE_MOTION, iconMotion } from '@/components/icons/motion'
import { cn } from '@/lib/utils'
import { ApplicationRecordView } from './ApplicationRecordView'
import { WizardProgress } from './wizardSteps'
import { STEPS, type StepId } from './wizardStepModel'
import { autofillPosting } from './autofillPosting'
import { draftFromJob, normalizePostingUrl, useRecordDraft, type RecordDraft } from './useRecordDraft'
import { applyMinedFields, minedDraftFields, type PostingDigestResult } from './digest'
import type { SupportedCurrency } from '@/services/userPreferences'
import type { JobAutofillResult, JobFormData } from '@/types'

/**
 * Adding an application, as four steps instead of a nineteen-field form.
 *
 * THE REVISION'S FLOW, in its order (item 5):
 *
 *   1. LINK      paste the posting's URL, with instructions that say why.
 *   2. STATUS    wishlist or applied; `applied` also asks WHEN and WHICH CV.
 *   3. FILL      the model reads the posting and fills the whole application.
 *   4. REVIEW    the two-column preview -- correct anything, then save.
 *
 * WHY A URL AND NOT A FORM. Everything after step 1 is derived from the
 * posting, so the only thing a person has to type is the thing only they know.
 * The old dialog opened on nineteen empty inputs and an Auto-fill button
 * halfway down that most people never reached.
 *
 * WHAT HAPPENS WHEN THE FETCH FAILS, which it will: several boards are
 * JavaScript-rendered or refuse datacenter traffic, and sometimes retrying
 * changes that and sometimes nothing will. Step 3 does not become a dead end
 * -- it says so and carries on to the review step with whatever it got, where
 * the description column beside the fields takes a paste. Blocking the whole
 * flow on a fetch nobody controls would make the unreliable half the required
 * half.
 *
 * AND THE REVIEW STEP OFFERS THE TWO WAYS OUT (Gabe, 2026-09-17), because a
 * failure with no control beside it is a wizard telling somebody bad news and
 * then asking them to carry on as though it had not: `try again`, for the
 * board that was merely busy, and `discard`, which drops the link and leaves a
 * clean manual form for the board that is never going to open. Both are in the
 * review step itself rather than in a dialog over it -- a modal on top of a
 * modal to report that a fetch failed would be the app raising its voice.
 */

/**
 * What step 3 says while it runs, in the order the work actually happens.
 *
 * TRUE IN ORDER, WHICH IS THE WHOLE POINT. `autofillPosting` fetches the page,
 * then the extractor reads it, then `digestPosting` restructures it under
 * headings, then the draft is filled -- so these four lines are a progress
 * report rather than four synonyms for "waiting". A shuffled list of
 * reassurances would be decoration pretending to be information, and a reader
 * who noticed the shuffle would trust the next thing the app told them less.
 *
 * FOUR RATHER THAN THE WHOLE PIPELINE. `RotatingText` holds on the last one,
 * and the step usually finishes somewhere in the middle of the list; a longer
 * sequence would mostly be lines nobody sees, and would make the ones they do
 * see change too fast to read.
 */
const READ_STEPS = [
  'opening the posting',
  'reading the page',
  'organising what it says',
  'filling the application',
]

export interface AddApplicationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultCurrency: SupportedCurrency
  resumes?: { id: string; title: string }[]
  saving?: boolean
  /** Resolves `false` on a rejected save. See ApplicationRecordView. */
  /** `interviewAt` rides alongside, as in the record. See ApplicationRecordView. */
  onSubmit: (
    data: JobFormData,
    interviewAt?: string | null
  ) => void | boolean | Promise<void | boolean>
  onLinkedResumeChange?: (resumeId: string | null) => void
  onAutofill?: (url: string, html?: string) => Promise<JobAutofillResult>
  autofilling?: boolean
  /**
   * Tidies and summarises the fetched posting.
   *
   * THE ONLY PLACE THE DIGEST RUNS NOW. The record's `tidy and summarise`
   * button is gone (Gabe, 2026-09-10: "the model auto-summarizes the job
   * description"), so this step is what that sentence refers to.
   */
  onDigest?: (text: string) => Promise<PostingDigestResult>
  onDirtyChange?: (dirty: boolean) => void
  /**
   * A posting address to open on, filled into the first step.
   *
   * IT SEEDS, IT DOES NOT SKIP. The calendar's job feed hands a URL over with
   * `track it`, and the temptation is to run the read immediately and drop the
   * reader on the review step. That would spend a scrape and a model call on a
   * link somebody may have clicked to look at rather than to track -- and it
   * would hide the one screen where a wrong link can still be corrected.
   */
  initialUrl?: string | null
  /**
   * The page source the bookmarklet captured for `initialUrl`.
   *
   * IT SEEDS TOO, AND IT STILL DOES NOT SKIP -- the same reasoning as
   * `initialUrl` above. Arriving with the source in hand makes the read free
   * and unblockable, but it does not make the LINK right, and the link step is
   * where a wrong one is still correctable. What it removes is the fetch, not
   * the confirmation.
   */
  initialHtml?: string | null
}

export function AddApplicationDialog({
  open,
  onOpenChange,
  defaultCurrency,
  resumes = [],
  saving = false,
  onSubmit,
  onLinkedResumeChange,
  onAutofill,
  autofilling = false,
  onDigest,
  onDirtyChange,
  initialUrl = null,
  initialHtml = null,
}: AddApplicationDialogProps) {
  const form = useRecordDraft(null, defaultCurrency, onDirtyChange)
  const { draft, set, replace, fillEmpty } = form

  const [step, setStep] = React.useState<StepId>('link')
  const [linkError, setLinkError] = React.useState('')
  const [readNote, setReadNote] = React.useState('')
  /** A read that FAILED, which is the only state with anything to offer. */
  const [readError, setReadError] = React.useState('')
  /**
   * Whether the reader's own browser is now the only route to this posting.
   *
   * SET BY THE READ, not guessed from the message. A board that refuses
   * servers answers 200 with a warning and no fields, and until today the
   * dialog's whole answer to that was a paragraph -- while the app shipped a
   * bookmarklet built for exactly this case that nothing linked to. See
   * `autofillPosting`'s `setHandover`.
   */
  const [handover, setHandover] = React.useState(false)
  const [resumeId, setResumeId] = React.useState('')
  /**
   * Whether the model has already restructured this draft's description.
   *
   * THE READ STEP DIGESTS WHAT IT FETCHES, and until now that was the only
   * place it ran -- so a description the READER pasted, which is exactly what
   * the failure copy asks them to do, was stored verbatim. The one person the
   * digest never reached was the one the instruction was written for.
   *
   * A ref rather than state: nothing renders differently for it, and it must
   * be readable inside the submit handler without that handler being rebuilt.
   */
  const digested = React.useRef(false)
  /** The save is waiting on the model rather than on the database. */
  const [digesting, setDigesting] = React.useState(false)

  const index = STEPS.findIndex((s) => s.id === step)

  // A fresh dialog every time it opens. Without this, cancelling halfway
  // through and pressing Add again resumes somebody else's half-filled draft.
  React.useEffect(() => {
    if (open) return
    setStep('link')
    setLinkError('')
    setReadNote('')
    setReadError('')
    setResumeId('')
    digested.current = false
    setDigesting(false)
    replace({ ...emptyDraft(defaultCurrency) })
    // `replace` is stable and `defaultCurrency` never changes mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // A link handed in from elsewhere fills the first step. Only when the field
  // is still empty: a URL already typed is the one the person meant.
  React.useEffect(() => {
    if (!open || !initialUrl) return
    set('url', initialUrl)
    // Keyed on the incoming URL rather than on the draft, so re-rendering the
    // parent never overwrites what has since been typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialUrl])


  // The read step, as an explicit parameter object rather than a closure over
  // nine values. See autofillPosting for why the width is the honest shape.
  const goRead = () =>
    autofillPosting({
      draft,
      fillEmpty,
      replace,
      setStep,
      setReadNote,
      setReadError,
      onAutofill,
      // WRAPPED SO THE SAVE KNOWS. `autofillPosting` runs this on a fetched
      // description; recording that here is what stops the save digesting the
      // same text a second time, and it costs no change to that module's
      // signature.
      onDigest: onDigest
        ? async (text: string) => {
            digested.current = true
            return onDigest(text)
          }
        : undefined,
      setHandover,
      // Only for the link it arrived with. Once the reader edits the URL the
      // captured source belongs to a different page, and parsing one page's
      // HTML under another page's address is how a wrong posting gets saved
      // looking right.
      html: draft.url === initialUrl ? (initialHtml ?? undefined) : undefined,
    })

  /**
   * Reads a pasted posting the moment the reader clicks away from it.
   *
   * WHY IT MOVED OFF THE SAVE (Gabe, 2026-09-19: "the model must fill the
   * information after I clicked fill it in button"). The wizard's third step
   * says `the model fills it in`, and on a board that refuses to be fetched it
   * filled nothing -- correctly, because nothing had been read. The reader's
   * own paste is the text that was missing, and running it at SAVE meant the
   * form sat visibly empty through the whole review step and then filled after
   * the dialog had closed. The application came out right and looked broken
   * getting there.
   *
   * IT IS NOT AN EXTRA CALL. `digested` guards it exactly as it guards the
   * save, so this is the SAME one call, moved to the moment the paste is
   * finished instead of the moment the form is submitted. `submitWithDigest`
   * stays as the path for a paste that was never blurred.
   *
   * ON THE PASTE ITSELF, which is forced by the editor rather than chosen:
   * the empty-state textarea is replaced by the section editor on its first
   * change, so a paste destroys the node a blur would have come from and no
   * event escapes the column. The gesture is also the honest signal -- a whole
   * posting arriving at once is precisely the thing worth reading.
   *
   * IT TAKES THE TEXT AS AN ARGUMENT because `draft.description` has not been
   * updated when the paste event fires.
   */
  const readPastedPosting = async (text: string) => {
    const pasted = text.trim()
    if (!onDigest || digested.current || !pasted) return
    setDigesting(true)
    try {
      const digest = await onDigest(pasted)
      digested.current = true
      replace({ description: digest.description })
      // EMPTY FIELDS ONLY. Anything on the form was typed by a person, and a
      // person outranks a model reading prose. See `minedDraftFields`.
      fillEmpty(minedDraftFields(digest.fields))
    } catch {
      // Keep the verbatim paste. Same reasoning as the save path below.
    } finally {
      setDigesting(false)
    }
  }

  /**
   * Tidies a PASTED description on the way to saving it.
   *
   * THE GAP THIS CLOSES. `onDigest` ran in exactly one place -- inside the
   * read step, on a description the FETCH returned -- so the model reached
   * every posting the app could read and none of the ones it could not. The
   * failure copy tells the reader to paste the posting in themselves, which
   * means the digest skipped precisely the documents it was most needed for,
   * and `RecordDescription`'s docblock meanwhile assumed the opposite ("by the
   * time a description reaches a record it has already been tidied"). True of
   * fetched postings, false of pasted ones.
   *
   * IT RUNS AT SAVE RATHER THAN ON BLUR OR ON A TIMER. A paste is not finished
   * when it lands -- people paste, then trim the recruiter's boilerplate off
   * the end -- and a model call per keystroke or per blur would spend a
   * metered allowance on text that is still being edited. Save is the first
   * moment the description is certainly final, and it is already a moment the
   * reader expects to wait through.
   *
   * ONCE, NEVER TWICE. `digested` is set by the read step's own call, so a
   * posting that arrived through a successful fetch is not restructured again
   * on its way out.
   *
   * A FAILURE HERE MUST NOT COST THE APPLICATION. The catch keeps the verbatim
   * text and saves it: the digest is a tidy-up, and losing somebody's pasted
   * posting because a model was rate-limited would be a far worse bug than an
   * untidy description. Same reasoning as the read step's own inner try/catch.
   */
  const submitWithDigest = async (data: JobFormData, interviewAt?: string | null) => {
    const pasted = (data.description ?? '').trim()
    if (onDigest && !digested.current && pasted) {
      setDigesting(true)
      try {
        const digest = await onDigest(pasted)
        digested.current = true
        // `digest.description` rather than `formatted`, the same choice the
        // read step makes and for the same reason -- see autofillPosting.
        //
        // AND THE FIELDS IT MINED, which this dropped until 2026-09-19. The
        // digest reports a posting's location, work mode, salary, stack and
        // tags as well as restructuring its text, and the read step has always
        // applied both halves. Keeping only the description here meant a
        // PASTED posting -- the path every unreadable board sends people down
        // -- saved an application with those fields empty out of text that
        // stated them. Empty fields only; see `applyMinedFields`.
        data = applyMinedFields({ ...data, description: digest.description }, digest.fields)
      } catch {
        // Keep what they pasted. See the docblock.
      } finally {
        setDigesting(false)
      }
    }
    return onSubmit(data, interviewAt)
  }

  /**
   * Throws the link away and leaves an ordinary form behind.
   *
   * THE URL GOES WITH THE MESSAGE, which is the whole difference between this
   * and dismissing a warning. A posting address that has just been proved
   * unreadable is not evidence of anything except a board that said no, and
   * leaving it in the field means it is saved onto the application and read
   * back later as "this is where I applied" -- for a page the app could not
   * open. Somebody who means to keep it can paste it back into `posting url`,
   * which the review step renders like every other field.
   *
   * NOTHING ELSE IS CLEARED BECAUSE NOTHING ELSE WAS FILLED: `autofillPosting`
   * throws before it applies a patch, so on this path the draft holds only
   * what the first two steps asked for.
   */
  const discardRead = () => {
    set('url', '')
    setReadError('')
    setReadNote('')
  }

  const stepBody = () => {
    switch (step) {
      case 'link':
        return (
          <div className="flex max-w-xl flex-col gap-5">
            <p className="text-body-m text-text-secondary">
              Paste the address of the job posting. Worktrack reads the page and fills the
              application in for you — company, role, salary, location and the description
              itself. You check it before anything is saved.
            </p>
            <Field
              id="posting-url"
              label="job posting URL"
              hint="the page you would send someone if they asked what you applied for."
            >
              <Input
                id="posting-url"
                type="url"
                icon="Link"
                autoFocus
                value={draft.url}
                onChange={(e) => {
                  set('url', e.target.value)
                  setLinkError('')
                }}
                error={linkError || undefined}
                placeholder="https://careers.acme.com/123"
              />
            </Field>
            {/* THE LINK IS REQUIRED NOW (Gabe, 2026-09-11). It used to be
                optional, with this paragraph inviting people past it -- and
                that invitation led straight to the one path this flow handles
                worst: three steps of a four-step wizard whose whole promise is
                "the model does three of them", with nothing for the model to
                read. Better to stop at the first step, where the fix is
                obvious, than at the third, where it is not. */}
            <p className="text-body-s text-text-muted">
              Everything after this step is built from the page at that address.
            </p>
          </div>
        )

      case 'status':
        return (
          <div className="flex max-w-xl flex-col gap-5">
            <p className="text-body-m text-text-secondary">
              Have you sent this one yet, or are you keeping it on the list for now?
            </p>
            <Field id="add-status" label="status">
              <Select
                id="add-status"
                icon="Flag"
                value={draft.status}
                onValueChange={(next) => {
                  set('status', next as RecordDraft['status'])
                  // Choosing `wishlist` clears a date that would otherwise
                  // save an application date onto something never applied to.
                  if (next === 'wishlist') set('dateApplied', '')
                }}
                items={[
                  { value: 'wishlist', label: 'Wishlist — saved, not sent' },
                  { value: 'applied', label: 'Applied — already sent' },
                ]}
              />
            </Field>

            {/* ONLY WHEN IT IS APPLIED. A date picker and a CV chooser above a
                wishlist row are two questions with no answer. */}
            {draft.status === 'applied' && (
              <div className="flex flex-col gap-5 border-t border-border-subtle pt-5">
                <Field id="add-date" label="date applied">
                  <Input
                    id="add-date"
                    type="date"
                    value={draft.dateApplied}
                    onChange={(e) => set('dateApplied', e.target.value)}
                  />
                </Field>
                <Field
                  id="add-resume"
                  label="cv sent"
                  hint={
                    resumes.length
                      ? 'which CV went with this application.'
                      : 'no CVs yet — write one in Documents and it will appear here.'
                  }
                >
                  <Select
                    id="add-resume"
                    icon="Documents"
                    disabled={resumes.length === 0}
                    value={resumeId}
                    onValueChange={(next) => {
                      setResumeId(next)
                      onLinkedResumeChange?.(next || null)
                    }}
                    items={[
                      { value: '', label: resumes.length ? 'none' : 'no CVs yet' },
                      ...resumes.map((resume) => ({ value: resume.id, label: resume.title })),
                    ]}
                  />
                </Field>
              </div>
            )}
          </div>
        )

      case 'fill':
        return (
          /*
            CENTRED, AND IT WAS NOT (Gabe, 2026-09-15: "application wizard model
            loading state animated icon and text is not centered"). This was
            `items-start`, so the glyph and both lines sat hard against the left
            edge of a dialog that is 1280px wide at desktop -- a 48px icon and
            two sentences in the top-left corner of an otherwise empty panel,
            which reads as content that failed to lay out rather than as a step
            in progress. `items-center` plus `text-center` is the arrangement
            every other waiting, empty and failed state in this app already
            uses; this one step was the exception.

            THE COPY CHANGES WHILE IT RUNS, which is the other half of the same
            instruction. See `RotatingText`: the phrases are the work in the
            order it actually happens, so the changing line is a progress
            report rather than a screensaver. That matters here more than
            anywhere else in the app, because this step waits on somebody
            else's web page and a model, and it is the one place a reader has
            no other signal that anything is still happening.
          */
          <div
            className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"
            data-add-loading
            role="status"
          >
            {/* The illustration of the step, not a decoration beside it: the
                scan line crossing a document is the only thing on screen that
                shows the posting being read. It carries its own sr-only label
                so it is correct anywhere; here the region above already speaks
                for it, which is the same arrangement the spinner it replaced
                had. */}
            <AnalyzingDocument className="size-12 text-text-muted" />
            <p className="text-body-m text-text-primary">
              <RotatingText phrases={READ_STEPS} />
            </p>
            <p className="max-w-prose text-body-s text-text-muted">
              Reading the page and organising what it says — the company, role, salary and
              location, and the description broken into sections. This takes a few seconds.
            </p>
          </div>
        )

      case 'review':
      default:
        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <p className="text-body-m text-text-primary">
                {readError
                  ? 'Fill this in yourself, or try the read again.'
                  : 'Does this look right? Correct anything that does not, then save.'}
              </p>
              {/* THE SAME `AlertCircleIcon` + `text-status-rejected-mark` ROW
                  `PanelSection` DRAWS A FAILED READ WITH, so a posting that
                  could not be read reads as the same kind of fact here as it
                  does on the record's panels -- and visibly not the same kind
                  as the grey note below it, which reports a read that
                  WORKED. The glyph's one-shot shake runs when the branch
                  mounts, which is when the failure appears and not while it
                  sits there being read.

                  IT IS NOT A CONFIRM DIALOG. `ConfirmDialog` is this app's
                  other destructive-action shape, and it is wrong here twice
                  over: this failure arrived unasked, so there is nothing to
                  confirm, and it would open a second modal over the one the
                  reader is already in. */}
              {readError ? (
                <div className="mt-1 flex flex-col gap-3" data-add-read-error>
                  <div className="flex items-start gap-2 text-body-s text-status-rejected-mark">
                    <AlertCircleIcon
                      size={16}
                      aria-hidden
                      className={cn('mt-0.5 shrink-0', ICON_STATE_MOTION.refuse)}
                    />
                    <p data-add-note>{readError}</p>
                  </div>
                  {/* `secondary` AND `ghost`, NEITHER OF THEM PRIMARY. The
                      record below this carries `Save application`, which is
                      the one thing this step is for; a filled orange button
                      up here would outrank it and point at the recovery
                      rather than at finishing. */}
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="secondary" size="s" onClick={() => void goRead()}>
                      try again
                    </Button>
                    {/* RED AT REST, the rule `IconButton`'s `danger` tone
                        settled: a control that only admits what it does once
                        the pointer is on it is a control somebody can press
                        without ever having been told. Its focus ring turns
                        red with it, because the accent means "this is the
                        action we want you to take". */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="s"
                      className="text-status-rejected-mark hover:bg-status-rejected-mark/10 hover:text-status-rejected-mark focus-visible:ring-status-rejected-mark"
                      onClick={discardRead}
                    >
                      discard
                    </Button>
                  </div>
                </div>
              ) : (
                readNote && (
                  <p className="text-body-s text-text-muted" data-add-note>
                    {readNote}
                  </p>
                )
              )}

              {/* THE ONE ROUTE LEFT, AS A LINK RATHER THAN A SENTENCE.
                  Measured 2026-09-19: a board that refuses our server serves
                  the same posting to an ordinary browser with a full
                  `JobPosting` JSON-LD in it -- the best source this parser
                  has. The bookmarklet hands that page over, and it has been
                  shipped and unlinked since it was written, so the reader who
                  needs it has never been told. It opens in a new tab because
                  this dialog is holding a half-finished application. */}
              {handover && (
                <p className="text-body-s text-text-muted" data-add-handover>
                  Your own browser can still read it.{' '}
                  <a
                    href="/bookmarklet"
                    target="_blank"
                    rel="noreferrer"
                    className="text-text-primary underline underline-offset-2 hover:text-accent"
                  >
                    Install the posting bookmarklet
                  </a>
                  , open the posting, and click it — the page comes back here with
                  its fields already read.
                </p>
              )}
            </div>
            <ApplicationRecordView
              job={null}
              layout="review"
              form={form}
              defaultCurrency={defaultCurrency}
              // The model's turn is part of the save from the reader's side:
              // one press, one wait, one outcome. Splitting it into a second
              // spinner would describe our architecture rather than their
              // action.
              saving={saving || digesting}
              onPostingPasted={readPastedPosting}
              onSubmit={submitWithDigest}
              resumes={resumes}
              linkedResumeId={resumeId || null}
              onLinkedResumeChange={(next) => {
                setResumeId(next ?? '')
                onLinkedResumeChange?.(next)
              }}
              submitLabel="Save application"
            />
          </div>
        )
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size={step === 'review' ? 'xl' : 'l'}
      title="new application"
      icon="Briefcase"
      description="four steps, and the model does three of them."
      headerSeparator={false}
    >
      <div className="flex flex-col gap-6">
        <WizardProgress current={index} />
        <Separator />
        {stepBody()}

        {/* The review step carries its own save-and-back row inside the record
            view, so this bar belongs to the first two steps only. */}
        {(step === 'link' || step === 'status') && (
          <div className="flex items-center gap-3 border-t border-border-subtle pt-5 max-sm:[&_button]:h-11 max-sm:[&_button]:flex-1">
            {step === 'link' ? (
              // DISABLED UNTIL THERE IS SOMETHING TO READ. `normalizePostingUrl`
              // completes a bare domain, so "acme.com/jobs/1" counts; only an
              // empty field is nothing. The shape is still checked on click,
              // because "looks like a URL" and "is non-empty" are different
              // questions and only the second one should gate a button --
              // disabling on the first would leave somebody mid-type staring
              // at a dead control.
              <Button
                disabled={!normalizePostingUrl(draft.url)}
                onClick={() => {
                  const url = normalizePostingUrl(draft.url)
                  if (!/^https?:\/\/.+/i.test(url)) {
                    setLinkError('That does not look like a web address.')
                    return
                  }
                  set('url', url)
                  setStep('status')
                }}
              >
                continue
                <ArrowRightIcon size={16} aria-hidden className={iconMotion('forward')} />
              </Button>
            ) : (
              // NO `back` (Gabe, 2026-09-11: "it destroys the whole process of
              // creation"). Nothing is stranded by its removal: the review step
              // renders every field open, the posting URL among them, so a
              // mistyped link is still fixable -- one step further on rather
              // than one step back.
              <Button onClick={() => void goRead()} disabled={autofilling}>
                {autofilling ? <CssSpinner size={14} /> : null}
                fill it in
                <ArrowRightIcon size={16} aria-hidden className={iconMotion('forward')} />
              </Button>
            )}
          </div>
        )}
      </div>
    </AppDialog>
  )
}

/**
 * A blank draft, for resetting between openings.
 *
 * IT DELEGATES rather than restating the eighteen fields. This was a hand-kept
 * copy of `draftFromJob(null, currency)` and it had already drifted once --
 * `interviewAt` landed on `RecordDraft` and this literal did not know, which
 * the compiler caught only because the type is exhaustive. One definition of
 * "empty" is the point of `draftFromJob` taking a nullable job at all.
 */
function emptyDraft(currency: SupportedCurrency): RecordDraft {
  return draftFromJob(null, currency)
}
