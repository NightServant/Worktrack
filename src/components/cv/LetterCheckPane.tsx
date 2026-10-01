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
}: {
  review: LetterReview
  covered?: readonly string[]
}) {
  const findings = review.findings.filter(
    (finding) => !covered.includes(finding.id as LetterFindingId)
  )

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-5" data-pane="letter-advice">
      <h4 className="text-label-caps uppercase text-text-secondary">what to change</h4>
      {review.words === 0 ? (
        <p className="text-body-s text-text-muted">
          nothing written yet. this follows the letter as you write it.
        </p>
      ) : findings.length === 0 ? (
        <p className="text-body-s text-text-muted">
          nothing else stands out. it reads like a letter written for one employer.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {findings.map((finding) => (
            <li
              key={finding.id}
              data-finding="letter"
              className="flex flex-col gap-2 rounded-[4px] border border-border-subtle bg-bg-canvas p-3"
            >
              <span className="text-label-caps text-text-muted">{finding.label}</span>
              {/* THE PROBLEM IN THE READING COLOUR AND THE FIX MUTED UNDER IT,
                  the order the grammar cards use: what is wrong, then what to
                  do. */}
              <p className="text-body-m leading-[1.5] text-text-primary">{finding.problem}</p>
              <p className="text-body-s leading-[1.6] text-text-muted">{finding.fix}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
