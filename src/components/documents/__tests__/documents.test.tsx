import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ResumeSummary } from '@/services/resumeService'
import { formatTouchedDate } from '@/services/date'
import { DocumentRow, DOCUMENT_GRID } from '../DocumentRow'
import { VersionHistory } from '../VersionHistory'
import { DocumentsPage } from '../DocumentsPage'
import { chooseOption } from '@/test/select'

afterEach(() => cleanup())

const STRUCTURED = {
  basics: {
    name: 'Gabe Cervantes',
    label: 'Software Engineer',
    email: 'gabe@example.com',
    phone: '+63 900 000 0000',
    location: 'Manila',
    summary: 'Builds web applications.',
  },
  work: [
    {
      company: 'Acme',
      position: 'Engineer',
      location: 'Remote',
      startDate: '2024-01',
      endDate: null,
      highlights: ['Shipped the billing rewrite'],
    },
  ],
  education: [],
  skills: ['TypeScript'],
  projects: [],
  awards: [],
}

function makeDoc(overrides: Partial<ResumeSummary> = {}): ResumeSummary {
  return {
    id: 'cv-1',
    title: 'Backend CV',
    mode: 'word',
    updated_at: '2026-08-20T10:00:00.000Z',
    sections: STRUCTURED,
    version: 3,
    hasVersions: true,
    ...overrides,
  }
}

const DOC = makeDoc()

