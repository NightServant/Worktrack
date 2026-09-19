'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { LazyPanel } from '@/components/ui/lazy-panel'

/**
 * THE ATS RING IS CODE-SPLIT (2026-09-11). It is the last thing pulling
 * recharts into this screen's first load, and it sits inside a panel most
 * visits never look at -- on /applications it lives in a dialog that starts
 * closed.
 *
 * `ssr: false` for the same reason as every other chart here: recharts
 * measures its container before drawing, and its `useId`-derived chart id was
 * a hydration mismatch between server and client.
 */
const AtsDonut = dynamic(() => import('@/components/ui/ats-donut').then((m) => m.AtsDonut), {
  ssr: false,
  loading: () => <LazyPanel height="h-40" label="the ATS score" />,
})
import { Button } from '@/components/ui/button'
import { PanelSection } from '@/components/ui/panel-section'
import { AtsTermChips, AtsVerdict } from '@/components/ui/ats-verdict'
import { verdictFor } from '@/components/ui/ats-verdict-copy'
import { CssSpinner } from '@/components/ui/css-spinner'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { authedFetch } from '@/lib/authedFetch'
import { matchKeywords, type KeywordMatch } from '@/services/atsMatch'
import type { TailoringResult } from '@/services/integrations/tailoring'
import type { ResumeContent } from '@/services/resumeService'
import type { Job } from '@/types'
import { ApplicationPicker } from './ApplicationPicker'
import { applySuggestions, tailoredTitle } from './applyTailoring'

/**
 * AI CV tailoring: one section, from the posting to the tailored document.
 *
 * WHY THIS IS ONE SECTION AND NOT THREE (Gabe, 2026-09-13: "AI tailoring
 * section must be merged with ATS scoring"). It was a "tailor to" panel with
 * the picker, an "ATS match" panel with the score, and an "AI tailoring" panel
 * with the button -- three headings for one question asked once. They share an
 * input (the posting on the selected application) and they read in a single
 * order: what am I tailoring to, how does the CV do against it, rewrite it.
 * Three panel headings made that look like three features you configure
 * separately. One section with hairline rules between the blocks says the
 * opposite, and it is what the rest of the app already does with grouped
 * content -- rules, never cards and never filled boxes.
 *
 * THE SCORE IS NOT COMPUTED BY THE MODEL. `matchKeywords` is deterministic,
 * in-repo and tested, and a number the user is going to act on should not come
 * back different every time they ask for it. The model is used only for the
 * part that genuinely needs language -- rewriting a line so it says the thing
 * the posting asks for -- and the prompt forbids invention.
 *
 * NOTHING IS APPLIED TO THE OPEN DOCUMENT. It used to be: every suggestion
 * carried an `apply` that edited the CV on screen, so accepting the model's
 * work destroyed the version you were comparing it against. The rewrites now
 * land in a NEW document and the open one is never touched -- which is also
 * the honest answer to "a tool that silently rewrote someone's employment
 * history". The original survives the experiment.
 */

export type TailoringOutcome =
  /** Handed to `onTailored`; the route is creating the document and leaving. */
  | { kind: 'created' }
  /**
   * The route REWROTE the open document instead of adding one, because it had
   * already been tailored for this application. Its own outcome because the
   * two end differently: `created` navigates away, this one stays put, and
   * telling someone a document is "opening" when the page is not going to
   * change is how a control comes to look broken.
   */
  | { kind: 'updated' }
  /** Every suggestion missed. Deliberately NOT a new document -- see below. */
  | { kind: 'unchanged' }
  /**
   * The rail was mounted without anywhere to put a new document (the editors
   * render like this in tests, and `onTailored` is optional so they can). The
   * request still ran, so say what it produced rather than silently doing nothing.
   */
  | { kind: 'unsaved'; count: number }

export interface CvTailoringState {
  jobId: string
  setJobId: (id: string) => void
  /**
   * THE WISHLIST, AND ONLY THE WISHLIST (Gabe, 2026-09-13). Tailoring is work
   * you do BEFORE applying; a posting you have already sent this CV to cannot
   * be tailored to any more. Filtered here rather than at the picker because
   * this hook also resolves `selectedJob` out of the same list, and two lists
   * is how the hook ends up holding a selection the picker cannot show.
   */
  jobs: Job[]
  /**
   * The posting being tailored against -- always the selected application's
   * stored description.
   *
   * THE PASTE BOX IS GONE (Gabe, 2026-09-05). It was a second place a posting
   * could live, and a second place is a fork: paste one thing, select another,
   * and the rail had to grow a rule about which wins and a sentence explaining
   * it. An application already has a `description` field, and it is the field
   * the ATS panel, the record view and the autofill all read. One posting, one
   * home. If it is missing, the fix is to put it on the application, which is
   * where every other part of the app will then find it too.
   */
  description: string
  match: KeywordMatch | null
  running: boolean
  result: TailoringResult | null
  outcome: TailoringOutcome | null
  run: () => Promise<void>
  selectedJob: Job | null
  /**
   * The application this DOCUMENT was tailored for, or null when the target is
   * still a choice. `ApplicationPicker` draws it instead of a search box.
   */
  tailoredFor: Job | null
  /**
   * Whether `result` is the last run read back out of storage rather than
   * something this session paid a model call for. The rail says so -- a
   * verdict with no visible provenance is one somebody re-runs to be sure.
   */
  restored: boolean
}

