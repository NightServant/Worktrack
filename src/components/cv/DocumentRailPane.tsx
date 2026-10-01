'use client'

import * as React from 'react'
import { GrammarCheckPane } from './ProofreadPanes'
import {
  TailoringAnalysisRail,
  useCvTailoring,
  type CvTailoringOptions,
  type CvTailoringState,
} from './CvTailoring'
import type { DocumentTabId } from './documentTabs'
import type { LetterReview } from './letterSuggestions'
import type { ProofreadState } from './useProofread'
import type { ThesaurusState } from './useThesaurus'

/**
 * The right rail: whichever pane the left rail has selected.
 *
 * THE WHOLE POINT OF THE PAIR is that this is one region with an id the tabs
 * point at, rather than four panels stacked down a column. `role="tabpanel"`
 * and `aria-labelledby` are what tell a screen reader that the thing on the
 * left drives the thing on the right -- the relationship a sighted user reads
 * out of the layout for free.
 *
 * THE PICKER USED TO BE ASSEMBLED HERE, in a "tailor to" PanelSection of its
 * own above the analysis. That made the tailoring pane two sections built in
 * two files, and it made this component the only place that knew which list of
 * applications the picker should show -- a second list beside the one
 * `useCvTailoring` was resolving the selection out of. Both moved into
 * `TailoringAnalysisRail`, which is why the tailor branch below is one line:
 * the pane switch should choose a pane, not lay one out.
 *
 * `letter` IS OPTIONAL BECAUSE ONLY A COVER LETTER HAS ONE (2026-10-01). Both
 * kinds have the tailor pane now; a letter's review rides inside it, under
 * the fit score, rather than behind a tab of its own.
 */

export interface DocumentRailPaneProps {
  active: DocumentTabId
  id?: string
  proofread: ProofreadState
  thesaurus?: ThesaurusState
  /** A CV's tailoring state. Absent in a cover-letter editor -- see below. */
  tailoring?: CvTailoringState
  /** A cover letter's findings. Absent in a CV editor. */
  letter?: LetterReview
}

export function DocumentRailPane({
  active,
  id = 'document-rail',
  proofread,
  thesaurus,
  tailoring,
  letter,
}: DocumentRailPaneProps) {
  return (
    <div
      id={`${id}-pane`}
      role="tabpanel"
      aria-labelledby={`${id}-pane-tab-${active}`}
      tabIndex={0}
      className="flex flex-col gap-6 focus-visible:outline-none"
      data-document-pane={active}
    >
      {active === 'grammar' && <GrammarCheckPane state={proofread} thesaurus={thesaurus} />}

      {/* A letter's review rides in the same pane as its tailoring
          (2026-10-01), under the fit score. */}
      {active === 'tailor' && tailoring && (
        <TailoringAnalysisRail state={tailoring} review={letter} />
      )}
    </div>
  )
}

/**
 * The same pane, for a CV, WITH the tailoring hook called inside it.
 *
 * THIS COMPONENT EXISTS FOR ONE REASON: so that a cover-letter editor never
 * calls `useCvTailoring` AT ALL (Gabe, 2026-09-14 -- the tailoring path "does
 * not run", rather than running and being hidden). Hooks cannot be called
 * conditionally, so as long as the call sat in `WordResumeEditor` a cover
 * letter would have mounted the tailoring state, filtered the wishlist and
 * held a selection for a pane that does not exist in its rail. Moving the call
 * below the kind branch is what makes "not at all" true, and a component
 * boundary is the only construct that can express it.
 *
 * WHY THE EDITOR STILL OWNS `jobId` (see `CvTailoringOptions`): the tab strip
 * and this pane go into two different `DocumentWorkspace` slots, and the strip
 * marks the tailor tab "needs an application" until one is picked. That one
 * string is the only thing the two slots share, so it is lifted and everything
 * else stays down here. Mirroring it back up with a callback was tried on
 * paper and rejected -- a second copy of the selection is exactly the shape of
 * bug the picker and the hook were merged to kill.
 */
export function TailoringRailPane({
  tailoring,
  ...pane
}: Omit<DocumentRailPaneProps, 'tailoring'> & { tailoring: CvTailoringOptions }) {
  const state = useCvTailoring(tailoring)
  return <DocumentRailPane {...pane} tailoring={state} />
}