describe('DocumentRow', () => {
  it('puts the row controls inside the grid, not beside it', () => {
    // Item 4: "version and delete button, does not align properly". The two
    // controls used to hang outside the grid in a flex wrapper, so the grid's
    // 1fr first column was measured from a width the stack had already taken
    // -- by a different amount per row, which is why the four content columns
    // landed at a different x on each one. As a real cell the grid measures
    // them like everything else.
    const { container } = render(
      <DocumentRow doc={DOC} actions={<button type="button">versions</button>} />
    )
    const row = container.querySelector('[data-document-row]')!
    const actions = row.querySelector('[data-row-actions]')!
    expect(actions.parentElement).toBe(row)
    // Asserted through the shared constant, not a copy of the class string:
    // the header strip and the row each used to spell this out, they drifted
    // (`auto` here against a fixed 8.5rem there), and every column between
    // them sat at a different x in the labels than in the data.
    expect(row.className).toContain(DOCUMENT_GRID)
    // The actions track is fixed, never `auto` -- `auto` makes the whole row's
    // geometry depend on how many buttons a caller happened to pass.
    expect(DOCUMENT_GRID).not.toContain('auto')
  })

  it('renders no actions cell when a caller passes none', () => {
    const { container } = render(<DocumentRow doc={DOC} />)
    expect(container.querySelector('[data-row-actions]')).toBeNull()
  })

  it('is a file row below md and the four-column table from it', () => {
    // Changed 2026-09-06, against Word for Android's Recent list: below `md`
    // the row is a flex line -- glyph, name, overflow menu -- with the meta
    // wrapping beneath, and from `md` it becomes the original grid. It used to
    // be `grid-cols-1` stacking name, meta and a bare trash glyph on three
    // separate lines.
    const { container } = render(<DocumentRow doc={DOC} />)
    const row = container.firstElementChild!
    expect(row.className).toContain('flex flex-wrap')
    expect(row.className).toMatch(/md:grid .*md:grid-cols-\[/)
  })

  it("offers the row's actions in one overflow menu below md", () => {
    // The compact row has no column to put controls in, so everything that is
    // not "open it" goes behind the three dots. The desktop row keeps its own
    // visible controls -- and must not render both, or one row would carry two
    // deletes.
    const { container } = render(
      <DocumentRow doc={DOC} onDelete={() => {}} onOpenVersions={() => {}} actions={<button>del</button>} />
    )
    const menu = container.querySelector('[data-row-menu]')!
    expect(menu).not.toBeNull()
    expect(menu.className).toContain('md:hidden')
    // The leading file glyph belongs to the same compact treatment: it says
    // "this row is a document" where the row has no column header to say it.
    expect(container.querySelector('[data-row-glyph]')!.className).toContain('md:hidden')
    expect(menu.getAttribute('aria-label')).toContain(DOC.title)
    // The desktop controls column is hidden where the menu shows.
    expect(container.querySelector('[data-row-actions]')!.className).toContain('hidden')
  })

  it('renders no menu when the row has nothing to offer', () => {
    const { container } = render(<DocumentRow doc={DOC} />)
    expect(container.querySelector('[data-row-menu]')).toBeNull()
  })

  it('keeps the marker, version and date together on one line beneath the title at 335px', () => {
    // jsdom has no layout engine, so the break is asserted where it is
    // actually declared: one wrapper holds the three trailing cells, and it
    // dissolves into the grid at md so the same markup is four columns on
    // desktop and two lines on mobile.
    const { container } = render(<DocumentRow doc={DOC} />)
    const meta = container.querySelector('[data-row-meta]')!
    expect(meta.className).toContain('md:contents')
    expect(within(meta as HTMLElement).getByText('v3')).toBeTruthy()
    expect(within(meta as HTMLElement).getByText(formatTouchedDate(DOC.updated_at))).toBeTruthy()
  })

  it('separates rows with a hairline rule, not a card border', () => {
    const { container } = render(<DocumentRow doc={DOC} />)
    const row = container.firstElementChild as HTMLElement
    expect(row.className).toContain('border-b')
    expect(row.className).not.toMatch(/(^|\s)border(\s|$)/)
  })

  it('opens the CV in the editor through the ?draft= contract', () => {
    render(<DocumentRow doc={DOC} />)
    expect(screen.getByRole('link', { name: /backend cv/i }).getAttribute('href')).toBe('/cv?draft=cv-1')
  })

  it('shows the ATS verdict for a structured CV as a rule and a label', () => {
    const { container } = render(<DocumentRow doc={DOC} />)
    expect(container.querySelector('[data-ats]')).toBeTruthy()
  })

  it('says a legacy draft was never checked rather than showing it as a failure', () => {
    const { container } = render(<DocumentRow doc={makeDoc({ sections: null })} />)
    expect(container.querySelector('[data-ats]')).toBeNull()
    expect(screen.getByText(/not checked/i)).toBeTruthy()
  })

  it('marks the row with an ATS verdict, never with an application status', () => {
    // A document is not an application, so the row speaks the ATS Check
    // vocabulary (pass/review/fail) and not the five-status one. Both halves
    // are asserted: the verdict actually rendered has to be the one the linter
    // returns for this CV, and no StatusMarker may appear beside it.
    const clean = render(<DocumentRow doc={DOC} />)
    expect(clean.container.querySelector('[data-ats]')!.getAttribute('data-ats')).toBe('pass')
    expect(clean.container.querySelector('[data-status]')).toBeNull()
    cleanup()

    const thin = render(<DocumentRow doc={makeDoc({ sections: { ...STRUCTURED, skills: [] } })} />)
    expect(thin.container.querySelector('[data-ats]')!.getAttribute('data-ats')).toBe('review')
  })

  it('reads updated_at in the viewer zone, because it is an instant and not a calendar day', () => {
    const { container } = render(<DocumentRow doc={DOC} />)
    expect(container.textContent).toContain(formatTouchedDate('2026-08-20T10:00:00.000Z'))
  })

  it('says a CV has no saved versions rather than calling it v0', () => {
    render(<DocumentRow doc={makeDoc({ version: null, hasVersions: false })} />)
    expect(screen.getByText(/no versions/i)).toBeTruthy()
  })

  it('calls a pre-backfill snapshot unnumbered, the same word its own panel uses', () => {
    // Expanding this row lists one entry labelled "Unnumbered". The row saying
    // "No versions" over the top of that is the two surfaces disagreeing about
    // the same column.
    render(<DocumentRow doc={makeDoc({ version: null, hasVersions: true })} />)
    expect(screen.getByText(/unnumbered/i)).toBeTruthy()
    expect(screen.queryByText(/no versions/i)).toBeNull()
  })

  it('names which KIND of document the row is, in the words the filter uses', () => {
    // It named the EDITOR until 2026-09-14 ("Word"), which was a constant once
    // there was one editor. It names the kind now, and it has to say it the
    // way the kind dropdown says it -- a reader who narrows to "CVs" and then
    // reads "Word" down the column has been shown two names for one thing.
    render(<DocumentRow doc={makeDoc({ mode: 'word' })} />)
    expect(screen.getByText('CV')).toBeTruthy()

    cleanup()
    render(<DocumentRow doc={makeDoc({ mode: 'cover_letter' })} />)
    expect(screen.getByText('Cover letter')).toBeTruthy()
  })
})

describe('VersionHistory', () => {
  const VERSIONS = [
    { id: 's-3', version: 3, created_at: '2026-08-20T10:00:00.000Z' },
    { id: 's-2', version: 2, created_at: '2026-08-19T10:00:00.000Z' },
  ]

  it('lists the saved versions of one CV', () => {
    render(<VersionHistory editHref="/cv?draft=cv-1" versions={VERSIONS} />)
    expect(screen.getByText('v3')).toBeTruthy()
    expect(screen.getByText('v2')).toBeTruthy()
  })

  it('sends restoring to the editor, which is the only surface that can do it', () => {
    // This is the documents-list surface: it answers "what versions exist",
    // not "put one back". The editor's own history control owns restore, and
    // duplicating it here would mean two ways to overwrite a CV.
    render(<VersionHistory editHref="/cv?draft=cv-1" versions={VERSIONS} />)
    expect(screen.queryByRole('button', { name: /restore/i })).toBeNull()
    expect(screen.getByRole('link', { name: /editor/i }).getAttribute('href')).toBe('/cv?draft=cv-1')
  })

  it('says the read failed rather than claiming there are no versions', () => {
    render(<VersionHistory editHref="/cv?draft=cv-1" versions={[]} error />)
    expect(screen.queryByText(/no versions saved yet/i)).toBeNull()
    expect(screen.getByText(/could not load/i)).toBeTruthy()
  })

  it('says so plainly when a CV has never been snapshotted', () => {
    render(<VersionHistory editHref="/cv?draft=cv-1" versions={[]} />)
    expect(screen.getByText(/no versions saved yet/i)).toBeTruthy()
  })

  it('shows a pending state rather than an empty one while the read is in flight', () => {
    const { container } = render(
      <VersionHistory editHref="/cv?draft=cv-1" versions={[]} loading />
    )
    expect(container.querySelector('[data-versions-loading]')).toBeTruthy()
    expect(screen.queryByText(/no versions saved yet/i)).toBeNull()
  })
})

describe('DocumentsPage', () => {
  it('carries + new document in the body header, matching Applications Add', () => {
    // `new CV` until 2026-09-14. The button offers two kinds of document now,
    // so a label naming one of them answers half the question for the reader.
    render(<DocumentsPage docs={[DOC]} />)
    const header = document.querySelector('[data-body-header]') as HTMLElement
    expect(within(header).getByRole('button', { name: /new document/i })).toBeTruthy()
  })

  it('puts `new document` in the body header exactly once, never in the Top Bar', () => {
    // Renamed: the old name said "exactly one way to start a CV", which stopped
    // being true when the template gallery and import arrived. It never
    // checked that anyway -- it checks that the HEADER carries one CTA and no
    // more. Content controls belong to the content, not to the Top Bar, which
    // is chrome and identical on five of the seven app screens.
    const { container } = render(<DocumentsPage docs={[DOC]} />)
    const header = container.querySelector('[data-body-header]')!
    const triggers = within(header as HTMLElement).getAllByRole('button', { name: /new document/i })
    expect(triggers).toHaveLength(1)
  })

  it('asks which kind of document before creating anything', async () => {
    // The chooser is back (it was deleted when one editor left it a modal with
    // a single button). What makes it a choice again is that `mode` names the
    // KIND of document rather than the engine, and the two are different
    // enough that guessing is worse than asking.
    const onCreateDraft = vi.fn()
    const user = userEvent.setup()
    render(<DocumentsPage docs={[DOC]} onCreateDraft={onCreateDraft} />)

    await user.click(screen.getByRole('button', { name: /new document/i }))
    expect(onCreateDraft).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /curriculum vitae/i }))
    expect(onCreateDraft).toHaveBeenCalledWith('word')
  })

  it('offers the cover letter as the other half of that choice', async () => {
    const onCreateDraft = vi.fn()
    const user = userEvent.setup()
    render(<DocumentsPage docs={[DOC]} onCreateDraft={onCreateDraft} />)

    await user.click(screen.getByRole('button', { name: /new document/i }))
    await user.click(screen.getByRole('button', { name: /cover letter/i }))
    expect(onCreateDraft).toHaveBeenCalledWith('cover_letter')
  })

  it('narrows the list by kind, and says which control emptied it', async () => {
    // The dropdown was deleted on 2026-09-13 because `word` and `latex` had
    // come to return the same set. Two kinds disagree again, so it is back --
    // and the "nothing matches" copy must name the control that did it rather
    // than borrowing the empty state's "no documents yet", which would be a
    // false claim about the account.
    const user = userEvent.setup()
    const { container } = render(<DocumentsPage docs={[DOC]} />)
    expect(container.querySelectorAll('[data-document-row]')).toHaveLength(1)

    await chooseOption(user, screen.getByLabelText(/filter documents by kind/i), 'cover letters')

    expect(container.querySelectorAll('[data-document-row]')).toHaveLength(0)
    const message = container.querySelector('[data-documents-filter-empty]')!
    expect(message.textContent).toMatch(/no cover letters/i)
    expect(message.textContent).toMatch(/1 document of the other kind/i)
  })

  it('reports the search rather than the kind when a search emptied the list', async () => {
    // The original bug in this copy: naming the kind whatever had happened
    // announced "no cover letters" to somebody who had typed a word that
    // matched nothing while the dropdown still said `all documents`.
    const user = userEvent.setup()
    const { container } = render(<DocumentsPage docs={[DOC]} />)
    await user.type(screen.getByLabelText(/search documents by name/i), 'zzz')

    const message = container.querySelector('[data-documents-filter-empty]')!
    expect(message.textContent).toMatch(/nothing matches/i)
    expect(message.textContent).not.toMatch(/cover letters/i)
  })

  it('renders one row per CV', () => {
    const { container } = render(
      <DocumentsPage docs={[DOC, makeDoc({ id: 'cv-2', title: 'Frontend CV' })]} />
    )
    expect(container.querySelectorAll('[data-document-row]')).toHaveLength(2)
  })

  it('offers a way to start one rather than an empty page when there are no documents', () => {
    // "no documents yet", not "no CVs yet": the list holds cover letters too,
    // and naming one kind tells a letter-writer they are on the wrong screen.
    render(<DocumentsPage docs={[]} />)
    expect(screen.getByText(/no documents yet/i)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /new document/i }).length).toBeGreaterThan(0)
  })

  it('shows one CV version history at a time, beside the row it belongs to', () => {
    const onToggleVersions = vi.fn()
    const { rerender } = render(
      <DocumentsPage docs={[DOC]} onToggleVersions={onToggleVersions} />
    )
    expect(screen.queryByText(/no versions saved yet/i)).toBeNull()

    // The `versions` button is gone at Gabe's request; the version cell is the
    // control now, so the number the column already showed is what opens the
    // history behind it.
    fireEvent.click(screen.getByRole('button', { name: /version history for/i }))
    expect(onToggleVersions).toHaveBeenCalledWith(DOC)

    rerender(<DocumentsPage docs={[DOC]} openVersionsFor="cv-1" versions={[]} />)
    expect(screen.getByText(/no versions saved yet/i)).toBeTruthy()
  })

  it('asks the caller to delete rather than deleting anything itself', () => {
    const onDelete = vi.fn()
    render(<DocumentsPage docs={[DOC]} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: /delete backend cv/i }))
    expect(onDelete).toHaveBeenCalledWith(DOC)
  })
})

