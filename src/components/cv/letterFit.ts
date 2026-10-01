import { matchKeywords } from '@/services/atsMatch'
import { letterReview, type LetterFindingId } from './letterSuggestions'
export { MAX_LETTER_WORDS, MIN_LETTER_WORDS } from './letterSuggestions'

/**
 * How well a cover letter answers ONE posting -- the letter's score in the
 * tailor pane.
 *
 * NOT AN ATS SCORE (Gabe, 2026-10-01: "Letter tailoring should not implement
 * the ATS scoring. Implement appropriate scoring"). The ATS ring measures how
 * much of a posting's vocabulary a CV contains, which is how a filter reads a
 * CV. A letter is read by a person, who asks other questions: is this written
 * to us, for this job, is it finished, and does it give a reason to believe
 * it. Each check below is one of those questions, answered from the letter,
 * the application and its posting.
 *
 * A CHECKLIST, NOT A NUMBER ALONE. The score is the share of checks passed,
 * and every check says what it found -- the ATS ring shipped as a bare number
 * once and was sent back for it.
 *
 * THREE CHECKS ARE THE LETTER CHECK'S OWN RULES (`letterReview`), read here
 * rather than written twice, so the two panes cannot disagree about whether
 * the letter shows evidence, fits a page or ends with a next step. The rest
 * need the application, which the letter check never has.
 *
 * Pure and computed, never fetched, for the reason `letterSuggestions` gives:
 * a score that moves while the paragraph it is about stays still is noise.
 */
export interface LetterFitCheck {
  id: 'company' | 'role' | 'placeholders' | 'posting' | LetterFindingId
  /** Chrome voice, lowercase: what is being checked. */
  label: string
  passed: boolean
  /** Sentence case: what was found, in this letter's terms. */
  detail: string
  /**
   * WHICH QUESTION THE CHECK ANSWERS. `job`: is this written for this
   * application. `send`: is it finished. The pane draws them as two groups,
   * because a letter can be perfectly finished for the wrong employer.
   */
  group: 'job' | 'send'
}

/** The pane's verdict. `pass` only when nothing fails: one open prompt is enough to stop a send. */
export type LetterFitVerdict = 'pass' | 'review' | 'fail'

export interface LetterFit {
  /** 0-100, the share of checks passed. */
  score: number
  verdict: LetterFitVerdict
  checks: LetterFitCheck[]
  /** The measurements behind three of the checks, for the pane's gauges. */
  words: number
  /** Posting terms the letter uses, and the ones it does not, role and company words excluded. */
  posting: { used: string[]; asked: string[] }
  placeholders: string[]
}

export interface LetterFitInput {
  text: string
  company: string
  role: string
  /** The posting, as stored on the application. */
  description: string
}

/** The terms a letter has to use for the posting check to pass. */
const POSTING_TERMS_NEEDED = 3

/** Square-bracket prompts and unfilled `{{tokens}}`, as the letter check reads them. */
const PLACEHOLDERS = /\[[^\]\n]{1,80}\]|\{\{[^}\n]{1,60}\}\}/g

function mentions(text: string, phrase: string): boolean {
  const needle = phrase.trim().toLowerCase()
  return needle.length > 0 && text.toLowerCase().includes(needle)
}

/**
 * Whether the letter names the role, allowing for how people shorten one.
 *
 * "Junior Software Engineer (Open for Fresh Graduates)" is the title as the
 * board printed it; a letter says "the Junior Software Engineer role". The
 * parenthetical and anything after a separator are dropped before matching.
 */
function namesRole(text: string, role: string): boolean {
  const core = role.split(/[(|–—]| - /)[0].trim()
  return mentions(text, core || role)
}

export function letterFit({ text, company, role, description }: LetterFitInput): LetterFit {
  const review = letterReview(text)
  const flagged = new Set(review.findings.map((finding) => finding.id))
  const placeholders = text.match(PLACEHOLDERS) ?? []
  const terms = description.trim() ? matchKeywords(text, description) : null
  // THE ROLE'S AND THE COMPANY'S OWN WORDS DO NOT COUNT. "Frontend" and
  // "Engineer" are in every posting for a Frontend Engineer, so a letter that
  // only names the job would pass this check on the strength of the role
  // check -- which already scores naming it.
  const named = `${company} ${role}`.toLowerCase()
  const own = (term: string) => named.includes(term.toLowerCase())
  const used = (terms?.matched ?? []).filter((term) => !own(term))
  const asked = (terms?.missing ?? []).filter((term) => !own(term))

  // GROUPED AS THE PANE DRAWS THEM: for this job, then ready to send.
  const checks: LetterFitCheck[] = [
    {
      id: 'company',
      group: 'job',
      label: 'names the company',
      passed: mentions(text, company),
      detail: mentions(text, company)
        ? `${company} is named in the letter.`
        : `${company} is not named anywhere in the letter.`,
    },
    {
      id: 'role',
      group: 'job',
      label: 'names the role',
      passed: namesRole(text, role),
      detail: namesRole(text, role)
        ? 'The role is named in the letter.'
        : `The letter never says it is applying for ${role}.`,
    },
    {
      id: 'posting',
      group: 'job',
      label: 'answers the posting',
      passed: used.length >= POSTING_TERMS_NEEDED || used.length + asked.length === 0,
      detail:
        used.length + asked.length === 0
          ? 'The posting has no requirements to answer.'
          : used.length >= POSTING_TERMS_NEEDED
            ? `Uses what the posting asks for: ${used.slice(0, 5).join(', ')}.`
            : `Uses ${used.length} of the posting's terms. It asks for ${asked.slice(0, 4).join(', ')}.`,
    },
    {
      id: 'placeholders',
      group: 'send',
      label: 'nothing left to fill',
      passed: placeholders.length === 0,
      detail:
        placeholders.length === 0
          ? 'No bracketed prompts are left.'
          : `${placeholders.length} ${placeholders.length === 1 ? 'prompt is' : 'prompts are'} still in brackets, starting with ${placeholders[0]}.`,
    },
    {
      id: 'evidence',
      group: 'send',
      label: 'shows evidence',
      passed: !flagged.has('evidence'),
      detail: flagged.has('evidence')
        ? 'No number or concrete result backs a claim up.'
        : 'A concrete result backs the claims up.',
    },
    {
      id: 'length',
      group: 'send',
      label: 'fits one page',
      passed: !flagged.has('length'),
      detail: flagged.has('length')
        ? `${review.words} words is outside a one-page letter.`
        : `${review.words} words, one page.`,
    },
    {
      id: 'closing',
      group: 'send',
      label: 'asks for a next step',
      passed: !flagged.has('closing'),
      detail: flagged.has('closing')
        ? 'The close does not ask for a conversation or an interview.'
        : 'The close asks for a next step.',
    },
  ]

  const passed = checks.filter((check) => check.passed).length
  const failed = checks.length - passed
  return {
    score: Math.round((passed / checks.length) * 100),
    verdict: failed === 0 ? 'pass' : failed <= 2 ? 'review' : 'fail',
    checks,
    words: review.words,
    posting: { used, asked },
    placeholders,
  }
}
