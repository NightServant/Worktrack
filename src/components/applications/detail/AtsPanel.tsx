import * as React from 'react'
import { type AtsResult } from '@/components/ui/ats-check'
import { AtsDonut } from '@/components/ui/ats-donut'
import { PanelSection } from '@/components/ui/panel-section'
import { AtsKeywords } from '@/components/ui/ats-keywords'
import type { KeywordMatch } from '@/services/atsMatch'

/**
 * Thresholds for turning a percentage into the three-way verdict `AtsCheck`
 * renders. Arbitrary but documented: 80 and 50 split the range into thirds
 * loosely centred on "most requirements met" and "roughly half", and nothing
 * downstream depends on the exact cut, so this is an implementer's call
 * rather than a spec'd value.
 */
function verdictFor(score: number): AtsResult {
  if (score >= 80) return 'pass'
  if (score >= 50) return 'review'
  return 'fail'
}

/**
 * How the CV stacks up against the posting -- and, unlike a bare score,
 * which words to add.
 *
 * `match` is `null` rather than a zeroed `KeywordMatch` when there is nothing
 * to compare: no linked CV, or no job description. Rendering a 0% in that
 * case would look like a genuinely bad match instead of an absent one.
 *
 * `error` is a third state, distinct from both loading and empty, matching
 * `LinkedCv`: a failed `resumes` read for the linked CV must not render the
 * same "link a CV" copy an application with genuinely no linked CV gets.
 *
 * The score-plus-two-lists content below keeps its own `gap-4` wrapper
 * rather than inheriting `PanelSection`'s section-level `gap-3` -- that gap is
 * for spacing the title from a single block of content, not for spacing
 * apart three stacked blocks of content, which is what this panel alone
 * among the five has.
 */
export interface AtsPanelProps extends React.HTMLAttributes<HTMLElement> {
  match: KeywordMatch | null
  error?: boolean
}

export function AtsPanel({ match, error = false, className, ...props }: AtsPanelProps) {
  return (
    <PanelSection
      aria-label="ATS match"
      title="ATS match"
      icon="ShieldCheck"
      error={error ? 'Could not load your CV to check the match. Try refreshing the page.' : undefined}
      className={className}
      {...props}
    >
      {match === null ? (
        <p className="text-body-s text-text-muted">
          Link a CV and add a job description to see how closely they match.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* THE RING REPLACES THE RULE (Gabe, 2026-09-06). `AtsCheck` drew a
              2px bar in the verdict colour with the number beside it, which
              made 32% and 82% the same picture -- only the digits differed.
              The score is a proportion of one whole, and the two lists below
              are that same split spelled out, so the arc is the honest shape
              for it. `AtsCheck` itself stays; CvTailoring still uses it. */}
          <AtsDonut
            score={match.score}
            matched={match.matched.length}
            missing={match.missing.length}
            verdict={verdictFor(match.score)}
          />
          {/* FOLDED, because a real posting yields sixty-odd terms and the
              most actionable thing on this panel was also the least
              readable. See ui/ats-keywords. */}
          <AtsKeywords
            label="missing keywords"
            terms={match.missing}
            emptyText="none -- every term in the posting shows up in the CV."
          />
          {match.matched.length > 0 && (
            <AtsKeywords label="matched" terms={match.matched} muted />
          )}
        </div>
      )}
    </PanelSection>
  )
}
