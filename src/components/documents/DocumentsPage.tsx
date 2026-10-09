'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { FilterBar } from '@/components/ui/filter-bar'
import { StatusState } from '@/components/ui/status-state'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { AppDialog } from '@/components/ui/app-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { PlusIcon, TrashIcon, UploadIcon } from '@/components/icons'
import { iconMotion } from '@/components/icons/motion'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { DocumentRow, DOCUMENT_GRID } from './DocumentRow'
import { TemplateGallery, type TemplateChoice } from './TemplateGallery'
import { DocumentChooser } from './DocumentChooser'
import { matchesTerms, searchTerms } from '@/lib/search'
import { tailoredCompanyOf } from '@/services/applicationDocuments'
import { useBelowDesktop } from '@/hooks/useBelowDesktop'
import { buttonVariants } from '@/components/ui/button-variants'
import { ICON_MOTION_GROUP } from '@/components/icons/motion'
import Link from 'next/link'
import { useAppHref } from '@/components/shell/routeBase'
import { VersionHistory, type VersionEntry } from './VersionHistory'
import { IMPORT_ACCEPT } from '@/lib/documentImport'
import type { ResumeMode, ResumeSummary } from '@/services/resumeService'

/**
 * `/cv?draft=new` still works as a deep link -- `src/app/(app)/cv/page.tsx`
 * opens the same `DocumentChooser` dialog directly when it lands there with
 * nothing else to sit behind it.
 *
 * That contract briefly stopped being true: with one editor left, the chooser
 * was a modal with a single button, so `?draft=new` created a CV on arrival
 * instead of asking. There are two kinds of document again, so it asks again,
 * and a bookmark of this URL behaves exactly as the button does.
 */
export const NEW_CV_HREF = '/cv?draft=new'

/**
 * Which kinds of document the list can be narrowed to (Gabe, 2026-09-10).
 *
 * THERE ARE EXACTLY TWO KINDS, not a taxonomy that might grow:
 * `ResumeSummary.mode` has exactly these values and `DocumentRow` already
 * labels every row with one. So the filter is a closed set rather than a
 * search over a free-text field.
 *
 * They used to be `word` and `latex` -- the two EDITORS. The LaTeX editor was
 * dropped on 2026-09-13 and `mode` was repurposed on 2026-09-14 to mean the
 * KIND of document, so the pair is now `word` (a CV) and `cover_letter`. The
 * closed-set argument survives the rename; the values it named do not.
 *
 * THE CONTROL ITSELF WAS DELETED IN BETWEEN, correctly: for one day `word` and
 * `latex` both returned the same set, and a dropdown whose two options cannot
 * disagree is furniture. It is back because the options disagree again.
 *
 * The labels say "documents", "CVs" and "cover letters" where the template
 * gallery's filter says "templates" -- the two dropdowns are on one screen at
 * desktop width and must not read as the same control drawn twice.
 */
const DOC_FILTERS = [
  { value: 'all', label: 'all documents' },
  { value: 'word', label: 'CVs' },
  { value: 'cover_letter', label: 'cover letters' },
] as const

type DocFilter = (typeof DOC_FILTERS)[number]['value']

/**
 * Which application a document was tailored for, as a filter (Gabe,
 * 2026-10-09: "I can easily find a CV/cover letter tailored to a specific job
 * for the company. My problem is that I need to use the pagination and search
 * feature to find it").
 *
 * THE COMPANY IS ALREADY IN EVERY TAILORED COPY'S NAME (`<original> —
 * <company>`; see `tailoredCompanyOf`), so the options come from the list
 * itself, with no extra read, and only companies something was tailored for
 * are offered. Picking one puts that company's CV and letter side by side on
 * one page. `untailored` is the other question people ask of this list:
 * which are my general documents.
 *
 * Values are prefixed so a company called "any" cannot collide with the
 * reset option.
 */
const ANY_APPLICATION = 'any'
const UNTAILORED = 'untailored'
const COMPANY = 'company:'