describe('the Word-style start screen', () => {
  it('offers templates only, and no blank card', () => {
    // The gallery is why the in-editor dropdown could go: templates are now a
    // starting point rather than an overwrite of what is already open.
    const { container } = render(<DocumentsPage docs={[]} />)
    const cards = [...container.querySelectorAll('[data-template-card]')].map(
      (c) => (c as HTMLElement).dataset.templateCard
    )
    // No blank card: `new document` is already a primary button on this screen, so a
    // blank card would be a third route to the same blank document.
    expect(cards.some((c) => c!.startsWith('blank'))).toBe(false)
    expect(cards.some((c) => c!.startsWith('word-'))).toBe(true)
    // Both sets, which is the bug the data layer left behind: the card list
    // read `modes.includes('word') ? WORD_TEMPLATES : []`, so a gallery asked
    // for cover letters rendered nothing at all.
    expect(cards.some((c) => c!.startsWith('cover-'))).toBe(true)
  })

  it('searches template names AND descriptions, the same way the list searches', async () => {
    // "for a career change" is written only in the description -- the card is
    // named "Career change" -- so a gallery that searched names alone would
    // miss the words somebody actually types. Every term, any order,
    // substring: the rule lives in `./search` precisely so the two boxes on
    // this screen cannot disagree.
    const user = userEvent.setup()
    const { container } = render(<DocumentsPage docs={[]} />)

    await user.type(screen.getByLabelText(/search templates by name/i), 'referred')
    const cards = [...container.querySelectorAll('[data-template-card]')].map(
      (c) => (c as HTMLElement).dataset.templateCard
    )
    expect(cards).toEqual(['cover-referral'])
  })

  it('narrows the gallery by kind without touching the documents list', async () => {
    // Two search boxes and two dropdowns share this screen at desktop width.
    // The guard that they are not wired to each other: narrowing the gallery
    // to cover letters must leave every CV row where it was.
    const user = userEvent.setup()
    const { container } = render(<DocumentsPage docs={[DOC]} />)

    await chooseOption(
      user,
      screen.getByLabelText(/filter templates by kind/i),
      'cover letter templates'
    )

    const cards = [...container.querySelectorAll('[data-template-card]')].map(
      (c) => (c as HTMLElement).dataset.templateCard
    )
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every((c) => c!.startsWith('cover-'))).toBe(true)
    expect(container.querySelectorAll('[data-document-row]')).toHaveLength(1)
  })

  it('reports which template was picked', async () => {
    const onChooseTemplate = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<DocumentsPage docs={[]} onChooseTemplate={onChooseTemplate} />)

    await user.click(container.querySelector('[data-template-card="word-classic"]')!)
    expect(onChooseTemplate.mock.calls[0][0].mode).toBe('word')
    expect(onChooseTemplate.mock.calls[0][0].template.id).toBe('word-classic')

  })

  it('keeps `new document` out of the header until there is a list to act on', () => {
    // Gabe's rule. With no documents the empty state already owns the screen
    // and already carries the call to action; a second identical button in the
    // corner is the same offer made twice, three inches apart.
    const empty = render(<DocumentsPage docs={[]} />)
    expect(empty.container.querySelector('[data-body-header]')!.textContent).not.toMatch(
      /new document/
    )
    empty.unmount()

    render(<DocumentsPage docs={[DOC]} />)
    expect(screen.getByRole('heading', { level: 1 }).closest('[data-body-header]')!.textContent).toMatch(
      /new document/
    )
  })

  it('gives the empty state the primary button, and import beside it', () => {
    const { container } = render(<DocumentsPage docs={[]} />)
    const state = container.querySelector('[data-empty-state]')!
    const newCv = [...state.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('new document')
    )!
    const importBtn = [...state.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('import')
    )!
    // With the header action gone this is the only call to action on the
    // screen, so a secondary here would leave the page with no primary at all.
    expect(newCv.className).not.toMatch(/border-border/)
    expect(importBtn).toBeTruthy()
  })

  it('hands the picked file straight to the caller and resets the input', () => {
    // Reset unconditionally, or picking the same file twice in a row fires
    // change once and the second import silently does nothing.
    const onImport = vi.fn()
    const { container } = render(<DocumentsPage docs={[]} onImport={onImport} />)
    const input = container.querySelector('[data-import-input]') as HTMLInputElement
    const file = new File(['hello'], 'cv.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onImport).toHaveBeenCalledWith(file)
    expect(input.value).toBe('')
  })

  it('labels the document columns, which nothing did before', () => {
    const { container } = render(<DocumentsPage docs={[DOC]} />)
    const columns = container.querySelector('[data-document-columns]')!
    expect(columns.textContent).toMatch(/name/)
    expect(columns.textContent).toMatch(/version/)
    expect(columns.textContent).toMatch(/modified/)
  })
})

