'use client'

import type { LetterFindingId, LetterReview } from './letterSuggestions'

/**
 * What is left to change in a cover letter: the letter check's findings, as
 * the last block of the letter's `tailor & review` pane.
 *
 * IT WAS A PANE OF ITS OWN, behind a `letter check` tab, until Gabe asked for
 * it to be combined with tailoring (2026-10-01). It now follows the fit score
 * in the same section, so it has no section chrome of its own -- one heading,
 * then the rows. `letterSuggestions` still records every check and the
 * threshold it turns on.
 *
 * `covered` IS WHAT THE FIT CHECKLIST ABOVE ALREADY SAYS. Three of the fit
 * checks are this file's own rules (evidence, length, closing) and a fourth
 * (placeholders) shares its id, so with an application picked those rows
 * would appear twice, a few lines apart. They are dropped here, not there,
 * because the checklist is what the score is made of.
 *
 * STILL NO RUN BUTTON. Nothing here leaves the browser; the rows follow the
 * letter as it is typed.
 */
export function LetterAdvice({
  review,
  covered = [],
  ready = false,
}: {
  review: LetterReview
  covered?: readonly string[]
  /**
   * The fit score above says the letter is ready to send. What is left here is
   * then polish, not a blocker, and the heading has to say so -- "ready to
   * send" over "what to change: 2" reads as the pane contradicting itself.
   */
  ready?: boolean
}) {
  const findings = review.findings.filter(
    (finding) => !covered.includes(finding.id as LetterFindingId)
  )

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-5" data-pane="letter-advice">
      <div className="flex items-baseline justify-between gap-4">
        <h4 className="text-label-caps uppercase text-text-secondary">
          {ready ? 'worth a second look' : 'what to change'}
        </h4>
        {findings.length > 0 && (
          <span className="text-body-s tabular-nums text-text-muted">{findings.length}</span>
        )}
      </div>
      {review.words === 0 ? (
        <p className="text-body-s text-text-muted">
          nothing written yet. this follows the letter as you write it.
        </p>
      ) : findings.length === 0 ? (
        <p className="text-body-s text-text-muted">
          nothing else stands out. it reads like a letter written for one employer.
        </p>
      ) : (
        /* A NUMBERED LIST ON HAIRLINES, NOT CARDS (redesign, 2026-10-01). The
           rows were bordered boxes, the one shape this system separates with
           rules instead; and they are a to-do list, which reads in order. The
           two-digit index is the sidebar's own vocabulary (01-06). */
        <ol className="flex flex-col divide-y divide-border-subtle border-y border-border-subtle">
          {findings.map((finding, index) => (
            <li
              key={finding.id}
              data-finding="letter"
              className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 py-3"
            >
              <span className="text-body-s tabular-nums text-text-muted" aria-hidden>
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="flex flex-col gap-1.5">
                <span className="text-label-caps uppercase text-text-secondary">{finding.label}</span>
                {/* What is wrong in the reading colour, what to do muted under
                    it: the order the grammar cards use. */}
                <p className="text-body-s leading-[1.55] text-text-primary">{finding.problem}</p>
                <p className="text-body-s leading-[1.55] text-text-muted">{finding.fix}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