/**
 * Five a page, and only where there is a pager to turn (Gabe, 2026-09-13:
 * "pagination should display 5 documents only in larger screens and laptop
 * screens. Remove the pagination and maintain the scroll in tablet and mobile
 * screens").
 *
 * IT WAS TEN, on a discoverability argument borrowed from /applications: at
 * twenty, somebody with a dozen CVs never sees a pager and cannot tell the
 * list is paged. Five keeps that and buys something else -- the desktop
 * screen opens with the template gallery above this list, and ten rows pushed
 * the pager itself under the fold, so the control that proves the list
 * continues was the part you had to scroll to find.
 *
 * BELOW `lg` THERE IS NO PAGER AT ALL and the list runs to its full length.
 * A phone scrolls; that is what a phone does. Paging a scrolling surface asks
 * somebody to tap a number to see the eleventh of twelve CVs when a thumb
 * would have got there on its own -- and it puts a row of tap targets between
 * them and the thing they came for.
 */
const PAGE_SIZE = 5

/**
 * The Documents screen, laid out the way Microsoft Word lays out its start
 * screen, at Gabe's instruction: a row of template cards across the top, then
 * the list of documents you already have beneath it.
 *
 * That ordering is the whole idea and it is worth stating why it is right
 * here rather than only in Word. This screen has two jobs -- start something,
 * or reopen something -- and the old layout served only the second, with
 * starting hidden behind one button in the corner. Putting the templates on
 * the page makes the first job visible without a click and gives the empty
 * state something to actually be empty OF.
 *
 * **Where `new document` lives is conditional, deliberately.** With documents
 * on the page it sits in the header, where a page-level action belongs. With
 * none, it does NOT: the empty state already owns the screen and already
 * carries the call to action, and a second identical button in the corner is
 * the same offer made twice, three inches apart. Gabe asked for exactly this.
 *
 * IT IS NOT CALLED `new CV` ANY MORE, because it no longer makes one. It opens
 * the `DocumentChooser`, which asks Curriculum Vitae or Cover Letter, and a
 * button whose label names one of the two things it offers is a button that
 * has already answered half the question on the reader's behalf.
 *
 * `import` sits beside `new document` wherever `new document` is -- header
 * when there are documents, empty state when there are not -- because they are
 * the two ways to get a document into this list and separating them would
 * imply a hierarchy that does not exist.
 *
 * Version history is one row at a time. Loading every CV's snapshots to render
 * a list of CVs would be one query per row for information almost nobody
 * opens, so the caller fetches on demand and this component only says which
 * row asked.
 */
export interface DocumentsPageProps {
  docs: ResumeSummary[]
  onDelete?: (doc: ResumeSummary) => void
  onToggleVersions?: (doc: ResumeSummary) => void
  openVersionsFor?: string | null
  versions?: VersionEntry[]
  versionsLoading?: boolean
  versionsError?: boolean
  /** Fires once a kind is chosen in the new-document dialog; the caller owns the write and the navigation. */
  onCreateDraft?: (mode: ResumeMode) => void
  /** Fires when a template card is picked. A null template means a blank document. */
  onChooseTemplate?: (choice: TemplateChoice) => void
  /** Fires with the picked file; the caller parses it and owns the write. */
  onImport?: (file: File) => void
  creatingDraft?: boolean
}

