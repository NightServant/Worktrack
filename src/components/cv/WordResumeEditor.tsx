'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { WORD_EDITOR_EXTENSIONS } from './editorExtensions'
import type { Editor, JSONContent } from '@tiptap/core'
import { Button } from '@/components/ui/button'
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  RotateCcwIcon,
  SettingsIcon,
  TrashIcon,
} from '@/components/icons'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { CssSpinner } from '@/components/ui/css-spinner'
import { iconMotion } from '@/components/icons/motion'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { supabase } from '@/lib/supabase'
import { authedFetch } from '@/lib/authedFetch'
import type { Job } from '@/types'
import { DocumentWorkspace } from './DocumentWorkspace'
import type { CvTailoringOptions } from './CvTailoring'
import { DocumentRailTabs } from './DocumentRail'
import { DocumentNavigator } from './DocumentNavigator'
import { DocumentToolbar } from './DocumentToolbar'
import { DocumentRailPane, TailoringRailPane } from './DocumentRailPane'
import { DocumentSkeleton } from '@/components/ui/loading-skeletons'
import { AnalyzingDocument } from '@/components/ui/analyzing-document'
import { RotatingText } from '@/components/ui/status-state'

/**
 * What the model is doing while the page is empty, in the order it happens.
 *
 * THE WIZARD'S `READ_STEPS` READ A POSTING; these write a CV. Same shape and
 * same component, because it is the same promise being made -- something is
 * happening to this document and it will be finished in a moment.
 */
const WRITE_STEPS = [
  'reading your profile',
  'writing your summary',
  'describing your projects',
  'setting it on the page',
]
import { asDocumentTab, DEFAULT_DOCUMENT_TAB, type DocumentTabId } from './documentTabs'
import { letterReview, type LetterReview } from './letterSuggestions'
import { useProofread } from './useProofread'
import { useThesaurus } from './useThesaurus'
import { useFitToWidth } from './useFitToWidth'
import {
  cssLineHeight,
  normalizeGeometry,
  normalizeTypography,
  type DocumentTypography,
  type PageGeometry,
} from '@/lib/pageGeometry'
import { useNaturalLineHeight } from './useNaturalLineHeight'
import { Pagination } from './pagination'
import { useResumeExport } from './useResumeExport'
import { useBelowDesktop } from '@/hooks/useBelowDesktop'
import { cn } from '@/lib/utils'
import { useDocumentView } from './documentView'
import { ResumeVersionHistory } from './ResumeVersionHistory'
import { DEFAULT_WORD_CONTENT, formatSaveTime, normalizeWordContent } from './content'
import { personalizeTemplate } from '@/services/templatePersonalization'
import { EMPTY_PROFILE } from '@/services/profile'
import { maybeCreateSnapshot } from '@/services/resumeSnapshotService'
import type { ResumeContent, ResumeDraft, ResumeMode } from '@/services/resumeService'

/**
 * The document-style CV editor: Tiptap, autosave, snapshots and PDF export.
 *
 * Moved out of `src/screens/ResumePage.tsx` when that file was split into
 * `/documents` and `/cv`. The engine is byte-for-byte what it was -- the same
 * 1200ms save debounce, the same 5000ms snapshot debounce, the same PDF
 * export call (`resume-export-pdf` then, `/api/cv/pdf` since 2026-09-15) --
 * because the plan asked for the chrome to be restyled, not for the editor to
 * be rewritten. What changed is the chrome:
 * M4 tokens, hairline rules, 4px radius, and no lucide. Its `Save` and
 * `Back` are text (two of the four glyphs the icon set eliminated), and
 * `RotateCcw`/`Download` resolve to the drawn icons. Its five formatting
 * buttons were already text-labelled, so dropping their glyphs cost nothing.
 *
 * Which draft is open now comes from `/cv?draft=<id>` rather than the deleted
 * screen's local `activeDraftId` state, so the route -- not this component --
 * decides what to render, and a CV is linkable.
 */
export interface WordResumeEditorProps {
  /**
   * The user's applications, for the tailoring rail's picker.
   *
   * A PROP, NOT A `useJobs()` CALL IN HERE. The route owns every read in this
   * app -- it is what lets the screens be rendered in a test with plain props
   * and no QueryClient -- and reaching for the hook here broke exactly that,
   * in eight tests, the moment it was added. Defaulted so a caller that has
   * no jobs list still renders.
   */
  jobs?: Job[]

  /**
   * Applications that already have a document pinned to them.
   *
   * Passed straight through to the tailoring rail, which uses it to stop
   * offering roles that have been tailored for already. A prop for the same
   * reason `jobs` is one -- the route owns every read.
   */
  linkedJobIds?: string[]

  /**
   * A model is writing this document's prose; show the paper, not the text.
   *
   * THE EDITOR STILL RENDERS AROUND IT (Gabe, 2026-09-19: "document editor
   * must show"). Only the sheet's contents are swapped -- see `PageSheet` --
   * so the toolbar, the rails, the page geometry and the zoom are all real and
   * all where they will be when the text lands.
   */
  polishing?: boolean

  /**
   * Where a tailored CV goes.
   *
   * THE ROUTE CREATES IT, not this editor, for the same reason the route does
   * every other write: `useCreateResume` needs a QueryClient and the router
   * needs the app's navigation, and an editor that reached for either stops
   * being renderable with plain props. This hands over a finished title and a
   * finished document; what happens to it is /cv's business.
   *
   * Optional, so the editor still mounts in a test with nothing wired -- the
   * tailor button then says what came back rather than throwing.
   */
  /**
   * Resolves with which write the route made, so the rail can say "opening the
   * new document" only when the page is actually about to change.
   */
  onTailored?: (input: {
    title: string
    content: ResumeContent
    jobId: string
  }) => Promise<'created' | 'updated' | void>

  /**
   * WHAT KIND OF DOCUMENT THIS IS -- and therefore what the editor IS, not
   * merely what it is called (Gabe, 2026-09-14: "same format for the document
   * editor but ATS scoring and tailoring will not be included").
   *
   * A cover letter gets the same chrome, the same Tiptap engine, the same
   * autosave and the same grammar pane. What it does not get is the tailor
   * pane, and not as a hidden tab: `documentTabs` gives it a different tab
   * list, `asDocumentTab` refuses to restore a remembered `tailor`, and
   * `TailoringRailPane` -- the only thing that calls `useCvTailoring` -- is
   * never mounted. A letter is not scored against a posting because it is not
   * a keyword surface; it is one argument written for one employer.
   *
   * DEFAULTED TO `word` SO EVERY EXISTING CALL SITE IS UNCHANGED. /cv passes
   * `draft.mode` once the documents screen can create a letter; until then the
   * default is the only value anything supplies.
   */
  kind?: ResumeMode