describe('column labels line up with the data under them', () => {
  it('declares the same tracks in the header strip and in every row', () => {
    // jsdom has no layout, so this pins the mechanism rather than the pixels:
    // both come from DOCUMENT_GRID, so they cannot disagree. Measured in the
    // browser after the fix, every label sits at the same x as its column.
    const { container } = render(<DocumentsPage docs={[DOC]} />)
    const columns = container.querySelector('[data-document-columns]')!
    const row = container.querySelector('[data-document-row]')!
    expect(columns.className).toContain(DOCUMENT_GRID)
    expect(row.className).toContain(DOCUMENT_GRID)
    // Five tracks each: the label strip carries an empty actions cell so the
    // count matches rather than relying on the browser to forgive a short row.
    expect(columns.children).toHaveLength(5)
  })

  it('does not make "no versions" a control, since there is nothing behind it', () => {
    // A control that opens an empty panel is a promise the data cannot keep.
    const { container } = render(
      <DocumentsPage
        docs={[{ ...DOC, version: null, hasVersions: false }]}
        onToggleVersions={vi.fn()}
      />
    )
    expect(container.querySelector('[data-row-versions]')).toBeNull()
    expect(screen.getByText('no versions')).toBeTruthy()
  })

  it('leaves the row with one control now that `versions` has gone', () => {
    const { container } = render(<DocumentsPage docs={[DOC]} onDelete={vi.fn()} />)
    const actions = container.querySelector('[data-row-actions]')!
    expect(actions.querySelectorAll('button')).toHaveLength(1)
    expect(actions.textContent).not.toMatch(/versions/i)
  })
})