export interface CvTailoringOptions {
  cvText: string
  /** Every application the account has; the wishlist is taken out of it here. */
  jobs: Job[]
  /**
   * Applications that already have a document attached to them.
   *
   * THEY ARE NOT OFFERED AGAIN (Gabe, 2026-09-19: "wishlisted jobs with
   * tailored CVs must not appear in the component itself"). Tailoring pins the
   * CV it writes to the application it wrote it for, so a job in this list has
   * been through here already, and a picker that keeps offering it is a list
   * of work somebody has finished.
   *
   * A PROP, NOT A READ IN HERE, like `jobs` above and for the same reason: the
   * route owns every read in this app, which is what lets these screens render
   * in a test with plain props and no QueryClient.
   *
   * THE DOCUMENT'S OWN TARGET IS NOT AFFECTED. `tailoredFor` resolves out of
   * every application rather than out of this filtered list -- see below --
   * so re-opening a tailored CV still shows and scores the posting it was
   * written for, which is exactly the one this filter would otherwise hide.
   */
  linkedJobIds?: string[]
  /**
   * WHICH APPLICATION IS SELECTED, OWNED BY THE EDITOR (2026-09-14).
   *
   * This was `React.useState('')` in here until cover letters arrived, and it
   * moved out for a reason that has nothing to do with tailoring. A cover
   * letter must not call this hook AT ALL -- see `TailoringRailPane` -- so the
   * call had to drop below the kind branch, into the component that renders
   * the pane. But the tab STRIP is a different `DocumentWorkspace` slot, and
   * it marks the tailor tab "needs an application" until one is picked. One
   * string crosses that seam, so one string is lifted; everything else the
   * hook owns stays here.
   *
   * NOT MIRRORED, LIFTED. The cheap version was an `onJobId` notification with
   * the state still living in here, and it is the same two-lists mistake this
   * hook and the picker were merged to kill on 2026-09-13: two copies of a
   * selection, one of which is a render behind. There is one copy, and this is
   * the hook reading it rather than holding it.
   */
  jobId: string
  onJobId: (id: string) => void
  /**
   * The document as it stands, read ONLY when the button is pressed.
   *
   * A getter rather than a value: `cvText` is re-read on every render because
   * a score against a stale copy is worse than no score, but serialising the
   * whole Tiptap tree on every keystroke to feed a button nobody has clicked
   * is a different trade entirely.
   */
  getContent?: () => ResumeContent | null
  /** The open document's title; the new one is named from it. */
  title?: string
  /**
   * The open document's row id, and HALF OF THE CACHE KEY (Gabe, 2026-09-17:
   * reopening a document should show the last analysis rather than spending
   * another model call for the answer it already had).
   *
   * OPTIONAL, AND NO ID MEANS NO CACHE -- never a fallback to the title. A
   * cached run belongs to one (document, application) pair, and a title is
   * neither unique nor stable: two roles at one company produce the SAME
   * tailored name, and every document here is renameable in place. Keying on
   * it would eventually print one file's analysis under another's, which is
   * the one failure this cache must not have. An editor mounted without a
   * route -- which is how the tests render these -- simply re-runs.
   */
  documentId?: string
  /**
   * The application this document was ALREADY tailored for, when it is a
   * tailored CV (Gabe, 2026-09-17: a tailored CV "must not offer the picker").
   *
   * THE FILE'S TARGET IS DECIDED THE MOMENT IT IS WRITTEN. `/cv` creates a
   * tailored CV keyed to an application and pins the `application_documents`
   * row that makes the next run a rewrite rather than a tenth copy. A combobox
   * in front of that offers a choice with nothing behind it: picking a
   * different posting does not re-target the file, it only scores a CV written
   * for one employer against another employer's words.
   *
   * AN ID, NOT A COMPANY AND A ROLE. This hook already resolves applications
   * out of `jobs`; two strings passed alongside an id are two strings that can
   * disagree with it, and the picker's whole history is about not holding a
   * second copy of the selection.
   */
  tailoredForJobId?: string
  /**
   * Where a tailored document goes. Optional because the route owns every
   * write in this app and the editors have to stay renderable without one.
   */
  /**
   * `jobId` IS THE WHOLE VERSIONING DECISION, and it is why this carries more
   * than a title and a body. A tailored CV used to be a new document every
   * time, so re-tailoring the same application five times left five files with
   * the same name. The route needs to know WHICH application this run was for
   * to tell "a new application" (a new file) from "this one again" (a rewrite
   * of the file already tailored for it), and only this hook knows.
   */
  onTailored?: (input: {
    title: string
    content: ResumeContent
    jobId: string
  }) => Promise<'created' | 'updated' | void>
  fetchImpl?: typeof fetch
}

