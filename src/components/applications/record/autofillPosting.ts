'use client'

import { normalizePostingUrl, type RecordDraft } from './useRecordDraft'
import { minedDraftFields } from './digest'
import type { PostingDigestResult } from './digest'
import { isSupportedCurrency } from '@/services/userPreferences'
import type { JobAutofillResult, WorkMode } from '@/types'
import type { StepId } from './wizardStepModel'

/**
 * The wizard's read step: fetch the posting, fill what it can, move on.
 *
 * SPLIT OUT OF `AddApplicationDialog` ON 2026-09-11 (505 lines). It was a
 * 103-line async flow closing over nine values in the middle of a dialog, and
 * the only way to exercise it was to mount the whole wizard and drive it with
 * clicks. The nine are now a parameter object -- a wide signature, and that is
 * the honest shape: this step really does touch the draft, the step cursor,
 * two notes and two callbacks, and hiding that in a closure did not make it
 * fewer.
 *
 * IT NEVER BLOCKS ON THE FETCH. Extraction depends on a page nobody here
 * controls, so every failure path still advances to review with whatever it
 * got; the description column beside the fields takes a paste. Making the
 * unreliable half the required half is how a wizard strands somebody on step
 * three.
 *
 * A FAILURE IS NOT A NOTE (2026-09-17). Every path used to land in
 * `setReadNote` -- one grey sentence under "Does this look right?" -- so "the
 * page was read" and "the page refused us" were the same typographic object,
 * and the only thing distinguishing them was the reader parsing the sentence.
 * The failing path has its own channel now because it is the only one with
 * ANYTHING TO DO about it: a read that failed can be run again, and a link
 * that will never open can be thrown away. A note cannot carry buttons.
 */

export interface AutofillPostingOptions {
  draft: RecordDraft
  /** Fills only the fields the user has not already typed into. */
  fillEmpty: (patch: Partial<RecordDraft>) => void
  /** Merges a patch over the draft, for fields extraction is authoritative on. */
  replace: (next: Partial<RecordDraft>) => void
  setStep: (step: StepId) => void
  setReadNote: (note: string) => void
  /**
   * Says the read FAILED, as opposed to the note, which says how it went.
   *
   * Separate because the review step draws them differently and offers only
   * this one a way out -- see the docblock above. Set to '' on every run, so a
   * second attempt clears the first attempt's failure whatever its outcome.
   */
  setReadError: (message: string) => void
  onAutofill?: (url: string, html?: string) => Promise<JobAutofillResult>
  /**
   * Page source the caller already holds, from the bookmarklet.
   *
   * Its presence changes what the SERVER does -- the extractor parses this and
   * fetches nothing -- which is why it travels all the way down here rather
   * than being resolved higher up: this is the function that decides a read
   * happens at all.
   */
  html?: string
  onDigest?: (url: string) => Promise<PostingDigestResult>
}