describe('narrowing and paging the document list', () => {
  /** Eleven documents: one page of ten and one of one. */
  const MANY: ResumeSummary[] = Array.from({ length: 11 }, (_, index) => ({
    id: `doc-${index}`,
    title: `CV ${index}`,
    mode: 'word',
    updated_at: new Date(2026, 8, 1 + index).toISOString(),
    sections: null,
    version: 1,
    hasVersions: false,
  }))

  it('shows five at a time and pages to the rest', async () => {
    // FIVE, DOWN FROM TEN (Gabe, 2026-09-13). The desktop screen opens with
    // the template gallery above this list, and ten rows pushed the pager
    // itself under the fold -- so the control that proves the list continues
    // was the part you had to scroll to find.
    const user = userEvent.setup()
    render(<DocumentsPage docs={MANY} />)
    expect(screen.getAllByRole('link', { name: /^CV \d+$/ })).toHaveLength(5)
    expect(screen.getByText('1–5 of 11')).toBeTruthy()

    // `role: 'button'` -- `PaginationLink` renders an anchor that carries an
    // explicit button role, which is right for a control that pages in place
    // rather than navigating.
    await user.click(screen.getByRole('button', { name: '3' }))
    expect(screen.getAllByRole('link', { name: /^CV \d+$/ })).toHaveLength(1)
    expect(screen.getByText('11–11 of 11')).toBeTruthy()
  })

  it('offers no filter at all on an empty account', () => {
    render(<DocumentsPage docs={[]} />)
    expect(screen.queryByLabelText('Filter documents')).toBeNull()
  })

  it('finds a document by name, in any word order', () => {
    // THE CONTROL THIS SCREEN WAS MISSING. The list pages at five, so an
    // account with twenty CVs reached the one it wanted by turning pages and
    // reading titles -- and the format filter cannot answer "where is the
    // Northwind one", because it narrows by KIND.
    //
    // Every term must match, in any order: a CV is named after a company as
    // often as after a role, and nobody remembers which word came first.
    render(<DocumentsPage docs={MANY} />)
    const search = screen.getByLabelText('Search documents by name')

    fireEvent.change(search, { target: { value: 'cv 7' } })
    expect(screen.getAllByRole('link', { name: /^CV \d+$/ })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'CV 7' })).toBeTruthy()

    fireEvent.change(search, { target: { value: '7 cv' } })
    expect(screen.getByRole('link', { name: 'CV 7' })).toBeTruthy()
  })

  it('blames the search rather than the format when a query matches nothing', () => {
    // The old copy named the format whatever had happened, so a query that
    // matched nothing while the filter said `all` announced "no LaTeX
    // documents" -- a false claim about the account.
    render(<DocumentsPage docs={MANY} />)
    fireEvent.change(screen.getByLabelText('Search documents by name'), {
      target: { value: 'kubernetes' },
    })
    const empty = screen.getByText(/nothing matches/i)
    expect(empty.textContent).toContain('kubernetes')
    expect(empty.textContent).not.toMatch(/LaTeX|Word/)
  })

  it('returns to the first page when the query changes', () => {
    // Page 3 of "all" may not exist once a search narrows the list; staying
    // there would strand the reader on an empty page.
    render(<DocumentsPage docs={MANY} />)
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    expect(screen.getByText('11–11 of 11')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Search documents by name'), {
      target: { value: 'cv' },
    })
    expect(screen.getByText('1–5 of 11')).toBeTruthy()
  })
})