/**
 * THE LAST RUN, REMEMBERED PER BROWSER (Gabe, 2026-09-17).
 *
 * `localStorage`, under the `worktrack:` prefix, because that is what this
 * codebase already does with per-viewer state of this kind -- see the rail tab
 * remembered under `worktrack:document-tab`. This is not account data: it is
 * one person's last look at one file, and putting it in Supabase would mean a
 * table, a policy and a write on a path that is already spending a metered
 * model call.
 *
 * THE KEY IS THE PAIR, AND THAT IS THE WHOLE CORRECTNESS ARGUMENT. An analysis
 * is about this document against THIS posting; showing it over a different
 * document, or the same document against a different application, is a
 * confident lie rather than a stale convenience. Both ids are in the key, so a
 * miss is a miss -- there is no nearest match to fall back to.
 *
 * ONLY A SUCCESSFUL RUN IS KEPT. A rate limit or a dropped connection is a
 * fact about a minute ago, not about the document, and re-running after one is
 * exactly what should happen.
 *
 * EVERY READ AND WRITE IS WRAPPED. Private windows and blocked site data throw
 * on access, and a cleared store returns null or JSON that no longer parses;
 * the section has to render the same either way, so a failure here resolves to
 * "no cached run" rather than to an error.
 */
const TAILORING_CACHE_PREFIX = 'worktrack:tailoring:'

function cacheKey(documentId: string, jobId: string): string {
  return `${TAILORING_CACHE_PREFIX}${documentId}:${jobId}`
}

/** The last successful run for this pair, or null for anything else. */
function readCachedRun(documentId: string, jobId: string): TailoringResult | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(documentId, jobId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    // SHAPE-CHECKED, NOT CAST. Anything can be under a localStorage key -- an
    // older version of this value, another tab's half-written write, a user
    // with devtools open -- and `suggestions.length` on a cast `any` is how a
    // rail renders a crash instead of a panel.
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { ok?: unknown }).ok !== true ||
      !Array.isArray((parsed as { suggestions?: unknown }).suggestions)
    ) {
      return null
    }
    return parsed as TailoringResult
  } catch {
    return null
  }
}

function writeCachedRun(documentId: string, jobId: string, result: TailoringResult): void {
  try {
    window.localStorage.setItem(cacheKey(documentId, jobId), JSON.stringify(result))
  } catch {
    // Private mode, blocked site data, or a full quota. Remembering a run is a
    // convenience; failing to is not worth taking the section down with it.
  }
}

/**
 * Owns the tailoring state for one document.
 *
 * A hook rather than state inside the rail, because the score and the rewrite
 * are one pass over one posting and the editor needs the selected job for the
 * new document's name.
 */