export async function autofillPosting({
  draft,
  fillEmpty,
  replace,
  setStep,
  setReadNote,
  setReadError,
  onAutofill,
  onDigest,
  html,
}: AutofillPostingOptions): Promise<void> {
    setStep('fill')
    setReadNote('')
    setReadError('')

    const url = normalizePostingUrl(draft.url)
    if (!onAutofill || !url) {
      // A NOTE AND NOT AN ERROR, both of them: neither has a read to retry.
      // The first step will not advance without a link and this component is
      // only mounted with `onAutofill` in the app, so these are the states
      // that should be impossible rather than the ones that go wrong.
      setReadNote(
        onAutofill
          ? 'No link to read. Paste the posting into the description column beside these fields.'
          : 'Reading a posting is not available here. Fill the application in below.'
      )
      setStep('review')
      return
    }

    let description = ''
    try {
      const result = await onAutofill(url, html)
      const values = result.values
      const next: Partial<RecordDraft> = {}
      if (values.company) next.company = values.company
      if (values.role) next.role = values.role
      if (values.location) next.location = values.location
      if (values.source) next.source = values.source
      // Guarded against the union: this arrives from a remote page, and an
      // unrecognised string would put the select into a state no option
      // matches.
      if (values.work_mode && ['remote', 'hybrid', 'onsite'].includes(values.work_mode)) {
        next.workMode = values.work_mode as WorkMode
      }
      if (values.salary_min != null) next.salaryMin = String(values.salary_min)
      if (values.salary_max != null) next.salaryMax = String(values.salary_max)
      // THE CURRENCY TRAVELS WITH THE FIGURES. A peso range stored under the
      // account's default relabels a number without converting it.
      if (values.salary_currency && isSupportedCurrency(values.salary_currency)) {
        next.currency = values.salary_currency
      }
      if (values.description) {
        description = values.description
        next.description = values.description
      }
      if (values.tech_stack?.length) next.techStack = values.tech_stack.join(', ')
      if (values.tags?.length) next.tags = values.tags.join(', ')
      replace(next)
      // `source` IS NOT A FILLED FIELD, and that is the whole reason this is
      // not one template string any more. A board that answers a bot
      // challenge still returns 200: `autofill_from_url_alone` hands back the
      // site's own name off the HOSTNAME and nothing else, no field read from
      // any posting. This branch then appended "Check every field before
      // saving" to a form where nothing had been filled -- two sentences after
      // the warning had told the reader the posting could not be fetched and
      // asked them to paste it in themselves. It reads as "we filled these in,
      // go check them", on a page the app never read.
      //
      // The throw branch below has always said "Nothing was filled in."
      // correctly. This is the same sentence for the case that fails with a
      // 200 instead of an exception.
      const filled = Object.keys(next).some((field) => field !== 'source')
      setReadNote(
        [
          result.warnings?.length
            ? result.warnings.join(' ')
            : filled
              ? 'Filled from the posting.'
              : 'Nothing was filled in.',
          // ONLY WHERE THERE IS SOMETHING TO CHECK. An instruction to verify
          // an empty form is noise standing between the reader and the advice
          // that actually gets them unstuck.
          filled ? 'Check every field before saving.' : '',
        ]
          .filter(Boolean)
          .join(' ')
      )
    } catch (err) {
      // IT NAMED A BUTTON DELETED ON 2026-09-10. This said "press 'tidy and
      // summarise'", and that control went when the wizard began summarising
      // what it FETCHES -- so the sentence was only ever read by the one
      // person the digest never runs for, and it sent them hunting the screen
      // for a control that is not on it. A page that cannot be read is
      // already the app looking broken; adding a dead instruction to it is
      // how somebody concludes the whole flow is.
      //
      // WHAT IT SAYS NOW IS THE TRUE VERSION OF THE SAME ADVICE. Nothing was
      // filled in, because this throw happens before `replace`. The
      // description column is to the right of the fields on a wide screen and
      // under them on a narrow one. This sentence has now been wrong in both
      // directions, which is why it is worth one comment: it first promised a
      // `tidy and summarise` button that had been deleted, was corrected to
      // promise nothing ("saved exactly as you paste it") because `onDigest`
      // genuinely ran only on FETCHED postings -- and as of 2026-09-17 the
      // save digests a pasted description too, so the honest sentence is the
      // one that says so. Copy describing a capability has to be changed by
      // whoever changes the capability; see AddApplicationDialog's
      // `submitWithDigest`.
      setReadError(
        `${err instanceof Error ? err.message : 'Could not read that posting.'} ` +
          'Nothing was filled in. Paste the posting into the description column ' +
          'beside these fields and it will be tidied and summarised when you save.'
      )
    }

    // TIDIED AND SUMMARISED IN THE SAME PASS, so the review step shows a
    // paragraph rather than eight hundred words. This is the auto-summarise
    // that replaced the `tidy and summarise` button (Gabe, 2026-09-10) -- it
    // is the only place the digest runs now, so it also has to apply the
    // fields the digest mines out of the posting.
    //
    // Its own try/catch: a failed restructure must not throw away a
    // description the fetch did recover.
    if (onDigest && description.trim()) {
      try {
        const digest = await onDigest(description)
        // `description`, NOT `formatted` (Gabe, 2026-09-14: "read and
        // understand the job posting first, then generate a structured job
        // description"). `formatted` is the advert with its decoration taken
        // off; `description` is the same posting reorganised under headings,
        // and it falls back to `formatted` on its own when the restructure
        // could not be verified -- so there is nothing to choose between here.
        replace({ description: digest.description })
        // ONE MAPPER, SHARED WITH THE PASTE PATH -- see `minedDraftFields` for
        // why the union guards live in one place.
        //
        // EMPTY FIELDS ONLY, and through `fillEmpty` rather than a comparison
        // against `draft`: the auto-fill above has not landed in the closure
        // this is reading, so anything checked here would look empty and the
        // digest would overwrite what the extractor just found.
        fillEmpty(minedDraftFields(digest.fields))
      } catch {
        // The untidied description is still the right thing to keep.
      }
    }

    setStep('review')
  }
