'use client'

import { useDocumentFocus } from '@/components/shell/documentFocus'
import { useBelowDesktop } from '@/hooks/useBelowDesktop'
import { CompactDocumentChrome } from './CompactDocumentChrome'
import { DesktopDocumentChrome } from './DesktopDocumentChrome'

/**
 * The chrome every CV editor sits in: breadcrumb, name, save state, actions,
 * a docked tool strip, and the page itself.
 *
 * ONE COMPONENT, AND IT OUTLIVED THE REASON IT WAS WRITTEN. Word and LaTeX had
 * separate headers that had already drifted, so they were merged here. The
 * LaTeX editor was then deleted on 2026-09-13 and the third surface this note
 * anticipated never arrived -- but the chrome is still shared, by the CV and
 * the cover letter, which are two document kinds through one bar rather than
 * two bars that disagree about where Save lives.
 *
 * WHAT CHANGED IN THE REFORMAT, and why each one, since "make it nicer" is
 * not a spec:
 *
 * 1. THE NAV IS GONE. `useDocumentFocus` hides the sidebar and the bottom nav
 *    while this is mounted (Gabe, 2026-09-04). A CV is a document you work
 *    inside, and the sidebar was spending 240px on destinations nobody wants
 *    mid-edit. The Top Bar stays: it carries the theme toggle and settings,
 *    and a full-screen editor with no chrome at all strands a phone user.
 *
 * 2. THE BREADCRUMB REPLACES THE PAGE TITLE. The header used to read "Word CV"
 *    -- a category, not a name -- while the document's actual name sat below
 *    it in a form field labelled CV TITLE. The name is now the heading, and
 *    the category is one crumb of the path that got you here. That is also
 *    the only way back now that the sidebar is hidden, which is why it is a
 *    breadcrumb rather than a lone back link.
 *
 * 3. THE NAME IS EDITED IN PLACE. Naming a document is not filling in a form,
 *    so it is a heading you type into: same size, same weight, no box until
 *    you focus it. This also kills the "CV TITLE" caps label, which existed
 *    only to explain a field that no longer needs explaining.
 *
 * 4. ACTIONS ARE RANKED. Save is the editor's verb and is primary. Export was
 *    the loudest control on the screen -- filled accent, next to a text
 *    Save -- which told the eye that leaving with a PDF mattered more than
 *    keeping the work. Delete is pushed to its own end of the bar: a
 *    destructive action does not belong beside Save.
 *
 * 5. SAVE STATE MOVED UNDER THE NAME. It was floating to the right of the
 *    title input, attached to nothing.
 *
 * 6. THE TOOL STRIP TOUCHES THE PAGE. It acts on the document, so it is docked
 *    directly above it rather than separated by the title block.
 */
export interface DocumentWorkspaceProps {
  /** Word, LaTeX -- the crumb between `documents` and this file's own name. */
  kindLabel: string
  documentsHref: string
  /**
   * A model is writing this document; the way out is closed until it lands.
   *
   * LEAVING MID-WRITE LOSES THE POLISH SILENTLY (Gabe, 2026-09-19: "back to
   * documents must be disabled when the model is polishing the document").
   * The request is in flight and its result is saved when it returns; a
   * navigation unmounts the hook, the save never happens, and the reader is
   * back on the documents list with a CV that quietly stayed unpolished. It
   * is a handful of seconds, and the alternative to blocking it is explaining
   * afterwards why nothing changed.
   */
  polishing?: boolean
  title: string
  onTitleChange: (title: string) => void
  /** e.g. "saved 7:43 am". Rendered under the name, muted. */
  savedLabel: string
  dirty?: boolean
  /**
   * A write is in flight.
   *
   * IT IS WHAT THE SAVE BUTTON USED TO SAY (Gabe, 2026-09-19: "remove the save
   * button ... and implement auto-save"). With a button, `saving` was a
   * spinner inside the control the reader had just pressed, so they already
   * knew. With none, this line is the only place the editor can answer "did
   * that go through" -- and it has to answer, because the question is now
   * asked by somebody who did not press anything.
   */
  saving?: boolean
  /** Save, export, versions, reset. Ranked by the caller; rendered as given. */
  actions: React.ReactNode
  /** Delete, or anything else that destroys. Kept apart from `actions`. */
  destructiveActions?: React.ReactNode
  /** Formatting controls. Docked to the top of the page. */
  tools?: React.ReactNode
  /**
   * Whether `children` draw a paper page -- fixed geometry, print margins,
   * page-break seams -- rather than an arbitrary preview.
   *
   * IT EXISTS ONLY TO GATE THE COMPACT SCROLL/PRINT TOGGLE. Below `lg` that
   * toggle is a floating button over the canvas, and the chrome has no way to
   * look at `children` and find out whether there is a sheet in there to
   * un-paginate. The Word editor says yes; the LaTeX editor's canvas is a
   * source pane and a compiled PDF in an <iframe>, with no geometry, no zoom
   * and no seams, so it says nothing and gets no button. Defaulting to `false`
   * is what keeps that a non-change for every other caller.
   */
  paged?: boolean
  /**
   * The AI tailoring rails, one either side of the page (Gabe, 2026-09-04).
   *
   * TWO RAILS RATHER THAN ONE PANEL because they answer different questions
   * and are read at different moments: the left is what you are tailoring TO
   * (the posting), the right is how well it currently matches and what to do
   * about it. Putting both on one side would make the reader scroll between
   * the requirement and the score for the same document.
   *
   * There is room for them only because the sidebar is hidden -- the two are
   * one decision, not two.
   */
  leftRail?: React.ReactNode
  rightRail?: React.ReactNode
  /**
   * The rail's tab strip -- what SELECTS the pane, as opposed to the panels
   * themselves.
   *
   * ITS OWN SLOT BECAUSE THE TWO RAILS COLLAPSE INTO ONE COLUMN (Gabe,
   * 2026-09-13: "and render the clicked navigation"). Below 1700 the chrome
   * stacks `leftRail` and `rightRail` in a single column, and the strip used to
   * be buried inside `leftRail` above an outline and a statistics table -- so
   * clicking a tab changed a pane two screens further down, which reads as the
   * click having done nothing. Named separately, the chrome can put the strip
   * and the pane it selects next to each other in every arrangement, which is
   * the only thing that makes the selection legible.
   */
  railNav?: React.ReactNode
  /** The page: an editor, or a compiled preview. */
  children: React.ReactNode
  /** A compile log or an unconfigured-integration notice, under the page. */
  footnote?: React.ReactNode
}

export function DocumentWorkspace(props: DocumentWorkspaceProps) {
  // Claimed on mount, released on unmount -- so closing the draft, navigating
  // away or unmounting for any other reason all restore the nav without this
  // component having to notice.
  useDocumentFocus()

  // CHOSEN IN JS, NOT WITH `lg:` CLASSES, and that is the important part.
  // Both chromes need `actions`, `tools` and the two rails, and those are
  // interactive controls -- rendering both trees would put two of every button
  // in the accessibility tree and two of every match in a test's `getByRole`.
  // One tree. See useBelowDesktop for why it defaults to desktop.
  //
  // THE TWO TREES MOVED OUT ON 2026-09-11 (533 lines). They were ~250 lines
  // each with `if (compact) return` between them, sharing only these props and
  // this decision -- which is all that is left here.
  const compact = useBelowDesktop()

  return compact ? (
    <CompactDocumentChrome {...props} />
  ) : (
    <DesktopDocumentChrome {...props} />
  )
}