export function useCvTailoring(options: CvTailoringOptions): CvTailoringState {
  const { jobId, onJobId, documentId = '', tailoredForJobId = '' } = options
  const [running, setRunning] = React.useState(false)
  const runningRef = React.useRef(false)
  const [result, setResult] = React.useState<TailoringResult | null>(null)
  const [outcome, setOutcome] = React.useState<TailoringOutcome | null>(null)
  /** True while `result` is the cached run rather than this session's. */
  const [restored, setRestored] = React.useState(false)

  const linked = React.useMemo(
    () => new Set(options.linkedJobIds ?? []),
    [options.linkedJobIds]
  )

  const jobs = React.useMemo(
    () =>
      options.jobs.filter(
        (job) =>
          job.status === 'wishlist' &&
          // ALREADY TAILORED FOR, EXCEPT THE ONE THIS DOCUMENT IS FOR. Keeping
          // the open document's own target in the list is what lets a
          // re-tailor of the same CV against the same posting still resolve a
          // selection here rather than falling back to nothing.
          (!linked.has(job.id) || job.id === tailoredForJobId)
      ),
    [options.jobs, linked, tailoredForJobId]
  )

  /**
   * The application this file was tailored for, resolved out of EVERY
   * application rather than out of the wishlist above.
   *
   * The wishlist filter exists so the hook cannot hold a selection the picker
   * refuses to show. A tailored CV's target was never chosen from that list --
   * it was decided when the file was written -- and by the time anyone reopens
   * the document the posting has usually moved to `applied`, which is the
   * whole point of having tailored it. Filtering here would blank the target,
   * the posting and the score on exactly the documents that have one.
   */
  const tailoredFor = React.useMemo(
    () => (tailoredForJobId ? (options.jobs.find((job) => job.id === tailoredForJobId) ?? null) : null),
    [options.jobs, tailoredForJobId]
  )

  /**
   * `tailoredFor` WINS OVER THE LIFTED ID, and it has to for one commit.
   *
   * The id lives in the editor (see `CvTailoringOptions`), so a tailored CV
   * mounts with it empty and the effect below is what fills it in -- which
   * lands AFTER the first paint. Reading the selection out of `jobs` alone
   * would therefore draw the locked target above "pick an application above to
   * score this CV", a sentence with no picker under it to act on.
   */
  const selectedJob = React.useMemo(
    () => tailoredFor ?? jobs.find((job) => job.id === jobId) ?? null,
    [tailoredFor, jobs, jobId]
  )

  /**
   * The lifted id catches up to the file's own target.
   *
   * NOT A SECOND COPY OF THE SELECTION. `jobId` is the one copy and it lives in
   * the editor, because the tab strip in another workspace slot reads it to
   * mark the tailor tab "needs an application"; this writes THROUGH the same
   * setter rather than keeping a private id beside it. A tailored CV with an
   * empty selection would leave that tab badged as unfinished over a document
   * whose target was settled before it existed.
   */
  React.useEffect(() => {
    if (tailoredFor && tailoredFor.id !== jobId) onJobId(tailoredFor.id)
  }, [tailoredFor, jobId, onJobId])

  /**
   * The last run for this pair, back on screen without paying for it again.
   *
   * KEYED ON BOTH IDS, so switching applications inside one document reads a
   * different entry and finding nothing leaves the section blank rather than
   * showing the previous posting's answer. Nothing is written back here: this
   * effect only ever reads, so a restore cannot overwrite a live run.
   */
  React.useEffect(() => {
    if (!documentId || !jobId) return
    const cached = readCachedRun(documentId, jobId)
    if (!cached) return
    setResult(cached)
    setRestored(true)
  }, [documentId, jobId])

  const description = selectedJob?.description?.trim() ?? ''

  const match = React.useMemo(
    () => (description && options.cvText.trim() ? matchKeywords(options.cvText, description) : null),
    [description, options.cvText]
  )

  const run = React.useCallback(async () => {
    if (!description.trim() || !options.cvText.trim()) return
    // A REF, NOT THE STATE FLAG. `disabled={running}` is the visible guard and
    // it is a render behind: two clicks inside one frame both see `running`
    // false and both spend the metered allowance. This is the guard that
    // actually holds.
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setResult(null)
    setOutcome(null)
    // Whatever is on screen is about to be this session's own answer.
    setRestored(false)
    /**
     * Whether the new document has been handed to the route.
     *
     * ONCE IT HAS, THIS BUTTON IS NOT COMING BACK (found in review,
     * 2026-09-13). The route answers `onTailored` with `router.push`, which
     * RETURNS before the navigation lands -- so re-enabling in `finally` left
     * a live `tailor this CV` sitting under the words "opening the new
     * document" for as long as the route took to settle. A press in that
     * window spends the allowance again and can file a duplicate document
     * under the identical title. The editor is about to unmount; there is
     * nothing to re-enable it for.
     */
    let handedOff = false
    // authedFetch, not fetch: the route is authenticated because tailoring
    // spends a metered LLM allowance.
    const doFetch = options.fetchImpl ?? authedFetch
    try {
      let payload: TailoringResult
      try {
        // Through the app's own route, never straight at the provider: the key
        // lives on the server and must not reach the browser.
        const response = await doFetch('/api/tailor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cvText: options.cvText,
            jobDescription: description,
            missingKeywords: match?.missing ?? [],
            role: selectedJob?.role,
            company: selectedJob?.company,
          }),
        })
        payload = (await response.json()) as TailoringResult
      } catch {
        setResult({
          ok: false,
          reason: 'network',
          message: 'Could not reach the tailoring service.',
        })
        return
      }

      setResult(payload)
      if (!payload.ok) return
      // REMEMBERED HERE, not after the document is written. This is the half
      // that cost a model call; whether the route could then save a file is a
      // different failure, and re-running the model to retry a save would
      // spend the allowance to fix something the allowance did not break.
      if (documentId && jobId) writeCachedRun(documentId, jobId, payload)

      const current = options.getContent?.() ?? null
      if (!current || !options.onTailored) {
        setOutcome({ kind: 'unsaved', count: payload.suggestions.length })
        return
      }

      // A COPY. `applySuggestions` returns the input by reference when nothing
      // matched, which is how a run that changed nothing is told apart from
      // one that changed everything -- without that, a model answering "no
      // notes" would file a byte-identical second CV under a new name.
      const content = applySuggestions(current, payload.suggestions)
      if (content === current) {
        setOutcome({ kind: 'unchanged' })
        return
      }

      try {
        const wrote = await options.onTailored({
          title: tailoredTitle(options.title ?? '', selectedJob?.company),
          content,
          jobId,
        })
        // `updated` stays on this page, so the rail is still mounted to show
        // it; `created` navigates, and `handedOff` keeps the button disabled
        // through the unmount rather than flickering back to life first.
        handedOff = wrote !== 'updated'
        setOutcome({ kind: wrote === 'updated' ? 'updated' : 'created' })
        if (wrote === 'updated') {
          runningRef.current = false
          setRunning(false)
        }
      } catch (err) {
        // The rewrite is not the part that failed, and saying "tailoring
        // failed" would send someone to re-run a request that costs allowance.
        //
        // THE THROWN MESSAGE WINS WHERE THERE IS ONE. Two different things
        // reach this branch -- the new CV could not be written, or the OPEN
        // one could not be flushed first (see the editors' `onTailored`) --
        // and only the second one has anything to do with unsaved edits.
        setResult({
          ok: false,
          reason: 'network',
          message:
            err instanceof Error && err.message
              ? err.message
              : 'The rewrite worked, but the new CV could not be saved. Try again.',
        })
      }
    } finally {
      // See `handedOff` above for the one case that stays disabled.
      if (!handedOff) {
        runningRef.current = false
        setRunning(false)
      }
    }
  }, [description, options, match, selectedJob, documentId, jobId])

  /**
   * Choosing a different application drops the previous run's answer.
   *
   * FOUND IN REVIEW (2026-09-13). `setJobId` only set the id, and `result` /
   * `outcome` were cleared at the top of `run`. So a rate-limit error raised
   * against Initech stayed on screen, in the error colour, under a score and a
   * chip list that had already updated to Globex -- a sentence about one
   * posting presented as a fact about another. Same for a stale "tailored --
   * opening the new document" if the navigation never landed.
   *
   * STILL CLEARED HERE NOW THAT THE ID LIVES IN THE EDITOR. The editor holds
   * the string; this hook holds what was computed FROM it, so the clearing
   * belongs on this side of the seam. Pushing it up would make every caller
   * responsible for remembering it, which is how the bug above came back.
   */
  const selectJob = React.useCallback(
    (next: string) => {
      onJobId(next)
      setResult(null)
      setOutcome(null)
      // The restore effect re-runs on the new id and may put a different
      // cached run here; clearing first is what stops the OLD posting's answer
      // from staying on screen when the new pair has nothing stored.
      setRestored(false)
    },
    [onJobId]
  )

  return {
    jobId,
    setJobId: selectJob,
    jobs,
    description,
    match,
    running,
    result,
    outcome,
    run,
    selectedJob,
    tailoredFor,
    restored,
  }
}

