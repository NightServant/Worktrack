import type { IconName } from '@/components/icons'
import type { ResumeMode } from '@/services/resumeService'

/**
 * The panes of the document editor's rails, as data -- and which of them a
 * given KIND of document gets.
 *
 * THE LEFT RAIL SELECTS AND THE RIGHT RAIL SHOWS, which is the arrangement
 * Word uses and the one Gabe asked for on 2026-09-11. Before this the two
 * rails were a fixed pair -- a "tailor to" picker on the left and the ATS
 * result on the right -- so the editor could only ever be doing one thing, and
 * grammar and spelling had nowhere to live at all.
 *
 * SEPARATED FROM THE COMPONENTS ON PURPOSE. The rail, the pane switch and the
 * mobile fallback all have to agree on what the tabs are and what order they
 * come in; three copies of that list is three chances to disagree. Keeping it
 * as data also means the ordering and the labels are unit-testable without
 * rendering anything, and it satisfies `react-refresh/only-export-components`
 * the same way `button-variants.ts` and `progress-tones.ts` already do.
 *
 * ORDER IS PROOFREAD-THEN-TARGET, and it is not alphabetical by accident.
 * Grammar and spelling are about the document as written and can be acted on
 * with nothing else set up; tailoring is about a specific application and
 * needs one chosen first. Putting the two that always work above the one that
 * needs configuration means a new CV opens on something useful.
 *
 * SPELL CHECK WAS A THIRD TAB AND IS GONE (Gabe, 2026-09-11). On a real
 * 949-word CV it produced 26 findings and roughly two thirds were proper
 * nouns LanguageTool has no dictionary for -- React, Next.js, shadcn/UI,
 * Laravel, Tarlac. A tab that is wrong two times in three is a list to
 * dismiss, not a check. `services/grammar` drops those findings at the
 * boundary, so nothing downstream has to know the tab ever existed.
 *
 * ATS MATCH AND AI TAILORING WERE TWO TABS UNTIL 2026-09-11 AND THAT WAS
 * WRONG. Gabe: "combine AI tailoring and ATS scoring properly this time."
 * They are one request against one posting -- the score says what a screener
 * will miss, the rewrites are what to do about it -- so splitting them made
 * you pick an application twice, read half an answer, and switch tabs to act
 * on it. The score and the fix now sit in one pane, in that order, because
 * that is the order you use them in.
 *
 * -------------------------------------------------------------------------
 *
 * ONE LIST BECAME ONE LIST PER KIND ON 2026-09-14, when cover letters started
 * opening in this editor (Gabe: "same format for the document editor but ATS
 * scoring and tailoring will not be included"). A cover letter is not scored
 * against a posting -- it IS the argument a posting asks for, written once for
 * one employer -- so the tailor pane is not merely unhelpful there, it is a
 * question with no answer: there is no keyword inventory to match and nothing
 * a rewrite could tailor that the letter does not already say on purpose.
 *
 * A `Record<ResumeMode, ...>` RATHER THAN A FLAG ON EACH TAB. `hiddenFor:
 * ['cover_letter']` was the first shape and it reads backwards: it describes
 * the tabs in terms of where they are absent, so working out what a cover
 * letter actually shows means scanning every entry and inverting each one.
 * Two named lists answer "what does this kind of document get" by being read.
 * They deliberately SHARE the tab objects rather than repeating them, so the
 * grammar tab cannot come to mean two different things in two places.
 *
 * THE SELECTED TAB IS REMEMBERED ACROSS DOCUMENTS, which is the reason
 * `asDocumentTab` takes a kind. One stored value serves both editors -- see
 * `WordResumeEditor` for why it is not keyed per kind -- so somebody who left
 * a CV on `tailor` and then opened a cover letter would restore a tab that
 * does not exist in that rail: a tablist with nothing selected above a pane
 * with nothing in it. Coercing on READ rather than on write is what keeps that
 * from working in the other direction too, where opening a letter would quietly
 * forget the CV's remembered tab.
 */