  draft: ResumeDraft
  /**
   * The application this CV was tailored FOR, if it is a tailored copy.
   *
   * A PROP RATHER THAN SOMETHING DERIVED HERE, because the evidence lives in
   * `application_documents` and this component is deliberately renderable
   * without a QueryClient -- the same reason `jobs` is passed in rather than
   * fetched. /cv holds the links and does the deriving.
   *
   * Empty or absent means an ordinary CV, which is the only case that gets the
   * application picker: a tailored file's target was decided when it was
   * written, so offering a combobox there is offering a choice that does
   * nothing.
   */
  tailoredForJobId?: string
  backHref: string
  onDelete: (draftId: string) => void
  onPersistDraft: (
    draftId: string,
    title: string,
    mode: ResumeMode,
    content: ResumeContent
  ) => Promise<ResumeDraft>
}

/**
 * The gap Word leaves between two pages in Print Layout.
 *
 * A quarter inch reads as a seam between sheets without spending a visible
 * fraction of the scroll on nothing, which a full inch does on a three-page CV.
 */
const PAGE_GAP_IN = 0.25

/**
 * THE SHEET, AND THE TWO WAYS IT IS DRAWN (Gabe, 2026-09-13: "floating icon
 * button for scroll view and print view -- scroll view is the default").
 *
 * IT IS ITS OWN COMPONENT ONLY BECAUSE OF THE CONTEXT. `useDocumentView` has
 * to be called from inside the provider, and the provider is in the compact
 * chrome -- which is BELOW `WordResumeEditor` in the tree and receives this
 * markup as `children`. A hook call in the editor itself would read the
 * default and always answer "print". Nothing else moved: the geometry, the
 * typography and that className are the same text they were inline.
 *
 * PRINT VIEW is what this editor has always drawn, unchanged: an 8.5in sheet
 * at the document's own geometry, `zoom`-fitted to the canvas, letter margins
 * as padding, and `Pagination`'s seams between pages.
 *
 * SCROLL VIEW is the same document as one continuous column:
 *   - no `zoom`, and `w-full` instead of a fixed `8.5in`. Fit-to-width on a
 *     375px phone is a scale of 0.46, which renders an 11pt body at about 5pt.
 *     Full width at 1.0 renders it at 11pt in a 343px column.
 *   - no `minHeight` of a page, so a half-page CV is half a page rather than
 *     11 inches of white with a scrollbar promising more.
 *   - 16px of reading padding instead of the 0.8in (77px) print margin, which
 *     on that phone was 41% of the screen spent on paper that is not there.
 *   - `[&_[data-page-spacer]]:hidden` -- the seams suppressed with a CSS rule
 *     on this wrapper rather than by re-creating the editor without the
 *     extension or mutating its options. Both of those rebuild the ProseMirror
 *     view, and the undo history dies with it: toggling the view would throw
 *     away every undo step, which is a far worse bug than a visible seam.
 *     The widgets still compute and still sit in the document; they are simply
 *     not painted.
 *
 * `--page-body-height` follows: a 9.4in floor under a full-width column is a
 * screenful of empty white under a short CV, so scroll view asks for half the
 * viewport instead -- enough to stay a tappable target for focusing the editor.
 */