export function DocumentsPage({
  docs,
  onDelete,
  onToggleVersions,
  openVersionsFor = null,
  versions = [],
  versionsLoading = false,
  versionsError = false,
  onCreateDraft,
  onChooseTemplate,
  onImport,
  creatingDraft = false,
}: DocumentsPageProps) {
  // BELOW `lg` THIS SCREEN IS A DIFFERENT SHAPE, on Gabe's instruction
  // (2026-09-06): recents first, one CTA, and the template grid moved to its
  // own page. Desktop is deliberately UNCHANGED -- he was explicit that the
  // desktop layout stays as it is.
  //
  //
  // Both KINDS of document exist at every width -- the old note here said
  // LaTeX was absent below `lg`, which stopped being a fact about this screen
  // when the LaTeX editor was deleted and `mode` was repurposed. A cover
  // letter is the same row and the same editor as a CV, so nothing is
  // withheld on a phone; only the gallery moves.
  const compact = useBelowDesktop()
  const appHref = useAppHref()
  const openDoc = docs.find((doc) => doc.id === openVersionsFor) ?? null
  const fileInput = React.useRef<HTMLInputElement>(null)
  const hasDocs = docs.length > 0

  const [newDocOpen, setNewDocOpen] = React.useState(false)
  const [filter, setFilter] = React.useState<DocFilter>('all')
  const [application, setApplication] = React.useState<string>(ANY_APPLICATION)
  const [query, setQuery] = React.useState('')
  const [page, setPage] = React.useState(1)

  /**
   * SEARCH BY NAME, and it is the control this screen was missing: the list
   * pages at five, so an account with twenty CVs reached the one it wanted by
   * turning pages and reading titles. The kind filter narrows by KIND; it
   * cannot answer "where is the Northwind one".
   *
   * The match rule lives in `./search` rather than here now, because the
   * template gallery six inches up the page has a search box of its own and
   * the two must not disagree about what a match is. That warning was in this
   * comment before the second box existed.
   */
  const terms = React.useMemo(() => searchTerms(query), [query])

  /** Every company something was tailored for, A to Z, with how many documents. */
  const companies = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const doc of docs) {
      const company = tailoredCompanyOf(doc.title)
      if (company) counts.set(company, (counts.get(company) ?? 0) + 1)
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [docs])

  const selectedCompany = application.startsWith(COMPANY) ? application.slice(COMPANY.length) : null

  const filtered = React.useMemo(() => {
    const byKind = filter === 'all' ? docs : docs.filter((doc) => doc.mode === filter)
    const byApplication =
      application === UNTAILORED
        ? byKind.filter((doc) => !tailoredCompanyOf(doc.title))
        : selectedCompany
          ? byKind.filter((doc) => tailoredCompanyOf(doc.title) === selectedCompany)
          : byKind
    return byApplication.filter((doc) => matchesTerms(terms, doc.title))
  }, [docs, filter, application, selectedCompany, terms])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // CLAMPED, NOT STORED. Deleting the last row of page 3, or narrowing to
  // cover letters when only page 1 has any, would otherwise strand the reader
  // on an empty page with no control that leads anywhere.
  const current = Math.min(page, pageCount)
  // COMPACT TAKES THE WHOLE LIST. Slicing it and then hiding the pager would
  // be worse than either: the rows past the fifth would exist, be filtered,
  // be counted -- and be unreachable, with no control on screen admitting it.
  const paged = compact ? filtered : filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  // Either control changes the result set, so the page index it was valid for
  // is meaningless afterwards.
  React.useEffect(() => {
    setPage(1)
  }, [filter, application, query])

  // ONE CTA, TWO BEHAVIOURS. Below `lg` it is a link to the Templates page;
  // on desktop it opens the document chooser. A link and a button rather than
  // one control that branches on click: the compact one is a navigation and
  // should be middle-clickable, openable in a new tab, and announced as a
  // link.
  //
  // The compact link does NOT open the chooser first. It leads to a screen
  // whose every card already names its kind, so asking on the way in would be
  // asking a question the destination answers better -- and the one card that
  // cannot name its kind, `blank document`, opens the chooser there.
  const newDocCta = compact ? (
    // `buttonVariants` rather than <Button asChild>: this Button has no
    // `asChild`, and the variants module exists precisely so a link can wear
    // the button's clothes -- see button.tsx's note on why it is a separate
    // file and must not be re-exported from there.
    <Link
      href={appHref('/documents/templates')}
      className={cn(ICON_MOTION_GROUP, buttonVariants({ size: 's' }))}
    >
      <PlusIcon size={16} aria-hidden className={iconMotion('open')} />
      new document
    </Link>
  ) : (
    <Button size="s" disabled={creatingDraft} onClick={() => setNewDocOpen(true)}>
      <PlusIcon size={16} aria-hidden className={iconMotion('open')} />
      new document
    </Button>
  )

  const importButton = (
    <Button variant="secondary" size="s" onClick={() => fileInput.current?.click()}>
      <UploadIcon size={16} aria-hidden className={iconMotion('raise')} />
      import
    </Button>
  )

  return (
    /*
      `gap-10` (40px), up from 32. On this screen the template gallery and the
      documents list are stacked, and each one now has a 24px step inside it
      between its header group and its content -- at 32px the boundary BETWEEN
      the sections was barely larger than a gap inside one, so "your documents"
      did not read as a new section starting. See FilterBar for the three
      steps.
    */
    <div className="flex flex-col gap-10">
      {/*
        A hidden input rather than a drop zone or a dialog: the picker is the
        platform's own and already knows how to filter by extension, remember
        the last folder, and search. Rendered once at the top so both call
        sites -- header and empty state -- drive the same element.
      */}
      <input
        ref={fileInput}
        type="file"
        accept={IMPORT_ACCEPT}
        data-import-input
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Cleared unconditionally, so picking the same file twice in a row
          // fires change twice rather than once.
          event.target.value = ''
          if (file) onImport?.(file)
        }}
      />

      <PageHeader
        title="documents"
        description="the CVs and cover letters you send out, and every version you have saved of them."
        action={
          // Below `lg` the CTA is present WHETHER OR NOT there are documents.
          // On desktop it is suppressed on an empty screen because the empty
          // state already carries the same offer three inches away -- but the
          // compact screen puts recents first, so on a full list the empty
          // state is not there to carry it.
          //
          // Stacked and full width on a phone; a row at their natural width
          // from `sm`. Sized HERE rather than in PageHeader, whose action slot
          // is deliberately untyped -- when PageHeader tried to size it
          // generically it stacked /applications' single button's own icon
          // above its own label.
          hasDocs || compact ? (
            <div className="flex items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:[&>*]:w-full">
              {importButton}
              {newDocCta}
            </div>
          ) : undefined
        }
        rule
      />

      {/* DESKTOP ONLY. Below `lg` the grid is a page of its own reached by
          the CTA above -- a six-card gallery pushed the user's actual
          documents below the fold on every phone, which is the wrong thing to
          put first on a screen called "documents". Rendered conditionally
          rather than with `hidden`, so the compact DOM has no gallery in it at
          all -- a `display:none` card is still tabbable in some browsers, and
          the gallery now carries a search box and a dropdown that would be two
          more invisible controls in the tab order. */}
      {!compact && (
        <TemplateGallery
          busy={creatingDraft}
          onChoose={(choice) => onChooseTemplate?.(choice)}
        />
      )}

      {/* `gap-5`, NOT `gap-3` (Gabe, 2026-09-10: "implement proper vertical
          spacing for this section"). Three things stack here -- a heading row,
          a table and a pager -- and at 12px the column labels sat against the
          heading, so "your documents" read as a caption on the NAME column
          rather than as the section's own title. The filter control made it
          worse by raising that row to 40px while the heading stayed 20px. */}
      <section className="flex flex-col gap-6">
        {/* THE FILTER LIVES WITH THE LIST IT NARROWS, not in the page header
            beside `new document` and `import`. Those two are page-level
            actions; this one only means anything next to the rows it hides. It
            is drawn only when there are documents, for the same reason `new
            document` leaves the header on an empty screen -- a control over
            nothing.

            THAT RULE IS NOW LOAD-BEARING RATHER THAN TIDY. At desktop width
            the template gallery above has a search box and a kind dropdown of
            its own, so four narrowing controls are on one screen. What tells
            them apart is that each pair sits on the heading row of the thing
            it narrows -- these with "your documents", those with "start a new
            document" -- and that the labels never repeat a noun: "search
            documents" against "search templates", "CVs" against "CV
            templates". Moving either pair into the page header would put a
            control that narrows one section above both of them. */}
        {/* THE HEADER GROUP: the list's name and the controls that narrow it,
            12px apart because they are one thing, and 24px clear of the table
            below. It was a flat 20/20 -- see FilterBar for the three steps.

            THE GROUP RENDERS EVEN WITH NO CONTROLS, which is why the heading
            is inside it rather than beside it: `hasDocs` gates the row, and an
            empty account still has a section called "your documents". */}
        <div className="flex flex-col gap-3">
          <h2 className="text-heading-s text-text-primary">your documents</h2>

          {/* SEARCH FIRST, THEN THE KIND -- the order `FilterBar` enforces for
            every section that has both. They are not the same kind of control:
            one finds a document you already have in mind, the other changes
            which kind of documents the list is about.

            THE HEADING NO LONGER SHARES THIS LINE (Gabe, 2026-09-15:
            "implement a new row containing that components"). It was a
            `justify-between` row with "your documents" at one end and the pair
            at the other; they are a row of their own now, which is what lets
            the search absorb the width instead of taking whatever the heading
            left. The hand-built version before that set `w-56` for the search
            and `w-44` for the dropdown while the gallery six inches up the page
            set `w-52` for both -- neither number was decided, and the
            difference was visible on one screen. */}
          {hasDocs && (
            <FilterBar
              search={{
                id: 'document-search',
                label: 'Search documents by name',
                placeholder: 'search documents',
                value: query,
                onChange: setQuery,
              }}
              selects={[
                {
                  id: 'document-filter',
                  label: 'Filter documents by kind',
                  icon: 'Documents',
                  value: filter,
                  onValueChange: (next) => setFilter(next as DocFilter),
                  items: DOC_FILTERS.map((option) => ({ ...option })),
                },
                // Only when something has been tailored: with no tailored
                // copies the control would offer one option and a reset.
                ...(companies.length > 0
                  ? [
                      {
                        id: 'document-application',
                        label: 'Filter documents by the application they were tailored for',
                        icon: 'Briefcase' as const,
                        width: 'l' as const,
                        value: application,
                        onValueChange: setApplication,
                        items: [
                          { value: ANY_APPLICATION, label: 'every application' },
                          { value: UNTAILORED, label: 'untailored only' },
                          ...companies.map(([company, count]) => ({
                            value: `${COMPANY}${company}`,
                            label: `${company} (${count})`,
                          })),
                        ],
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>

        {hasDocs ? (
          <div>
            {/* Column labels, Word's own recents header: the row already had
                four columns and nothing said what any of them were. */}
            <div
              data-document-columns
              className={cn(
                // `pb-3` matches the rows' own `py-3`, so the label row sits
                // on the same rhythm as the data under it instead of being
                // pinched against the first one.
                'hidden border-b border-border-subtle pb-3',
                // No labels over nothing: a filter that matches no rows should
                // not leave four column headings floating above its message.
                filtered.length > 0 && 'md:grid',
                DOCUMENT_GRID
              )}
            >
              <span className="text-label-caps uppercase text-text-muted">name</span>
              <span className="text-label-caps uppercase text-text-muted">ATS</span>
              <span className="text-label-caps uppercase text-text-muted">version</span>
              <span className="text-label-caps uppercase text-text-muted">modified</span>
              {/* The actions track, empty. Present so the label row declares
                  the same five tracks the data rows do. */}
              <span />
            </div>
            {paged.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                onOpenVersions={() => onToggleVersions?.(doc)}
                // The same verb, twice, for two surfaces: `onDelete` builds
                // the compact row's overflow menu item, `actions` fills the
                // desktop row's controls column. Passing the callback rather
                // than a second button keeps the two from drifting on what
                // delete MEANS while letting each look right where it is.
                onDelete={() => onDelete?.(doc)}
                actions={
                  // `tone="danger"` (Gabe, 2026-09-15). This control is only
                  // rendered from `md` up -- `DocumentRow` puts the same verb
                  // in an overflow menu below that, where it has been a
                  // `variant="destructive"` item all along. So the two halves
                  // of one row finally agree that delete is destructive; the
                  // desktop half was the one saying otherwise.
                  <IconButton
                    tone="danger"
                    aria-label={`Delete ${doc.title}`}
                    onClick={() => onDelete?.(doc)}
                  >
                    <TrashIcon size={16} aria-hidden className={`[&_svg]:size-4 ${iconMotion('lid')}`} />
                  </IconButton>
                }
              />
            ))}

            {/* A FILTER THAT MATCHES NOTHING IS NOT AN EMPTY ACCOUNT, and it
                must not borrow the empty state's copy -- "no documents yet"
                would be a false claim about the account whenever somebody
                picks cover letters and owns only CVs. */}
            {filtered.length === 0 && (
              // WHICH CONTROL EMPTIED THE LIST IS THE WHOLE MESSAGE, and there
              // are two of them again. Naming the kind whatever had happened
              // was the original bug: a search that matches nothing while the
              // dropdown says `all documents` would announce "no cover
              // letters", which is a false claim about the account. So the
              // search is reported when something was typed -- it is the thing
              // the reader just did -- and the kind only qualifies it.
              //
              // With no search term the dropdown is the only candidate left,
              // and the count of what is in the OTHER kind is the useful half:
              // it says the account is not empty and where the rest went.
              // `StatusState kind="no-results"` since 2026-09-15, replacing a
              // loose muted <p>. The SENTENCES are unchanged -- they were
              // already doing the hard part, which is naming which control
              // emptied the list -- and what they gain is the lens glyph and
              // the centring every other "nothing here" surface in the app
              // has. A line of grey text is the shape a FAILED READ takes too,
              // and telling those two apart at a glance is the whole reason
              // this component exists.
              //
              // `compact`, because this sits inside a section under a heading
              // and a column row, not on an empty screen.
              <StatusState
                kind="no-results"
                compact
                data-documents-filter-empty
                /* The heading must not repeat the message's own opening
                   words -- "nothing matches that search" over "nothing matches
                   'zzz' in CVs" is the same sentence twice, and it broke a
                   test that reads the copy rather than a data attribute. The
                   heading names the SHAPE of the result; the message names the
                   term and the kind. */
                title={terms.length > 0 ? 'no matching documents' : 'nothing of that kind'}
                message={
                  terms.length > 0 ? (
                    <>
                      nothing matches “{query.trim()}”
                      {filter === 'all' ? '' : filter === 'word' ? ' in CVs' : ' in cover letters'}
                      {selectedCompany
                        ? ` tailored for ${selectedCompany}`
                        : application === UNTAILORED
                          ? ' that are untailored'
                          : ''}
                      .
                    </>
                  ) : application !== ANY_APPLICATION ? (
                    // THE APPLICATION FILTER EMPTIED IT, so it is the one named.
                    <>
                      no {filter === 'all' ? 'documents' : filter === 'word' ? 'CVs' : 'cover letters'}{' '}
                      {selectedCompany ? `tailored for ${selectedCompany}` : 'that are untailored'}.
                    </>
                  ) : (
                    <>
                      no {filter === 'word' ? 'CVs' : 'cover letters'}. there
                      {docs.length === 1 ? ' is ' : ' are '}
                      {docs.length} {docs.length === 1 ? 'document' : 'documents'} of the other kind.
                    </>
                  )
                }
                action={
                  // Only when a search is what emptied it. Offering to clear a
                  // search nobody typed is a button that does nothing, and the
                  // dropdown is two inches away and already reads as the
                  // control that did this.
                  terms.length > 0 ? (
                    <Button variant="secondary" size="s" onClick={() => setQuery('')}>
                      clear the search
                    </Button>
                  ) : undefined
                }
              />
            )}

            {filtered.length > 0 && (
              // `pt-5` clears the last row's own hairline. At `pt-4` the
              // count and the pager crowded a rule they are not part of.
              <div className="flex flex-wrap items-center justify-between gap-4 pt-5">
                {/* THE COUNT SURVIVES THE PAGER, and says a different thing on
                    each surface because a different thing is true. Paged, it
                    is which slice you are looking at; scrolling, there is no
                    slice -- so it states the total rather than pretending to
                    describe a window that does not exist. */}
                <p className="text-body-s text-text-muted" data-documents-count>
                  {compact ? (
                    <>
                      {filtered.length} {filtered.length === 1 ? 'document' : 'documents'}
                    </>
                  ) : (
                    <>
                      {(current - 1) * PAGE_SIZE + 1}&ndash;
                      {Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length}
                    </>
                  )}
                </p>
                {/* NO PAGER BELOW `lg`. See PAGE_SIZE: the list is whole there
                    and a phone scrolls it. */}
                {!compact && (
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        aria-disabled={current === 1}
                        className={current === 1 ? 'pointer-events-none opacity-50' : undefined}
                        onClick={(event) => {
                          event.preventDefault()
                          setPage((value) => Math.max(1, value - 1))
                        }}
                      />
                    </PaginationItem>
                    {pageCount > 1 &&
                      Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
                        <PaginationItem key={number}>
                          <PaginationLink
                            href="#"
                            isActive={number === current}
                            onClick={(event) => {
                              event.preventDefault()
                              setPage(number)
                            }}
                          >
                            {number}
                          </PaginationLink>
                        </PaginationItem>
                      ))}
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        aria-disabled={current === pageCount}
                        className={
                          current === pageCount ? 'pointer-events-none opacity-50' : undefined
                        }
                        onClick={(event) => {
                          event.preventDefault()
                          setPage((value) => Math.min(pageCount, value + 1))
                        }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
                )}
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon="Documents"
            action={
              // Primary, at Gabe's instruction, and correct: with the header
              // action gone this is the only call to action on the screen, so
              // a secondary button here would leave the page with no primary
              // at all. `import` sits beside it as the other way in.
              <div className="flex flex-wrap items-center justify-center gap-2">
                {newDocCta}
                {importButton}
              </div>
            }
          >
            {/* "no documents yet", not "no CVs yet": the list holds cover
                letters too, and an empty state that names one kind tells
                somebody who came to write a letter that they are on the wrong
                screen. */}
            {compact
              ? 'no documents yet. start from a template, or import one you already have.'
              : 'no documents yet. start from a template above, write one from scratch, or import one you already have.'}
          </EmptyState>
        )}
      </section>

      <AppDialog
        open={openDoc !== null}
        onOpenChange={(next) => {
          if (!next && openDoc) onToggleVersions?.(openDoc)
        }}
        title={openDoc ? `versions of ${openDoc.title}` : 'versions'}
        icon="RotateCcw"
      >
        {openDoc && (
          <VersionHistory
            editHref={`/cv?draft=${openDoc.id}`}
            versions={versions}
            loading={versionsLoading}
            error={versionsError}
          />
        )}
      </AppDialog>

      {/* Both header and empty-state CTAs open this one dialog rather than
          each owning their own: they are the same offer rendered in two
          places, and two dialogs would be two places for the copy to drift. */}
      <AppDialog
        open={newDocOpen}
        onOpenChange={setNewDocOpen}
        title="new document"
        icon="Documents"
      >
        <DocumentChooser
          creating={creatingDraft}
          onChoose={(mode) => {
            // CLOSED BEFORE THE WRITE, not after it. The caller navigates to
            // the editor when the row lands, and a dialog still mounted over a
            // route that has already changed is the scrim that will not go
            // away -- the failure the version-history dialog hit first.
            setNewDocOpen(false)
            onCreateDraft?.(mode)
          }}
        />
      </AppDialog>
    </div>
  )
}