/**
 * Finding what was tailored for one company (Gabe, 2026-10-09: "My problem
 * is that I need to use the pagination and search feature to find it").
 */
describe('the application filter', () => {
  const LIBRARY = [
    makeDoc({ id: 'base-cv', title: 'Gabe - CV (ATS)' }),
    makeDoc({ id: 'base-letter', title: 'Standard cover letter', mode: 'cover_letter' }),
    makeDoc({ id: 'apw-cv', title: 'Gabe - CV (ATS) — APW Tech' }),
    makeDoc({ id: 'apw-letter', title: 'Standard cover letter — APW Tech', mode: 'cover_letter' }),
    makeDoc({ id: 'acc-cv', title: 'Gabe - CV (ATS) — Accenture Inc.' }),
    makeDoc({ id: 'zen-cv', title: 'Gabe - CV (ATS) — Zendesk' }),
    makeDoc({ id: 'zen-letter', title: 'Standard cover letter — Zendesk', mode: 'cover_letter' }),
  ]
  const rows = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-document-row]')].map((row) => row.textContent ?? '')

  it('offers every company something was tailored for, A to Z, with its count', async () => {
    const user = userEvent.setup()
    render(<DocumentsPage docs={LIBRARY} />)
    await user.click(screen.getByLabelText(/tailored for/i))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent?.trim())
    expect(options).toEqual([
      'every application',
      'untailored only',
      'Accenture Inc. (1)',
      'APW Tech (2)',
      'Zendesk (2)',
    ])
  })

  it('puts one company’s CV and letter on one page, whatever page they were on', async () => {
    const user = userEvent.setup()
    const { container } = render(<DocumentsPage docs={LIBRARY} />)
    await chooseOption(user, screen.getByLabelText(/tailored for/i), 'Zendesk (2)')
    const shown = rows(container)
    expect(shown).toHaveLength(2)
    expect(shown.every((row) => row.includes('Zendesk'))).toBe(true)
  })

  it('narrows to the general documents', async () => {
    const user = userEvent.setup()
    const { container } = render(<DocumentsPage docs={LIBRARY} />)
    await chooseOption(user, screen.getByLabelText(/tailored for/i), 'untailored only')
    expect(rows(container).map((row) => row.includes('—'))).toEqual([false, false])
  })

  it('says it was the application filter that emptied the list', async () => {
    const user = userEvent.setup()
    const { container } = render(<DocumentsPage docs={LIBRARY} />)
    await chooseOption(user, screen.getByLabelText(/tailored for/i), 'Accenture Inc. (1)')
    await chooseOption(user, screen.getByLabelText(/filter documents by kind/i), 'cover letters')
    expect(container.querySelector('[data-documents-filter-empty]')!.textContent).toMatch(
      /no cover letters tailored for Accenture Inc\./
    )
  })

  it('is absent when nothing has been tailored', () => {
    render(<DocumentsPage docs={[LIBRARY[0], LIBRARY[1]]} />)
    expect(screen.queryByLabelText(/tailored for/i)).toBeNull()
  })
})