function PageSheet({
  editor,
  geometry,
  type,
  naturalLineHeight,
  scale,
  polishing = false,
}: {
  editor: Editor | null
  geometry: PageGeometry
  type: DocumentTypography
  naturalLineHeight: number
  scale: number
  /**
   * A model is writing this document's prose; show the paper, not the text.
   *
   * ON THE SHEET RATHER THAN OVER THE ROUTE (Gabe, 2026-09-19: "document
   * editor must show and there must be a customized skeleton for the document
   * itself"). Swapping the whole screen for a route skeleton drew two boxes
   * side by side -- the shape of a record screen, not of a word processor --
   * so the pause looked like the wrong page loading. Everything around this
   * sheet is real: the toolbar, the rails, the page geometry and the zoom. It
   * is only the text that is not there yet.
   */
  polishing?: boolean
}) {
  const view = useDocumentView()
  const scroll = view === 'scroll'

  return (
    /*
      `zoom`, NOT `transform: scale()`, and the difference is layout.
      A transform is painted only: a page drawn at 0.7 still occupies its
      full 11in in the flow, so the well ends in a third of a page of nothing
      and the scrollbar promises more document than exists. Correcting that
      by hand means measuring the sheet and multiplying its height, which is
      a second source of truth for a number the browser already knows.

      `zoom` participates in layout -- measured here: a 1000px child at 0.7
      gives a 700px wrapper, where the transform leaves it at 1000 -- so the
      flow, the scroll height and the caret all agree with what is drawn,
      with no correction and no wrapper. Supported in every current browser
      (`CSS.supports('zoom', '0.7')` verified true in the app).
    */
    <div
      data-page-sheet={view}
      className={cn(
        'bg-white',
        // `grow` only in scroll view: it fills the canvas the wrapper stretched
        // to, so a half-page CV still ends at the bottom of the screen instead
        // of on a band of well. Print keeps its own page height.
        scroll ? 'w-full grow [&_[data-page-spacer]]:hidden' : 'mx-auto'
      )}
      style={
        scroll
          ? undefined
          : {
              zoom: scale,
              width: `${geometry.width}in`,
              minHeight: `${geometry.height}in`,
              // NO PAINTED PAGE EDGE HERE ANY MORE. Two versions of it were
              // drawn as a background -- a hairline, then a band of the well's
              // colour -- and both sat BEHIND the text, so a break falling
              // mid-paragraph struck a stripe through a line of it. Nothing about
              // a background can avoid that; the content flows over it regardless.
              // `Pagination` pushes the content past the edge instead, which is
              // what Word does. See components/cv/pagination.
            }
      }
    >
      {polishing ? (
        <div
          style={{
            padding: scroll
              ? '1rem 1rem 4rem'
              : `${geometry.margin.top}in ${geometry.margin.right}in ${geometry.margin.bottom}in ${geometry.margin.left}in`,
          }}
        >
          {/* THE WIZARD'S OWN WAITING STATE (Gabe, 2026-09-19: "how about the
              loading-ui components? we can reuse it from the application
              wizard"). Step 3 of `AddApplicationDialog` already says "a model
              is working on a document" with this glyph and a rotating line,
              and a second vocabulary for the same idea would be two answers to
              one question -- plus this one is already reduced-motion aware and
              already announces itself. Only the phrases differ: that one is
              reading a posting, this one is writing a CV. */}
          {/* PAPER COLOURS, NOT THEME COLOURS. The sheet is `bg-white` in both
              themes because it is what gets printed, so `text-text-primary`
              here is white-on-white in dark mode -- which is what the rotating
              line was (Gabe, 2026-09-19). The `ink-*` scale is fixed. */}
          <div className="flex flex-col items-center gap-3 pb-10">
            <AnalyzingDocument className="size-12 text-ink-400" />
            <p className="text-body-m text-ink-600">
              <RotatingText phrases={WRITE_STEPS} />
            </p>
          </div>
          {/* THE SAME MARGINS THE TEXT WILL HAVE, so the lines land where the
              real ones do and the page does not jump when they arrive. */}
          <DocumentSkeleton />
        </div>
      ) : (
      <EditorContent
        editor={editor}
        style={
          {
            padding: scroll
              ? '1rem 1rem 4rem'
              : `${geometry.margin.top}in ${geometry.margin.right}in ${geometry.margin.bottom}in ${geometry.margin.left}in`,
            // THE TYPING AREA DERIVES FROM THE PAGE, rather than the 9.4in
            // that was hard-coded for Letter at 0.8in margins. On A4 that
            // number is wrong by a third of an inch and on Legal by three,
            // so the editable region either fell short of the page or ran
            // past it -- both of which look like the sheet is the wrong size.
            '--page-margin-left': `${geometry.margin.left}in`,
            '--page-margin-right': `${geometry.margin.right}in`,
            '--page-body-height': scroll
              ? '50svh'
              : `${Math.max(
                  1,
                  geometry.height - geometry.margin.top - geometry.margin.bottom
                )}in`,
            // THE DOCUMENT'S OWN TYPE, where it had any. mammoth converts a
            // .docx to semantic HTML and drops every run property, so without
            // this an imported CV renders in the editor's stylesheet rather
            // than the face its author chose -- Garamond 11pt arriving as
            // sans-serif 15px on the file that reported this.
            //
            // IT IS NOT BRANCHED ON THE VIEW. Scroll view changes the page the
            // document sits on, never the document: the face, the size and the
            // spacing are what will be exported, and a "more readable" scroll
            // view that types at a size the PDF will not use is a preview that
            // lies.
            ...(type.fontFamily ? { fontFamily: type.fontFamily } : {}),
            ...(type.fontSize ? { fontSize: `${type.fontSize}pt` } : {}),
            // `w:line="235"` is 0.98 of SINGLE spacing, and single is the
            // font's own line box -- not 0.98 of the font size, which is what
            // handing the raw number to CSS meant and what set every line on
            // the reported CV about 15% tight.
            ...(cssLineHeight(type.lineHeight, naturalLineHeight)
              ? { lineHeight: cssLineHeight(type.lineHeight, naturalLineHeight)! }
              : {}),
            ...(type.paragraphSpacing !== null
              ? { '--doc-para-space': `${type.paragraphSpacing}pt` }
              : {}),
            // HEADING SIZES THE DOCUMENT STATES, rather than em multiples of
            // the body guessed at. On the reported CV the name is 16pt and a
            // section heading 11pt against a 9.5pt body; guessing 1.45em and
            // 1.05em rendered them at 13.8 and 10. Null falls through to the
            // editor's own scale, which is right for a CV typed here.
            ...(type.titleSize ? { '--doc-h1-size': `${type.titleSize}pt` } : {}),
            ...(type.sectionSize ? { '--doc-h2-size': `${type.sectionSize}pt` } : {}),
            // AND THE SPACE AROUND THEM. `mt-4` is 12pt against the 6.5pt the
            // reported CV sets, which repeated over eight headings is most of
            // a visible margin error down the page.
            ...(type.headingSpaceBefore !== null
              ? { '--doc-h-before': `${type.headingSpaceBefore}pt` }
              : {}),
            ...(type.headingSpaceAfter !== null
              ? { '--doc-h-after': `${type.headingSpaceAfter}pt` }
              : {}),
          } as React.CSSProperties
        }
          className=" [&_.ProseMirror]:min-h-[var(--page-body-height)] [&_.ProseMirror]:outline-none [&_.ProseMirror]:ring-0 [&_.ProseMirror]:shadow-none [&_.ProseMirror]:border-0 [&_.ProseMirror:focus]:outline-none [&_.ProseMirror:focus-visible]:outline-none [&_.ProseMirror:focus]:ring-0 [&_.ProseMirror:focus-visible]:ring-0 [&_.ProseMirror_*:focus]:outline-none [&_.ProseMirror_*:focus-visible]:outline-none [&_.ProseMirror_a]:outline-none [&_.ProseMirror_a:focus]:outline-none [&_.ProseMirror_h1]:[margin-block:0_var(--doc-h-after,0.25rem)] [&_.ProseMirror_h1]:text-[length:var(--doc-h1-size,1.45em)] [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h2]:[margin-block:var(--doc-h-before,1rem)_var(--doc-h-after,0.25rem)] [&_.ProseMirror_h2]:text-[length:var(--doc-h2-size,1.05em)] [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h3]:[margin-block:var(--doc-h-before,0.75rem)_var(--doc-h-after,0.25rem)] [&_.ProseMirror_h3]:font-bold [&_.ProseMirror_h3]:text-[length:var(--doc-h2-size,1em)] [&_.ProseMirror_[data-ruled]]:border-b [&_.ProseMirror_[data-ruled]]:border-current [&_.ProseMirror_[data-ruled]]:pb-0.5 [&_.ProseMirror_p]:[margin-block:0_var(--doc-para-space,0.5rem)] [&_.ProseMirror_ul]:[margin-block:0_var(--doc-para-space,0.5rem)] [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_li]:[margin-block:0] [&_.ProseMirror_li_p]:[margin-block:0_var(--doc-para-space,0.25rem)]"
      />
      )}
    </div>
  )
}

/**
 * One row of the document-actions panel.
 *
 * A ROW, NOT A MENU ITEM, and that is the whole difference Gabe asked for
 * ("a better looking dropdown like version history"). A menu item is a label;
 * these carry a second line saying what the command costs -- which matters
 * most for the two that are hard to take back, `reset` and `delete`. The
 * density and the hairline are `ResumeVersionHistory`'s, because the two
 * panels open from adjacent controls in the same bar.
 */
function ActionRow({
  icon,
  label,
  hint,
  onClick,
  disabled,
  destructive,
  recommended,
  className,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
  /**
   * Marks the one row worth taking by default.
   *
   * ACCENT TEXT, NOT A BADGE. The design system settled on no pills, and a
   * rounded chip here would be the only one in the app -- so the word carries
   * the emphasis and the orange carries the eye. One row may have it: a list
   * where two things are recommended has recommended nothing.
   */
  recommended?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group flex w-full items-start gap-3 border-b border-border-subtle p-3 text-left last:border-b-0',
        'transition-colors duration-(--duration-fast)',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/30',
        'disabled:pointer-events-none disabled:opacity-50',
        destructive ? 'hover:bg-status-rejected-mark/10' : 'hover:bg-bg-inset',
        className
      )}
    >
      <span
        className={cn(
          'mt-0.5 shrink-0',
          destructive
            ? 'text-status-rejected-mark'
            : recommended
              ? 'text-accent-default'
              : 'text-text-muted'
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'text-body-s',
              destructive ? 'text-status-rejected-mark' : 'text-text-primary'
            )}
          >
            {label}
          </span>
          {recommended && (
            <span className="shrink-0 text-body-s text-accent-default">recommended</span>
          )}
        </span>
        <span className="text-body-s text-text-muted">{hint}</span>
      </span>
    </button>
  )
}