/**
 * `TailoringTargetRail` WAS HERE and it is gone (2026-09-13). It was a second
 * component holding a `<Select>` of every application, mounted opposite this
 * one so the editor had a "tailor to" panel on one side and a score on the
 * other. Once the picker moved into this section there was nothing left in it
 * but a heading, and a component that renders one control belonging to another
 * component's section is just a place for the two to disagree.
 *
 * `AnalysisEmphasis` went with it. It existed to serve two tabs -- one showing
 * the match, one showing the rewrites -- out of one rail, and the tabs were
 * merged on 2026-09-11. A prop with one live value is a branch nobody reads.
 */

/**
 * THE SCORE ARRIVES RATHER THAN SNAPPING INTO PLACE (Gabe, 2026-09-17: the
 * ring, the percentage and the matched/missing lists should animate).
 *
 * ONE PROGRESS, READ BY EVERYTHING. The arc, the number in the middle of it,
 * the legend counts and both chip inventories are four views of one match, and
 * four independent animations is how they come to disagree by a term
 * mid-flight. This hook owns the only clock; the rail derives every drawn
 * number from the frame it returns.
 *
 * IT ANIMATES THE COMPONENTS THAT ARE ALREADY THERE. `AtsDonut` draws its arc
 * from the matched/missing COUNTS (deliberately -- see its docblock, the ring
 * and the lists must agree), so sweeping those counts sweeps the ring without
 * a second chart, a charting library, or a recharts entry animation that has
 * already shipped a ring with no arcs in it at all. The chips arrive the same
 * way: the rail hands over as many terms as the frame has reached, so the
 * heading count and the list are the same fact moving together.
 *
 * FROM WHERE IT IS, NOT ALWAYS FROM ZERO. The first score sweeps up from an
 * empty ring, which is the arrival Gabe asked for; a score that CHANGES --
 * a re-tailored document, a different application, a keyword typed into the CV
 * -- travels from the number on screen to the new one. Restarting at zero on
 * every change would make an edit that moves the score by a point look like
 * the panel reloading, and `cvText` is re-read on every keystroke.
 *
 * THE DURATION IS THE DESIGN SYSTEM'S, READ OFF THE ROOT. `--duration-slow` is
 * what `progress-fill` uses for a bar filling, which is the same gesture. It
 * is read rather than hard-coded so retuning the token retunes this too; the
 * fallback is only for an environment with no stylesheet (jsdom, a test).
 *
 * THE EASING IS DECELERATION AND NOTHING ELSE. `--ease-decelerate` is
 * `cubic-bezier(0, 0, 0.2, 1)`; this is its arithmetic cousin, a quadratic
 * ease-out. A bezier solver for one ring is code nobody needs, and anything
 * with overshoot in it would make a diagnostic number bounce past itself --
 * this house's motion is restrained, and a score that overshoots 86% is a
 * score that briefly reports the wrong thing.
 *
 * UNDER REDUCED MOTION THERE IS NO CLOCK AT ALL, following `HeroScrollCue`:
 * not a shorter sweep and not a paused one, but the final frame committed
 * directly, so nothing can resume if the preference is re-evaluated. Two other
 * ways out land the same way, for the same reason `Reveal` has them -- a
 * hidden document (a background tab, a headless pane) has rAF paused, and an
 * environment without rAF never ticks, and in both cases a ring that waits for
 * a frame is a ring stuck at zero. A missing animation is cosmetic; a panel
 * reporting 0% is wrong.
 */
