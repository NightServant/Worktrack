'use client'

import * as React from 'react'
import { AlertCircleIcon, CheckIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import {
  MAX_LETTER_WORDS,
  MIN_LETTER_WORDS,
  type LetterFit,
  type LetterFitCheck,
  type LetterFitVerdict,
} from './letterFit'

/**
 * A cover letter's readiness for one application, drawn.
 *
 * REDESIGNED 2026-10-01 (Gabe: "Redesign the specific section following UI/UX
 * principles ... add visual indicators such as graphs if needed"). It was a
 * score line over seven equal rows, so a passed check took as much room as a
 * failed one and nothing said which half of the problem was which.
 *
 * THREE LEVELS OF READING, top to bottom, each one answering the question a
 * person has at that moment:
 *
 *   1. Is it ready?  The score, a verdict in words, and a seven-cell meter in
 *      two clusters -- the at-a-glance answer, readable without a word.
 *   2. What is wrong? The checks, grouped by the question they answer: "for
 *      this job" (is it written to this application) and "ready to send" (is
 *      it finished). A passed check folds to one muted line; a failed one says
 *      what it found.
 *   3. How far off? Two checks are measurements, and get a gauge rather than
 *      a sentence: how much of the posting the letter speaks to, and where its
 *      length sits against the one-page band.
 *
 * NO RING. The ring is the ATS score's picture, a proportion of vocabulary;
 * this is seven yes-or-no checks, and a segmented meter shows which ones
 * without pretending the score is continuous. NO PILLS, per the design system:
 * the cells are 6px bars with a 1px radius, and terms are listed as text.
 *
 * Verdict colours, not the accent: orange means "the action we want you to
 * take" in this system, and a score is not an action.
 */

const VERDICT: Record<LetterFitVerdict, { label: string; text: string }> = {
  pass: { label: 'ready to send', text: 'text-verdict-pass' },
  review: { label: 'nearly there', text: 'text-verdict-review' },
  fail: { label: 'needs work', text: 'text-verdict-fail' },
}

const GROUPS: { id: LetterFitCheck['group']; label: string }[] = [
  { id: 'job', label: 'for this job' },
  { id: 'send', label: 'ready to send' },
]

/** How many checks each group holds when no application is chosen yet. */
const EMPTY_GROUP_SIZE: Record<LetterFitCheck['group'], number> = { job: 3, send: 4 }

/**
 * The seven-cell meter: one cell per check, clustered by group.
 *
 * The clusters are sized by how many checks they hold (3fr / 4fr), so a cell
 * is the same width in both and the eye reads seven equal units. A cell is
 * filled when its check passes; failed cells stay on the track rather than
 * turning red, because the rows below already carry the warning and a meter
 * of red bars reads as an error state rather than as progress.
 */
function FitMeter({ fit }: { fit: LetterFit | null }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `${EMPTY_GROUP_SIZE.job}fr ${EMPTY_GROUP_SIZE.send}fr` }}
    >
      {GROUPS.map((group) => {
        const checks = fit?.checks.filter((check) => check.group === group.id) ?? null
        const passed = checks?.filter((check) => check.passed).length ?? 0
        const total = checks?.length ?? EMPTY_GROUP_SIZE[group.id]
        return (
          <div key={group.id} className="flex flex-col gap-1.5" data-fit-group={group.id}>
            <div
              className="grid gap-[3px]"
              style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
              role="img"
              aria-label={
                checks ? `${group.label}: ${passed} of ${total} passed` : `${group.label}: not scored yet`
              }
            >
              {Array.from({ length: total }, (_, index) => {
                const check = checks?.[index]
                return (
                  <span
                    key={check?.id ?? index}
                    data-fit-cell={check ? (check.passed ? 'passed' : 'failed') : 'empty'}
                    className={cn(
                      'h-1.5 rounded-[1px] motion-safe:transition-colors motion-safe:duration-(--duration-fast)',
                      check?.passed ? 'bg-verdict-pass' : 'bg-verdict-track'
                    )}
                  />
                )
              })}
            </div>
            <span className="flex items-baseline justify-between gap-2 text-body-s text-text-muted">
              <span>{group.label}</span>
              {checks && (
                <span className="tabular-nums">
                  {passed}/{total}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * How much of the posting the letter speaks to.
 *
 * A fill, not a percentage: "3 of 9 terms" is already the number, and the bar
 * is there so the proportion reads before the digits do. The fill is drawn
 * with a transform rather than a width so a change animates without layout.
 */
function CoverageGauge({ fit, passed }: { fit: LetterFit; passed: boolean }) {
  const { used, asked } = fit.posting
  const total = used.length + asked.length
  if (total === 0) return null
  return (
    <div className="flex flex-col gap-1.5" data-fit-gauge="posting">
      <div className="h-1 overflow-hidden rounded-[1px] bg-verdict-track">
        <div
          className={cn(
            'h-full origin-left motion-safe:transition-transform motion-safe:duration-(--duration-fast)',
            passed ? 'bg-verdict-pass' : 'bg-verdict-review'
          )}
          style={{ transform: `scaleX(${used.length / total})` }}
        />
      </div>
      {asked.length > 0 && (
        <p className="text-body-s text-text-muted">
          not yet in the letter: {asked.slice(0, 6).join(', ')}
          {asked.length > 6 ? `, and ${asked.length - 6} more` : ''}
        </p>
      )}
    </div>
  )
}

/**
 * Where the letter's length sits against one page.
 *
 * The shaded band is the one-page range the letter check enforces (150 to 400
 * words), and the tick is this letter. The scale runs a little past the band
 * so a letter at 400 is visibly at the edge rather than at the end of the
 * world, and stretches if the letter runs longer than that.
 */
function LengthGauge({ words }: { words: number }) {
  const scale = Math.max(MAX_LETTER_WORDS + 100, words)
  const at = (value: number) => `${(value / scale) * 100}%`
  return (
    <div className="flex flex-col gap-1" data-fit-gauge="length">
      <div className="relative h-3">
        <div className="absolute inset-x-0 top-1 h-1 rounded-[1px] bg-verdict-track" />
        <div
          className="absolute top-1 h-1 bg-verdict-pass/35"
          style={{ left: at(MIN_LETTER_WORDS), width: `${((MAX_LETTER_WORDS - MIN_LETTER_WORDS) / scale) * 100}%` }}
        />
        <div
          aria-hidden
          className="absolute top-0 h-3 w-0.5 -translate-x-1/2 bg-text-primary"
          style={{ left: at(Math.min(words, scale)) }}
          data-fit-marker
        />
      </div>
      <div className="relative h-4 text-body-s tabular-nums text-text-muted" aria-hidden>
        <span className="absolute -translate-x-1/2" style={{ left: at(MIN_LETTER_WORDS) }}>
          {MIN_LETTER_WORDS}
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: at(MAX_LETTER_WORDS) }}>
          {MAX_LETTER_WORDS}
        </span>
      </div>
    </div>
  )
}

/** The short figure at the end of a row, where a check has one. */
function metricFor(check: LetterFitCheck, fit: LetterFit): string | null {
  if (check.id === 'posting') {
    const total = fit.posting.used.length + fit.posting.asked.length
    return total > 0 ? `${fit.posting.used.length} of ${total} terms` : null
  }
  if (check.id === 'length') return `${fit.words} words`
  if (check.id === 'placeholders' && fit.placeholders.length > 0) return `${fit.placeholders.length} open`
  return null
}

function CheckRow({ check, fit }: { check: LetterFitCheck; fit: LetterFit }) {
  const metric = metricFor(check, fit)
  // Measurements keep their gauge whether they pass or not: a letter being
  // written is moving through the band, and the tick is worth watching.
  const gauge =
    check.id === 'posting' ? (
      <CoverageGauge fit={fit} passed={check.passed} />
    ) : check.id === 'length' ? (
      <LengthGauge words={fit.words} />
    ) : null

  return (
    <li
      className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1.5"
      data-fit-check={check.id}
      data-passed={check.passed}
    >
      {check.passed ? (
        <CheckIcon size={16} aria-hidden className="mt-0.5 text-verdict-pass" />
      ) : (
        <AlertCircleIcon size={16} aria-hidden className="mt-0.5 text-verdict-fail" />
      )}
      <span className={cn('text-body-s', check.passed ? 'text-text-muted' : 'text-text-primary')}>
        {check.label}
        <span className="sr-only">{check.passed ? ': passed' : ': not yet'}</span>
      </span>
      <span className="text-body-s tabular-nums text-text-muted">{metric}</span>
      {(gauge || !check.passed) && (
        <div className="col-start-2 col-end-4 flex flex-col gap-1.5">
          {gauge}
          {/* The sentence only for a failure: a passed check has nothing to
              say that its label and tick have not, and the measurement rows
              say it in their gauge. */}
          {!check.passed && check.id !== 'posting' && check.id !== 'length' && (
            <p className="text-body-s text-text-muted">{check.detail}</p>
          )}
          {!check.passed && check.id === 'length' && (
            <p className="text-body-s text-text-muted">
              {fit.words < MIN_LETTER_WORDS ? 'Too short to make a case.' : 'Past one page.'}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

export function LetterFitSection({ fit }: { fit: LetterFit | null }) {
  const verdict = fit ? VERDICT[fit.verdict] : null
  return (
    <div className="flex flex-col gap-6 border-t border-border-subtle pt-5" data-letter-fit>
      {/* ONE: IS IT READY. */}
      <div className="flex flex-col gap-4" data-fit-readiness>
        <div className="flex items-baseline justify-between gap-4">
          <p className="flex items-baseline gap-1">
            <span className="text-display-m tabular-nums text-text-primary" data-fit-score>
              {fit ? fit.score : '–'}
            </span>
            <span className="text-body-s text-text-muted">/ 100</span>
          </p>
          {verdict ? (
            <span className={cn('text-label-caps uppercase', verdict.text)} data-fit-verdict>
              {verdict.label}
            </span>
          ) : (
            <span className="text-body-s text-text-muted">not scored</span>
          )}
        </div>
        <FitMeter fit={fit} />
        {!fit && (
          <p className="text-body-s text-text-muted">
            pick an application above to see how well this letter answers it.
          </p>
        )}
      </div>

      {/* TWO AND THREE: WHAT IS WRONG, AND HOW FAR OFF. */}
      {fit &&
        GROUPS.map((group) => (
          <section key={group.id} className="flex flex-col gap-3" aria-label={group.label}>
            <h4 className="text-label-caps uppercase text-text-secondary">{group.label}</h4>
            <ul className="flex flex-col gap-3">
              {fit.checks
                .filter((check) => check.group === group.id)
                .map((check) => (
                  <CheckRow key={check.id} check={check} fit={fit} />
                ))}
            </ul>
          </section>
        ))}
    </div>
  )
}