/**
 * A CV's review object, so the memo below has something of the right shape to
 * hand down without `letterReview` ever running. A module constant rather than
 * a fresh literal: it is frozen data, and one identity keeps it out of every
 * downstream dependency array.
 */
const EMPTY_REVIEW: LetterReview = { words: 0, findings: [] }

export function WordResumeEditor({
  draft,
  backHref,
  onDelete,
  onPersistDraft,
  jobs = [],
  onTailored,
  kind = 'word',
  tailoredForJobId,
  linkedJobIds,
  polishing = false,
}: WordResumeEditorProps) {
  const isLetter = kind === 'cover_letter'
  const { user } = useAuth()
  const { success, error: showError, info } = useToast()
  const [title, setTitle] = useState(draft.title)
  const [isSaving, setIsSaving] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  /**
   * Dirtiness is a comparison between two counters, not a boolean.
   *
   * A boolean cannot survive the save round trip. The debounce captures the
   * document as it is now, awaits the write, and then has to decide whether the
   * editor is still clean -- and by then more keystrokes may have arrived.
   * Clearing a boolean at that point marks work saved that was never sent, and
   * the header says "Saved 3:42 PM" with no unsaved marker over content that
   * exists only in the DOM. Stamping `savedRevision` with the revision that
   * was actually written leaves the editor dirty for anything typed since.
   *
   * It also fixes a second defect for free: `setIsDirty(true)` on an already
   * true value is not a state change, so React skipped the render and the
   * autosave effect never re-armed. A counter always changes, so an edit that
   * touches nothing else -- a body edit, a template reset -- still re-arms the
   * debounce. Without that, one failed save stopped autosave for the session.
   */
  const [revision, setRevision] = useState(0)
  const [savedRevision, setSavedRevision] = useState(0)
  const isDirty = revision !== savedRevision
  /**
   * `revisionRef` mirrors `revision` synchronously.
   *
   * `saveDraft` has to know which revision its write carries, and reading that
   * from the `revision` state variable reads the value of the render it was
   * created in. That is one behind for any caller that marks the editor dirty
   * and then saves in the same tick -- `restoreSnapshot` does exactly that --
   * so the write got stamped one revision short, the editor stayed dirty over
   * content that was saved, and the debounce re-sent it 1200ms later.
   */
  const revisionRef = useRef(0)
  const markDirty = () => {
    revisionRef.current += 1
    setRevision(revisionRef.current)
  }
  const [lastSavedAt, setLastSavedAt] = useState(draft.updated_at)
  const autosaveTimerRef = useRef<number | null>(null)
  const snapshotTimerRef = useRef<number | null>(null)

  const docAttrs = (
    normalizeWordContent(draft.content) as {
      attrs?: { pageGeometry?: unknown; documentTypography?: unknown }
    }
  ).attrs
  const geometry = normalizeGeometry(docAttrs?.pageGeometry)
  // The face, size and spacing the document was set in. Null members mean
  // "the editor's own styles", which is what a CV typed here gets.
  const type = normalizeTypography(docAttrs?.documentTypography)
  // Word's line spacing is a multiple of the FONT's line box, not of its size,
  // so the face has to be measured before that multiple means anything in CSS.
  const naturalLineHeight = useNaturalLineHeight(type.fontFamily)

  /**
   * The extension list lives in `editorExtensions` so the ribbon's tests build
   * the same editor this does -- see that file for why.
   *
   * THE DOCBLOCK SITS OUT HERE, NOT INSIDE THE OPTIONS, because
   * `tiptapSsr.test.ts` scans a fixed window after `useEditor(` for
   * `immediatelyRender: false` -- and it caught this exact mistake when the
   * comment was inline and pushed the flag out of range. Keep the options
   * compact.
   */
  const editor = useEditor({
    extensions: [
      ...WORD_EDITOR_EXTENSIONS,
      // PAGE HEIGHT IN CSS PIXELS: the page less both margins, at 96dpi,
      // which is what `1in` resolves to in CSS.
      Pagination.configure({
        pageHeight:
          (geometry.height - geometry.margin.top - geometry.margin.bottom) * 96,
        gap: PAGE_GAP_IN * 96,
        // The sheet's own margins, so a break leaves white below the last
        // line and above the first one rather than running text into the seam.
        marginTop: geometry.margin.top * 96,
        marginBottom: geometry.margin.bottom * 96,
      }),
    ],
    content: normalizeWordContent(draft.content),
    editorProps: {
      // No `text-[15px] leading-7` here any more: an imported document sets
      // its own size and leading on the wrapper, and a class on the editable
      // element would win over it.
      attributes: { class: 'focus:outline-none min-h-[10in] text-zinc-900' },
    },
    // Tiptap v3 renders eagerly by default, including on the server. This
    // component is 'use client', but App Router still server-renders a
    // client component for its initial HTML -- /cv is statically
    // prerendered (confirmed in the build output), so `useEditor` really
    // does run server-side. Without this, tiptap throws "SSR has been
    // detected, please set `immediatelyRender` explicitly to `false`" and
    // the whole route crashes with a client-side exception on load.
    immediatelyRender: false,
  })

  useEffect(() => {
    setTitle(draft.title)
    setLastSavedAt(draft.updated_at)
    // Cross-file invariant: `cv/page.tsx` renders the editor with
    // `key={draft.id}`, so switching CVs remounts rather than reusing this
    // component and this reset is belt-and-braces. If that key is ever
    // dropped, a save still in flight from the previous CV can land after the
    // counters are zeroed and stamp `savedRevision` above `revision`, which
    // strands the editor permanently dirty. Keep the key, or make this reset
    // cancel the in-flight save.
    revisionRef.current = 0
    setRevision(0)
    setSavedRevision(0)
    editor?.commands.setContent(normalizeWordContent(draft.content))
  }, [draft.id])

  useEffect(() => {
    if (!editor) return
    const onUpdate = () => markDirty()
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor])

  /** Resolves to whether the write landed, so a caller can stop on failure. */
  const saveDraft = async (notify = false): Promise<boolean> => {
    if (!editor) return false
    // Read from the ref, not the state: a caller that marked the editor dirty
    // in this same tick has not re-rendered yet.
    const writing = revisionRef.current
    setIsSaving(true)
    try {
      const updated = await onPersistDraft(
        draft.id,
        title.trim() || 'Untitled CV',
        'word',
        editor.getJSON()
      )
      setLastSavedAt(updated.updated_at)
      // Never rewind: two saves can overlap, and the older one landing second
      // must not un-save what the newer one already wrote.
      setSavedRevision((current) => Math.max(current, writing))
      if (notify) success('Draft saved', 'Your CV draft is saved to Supabase.')
      return true
    } catch (err) {
      showError('Save failed', err instanceof Error ? err.message : 'Unable to save draft')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Routes every snapshot write through the cadence policy in
   * `resumeSnapshotService`: never write one identical to the latest, and
   * never write an autosave-triggered one more than once per five minutes.
   * `{ force: true }` -- passed only from the explicit Save handler below --
   * bypasses the floor but not the delta guard.
   */
  const writeSnapshot = async (options: { force?: boolean } = {}) => {
    if (!user || !editor) return
    try {
      await maybeCreateSnapshot(supabase, draft.id, user.id, editor.getJSON(), options)
    } catch (err) {
      // Silently fail for snapshots - don't interrupt user workflow
      console.error('Snapshot failed:', err)
    }
  }

  /** The explicit Save button: persists the draft, then forces a checkpoint snapshot. */
  const handleSave = async () => {
    const saved = await saveDraft(true)
    if (saved) void writeSnapshot({ force: true })
  }

  useEffect(() => {
    if (!editor || !isDirty) return
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = window.setTimeout(() => {
      void saveDraft(false)
    }, 1200)
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
    }
  }, [revision, isDirty, editor])

  /**
   * Keyed on `revision` alone, deliberately.
   *
   * `isDirty` used to be in here, and going clean tore the timer down: the
   * save debounce is 1200ms and this one is 5000ms, so in every real session
   * the save landed first, cleared the flag, and cancelled the snapshot before
   * it could fire. Version history was not merely sparse -- it was never
   * written. `user` is out of the deps for the same reason (a re-run cancels);
   * the (app) layout renders nothing until auth resolves, so this component
   * cannot mount without one.
   */
  useEffect(() => {
    if (revision === 0) return
    if (snapshotTimerRef.current) window.clearTimeout(snapshotTimerRef.current)
    snapshotTimerRef.current = window.setTimeout(() => {
      void writeSnapshot()
    }, 5000)
    return () => {
      if (snapshotTimerRef.current) window.clearTimeout(snapshotTimerRef.current)
    }
  }, [revision])


  const resetTemplate = () => {
    /*
      PERSONALISED WITH AN EMPTY PROFILE, WHICH IS NOT A SHORTCUT. The starter
      carries `{{name}}` tokens since 2026-09-17 so that creating a CV from
      scratch fills in the LinkedIn profile, and nothing may hand a document
      with `{{` in it to the editor. This component is deliberately renderable
      with plain props and no QueryClient -- it is why `jobs` is a prop -- so it
      cannot read the profile to do better, and reaching for `useUserProfile`
      here would break eight tests that mount it bare. `EMPTY_PROFILE` renders
      every token's fallback, which is exactly the text this reset produced
      before the tokens existed. Reset means "back to the starter", and the
      starter is what it has always been.
    */
    editor?.commands.setContent(personalizeTemplate(DEFAULT_WORD_CONTENT, EMPTY_PROFILE))
    markDirty()
    info('Template reset', 'The editor has been reset to the starter template.')
  }

  // applyTemplate and its dropdown are gone. Templates are chosen on
  // /documents now, before the document exists, at Gabe's instruction. In the
  // editor the action was destructive dressed as a preset -- it REPLACED
  // whatever was on screen, from a control sitting between `reset` and `save`
  // in the same toolbar. `reset` still restores the starter content, which is
  // the one in-editor case that is genuinely a reset rather than a swap.

  // THE TAILORING RAILS' STATE (Gabe, 2026-09-04). The CV goes to them as
  // plain text: the scorer counts words and the model rewrites sentences, and
  // neither has any use for TipTap's node tree. `editor?.getText()` is read on
  // every render rather than memoised, because it has to follow the document
  // as it is typed -- a score computed against a stale copy is worse than no
  // score, since it looks current.
  // PDF and .docx. `saveDraft` is passed in rather than reached for: see
  // useResumeExport on why that dependency belongs in the signature.
  const exportState = useResumeExport({
    editor,
    title,
    saveDraft,
    authedFetch,
    // WHAT THE SHEET IS ACTUALLY SET IN. `line-height: normal` is a property
    // of the face the BROWSER resolved -- Garamond where it is installed, the
    // fallback serif where it is not -- and the PDF has no browser to measure
    // it in. Sending it is what keeps the exported line spacing at the density
    // of the preview instead of the density of whatever face the server drew.
    naturalLineHeight,
  })

  /** Read every render, not memoised -- see the note above this block. */
  const cvText = editor?.getText() ?? ''

  /**
   * WHICH APPLICATION THE TAILOR PANE IS POINTED AT.
   *
   * A plain string in the editor rather than state inside `useCvTailoring`,
   * and `CvTailoringOptions` carries the full reason. The short version: the
   * hook now lives one component down so a cover letter never calls it, and
   * this is the one value that still has to be visible to the tab strip in the
   * other rail slot. Declared unconditionally because it is a string -- it is
   * not "the tailoring path", and a cover letter simply never writes to it.
   */
  const [tailorJobId, setTailorJobId] = useState('')

  /**
   * THE LETTER CHECK, WHICH IS WHAT A COVER LETTER HAS INSTEAD OF TAILORING.
   *
   * COMPUTED HERE RATHER THAN IN THE PANE because the tab badge needs the
   * count before the pane is opened -- that is the whole job of a badge, to
   * say how much is waiting behind a tab nobody has clicked. Computing it in
   * both places would be two answers to one question.
   *
   * MEMOISED ON THE TEXT, unlike `cvText` above it, because this one is real
   * work: ten rules over the paragraphs, the tokens and the sentences. It is
   * still cheap enough to run on a keystroke, which is exactly why the pane
   * has no "check" button -- see `letterSuggestions` for why none of it is
   * fetched. `EMPTY_REVIEW` keeps a CV from paying for any of it.
   */
  const review = useMemo(
    () => (kind === 'cover_letter' ? letterReview(cvText) : EMPTY_REVIEW),
    [kind, cvText]
  )

  /**
   * EVERYTHING THE TAILORING HOOK NEEDS, BUT NOT THE HOOK ITSELF.
   *
   * This was a `useCvTailoring(...)` call until cover letters arrived, and it
   * is an object now because the call moved down into `TailoringRailPane` --
   * which only mounts for a CV. That is what makes "a cover letter does not
   * run the tailoring path" literally true rather than a matter of nothing
   * being drawn: hooks cannot be called conditionally, so the only way to not
   * call one is to put a component between yourself and it.
   *
   * BUILDING THIS OBJECT COSTS NOTHING ON A COVER LETTER. It is a literal with
   * two closures in it; no request, no filter over the applications, no
   * keyword match. The work all lives behind the hook.
   */
  const tailoringOptions: CvTailoringOptions = {
    cvText,
    jobs,
    linkedJobIds,
    title,
    // Lifted out of the hook so the tab strip -- a different workspace slot --
    // can mark the tailor tab "needs an application". See CvTailoringOptions.
    jobId: tailorJobId,
    onJobId: setTailorJobId,
    // WHAT MAKES THE CACHE AND THE FIXED TARGET REAL. Both were written to be
    // driven from here and neither does anything until it is: no id means no
    // cache, and no tailored-for job means the picker. `draft.id` rather than
    // the title, because two roles at one company produce the same tailored
    // title and would then share a cache entry.
    documentId: draft.id,
    tailoredForJobId,
    // A GETTER, not `editor?.getJSON()` inline. The plain text above is read
    // on every render on purpose; serialising the whole node tree on every
    // keystroke for a button nobody has pressed is not the same trade. This
    // one runs once, when the rewrite is actually being built.
    getContent: () => editor?.getJSON() ?? null,
    // THE OPEN DOCUMENT IS SAVED BEFORE THE NEW ONE IS CREATED, and this
    // wrapper is the whole fix for a real data loss (found in review,
    // 2026-09-13).
    //
    // The route answers `onTailored` by navigating to the new CV. That changes
    // `?draft=`, which changes this editor's `key`, which UNMOUNTS it -- and
    // the autosave effect's cleanup clears the pending 1200ms timer on the way
    // out. Worse, that timer is re-armed on every keystroke, so somebody
    // typing while the model works (and it works for seconds) never reaches a
    // quiet 1200ms at all. Everything typed since the last pause was on its
    // way to Supabase and went nowhere, under a rail promising "the one you
    // have open is left exactly as it is."
    //
    // A FAILED FLUSH STOPS THE HANDOFF rather than navigating anyway: leaving
    // is what destroys the edits, so if they cannot be stored the honest
    // answer is to stay put and say so. `saveDraft` has already raised its own
    // toast by then; this message is what the rail prints.
    onTailored: onTailored
      ? async (input) => {
          if (isDirty && !(await saveDraft(false))) {
            throw new Error(
              'Your unsaved edits could not be saved, so the tailored copy was not created.'
            )
          }
          // CHECKPOINT BEFORE THE HANDOFF, because the route may now REWRITE
          // this document rather than create a new one -- re-tailoring against
          // the application it was already tailored for overwrites the text on
          // screen. Without this the previous rewrite is simply gone: the
          // autosave path takes a snapshot at most once every five minutes, and
          // two tailoring runs inside that window leave nothing to go back to.
          // `force` bypasses that floor but not the delta guard, so a run that
          // changed nothing still writes no version, and the new-document path
          // pays only that same skipped check.
          await writeSnapshot({ force: true })
          const wrote = await onTailored(input)

          // THE REWRITE HAS TO LAND ON SCREEN, and only this branch has to do
          // it by hand. `created` navigates to the new CV, which remounts this
          // editor and loads the new text for free. `updated` rewrote the
          // document you are already looking at and STAYS here -- and the
          // content sync above keys on `draft.id`, deliberately, so that a
          // refetch can never clobber what someone is typing. Nothing else
          // would put the new text in the editor: the row changed, the screen
          // did not, and the match score is derived from `editor.getText()`,
          // so the panel would go on reporting the score of the CV this one
          // replaced.
          if (wrote === 'updated') {
            editor?.commands.setContent(input.content)
            // `setContent` fires `update`, which marks the editor dirty -- over
            // text that was just written to the row it came from. Mark it saved
            // instead, with the same "never rewind" guard `saveDraft` uses so an
            // older overlapping save cannot un-save this.
            setSavedRevision((current) => Math.max(current, revisionRef.current))
            setLastSavedAt(new Date().toISOString())
          }

          return wrote
        }
      : undefined,
  }
  const proofread = useProofread(editor)
  // Follows the caret; see useThesaurus for why it is not behind a button.
  const thesaurus = useThesaurus(editor)
  // Word's zoom-to-fit: the page scales to the well instead of scrolling
  // sideways. See useFitToWidth for why this replaced nudging breakpoints.
  // THE PAGE THIS DOCUMENT WAS WRITTEN FOR. Imported .docx files carry their
  // own size and margins on the doc node; anything else gets Word's default.
  // Hard-coding 0.8in here is what made an imported ATS CV reflow -- see
  // lib/pageGeometry.
  const fit = useFitToWidth(geometry.width * 96)

  /**
   * WHICH RAIL TAB IS OPEN, remembered per browser.
   *
   * Somebody proofreading a CV does it over several sittings, and reopening on
   * Grammar every time would make the tab they actually use a click they pay
   * for repeatedly. `asDocumentTab` coerces anything stored, so a renamed or
   * removed tab cannot leave the rail permanently blank.
   *
   * ONE KEY FOR BOTH KINDS, AND THAT IS WHY THE COERCION TAKES A KIND
   * (2026-09-14). Keying it per kind was the first instinct and it is worse:
   * the preference being remembered is "which of these do I use", and a person
   * who works in the grammar pane works in the grammar pane whichever document
   * is open. What one key costs is the case the kind argument exists for -- a
   * CV left on `tailor`, then a cover letter opened, restoring a tab that rail
   * does not have and leaving the tablist selecting nothing above an empty
   * pane. Coercing on READ rather than rewriting the stored value keeps that
   * one-way: opening a letter does not make the CV forget `tailor`.
   */
  const [tab, setTab] = useState<DocumentTabId>(DEFAULT_DOCUMENT_TAB)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('worktrack:document-tab')
      if (stored) setTab(asDocumentTab(stored, kind))
    } catch {
      // Private windows and blocked site data throw on access. The default
      // tab is a fine answer; losing the preference is not worth an error.
    }
    // `kind` is fixed for the life of a mounted editor -- /cv re-keys on the
    // draft id -- so this is still a mount effect. It is listed because the
    // coercion reads it, not because it is expected to change.
  }, [kind])

  const selectTab = useCallback((next: DocumentTabId) => {
    setTab(next)
    try {
      window.localStorage.setItem('worktrack:document-tab', next)
    } catch {
      // As above: a remembered tab is a convenience, never a requirement.
    }
  }, [])
  const compact = useBelowDesktop()

  const restoreSnapshot = async (content: unknown) => {
    if (content && typeof content === 'object' && (content as { type?: string }).type === 'doc') {
      editor?.commands.setContent(content as JSONContent)
      markDirty()
      await saveDraft(false)
    }
  }

  return (
    <DocumentWorkspace
      /* THE CRUMB IS THE KIND, and "word" only ever meant "the Word editor"
         because that was the only thing this component opened. It is the
         breadcrumb between `documents` and the file's own name, so on a letter
         it has to say letter -- otherwise the path claims you are somewhere
         you are not. */
      kindLabel={isLetter ? 'cover letter' : 'word'}
      documentsHref={backHref}
      title={title}
      onTitleChange={(next) => {
        setTitle(next)
        markDirty()
      }}
      savedLabel={formatSaveTime(lastSavedAt)}
      dirty={isDirty}
      actions={
        <>
          {/* VERSION HISTORY IS DESKTOP-ONLY (Gabe, 2026-09-06). It is the one
              control here that is not a button but a dropdown of snapshots,
              and in the compact action sheet it read as a form field dropped
              into a menu -- and it opens a list of dated entries that wants
              more room than a sheet over a document has. Removed rather than
              hidden: a `display:none` dropdown still mounts, still fetches its
              snapshots, and is still in the tab order. The list remains
              reachable from the documents screen, which is where a phone user
              looks for it. */}
          {user && !compact && (
            <ResumeVersionHistory resumeId={draft.id} userId={user.id} onRestore={restoreSnapshot} />
          )}

          {/*
            EVERYTHING BUT SAVE IS BEHIND ONE ICON ON A DESKTOP (Gabe,
            2026-09-13: "compress this into a settings/avatar icon with
            dropdown to desktop and laptop screens", and in the same breath
            "unwanted space in the toolbar, allow properties to breathe").
            Those are one change: the row was six labelled controls --
            versions, reset, export .docx, export PDF, save, delete -- taking
            about 560px off the right of a ribbon whose own bands were being
            dropped by `visibility` rules for want of width. The formatting
            controls are what the toolbar is FOR; the file commands are what
            a menu is for.

            SAVE STAYS OUT. It is the editor's verb, it is the one control
            here anyone presses more than once a session, and it is the only
            one that reports state -- burying a spinner that says `saving` in
            a closed menu hides the answer to the question the menu would be
            covering. Word keeps Save in the quick-access bar for the same
            reason.

            COMPACT IS UNCHANGED: below `lg` these already live in the dock's
            action sheet, which is the same idea arrived at earlier, and
            nesting a menu inside that sheet would be two taps to reach what
            is currently one.
          */}
          {!compact && (
            <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
              <PopoverTrigger
                render={
                  <Button variant="secondary" size="s" aria-label="Document actions">
                    <SettingsIcon size={14} aria-hidden />
                    <ChevronDownIcon
                      size={14}
                      aria-hidden
                      className={actionsOpen ? 'rotate-180' : undefined}
                    />
                  </Button>
                }
              />
              {/* THE SAME PANEL VERSION HISTORY USES, deliberately (Gabe,
                  2026-09-13: "extend the width and I want a better looking
                  dropdown like version history"). The two controls sit next to
                  each other in the same bar, so a compact menu beside a titled
                  panel read as two different kinds of thing. `w-80`, `p-0` and
                  rows that carry their own padding and hairline -- exactly the
                  shape next door.

                  `align="end"`, where versions uses `start`: this trigger is
                  the last control before the bar's right edge, so a panel
                  opening rightwards would run off it. */}
              <PopoverContent align="end" className="w-80 gap-0 p-0">
                <PopoverHeader className="border-b border-border-subtle p-4">
                  <PopoverTitle className="text-heading-s text-text-primary">
                    document actions
                  </PopoverTitle>
                  <PopoverDescription className="text-body-s text-text-muted">
                    export a copy, start over, or remove this CV. saving stays on the bar.
                  </PopoverDescription>
                </PopoverHeader>

                <div>
                  <ActionRow
                    icon={<RotateCcwIcon size={16} aria-hidden className={iconMotion('back')} />}
                    label="reset to the template"
                    hint="replaces everything you have written"
                    disabled={!editor}
                    onClick={() => {
                      setActionsOpen(false)
                      resetTemplate()
                    }}
                  />
                  {/* FIRST OF THE THREE, AND THE ONLY ONE MARKED (Gabe,
                      2026-09-15: ".tex ... is the best version of the CV").
                      It used to be last, under a comment arguing the list was
                      most-wanted-first and that a .tex source was a thing only
                      academic applications asked for. That was a guess about
                      who exports what; the author of the CVs says the LaTeX
                      output is the one worth sending, so it leads and it says
                      so.

                      The mark is accent text rather than a badge -- see
                      ActionRow -- and exactly one row carries it.

                      THE COMPACT ROW CARRIES ALL THREE TOO (2026-09-17). It
                      held two, under a note here claiming this menu covered
                      every width -- but the menu is `!compact`, so below `lg`
                      there was no menu and no `.tex` anywhere. The one format
                      the app recommends was the one a phone could not reach.
                      */}
                  <ActionRow
                    icon={<DownloadIcon size={16} aria-hidden className={iconMotion('drop')} />}
                    label={exportState.isExportingLatex ? 'exporting .tex…' : 'export .tex'}
                    hint="LaTeX source — the best-looking version of this CV"
                    recommended
                    disabled={!editor || exportState.isExportingLatex}
                    onClick={() => {
                      setActionsOpen(false)
                      void exportState.exportLatex()
                    }}
                  />
                  <ActionRow
                    icon={<DownloadIcon size={16} aria-hidden className={iconMotion('drop')} />}
                    label={exportState.isExportingDocx ? 'exporting .docx…' : 'export .docx'}
                    hint="opens in Word, Pages and Google Docs"
                    disabled={!editor || exportState.isExportingDocx}
                    onClick={() => {
                      setActionsOpen(false)
                      void exportState.exportDocx()
                    }}
                  />
                  <ActionRow
                    icon={<DownloadIcon size={16} aria-hidden className={iconMotion('drop')} />}
                    label={exportState.isExportingPdf ? 'exporting PDF…' : 'export PDF'}
                    hint="what a recruiter should receive"
                    disabled={!editor || exportState.isExportingPdf}
                    onClick={() => {
                      setActionsOpen(false)
                      void exportState.exportPdf()
                    }}
                  />
                  {/* A destructive action does not sit flush against the
                      exports: the heavier rule is the pause before it. */}
                  <ActionRow
                    icon={<TrashIcon size={16} aria-hidden className={iconMotion('lid')} />}
                    label="delete this CV"
                    hint="cannot be undone"
                    destructive
                    className="border-t-2 border-t-border-default"
                    onClick={() => {
                      setActionsOpen(false)
                      onDelete(draft.id)
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/*
            THE SAME THREE EXPORTS AS THE MENU, IN THE MENU'S ORDER. This row
            is written by hand rather than derived from the list above, which
            is how it came to be missing `.tex` for two days while the menu
            called `.tex` the recommended format: two surfaces, one of them
            edited.

            `.tex` TAKES THE EMPHASIS AND PDF GIVES IT UP. The menu marks one
            row `recommended`; a sheet of ghost buttons has no such marker, so
            the ranking has to come from the variants -- and a row where PDF
            is the raised control says the opposite of what the menu says.
            Save is still the only FILLED control here; `secondary` sits under
            it, not beside it.
          */}
          {compact && (
            <>
              <Button variant="ghost" size="s" onClick={resetTemplate} disabled={!editor}>
                <RotateCcwIcon size={14} aria-hidden className={iconMotion('back')} />
                reset
              </Button>
              <Button
                variant="secondary"
                size="s"
                onClick={exportState.exportLatex}
                disabled={!editor || exportState.isExportingLatex}
              >
                <DownloadIcon size={14} aria-hidden className={iconMotion('drop')} />
                {exportState.isExportingLatex ? 'exporting' : 'export .tex'}
              </Button>
              <Button
                variant="ghost"
                size="s"
                onClick={exportState.exportDocx}
                disabled={!editor || exportState.isExportingDocx}
              >
                <DownloadIcon size={14} aria-hidden className={iconMotion('drop')} />
                {exportState.isExportingDocx ? 'exporting' : 'export .docx'}
              </Button>
              <Button
                variant="ghost"
                size="s"
                onClick={exportState.exportPdf}
                disabled={!editor || exportState.isExportingPdf}
              >
                <DownloadIcon size={14} aria-hidden className={iconMotion('drop')} />
                {exportState.isExportingPdf ? 'exporting' : 'export PDF'}
              </Button>
            </>
          )}

          {/*
            SAVE IS PRIMARY, and Export is not. Before this, Export PDF was the
            only filled control on the screen while Save was plain text --
            which told the eye that leaving with a file mattered more than
            keeping the work. In an editor the verb is Save.
          */}
          <Button size="s" onClick={() => void handleSave()} disabled={!editor || isSaving}>
            {isSaving ? <CssSpinner size={14} /> : <CheckIcon size={14} aria-hidden />}
            {isSaving ? 'saving' : 'save'}
          </Button>
        </>
      }
      /* DELETE IS IN THE MENU ON A DESKTOP, so only the compact sheet still
         needs its own slot for it. */
      destructiveActions={
        compact ? (
          <Button
            variant="ghost"
            size="s"
            aria-label={`Delete ${draft.title}`}
            onClick={() => onDelete(draft.id)}
          >
            <TrashIcon size={14} aria-hidden className={iconMotion('lid')} />
            delete
          </Button>
        ) : undefined
      }
      /* THE RIBBON IS NOT A RIBBON ON A PHONE. Below `lg` the toolbar is a
         docked panel, and the ribbon's per-band `visibility` rules -- written
         to drop bands before a horizontal bar overflows -- left exactly ONE
         of its four bands rendered there (history, paragraph and styles all
         measured 0x0 at 390px). `stacked` ignores them; see DocumentToolbar.

         DECIDED HERE RATHER THAN IN THE CHROME because `tools` crosses that
         seam as a built node: CompactDocumentChrome receives the toolbar, it
         does not construct it. `compact` is already on hand for the version
         history below. */
      tools={<DocumentToolbar editor={editor} layout={compact ? 'stacked' : 'ribbon'} />}
      /* THE STRIP IS ITS OWN SLOT so the chrome can keep it next to the pane
         it selects in both arrangements -- beside the document above 1700,
         stacked with it below. See `railNav` in DocumentWorkspace. */
      railNav={
        <DocumentRailTabs
          kind={kind}
          active={tab}
          onSelect={selectTab}
          applicationSelected={!!tailorJobId}
          badges={{
            // Grammar and style together: the tab covers both, so a count
            // that only named half of it would understate the work left.
            grammar: proofread.ran
              ? proofread.grammar.length + proofread.style.length
              : null,
            // THE LETTER CHECK BADGES ITSELF WITHOUT BEING OPENED, which the
            // grammar tab cannot: there is no request to make, so the count is
            // simply true. `null` on a CV rather than 0 -- the tab is not in
            // that strip at all, and a zero would be a claim about it.
            suggestions: isLetter ? review.findings.length : null,
          }}
        />
      }
      /* WORD'S NAVIGATION PANE AND WORD COUNT. The rail was two buttons and a
         column of nothing; these are the two things Word puts there, and both
         read straight off the editor. */
      leftRail={<DocumentNavigator editor={editor} />}
      /* THE BRANCH THAT MAKES "TAILORING DOES NOT RUN" TRUE. It is a component
         swap rather than a prop, because `useCvTailoring` is a hook and the
         only way to not call one is to not mount the thing that calls it --
         see `TailoringRailPane`. A cover letter therefore has no application
         picker, no ATS ring and no rewrite in this tree at all, rather than a
         hidden one. */
      rightRail={
        isLetter ? (
          <DocumentRailPane
            active={tab}
            proofread={proofread}
            thesaurus={thesaurus}
            letter={review}
          />
        ) : (
          <TailoringRailPane
            active={tab}
            proofread={proofread}
            thesaurus={thesaurus}
            tailoring={tailoringOptions}
          />
        )
      }
      /* THE PAGE IS THE SAME PAGE AND THE NOTE UNDER IT IS NOT. Both are
         letter-sized sheets with the same margins, but "print-ready CV" under
         a cover letter names the wrong document -- and this note is the only
         line on the screen that says what the sheet is FOR. */
      footnote={
        isLetter
          ? 'letter-style layout preview with 0.8in margins for a print-ready cover letter.'
          : 'letter-style layout preview with 0.8in margins for a print-ready CV.'
      }
      paged
    >
      {/* THE PAPER REACHES THE BOTTOM OF THE CANVAS IN SCROLL VIEW.
          Measured at 390x844 with the dock closed: a 711px canvas under a
          640px sheet, so 71px of dark well sat beneath the white -- which on a
          short CV reads as the document having been cut off rather than as
          having ended. `min-h-full` here plus `grow` on the sheet (see
          `PageSheet`) is the pair that does it: a percentage min-height needs
          a parent with a resolved height, which the canvas has (`h-full`) and
          this wrapper did not, and flex-grow is what lets the sheet take the
          slack without a measured number anywhere.

          PRINT VIEW IS UNTOUCHED, and measured identical either way (449x581
          in a 390x844 canvas, same offset, same scroll extents). It keeps its
          own `minHeight` and never grows: a zoomed page ending above the fold
          with well below it is what print layout IS. Scroll view has no page
          to end, which is why the band of dark read as damage only there. */}
      <div ref={fit.ref} className="flex min-h-full w-full flex-col">
        <PageSheet
          editor={editor}
          geometry={geometry}
          type={type}
          naturalLineHeight={naturalLineHeight}
          scale={fit.scale}
          polishing={polishing}
        />
      </div>
    </DocumentWorkspace>
  )
}