export type DocumentTabId = 'grammar' | 'tailor'

export interface DocumentTab {
  id: DocumentTabId
  label: string
  icon: IconName
  /** Shown under the label in the rail; says what the pane is for. */
  hint: string
  /**
   * True when the pane is useless without an application selected. The rail
   * marks these so the reason a pane is empty is visible before it is opened,
   * rather than after.
   */
  needsApplication: boolean
}

/**
 * The tabs themselves, declared once and shared between the lists below.
 *
 * `grammar` is in both because the question it answers -- is this written
 * correctly -- is the same question for a CV and for a letter, and the pane
 * behind it reads the same editor either way.
 */
const GRAMMAR_TAB: DocumentTab = {
  id: 'grammar',
  label: 'grammar check',
  icon: 'Pencil',
  hint: 'agreement, tense, phrasing and style',
  needsApplication: false,
}

const TAILOR_TAB: DocumentTab = {
  id: 'tailor',
  label: 'tailor to a job',
  icon: 'ShieldCheck',
  hint: 'score this CV, then rewrite it',
  needsApplication: true,
}

/**
 * The cover letter's one tab for the job: tailoring and the letter check,
 * together (Gabe, 2026-10-01: "combine the tailor to a job and letter check
 * section and rename it with concise wording").
 *
 * They were two tabs answering halves of one question -- is this letter ready
 * to send for this job -- and the fit score already read three of the letter
 * check's rules, so the same finding could appear in both. One pane now:
 * the application, the rewrite, the fit score, then what is left to change.
 *
 * Same id as the CV's, so the remembered tab carries over between kinds.
 * NOT `needsApplication`: the review half reads the letter alone, so the tab
 * is useful before an application is picked.
 */
const LETTER_TAB: DocumentTab = {
  id: 'tailor',
  label: 'tailor & review',
  icon: 'Mail',
  hint: 'fit to a job, then what to fix',
  needsApplication: false,
}

/** Every tab there is, for lookups that do not know the kind. */
const ALL_TABS: readonly DocumentTab[] = [GRAMMAR_TAB, TAILOR_TAB]

export const DOCUMENT_TABS: Record<ResumeMode, readonly DocumentTab[]> = {
  word: [GRAMMAR_TAB, TAILOR_TAB],
  cover_letter: [GRAMMAR_TAB, LETTER_TAB],
} as const

/**
 * Grammar, for both kinds.
 *
 * It is the first entry of both lists rather than a coincidence: it is the
 * pane that works with nothing else set up, which is the whole reason for the
 * proofread-then-target ordering above. A per-kind default would be a second
 * place for that ordering to live.
 */
export const DEFAULT_DOCUMENT_TAB: DocumentTabId = 'grammar'

export function tabById(id: DocumentTabId): DocumentTab {
  const tab = ALL_TABS.find((candidate) => candidate.id === id)
  // Unreachable through the type, but a bad id from persisted state would
  // otherwise render a blank rail with no clue why.
  if (!tab) throw new Error(`Unknown document tab: ${id}`)
  return tab
}

/**
 * Coerce anything into a tab id THIS KIND OF DOCUMENT ACTUALLY HAS.
 *
 * The selected tab is worth remembering between visits, and stored values
 * outlive the code that wrote them: a tab that is renamed or removed would
 * otherwise leave somebody's editor permanently blank.
 *
 * `kind` IS REQUIRED, WITH NO DEFAULT, and that is deliberate. A default of
 * `'word'` would make the dangerous call -- the cover letter one -- the one
 * that is easiest to write by forgetting an argument, and its failure is
 * silent: a rail whose tablist selects nothing. There is one caller; making it
 * say which editor is asking costs a word.
 */
export function asDocumentTab(raw: unknown, kind: ResumeMode): DocumentTabId {
  return DOCUMENT_TABS[kind].some((tab) => tab.id === raw)
    ? (raw as DocumentTabId)
    : DEFAULT_DOCUMENT_TAB
}