interface ScoreFrame {
  /** 0-100. The ring's centre number, and the panel's sr-only sentence. */
  score: number
  /** Matched terms on screen: the filled arc AND the matched chip list. */
  matched: number
  /** Missing terms on screen. The chip list only -- see the rail's `missing`. */
  missing: number
}

/** An empty ring: where the first sweep starts. */
const EMPTY_RING: ScoreFrame = { score: 0, matched: 0, missing: 0 }

/** Only reached where the `--duration-slow` token is not resolvable. */
const SWEEP_FALLBACK_MS = 400

function sweepDurationMs(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--duration-slow').trim()
  const ms = raw.endsWith('ms')
    ? Number.parseFloat(raw)
    : raw.endsWith('s')
      ? Number.parseFloat(raw) * 1000
      : Number.NaN
  return Number.isFinite(ms) && ms > 0 ? ms : SWEEP_FALLBACK_MS
}

function useScoreSweep(score: number | null, matched: number, missing: number): ScoreFrame {
  const reduced = usePrefersReducedMotion()
  const [shown, setShown] = React.useState<ScoreFrame>(EMPTY_RING)
  /**
   * What the last committed frame drew, so a new target can travel FROM it.
   *
   * A ref beside the state rather than a read of the state: the effect that
   * starts a sweep would otherwise have to list `shown` as a dependency, and a
   * sweep that restarts every time it advances a frame is a sweep that never
   * ends. Written only from the effect and its own frames.
   */
  const shownRef = React.useRef<ScoreFrame>(EMPTY_RING)

  React.useEffect(() => {
    // Nothing to score: the rail draws its own "pick an application" instead.
    if (score === null) return

    const to: ScoreFrame = { score, matched, missing }
    const land = () => {
      shownRef.current = to
      setShown(to)
    }

    if (
      reduced ||
      typeof requestAnimationFrame !== 'function' ||
      (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    ) {
      land()
      return
    }

    const from = shownRef.current
    // The terms in the posting, which is the whole the arc is a proportion of.
    const total = matched + missing
    const started = Date.now()
    const duration = sweepDurationMs()
    let frame = 0

    const step = () => {
      // `Date.now`, not the frame's own timestamp: the timestamp is a
      // high-resolution clock that fake timers do not advance, so a test that
      // drives 500ms of frames would watch the sweep sit at zero for all of
      // them. Millisecond resolution is plenty for a 400ms travel.
      const t = Math.min(1, (Date.now() - started) / duration)
      if (t >= 1) {
        land()
        return
      }
      const eased = 1 - (1 - t) * (1 - t)
      const at = (a: number, b: number, ceiling: number) =>
        Math.max(0, Math.min(ceiling, Math.round(a + (b - a) * eased)))
      shownRef.current = {
        score: at(from.score, to.score, 100),
        matched: at(from.matched, to.matched, total),
        missing: at(from.missing, to.missing, total),
      }
      setShown(shownRef.current)
      frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // The VALUES, not the match object: `match` is rebuilt on every keystroke
    // because `cvText` is, and depending on it would restart the sweep on
    // characters that did not move the score.
  }, [score, matched, missing, reduced])

  /**
   * NEVER ZERO TERMS WHILE THERE IS ONE TO SHOW, applied on the way out rather
   * than inside the frames.
   *
   * `AtsTermChips` prints an empty-state sentence at zero terms -- "none of
   * the posting's terms appear in this CV yet" -- and the FIRST commit happens
   * before any frame has run, so without this floor every score starts with a
   * sentence that is about to be contradicted and a block that jumps when it
   * is. Flooring here covers that commit too; inside the loop it could not.
   */
  return {
    score: shown.score,
    matched: Math.max(matched > 0 ? 1 : 0, Math.min(shown.matched, matched + missing)),
    missing: Math.max(missing > 0 ? 1 : 0, shown.missing),
  }
}

/** The whole tailoring pane: pick a posting, read the match, rewrite the CV. */
export function TailoringAnalysisRail({ state }: { state: CvTailoringState }) {
  const { match, result, running, outcome, restored } = state
  // One sweep, read by the ring, the number and both inventories.
  const shown = useScoreSweep(
    match?.score ?? null,
    match?.matched.length ?? 0,
    match?.missing.length ?? 0
  )

  return (
    // `border-t-0 pt-0`: it is the first thing in the rail, so the section's
    // own rule would be a line under the tab strip.
    <PanelSection title="tailor to a job" icon="ShieldCheck" className="border-t-0 pt-0">
      {/* ONE: WHAT IT IS BEING TAILORED TO. */}
      <div className="flex flex-col gap-3">
        <ApplicationPicker
          jobs={state.jobs}
          value={state.jobId}
          onChange={state.setJobId}
          // Set on a tailored CV, and the picker then draws the target instead
          // of a search box. The decision is the hook's because only it knows
          // whether the id resolves to an application that still exists.
          tailoredFor={state.tailoredFor}
        />
        {state.selectedJob && !state.selectedJob.description && (
          // Not an error and not a dead end: the description lives on the
          // application, and adding it there is what makes this rail, the ATS
          // panel and the record view all work at once.
          <p className="text-body-s text-text-muted">
            that application has no job description saved, so there is nothing to score against.
            add one on the application.
          </p>
        )}
      </div>

      {/* TWO: THE REWRITE, AND IT SITS DIRECTLY UNDER THE PICKER.

          MOVED ABOVE THE SCORE (Gabe, 2026-09-15). The action used to come
          after the verdict, the ring and two chip lists that fold at twelve
          terms each -- so in a 320px rail the button was off the bottom of the
          panel, and the reason to scroll was invisible from where you chose
          the application. Picking a posting and tailoring against it is one
          gesture; the score is what you read afterwards, or not at all.

          THE SUGGESTION LIST WAS HERE. Each rewrite came back as a
          before/after card with its own `apply` button that edited the open
          document, which made taking the model's work a click per suggestion
          and left no copy of what the CV said before. The button now produces
          the tailored CV as a new document; that document IS the result, so
          there is nothing left to list. `result.summary` went with the list --
          it was a "suggested summary" printed under the rewrites with no way
          to take it, which is a suggestion in the sense that a poster is. */}
      <div className="flex flex-col gap-3 border-t border-border-subtle pt-5">
        {/* SAYS BOTH OUTCOMES, because there are two now. The old copy
            promised "a new document" and that "the one you have open is left
            exactly as it is", which stopped being true when re-tailoring the
            same application started rewriting the open file instead of adding
            a fourth copy of it. A control that misdescribes which document it
            is about to write is worse than one that says nothing. */}
        <p className="text-body-s text-text-muted">
          rewrites this CV against the posting. the first run for an application saves a new
          document; running it again for the same application updates that one.
        </p>

        <Button
          size="s"
          className="w-fit"
          onClick={() => void state.run()}
          disabled={running || !state.description.trim()}
        >
          {running && <CssSpinner size={14} />}
          {running ? 'tailoring' : 'tailor this CV'}
        </Button>

        {!state.description.trim() && (
          <p className="text-body-s text-text-muted">needs a posting to tailor against.</p>
        )}

        {result && !result.ok && (
          <p
            role="alert"
            className={
              // `unconfigured` is not an error: the capability was never set
              // up, and shouting about it in the error colour would say the
              // app failed at something it was never asked to do.
              result.reason === 'unconfigured'
                ? 'text-body-s text-text-muted'
                : 'text-body-s text-status-rejected-mark'
            }
          >
            {result.message}
          </p>
        )}

        {outcome?.kind === 'unchanged' && (
          // NO DOCUMENT FOR THIS ONE. Every suggestion missed -- either the
          // model had no notes, or it quoted text that spans nodes and could
          // not be found. Creating a second identical CV to report that would
          // leave the user deleting the evidence of a no-op.
          <p role="status" className="text-body-s text-text-muted">
            the model returned no changes this CV could take, so nothing was created.
          </p>
        )}

        {outcome?.kind === 'created' && (
          <p role="status" className="text-body-s text-text-muted">
            tailored — opening the new document.
          </p>
        )}

        {outcome?.kind === 'updated' && (
          // Stays on this page, so this is the only thing that tells the
          // reader the run landed -- there is no navigation to notice.
          <p role="status" className="text-body-s text-text-muted">
            tailored — this document was rewritten for the same application.
          </p>
        )}

        {outcome?.kind === 'unsaved' && (
          <p role="status" className="text-body-s text-text-muted">
            {outcome.count} rewrites came back, but this editor has nowhere to save a new
            document.
          </p>
        )}

        {restored && result?.ok && (
          // THE LAST RUN, AND IT SAYS SO. Reopening a tailored CV used to show
          // an empty section with a live button under it, so the only way to
          // learn what the model had already produced for this posting was to
          // spend another call and be told the same thing. Saying which run
          // this is matters as much as showing it: an answer with no
          // provenance is one somebody re-runs to be sure it is current.
          <p role="status" data-tailoring-restored className="text-body-s text-text-muted">
            already tailored for this application — {result.suggestions.length}{' '}
            {result.suggestions.length === 1 ? 'rewrite' : 'rewrites'} from the last run. running it
            again spends another model call.
          </p>
        )}
      </div>
      {/* THREE: HOW IT SCORES. Read like the application record's third column
          -- verdict in words, then the ring, then the two inventories -- from
          the same `ui/ats-verdict` pieces, because one score with two
          appearances is how two surfaces start disagreeing about a threshold.
          `limit={12}`, not the record's 24: this is a 320px rail, and both
          lists fold honestly with the count in the heading.

          MATCHED BEFORE MISSING, same as the record. The revision asked for
          the matched list "for positive reinforcement", and a list of failures
          above a list of wins reverses the point of showing them at all. */}
      <div className="flex flex-col gap-4 border-t border-border-subtle pt-5">
        {match === null ? (
          <p className="text-body-s text-text-muted">
            pick an application above to score this CV against its posting.
          </p>
        ) : (
          <>
            {/* THE FINAL SCORE, NOT THE SWEPT ONE. This is the verdict in
                words, and words that read "needs work" before settling on
                "strong" are the app changing its mind on screen. The sweep is
                for the quantities. */}
            <AtsVerdict score={match.score} />
            {/* Sizes itself by its CONTAINER rather than the viewport -- this
                rail is 320px on the same wide screen where the record dialog
                is roomy, and a viewport query cannot tell those apart. */}
            <AtsDonut
              score={shown.score}
              matched={shown.matched}
              /* THE WHOLE STAYS THE SIZE OF THE POSTING. The arc is a
                 proportion of the terms in the posting, so it can only SWEEP
                 if that total holds still: matched grows into a full-size
                 track and missing resolves down to meet it. Growing both from
                 zero keeps the ratio constant, which is a ring that fades in
                 rather than one that fills -- and it would print "terms in
                 posting: 0" in the legend on the way. */
              missing={match.matched.length + match.missing.length - shown.matched}
              /* Also the final verdict: the arc's colour IS the answer, and a
                 ring that runs red to amber to green on its way to green
                 offers three of them for one score. */
              verdict={verdictFor(match.score)}
            />
            {/* SLICED BY THE SWEEP, which is what makes the lists arrive
                rather than appear -- and it animates the counts for free,
                since the number in each heading IS the length of the list
                under it. Sliced here rather than faded in `AtsTermChips`
                because that component is shared with the application record,
                where the score is not being revealed. */}
            <AtsTermChips
              label="matched"
              tone="matched"
              terms={match.matched.slice(0, shown.matched)}
              limit={12}
              emptyText="none of the posting’s terms appear in this CV yet."
            />
            <AtsTermChips
              label="missing"
              tone="missing"
              terms={match.missing.slice(0, shown.missing)}
              limit={12}
              emptyText="none — every term in the posting shows up in this CV."
            />
          </>
        )}
      </div>

    </PanelSection>
  )
}
