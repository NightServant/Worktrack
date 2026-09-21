import * as React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApplicationsPage } from '../ApplicationsPage'
import { ApplicationRecordView } from '../record/ApplicationRecordView'
import { StatusTabs, STATUS_TABS, type StatusTabValue } from '../StatusTabs'
import { ApplicationsTable } from '../ApplicationsTable'
import { makeJob } from '@/test/fixtures'
import { chooseOption, selectedLabel } from '@/test/select'
import type { Job } from '@/types'

// The desktop/mobile fork. jsdom reports a 1024px window, so `useIsMobile` is
// false unless a test says otherwise -- desktop is the default here, and the
// mobile branch is opted into explicitly.
const useIsMobileMock = vi.hoisted(() => vi.fn(() => false))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: useIsMobileMock }))

const JOBS: Job[] = [
  makeJob({ id: '1', status: 'wishlist', company: 'Initech' }),
  makeJob({ id: '2', status: 'applied', company: 'Globex' }),
  makeJob({ id: '3', status: 'interviewing', company: 'Umbrella' }),
  makeJob({ id: '4', status: 'interviewing', company: 'Soylent' }),
  makeJob({ id: '5', status: 'offer', company: 'Hooli' }),
  makeJob({ id: '6', status: 'rejected', company: 'Vandelay' }),
]

afterEach(() => cleanup())

/**
 * Adding an application is FOUR STEPS now, not a form (Worktrack Revisions
 * item 5): a link, a status, the model reading the posting, then the review
 * where it is corrected and saved. Every test below that used to click `add`
 * and type into a field has to walk that path first.
 *
 * No `onAutofill` is passed, so the read step has nothing to call and falls
 * straight through to review -- which is the branch these tests want, since
 * what they are about is the save, not the fetch. `autofillWorkMode.test.tsx`
 * covers the fetch.
 */
async function addUpToReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'add' }))
  // A LINK IS REQUIRED FROM THE FIRST STEP (Gabe, 2026-09-11): `continue` is
  // disabled until there is one, because every step after it is built from
  // that page. These tests are about the save, but they still have to get
  // past the door like anybody else.
  await user.type(screen.getByLabelText(/job posting url/i), 'https://careers.example.com/j/1')
  await user.click(screen.getByRole('button', { name: /continue/i }))
  await user.click(screen.getByRole('button', { name: /fill it in/i }))
  return screen.findByRole('button', { name: /save application/i })
}

describe('opening one application', () => {
  // THE POINT OF THE WHOLE REFACTOR, and the part nothing else asserts: a row
  // opens the record here, in a dialog, instead of navigating to a second
  // screen. AT EVERY WIDTH since 2026-09-09 -- the dialog is a bottom sheet
  // below 640, so the phone gets the same record rather than a second edition
  // of it, and `/applications/[id]` is a redirect into this.

  it('opens the record in a dialog instead of navigating', async () => {
    useIsMobileMock.mockReturnValue(false)
    render(<ApplicationsPage jobs={JOBS} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: `View ${JOBS[0].role} at Initech` }))

    const dialog = await screen.findByRole('dialog')
    // THE HEADING NAMES THE SCREEN, not the row: company, position and status
    // are editable fields a few lines below, so printing them in the header
    // too was three duplicates and no explanation of what the dialog is.
    expect(within(dialog).getByRole('heading', { name: 'application overview' })).toBeTruthy()
    expect(within(dialog).queryByRole('heading', { name: JOBS[0].role })).toBeNull()
    // ONE SURFACE. The record shows and edits at once, so Save is there from
    // the moment it opens and there is no `edit` button to press first --
    // disabled until something actually changes.
    const save = within(dialog).getByRole('button', { name: /save application/i })
    expect(save).toBeDisabled()
    expect(within(dialog).getByLabelText(/^company/)).toHaveValue('Initech')
  })

  it('leaves the company name as plain text, with no second way into the record', () => {
    // Gabe, 2026-09-13: "company name must not be clickable". It used to be an
    // anchor to `/applications/<id>` whose plain left-click was intercepted --
    // which meant one row carried two affordances of different kinds for the
    // same destination. The route still redirects for anyone holding the old
    // address; the row no longer offers it.
    useIsMobileMock.mockReturnValue(false)
    render(<ApplicationsPage jobs={JOBS} />)

    expect(screen.queryByRole('link', { name: 'Initech' })).toBeNull()
    expect(screen.getByText('Initech')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the same dialog on a phone, rather than navigating away', async () => {
    // IT USED TO NAVIGATE, to a full-screen route that was the mobile record.
    // Gabe's revision collapsed the two ("View displays the bottom sheet
    // version of the new view"): AppDialog anchors itself to the bottom edge
    // below 640, which is the shape a phone wants, and one surface is one
    // thing to keep correct instead of two.
    useIsMobileMock.mockReturnValue(true)
    render(<ApplicationsPage jobs={JOBS} />)

    fireEvent.click(screen.getByRole('button', { name: `View ${JOBS[0].role} at Initech` }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('puts view before delete in the actions column, at every width', () => {
    // It was `sm:hidden` -- a phone-only control, back when the company cell
    // was the pointer affordance. With that cell now plain text this is the
    // only way into the record, so hiding it from a pointer would leave a
    // desktop row offering nothing but `delete`.
    render(<ApplicationsPage jobs={JOBS} onDelete={vi.fn()} />)
    const view = screen.getByRole('button', { name: `View ${JOBS[0].role} at Initech` })
    const remove = screen.getByRole('button', { name: `Delete ${JOBS[0].role} at Initech` })

    expect(view.className).not.toContain('sm:hidden')
    // View comes FIRST: the safe action leads, the destructive one follows.
    expect(view.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The edit button that used to sit beside them is gone.
    expect(screen.queryByRole('button', { name: /^edit /i })).toBeNull()
  })

  it('tells the caller which row is open, so the route can read its history', async () => {
    // This screen does not fetch. It reports the selection and the route runs
    // the record's four reads against it -- which is the seam that keeps this
    // component renderable with no QueryClient.
    useIsMobileMock.mockReturnValue(false)
    const onOpenJobChange = vi.fn()
    render(<ApplicationsPage jobs={JOBS} onOpenJobChange={onOpenJobChange} />)

    fireEvent.click(screen.getByRole('button', { name: /^View .* at Initech$/ }))
    expect(onOpenJobChange).toHaveBeenLastCalledWith(JOBS[0])

    await screen.findByRole('dialog')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(onOpenJobChange).toHaveBeenLastCalledWith(null))
  })

  it('closes the record when the row it is showing is deleted out from under it', async () => {
    // Once the row is gone from `jobs`, what is left underneath is a record
    // of something that no longer exists, carrying a Save that would write it
    // back. Keyed on the LIST rather than on the delete callback, so it also
    // covers a row deleted in another tab and arriving through a refetch.
    useIsMobileMock.mockReturnValue(false)
    const { rerender } = render(<ApplicationsPage jobs={JOBS} />)
    fireEvent.click(screen.getByRole('button', { name: /^View .* at Initech$/ }))
    await screen.findByRole('dialog')

    rerender(<ApplicationsPage jobs={JOBS.filter((job) => job.id !== '1')} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('leaves an open record alone when some OTHER row is deleted', async () => {
    // The companion. Without it, closing on every change to `jobs` would pass
    // the test above and make the dialog unusable the moment anything else
    // refetched.
    useIsMobileMock.mockReturnValue(false)
    const { rerender } = render(<ApplicationsPage jobs={JOBS} />)
    fireEvent.click(screen.getByRole('button', { name: /^View .* at Initech$/ }))
    await screen.findByRole('dialog')

    rerender(<ApplicationsPage jobs={JOBS.filter((job) => job.id !== '5')} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
  })

  it('closes a record opened for reading on the first Escape, with no discard prompt', async () => {
    // Viewing is never dirty. A stale `formDirty` from an earlier edit would
    // otherwise make a read-only record refuse to close.
    useIsMobileMock.mockReturnValue(false)
    render(<ApplicationsPage jobs={JOBS} />)
    fireEvent.click(screen.getByRole('button', { name: /^View .* at Initech$/ }))
    await screen.findByRole('dialog')

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(/discard unsaved changes/i)).toBeNull()
  })
})

describe('ApplicationsPage', () => {
  it('renders the same flat list at every width, not a mobile-only fallback', () => {
    // Gabe, verbatim, correcting two earlier misreads of this task: "I said
    // remove the sorting itself, not redesign it" -- the kanban's five status
    // columns WERE the sorting. There is no board any more, at any
    // breakpoint, so there is nothing left to hide below 768px.
    const { container } = render(<ApplicationsPage jobs={JOBS} />)
    expect(container.querySelector('[data-kanban]')).toBeNull()
    expect(container.querySelector('[data-list]')!.className).not.toContain('md:hidden')
    expect(screen.getAllByTestId('application-row')).toHaveLength(JOBS.length)
  })

  it('filters the list by the selected status tab, all being every application ungrouped', () => {
    render(<ApplicationsPage jobs={JOBS} />)
    fireEvent.click(screen.getByRole('tab', { name: /interviewing/i }))
    const rows = screen.getAllByTestId('application-row')
    expect(rows).toHaveLength(JOBS.filter((j) => j.status === 'interviewing').length)
    fireEvent.click(screen.getByRole('tab', { name: /^all/i }))
    expect(screen.getAllByTestId('application-row')).toHaveLength(JOBS.length)
  })

  it('shows "not applied" on the row for a job with no applied date, never a raw fallback string', () => {
    // Regression for the list disagreeing with the dashboard about what an
    // unset date_applied renders as -- both now go through the same
    // formatAppliedDate rather than each inventing its own literal.
    // The second assertion used to forbid the lowercase literal, back when the
    // friendly label was title-case. Chrome is lowercase now (Item 10), so
    // that pair contradicted itself -- the label IS "not applied". Restored to
    // the original intent: show the label, never leak a raw timestamp or a
    // stringified null from created_at.
    const notYetApplied = makeJob({
      id: '7',
      status: 'wishlist',
      date_applied: null,
      created_at: '2026-08-20T14:23:01.123456+00:00',
    })
    render(<ApplicationsPage jobs={[notYetApplied]} />)
    expect(screen.getByText('not applied')).toBeTruthy()
    expect(screen.queryByText(/2026-08-20T/)).toBeNull()
    expect(screen.queryByText(/^null$/i)).toBeNull()
  })

  it('shows previous and next even when everything fits on one page', () => {
    // They were gated on pageCount > 1, so an account under one page saw no
    // pagination at all and could not tell the feature existed -- which is
    // exactly how it read on review.
    render(<ApplicationsPage jobs={JOBS} />)
    expect(screen.getByRole('button', { name: /previous/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /next/i })).toBeTruthy()
    // Both disabled, because there is nowhere to go.
    expect(screen.getByRole('button', { name: /previous/i }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('button', { name: /next/i }).getAttribute('aria-disabled')).toBe('true')
  })

  it('splits the rows across pages and moves between them', () => {
    // M5 Task 4 removed the original 20-per-page pagination along with the
    // advanced filters; Gabe asked for it back.
    const many = Array.from({ length: 45 }, (_, i) =>
      makeJob({ id: `p${i}`, status: 'applied', company: `Co ${i}` })
    )
    render(<ApplicationsPage jobs={many} />)
    expect(screen.getAllByTestId('application-row')).toHaveLength(10)
    expect(screen.getByText(/1.*10 of 45/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '5' }))
    // 45 rows over 10 a page leaves 5 on the last one -- a slice that returned
    // a full page here would mean the offset maths is wrong.
    expect(screen.getAllByTestId('application-row')).toHaveLength(5)
  })

  it('returns to the first page when a search changes the result set', () => {
    // Otherwise narrowing the list while on page 3 leaves the user staring at
    // an empty page with no indication why.
    const many = Array.from({ length: 45 }, (_, i) =>
      makeJob({ id: `p${i}`, status: 'applied', company: `Co ${i}` })
    )
    render(<ApplicationsPage jobs={many} />)
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    expect(screen.getAllByTestId('application-row')).toHaveLength(5)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'Co 1' } })
    expect(screen.getAllByTestId('application-row').length).toBeGreaterThan(5)
  })

  it('marks the selected tab for a screen reader, not just visually', () => {
    render(<ApplicationsPage jobs={JOBS} />)
    const tab = screen.getByRole('tab', { name: /interviewing/i })
    fireEvent.click(tab)
    expect(tab.getAttribute('aria-selected')).toBe('true')
  })

  it('carries Add in the body header rather than the toolbar', () => {
    // The roadmap flagged Add sitting in the Top Bar as the last inconsistency
    // against Documents' "+ new cv". The body header is where it gets fixed.
    const { container } = render(<ApplicationsPage jobs={JOBS} />)
    const header = container.querySelector('[data-body-header]')!
    expect(header.querySelector('button')!.textContent).toContain('add')
  })

  it('narrows the list by the search box', () => {
    render(<ApplicationsPage jobs={JOBS} />)
    fireEvent.change(screen.getByLabelText('Search applications'), {
      target: { value: 'hooli' },
    })
    expect(screen.getAllByTestId('application-row')).toHaveLength(1)
  })

  it('keeps each tab\'s count of every application, not just the ones currently shown', () => {
    render(<ApplicationsPage jobs={JOBS} />)
    const offerTab = screen.getByRole('tab', { name: /offer/i })
    expect(offerTab.textContent).toContain(String(JOBS.filter((j) => j.status === 'offer').length))
  })

  it('shows a real empty state, not a blank panel, for a status with zero applications', async () => {
    const noRejected = JOBS.filter((job) => job.status !== 'rejected')
    render(<ApplicationsPage jobs={noRejected} />)
    await userEvent.click(screen.getByRole('tab', { name: /rejected/i }))
    expect(screen.queryAllByTestId('application-row')).toHaveLength(0)
    expect(screen.getByText(/no rejected applications yet/i)).toBeTruthy()
  })

  it('states the status with a rule and a label, never a pill', () => {
    const { container } = render(<ApplicationsPage jobs={JOBS} />)
    const rules = container.querySelectorAll('[data-status-rule]')
    expect(rules.length).toBeGreaterThan(0)
    rules.forEach((rule) => expect(rule.className).toContain('rounded-none'))
  })

  it('says there are no applications at all, before any tab or search narrows the list', () => {
    render(<ApplicationsPage jobs={[]} />)
    expect(screen.getByText(/no applications yet/i)).toBeTruthy()
  })

  it('keeps the form open with the typed data when the save is rejected', async () => {
    // The route handlers catch and used to swallow every failure, so the
    // promise always resolved and the panel always closed -- a pasted job
    // description vanished behind a toast on an RLS denial. onCreate now
    // resolves to false on that same caught failure, and the panel has to
    // stay open with the field intact instead of discarding it.
    const onCreate = vi.fn().mockResolvedValue(false)
    const user = userEvent.setup()
    render(<ApplicationsPage jobs={JOBS} onCreate={onCreate} />)
    const save = await addUpToReview(user)
    fireEvent.change(screen.getByLabelText(/^company/), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText(/^position/), { target: { value: 'Engineer' } })
    fireEvent.click(save)
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('heading', { name: /new application/i })).toBeTruthy()
    expect(screen.getByLabelText(/^company/)).toHaveValue('Acme')
  })

  it('closes the form only once the save resolves successfully', async () => {
    const onCreate = vi.fn().mockResolvedValue(true)
    const user = userEvent.setup()
    render(<ApplicationsPage jobs={JOBS} onCreate={onCreate} />)
    const save = await addUpToReview(user)
    fireEvent.change(screen.getByLabelText(/^company/), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText(/^position/), { target: { value: 'Engineer' } })
    fireEvent.click(save)
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /new application/i })).toBeNull()
    )
  })

  it('keeps the parsed CSV state when the import is rejected', async () => {
    const onImport = vi.fn().mockResolvedValue(false)
    const file = {
      name: 'jobs.csv',
      text: () => Promise.resolve('company,role\nAcme,Engineer'),
    } as unknown as File
    render(<ApplicationsPage jobs={JOBS} onImport={onImport} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByText(/jobs\.csv/i)
    fireEvent.click(screen.getByRole('button', { name: /^import 1$/i }))
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(screen.getByText(/jobs\.csv/i)).toBeTruthy()
  })

  it('reports a failed CSV read instead of leaving an unhandled rejection', async () => {
    // handleCsvFile had no try/catch: a throw from file.text() or Papa became
    // an unhandled rejection with no user feedback, the same failure-eats-work
    // shape as a rejected save.
    const onCsvError = vi.fn()
    const brokenFile = {
      name: 'broken.csv',
      text: () => Promise.reject(new Error('disk error')),
    } as unknown as File
    render(<ApplicationsPage jobs={JOBS} onCsvError={onCsvError} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [brokenFile] } })
    await waitFor(() => expect(onCsvError).toHaveBeenCalledWith('disk error'))
    expect(screen.queryByText(/broken\.csv/i)).toBeNull()
  })

  it('moves focus into the dialog and onto the first field, with no scroll compensation needed', async () => {
    // A card low on a five-column board used to be off-screen from where the
    // inline section opened, so ApplicationsPage carried its own
    // scrollIntoView + .focus() effect to compensate. A dialog is centred in
    // the viewport regardless of where its trigger sits, and Base UI's own
    // focus trap moves focus in on open -- so that compensation is gone, and
    // this pins the dialog's own behaviour rather than assuming it.
    //
    // OPENED FROM THE ROW, not from an `edit` button: that button is gone, and
    // the record is editable the moment it opens.
    const user = userEvent.setup()
    render(<ApplicationsPage jobs={JOBS} />)
    await user.click(screen.getByRole('button', { name: /^View .* at Initech$/ }))
    expect(await screen.findByLabelText(/^company/)).toHaveFocus()
  })

  it('returns focus to the row that opened the dialog once it closes', async () => {
    const user = userEvent.setup()
    render(<ApplicationsPage jobs={JOBS} />)
    const trigger = screen.getByRole('button', { name: /^View .* at Initech$/ })
    await user.click(trigger)
    expect(await screen.findByLabelText(/^company/)).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })

  it('asks before discarding a dirty form on Escape, an overlay click or the header close button', async () => {
    const user = userEvent.setup()
    render(<ApplicationsPage jobs={JOBS} />)
    await addUpToReview(user)
    await user.type(screen.getByLabelText(/^company/), 'Acme')

    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: /discard/i })).toBeTruthy()
    // The form dialog is still open and the typed field is still intact --
    // Escape did not drop it, it only raised the question.
    expect(screen.getByLabelText(/^company/)).toHaveValue('Acme')

    await user.click(screen.getByRole('button', { name: 'cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByLabelText(/^company/)).toHaveValue('Acme')

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByLabelText(/^company/)).toBeNull()
  })

  it('stops asking to discard once the save has landed', async () => {
    // A save that worked moves the draft's baseline. Without that the record
    // stays permanently dirty against the values it opened with, and every
    // Escape from then on offers to discard changes that are already stored --
    // which reads as "it did not save".
    const user = userEvent.setup()
    render(<ApplicationsPage jobs={JOBS} onUpdate={vi.fn().mockResolvedValue(true)} />)
    await user.click(screen.getByRole('button', { name: /^View .* at Initech$/ }))
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText(/^company/), '!')
    await user.click(screen.getByRole('button', { name: /save application/i }))

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('still asks when the save was rejected, because the values are only here', async () => {
    const user = userEvent.setup()
    render(<ApplicationsPage jobs={JOBS} onUpdate={vi.fn().mockResolvedValue(false)} />)
    await user.click(screen.getByRole('button', { name: /^View .* at Initech$/ }))
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText(/^company/), '!')
    await user.click(screen.getByRole('button', { name: /save application/i }))

    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: /discard/i })).toBeTruthy()
  })

  it('closes an untouched wizard immediately on Escape, with no discard prompt', async () => {
    const user = userEvent.setup()
    render(<ApplicationsPage jobs={JOBS} />)
    await user.click(screen.getByRole('button', { name: 'add' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('heading', { name: /new application/i })).toBeNull()
  })

  // "STILL LETS CANCEL CLOSE A DIRTY FORM IMMEDIATELY" WAS HERE. There is no
  // Cancel any more: the record shows and edits one surface, so there is
  // nothing to cancel back to, and the wizard's footer offers `back` to the
  // previous step instead of an abandon. Every remaining dismiss path is one
  // a dialog adds -- Escape, the overlay, the header close -- and all three
  // ask before discarding, which the test above this one pins.

  it('wires the list as a labelled tabpanel for the selected status tab', () => {
    render(<ApplicationsPage jobs={JOBS} />)
    const panel = document.querySelector('[data-list]')!
    expect(panel.getAttribute('role')).toBe('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe('status-tab-all')
    fireEvent.click(screen.getByRole('tab', { name: /interviewing/i }))
    expect(panel.getAttribute('aria-labelledby')).toBe('status-tab-interviewing')
  })
})

function StatusTabsHarness({ initial }: { initial: StatusTabValue }) {
  const [value, setValue] = React.useState<StatusTabValue>(initial)
  const counts = Object.fromEntries(STATUS_TABS.map((tab) => [tab, 0])) as Record<
    StatusTabValue,
    number
  >
  return <StatusTabs value={value} onChange={setValue} counts={counts} />
}

const ZERO_COUNTS = Object.fromEntries(STATUS_TABS.map((tab) => [tab, 0])) as Record<
  StatusTabValue,
  number
>

// Base UI's composite commits the roving-tabindex focus move inside a
// `queueMicrotask` (it waits one tick for its own FocusManager), unlike the
// hand-rolled `handleKeyDown` this replaces, which called `.focus()`
// synchronously. `userEvent.keyboard` (rather than a raw `fireEvent.keyDown`)
// is what actually flushes that tick correctly -- it is already the
// act-aware, real-event path RTL recommends, and a raw `fireEvent` plus a
// manually awaited microtask left React warning about an update outside
// `act` even when the assertions passed.
async function pressKey(user: ReturnType<typeof userEvent.setup>, key: string) {
  await user.keyboard(`{${key}}`)
}

/**
 * The empty board, which is the first screen a new account ever sees.
 *
 * IT WAS THE ONE SURFACE NOT USING THE DESIGN SYSTEM'S EMPTY STATE. A
 * hand-rolled block: left-aligned, its own `h2`, `text-muted` copy, no glyph.
 * Every other empty surface in the app -- documents, both calendar rails, four
 * analytics panels, and the applications TABLE in the next file -- already
 * went through `EmptyState`, so this screen was the only one that looked like
 * a different product.
 *
 * WHY THESE ASSERT ON STRUCTURE AND NOT ON COPY: the sentence should be
 * editable without a red build. What must not drift is that this screen uses
 * the shared component, and that it carries exactly ONE call to action.
 */
describe('an account with nothing in it yet', () => {
  it('renders the design system empty state rather than a bespoke block', () => {
    const { container } = render(<ApplicationsPage jobs={[]} />)
    expect(container.querySelector('[data-empty-state]')).toBeTruthy()
  })

  it('keeps the call to action, in the empty state', () => {
    // Gabe, 2026-09-15: "empty state must have the CTA". Removing the header
    // button must not leave the screen with no way to add anything.
    render(<ApplicationsPage jobs={[]} />)
    const cta = screen.getByRole('button', { name: 'add your first application' })
    expect(cta.closest('[data-empty-state]')).toBeTruthy()
  })

  it('drops the header action, so one screen does not offer two primaries', () => {
    // THE ASSERTION THAT WOULD CATCH A REVERT. Both buttons open the same
    // dialog; showing both is the page arguing with itself about where to
    // start.
    render(<ApplicationsPage jobs={[]} />)
    expect(screen.queryByRole('button', { name: 'add' })).toBeNull()
  })

  it('brings the header action back as soon as there is anything to add to', () => {
    // The suppression is scoped to the empty case. On a populated board the
    // empty state is not rendered at all, so the header is the only way in.
    const { container } = render(<ApplicationsPage jobs={JOBS} />)
    expect(screen.getByRole('button', { name: 'add' })).toBeInTheDocument()
    expect(container.querySelector('[data-empty-state]')).toBeNull()
  })

  it('still offers the import route the empty copy points at', () => {
    // The sentence tells people they can import a spreadsheet instead; the
    // toolbar has to still be there for that to be true.
    render(<ApplicationsPage jobs={[]} />)
    expect(screen.getByRole('button', { name: /import csv/i })).toBeInTheDocument()
  })
})

describe('StatusTabs', () => {
  it('moves focus and selection with ArrowRight/ArrowLeft, wrapping at the ends', async () => {
    const user = userEvent.setup()
    render(<StatusTabsHarness initial="all" />)
    const first = screen.getByRole('tab', { name: /^all/i })
    first.focus()
    await pressKey(user, 'ArrowRight')
    expect(screen.getByRole('tab', { name: /wishlist/i })).toHaveFocus()
    expect(screen.getByRole('tab', { name: /wishlist/i }).getAttribute('aria-selected')).toBe(
      'true'
    )
    await pressKey(user, 'ArrowLeft')
    expect(screen.getByRole('tab', { name: /^all/i })).toHaveFocus()
  })

  it('jumps to the first and last tab on Home and End', async () => {
    const user = userEvent.setup()
    render(<StatusTabsHarness initial="applied" />)
    const current = screen.getByRole('tab', { name: /applied/i })
    current.focus()
    await pressKey(user, 'End')
    expect(screen.getByRole('tab', { name: /rejected/i })).toHaveFocus()
    await pressKey(user, 'Home')
    expect(screen.getByRole('tab', { name: /^all/i })).toHaveFocus()
  })

  it('reaches every tab from the keyboard, not just the selected one', async () => {
    // Roving tabindex with no onKeyDown left five of six tabs unreachable by
    // Tab -- this pins that arrow-key traversal actually visits all six.
    const user = userEvent.setup()
    render(<StatusTabsHarness initial="all" />)
    let current = screen.getByRole('tab', { name: /^all/i })
    current.focus()
    const seen = new Set<string>()
    for (let i = 0; i < STATUS_TABS.length; i += 1) {
      seen.add(current.textContent ?? '')
      await pressKey(user, 'ArrowRight')
      current = document.activeElement as HTMLElement
    }
    expect(seen.size).toBe(STATUS_TABS.length)
  })

  it('is present at desktop widths, not only on mobile', () => {
    // Item 3. The board separates by status but cannot present a sorted view
    // of everything, so the tabs are the sort control at every width.
    const { container } = render(
      <StatusTabs value="all" onChange={vi.fn()} counts={ZERO_COUNTS} />
    )
    const list = container.querySelector('[role="tablist"]')!
    expect(list.className).not.toContain('md:hidden')
    // Positive companion: prove the element is the thing being asserted on.
    expect(list.querySelectorAll('[role="tab"]')).toHaveLength(6)
  })

  it('marks each status tab with its own status colour', () => {
    // Figma 60:674 -- a 6px ellipse per status tab, in the status hue. This is
    // a legend swatch, not the active marker; the active marker stays accent.
    const { container } = render(
      <StatusTabs value="all" onChange={vi.fn()} counts={ZERO_COUNTS} />
    )
    const applied = container.querySelector('#status-tab-applied [data-status-mark]')!
    expect(applied.className).toContain('bg-status-applied-mark')
    // The plan's draft of this test expected `''`, but React's typed
    // `aria-hidden` prop only accepts a `Booleanish` value, and the JSX
    // shorthand `aria-hidden` (as every other `aria-hidden` span in this
    // codebase already uses) renders `"true"`, not an empty string.
    expect(applied.getAttribute('aria-hidden')).toBe('true')
  })

  it('gives the all tab no status colour', () => {
    // "all" is not a status. A sixth hue on it would invent one.
    const { container } = render(
      <StatusTabs value="all" onChange={vi.fn()} counts={ZERO_COUNTS} />
    )
    expect(container.querySelector('#status-tab-all [data-status-mark]')).toBeNull()
  })

  it('keeps the active marker accent, not the status hue', () => {
    const { container } = render(
      <StatusTabs value="offer" onChange={vi.fn()} counts={ZERO_COUNTS} />
    )
    const rule = container.querySelector('#status-tab-offer [data-tab-rule]')!
    expect(rule.className).toContain('bg-accent-default')
    expect(rule.className).not.toContain('status-offer')
  })
})

/**
 * `ApplicationForm` WAS TESTED HERE. It was deleted on 2026-09-09 -- the
 * record shows and edits one surface, so a separate form in a separate dialog
 * had nothing left to be. Every rule below is unchanged and now belongs to
 * `ApplicationRecordView`; only the component under it moved.
 *
 * The submit reads `Save application` in both cases now. The old form said
 * `Add application` for a new one, and the wizard's review step says Save
 * because saving is what that step does.
 */
describe('the record’s fields and its one submit', () => {
  // `showAll` so the optional fields are on screen without a click. The
  // record hides the ones this application has never filled in -- that rule
  // has its own test in detail.test.tsx.
  const renderRecord = (props: Partial<React.ComponentProps<typeof ApplicationRecordView>> = {}) =>
    render(
      <ApplicationRecordView
        job={null}
        defaultCurrency="PHP"
        onSubmit={vi.fn()}
        layout="review"
        {...props}
      />
    )

  it('starts a new application in the stored default currency', () => {
    // A PHP user typing a peso figure into a form defaulted to USD produces a
    // number that is wrong by a factor of 55 and looks plausible.
    renderRecord()
    // A button, not a <select>: what it SHOWS is the assertion.
    expect(selectedLabel(screen.getByLabelText('currency'))).toBe('PHP')
  })

  it('disables submit and shows a spinner while saving', () => {
    renderRecord({ saving: true })
    const submit = screen.getByRole('button', { name: /saving/i })
    expect(submit).toHaveProperty('disabled', true)
    // `aria-busy` AND the spinning element, rather than the spinner's old
    // `role="status"`. This button now passes a `loadingText`, so its label
    // already reads "Saving..." and CssSpinner drops its own "Loading" label
    // to keep the two from concatenating into "Loading Saving...". The state
    // is still announced -- by aria-busy and by the name this query matched --
    // and the spinner is still drawn. Only the redundant role went.
    expect(submit).toHaveAttribute('aria-busy', 'true')
    expect(submit.querySelector('.animate-spin')).toBeTruthy()
  })

  it('keeps the job own currency when editing rather than the account default', () => {
    // Re-defaulting an existing USD job to the account currency would relabel
    // a stored figure without changing it.
    const job = makeJob({ id: '9', status: 'applied', salary_currency: 'USD' })
    renderRecord({ job })
    expect(selectedLabel(screen.getByLabelText('currency'))).toBe('USD')
  })

  it('refuses to submit a job with no company and says why', () => {
    const onSubmit = vi.fn()
    renderRecord({ onSubmit })
    fireEvent.change(screen.getByLabelText(/^position/), { target: { value: 'Engineer' } })
    fireEvent.click(screen.getByRole('button', { name: /save application/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/company is required/i)).toBeTruthy()
  })

  it('submits the typed currency alongside the figures', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderRecord({ onSubmit })
    fireEvent.change(screen.getByLabelText(/^company/), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText(/^position/), { target: { value: 'Engineer' } })
    await chooseOption(user, screen.getByLabelText('currency'), 'USD')
    fireEvent.click(screen.getByRole('button', { name: /save application/i }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      company: 'Acme',
      role: 'Engineer',
      salary_currency: 'USD',
    })
  })

  it('saves with a LABELLED button, which is the half of that rule that held', () => {
    // REVERSED IN PART, 2026-09-05. This asserted the submit had no icon at
    // all -- "Save was one of the four glyphs M5 eliminated outright" -- and
    // Gabe asked for icons on CTA buttons, then on tertiary and danger ones,
    // which supersedes it.
    //
    // What M5 was actually protecting against survives and is asserted here:
    // an ICON-ONLY save. A glyph beside a word is not the thing that was
    // eliminated; a glyph INSTEAD of the word was.
    const { container } = renderRecord()
    const submit = container.querySelector('button[type="submit"]')!
    expect(submit.textContent!.trim().length).toBeGreaterThan(0)
    expect(submit.querySelectorAll('svg').length).toBe(1)
  })
})

describe('ApplicationsTable accent header', () => {
  it('wears the accent band on its header, from the surface token not the text one', () => {
    const { container } = render(<ApplicationsTable jobs={[makeJob({ id: 'a', status: 'applied' })]} />)
    const header = container.querySelector('thead')!
    expect(header.className).toMatch(/bg-accent-surface/)
    // accent-default is chosen for text contrast -- accent-400 in dark -- so a
    // full-width band of it is the over-bright header Gabe rejected on the
    // calendar. Same rule, same token, both surfaces.
    expect(header.className).not.toMatch(/bg-accent-default/)
    // TableHead sets its own muted foreground, which wins over inheritance.
    expect(header.className).toMatch(/text-accent-on-surface/)
  })

  it('bands its rows from the same accent family, not a neutral grey', () => {
    const { container } = render(
      <ApplicationsTable jobs={[makeJob({ id: 'a', status: 'applied' }), makeJob({ id: 'b', status: 'applied' }), makeJob({ id: 'c', status: 'applied' })]} />
    )
    const rows = [...container.querySelectorAll('tbody tr')]
    // Striping is only striping if neighbours differ.
    expect(rows[0].className).not.toMatch(/\brow-zebra\b/)
    expect(rows[0].className).toMatch(/bg-bg-canvas/)
        // `row-zebra` rather than the literal `bg-accent-surface/30` this used to
    // assert. Same colour, now opaque (see the utility): a sticky first column
    // has the rest of its row sliding underneath it, and a translucent band
    // lets that show through.
    expect(rows[1].className).toMatch(/\brow-zebra\b/)
    expect(rows[2].className).not.toMatch(/\brow-zebra\b/)
    expect(rows[2].className).toMatch(/bg-bg-canvas/)
    // The old neutral band is gone -- a grey table with an orange header was
    // the thing that read as two unrelated decisions.
    expect(rows[1].className).not.toMatch(/bg-bg-surface/)
  })
})

/**
 * Gabe asked for icons on the fields in the application edit dialog
 * (2026-09-05). The rule that decides WHICH fields get one is the part worth
 * pinning, because it is invisible in the source -- it lives across nineteen
 * separate `icon=` props and one person adding a field will not know it.
 */
describe('naming the record\'s fields with glyphs', () => {
  function renderForm() {
    // `layout="review"` opens every optional field, which is what makes this
    // an all-or-nothing check over the whole set rather than over whichever
    // fields one fixture happened to fill in.
    return render(
      <ApplicationRecordView
        job={null}
        defaultCurrency="PHP"
        onSubmit={vi.fn()}
        layout="review"
      />
    )
  }

  /** The glyph a control carries, if any. */
  function glyphFor(id: string): SVGElement | null {
    const control = document.getElementById(id)!
    // Input, Select and Textarea all wrap the control in a `relative` box and
    // put the glyph in it as a sibling.
    return control.closest('.relative')?.querySelector('svg') ?? null
  }

  it('names every field in a section that holds more than one', () => {
    // The whole first column, plus the CV field under it. Half a column with
    // glyphs reads as a rendering fault rather than a system, so this is
    // all-or-nothing.
    //
    // `contact_*` is absent: notes and contact left the record entirely
    // (Worktrack Revisions item 4).
    renderForm()
    for (const id of [
      'company',
      'role',
      'salary_min',
      'salary_max',
      'salary_currency',
      'status',
      'location',
      'work_mode',
      'source',
      'url',
      'tags',
      'tech_stack',
      'resume_id',
    ]) {
      expect(glyphFor(id), `${id} has no glyph`).toBeTruthy()
    }
  })

  it('lets the heading carry it where the column already names the field', () => {
    // Saying it twice, three lines apart. `date_applied` draws the browser's
    // own calendar (see below) and `description` sits under a heading that
    // already carries the document glyph.
    renderForm()
    for (const id of ['date_applied', 'description']) {
      expect(glyphFor(id), `${id} repeats its section's glyph`).toBeNull()
    }
  })

  it('never puts a second calendar in the date field', () => {
    /*
      THE DEFECT THIS GUARDS IS UNCHANGED, but what causes it is. A
      `type="date"` input drew the BROWSER's calendar button inside the box, so
      a leading glyph made two of them; the rule was "no icon on that field".

      Since 2026-09-21 the field is this app's own `DatePicker`, whose trigger
      carries exactly one calendar glyph and is not a native date input at all.
      So the rule is now the honest form of the same thing: one calendar, and
      it is ours.
    */
    renderForm()
    const date = document.getElementById('date_applied')!
    expect(date.getAttribute('type')).not.toBe('date')
    expect(date.getAttribute('data-date-picker-trigger')).not.toBeNull()
    expect(date.querySelectorAll('svg').length).toBe(1)
  })

  it('gives the submit control a glyph too', () => {
    renderForm()
    const submit = screen.getByRole('button', { name: /save application/i })
    expect(submit.querySelector('svg')).toBeTruthy()
  })

  it('drops the submit glyph while saving, so the spinner stands alone', () => {
    // Button renders its spinner in the same leading slot. Two marks where the
    // control has one thing to say.
    render(
      <ApplicationRecordView
        job={null}
        defaultCurrency="PHP"
        saving
        onSubmit={vi.fn()}
        layout="review"
      />
    )
    const busy = screen.getByRole('button', { name: /saving/i })
    expect(busy.querySelectorAll('svg').length).toBe(0)
    expect(busy.querySelector('[role="status"], .animate-spin, [data-spinner]')).toBeTruthy()
  })
})

describe('the applications table header', () => {
  it('is the table that opts into a pinned header, because it is the long one', () => {
    // /applications paginates at ten rows and carries 439px of chrome above
    // it; the dashboard's "recent applications" shows five and does not. The
    // opt-in is what keeps a summary panel from growing a scrollport it has
    // no use for -- see ui/table.tsx for the arithmetic behind the cap.
    const { container } = render(<ApplicationsTable jobs={JOBS} />)
    const box = container.querySelector('[data-slot="table-container"]')!
    expect(box.hasAttribute('data-sticky-header')).toBe(true)
    expect(box.className).toContain('sm:overflow-y-auto')
  })

  it('lets every link of the chain shrink, and none of them grow', () => {
    // TWO FAILURE MODES, ONE ASSERTION EACH, and both have actually happened.
    //
    // Missing `min-h-0`: a flex item's automatic minimum size is its content
    // height, so one omission anywhere between AppShell and the scroll
    // container silently restores page scrolling -- the table keeps its full
    // height and the frame scrolls away with it.
    //
    // Present `flex-1`: that is `flex: 1 1 0%`, which forces GROWTH. The chain
    // shipped with it on 2026-09-06 and a filtered list of one row stretched
    // the card to the full height of the locked frame, leaving the empty panel
    // Gabe reported on a large desktop.
    //
    // Each link is asserted rather than the end result, because the end result
    // is invisible to jsdom.
    const { container } = render(<ApplicationsTable jobs={JOBS} />)
    for (const sel of ['[data-list]', '[data-slot="table-container"]']) {
      const el = container.querySelector(sel)!
      expect(el.className, `${sel} cannot give the space back`).toContain('sm:min-h-0')
      expect(el.className, `${sel} would stretch to fill the frame`).not.toContain('flex-1')
    }
  })
})

describe('the status filter', () => {
  const COUNTS = Object.fromEntries(STATUS_TABS.map((t) => [t, 0])) as Record<
    (typeof STATUS_TABS)[number],
    number
  >

  it('offers a dropdown on a phone and tabs from sm, over one value', () => {
    // Gabe, 2026-09-06. Six tabs do not fit 320-375px, so the strip became a
    // horizontal scroller with three destinations off-screen and no affordance
    // saying so -- a filter you cannot see is a filter you do not use.
    //
    // Both render; CSS shows one. They are form controls over the SAME value
    // and callback, so the hidden one is inert, and `display:none` takes it
    // out of the accessibility tree so nothing is announced twice.
    const { container } = render(
      <StatusTabs value="all" onChange={() => {}} counts={{ ...COUNTS, all: 27 }} />
    )
    const dropdown = container.querySelector('[role="combobox"]')!
    expect(dropdown).not.toBeNull()
    expect(dropdown.getAttribute('aria-label')).toBe('Filter applications by status')
    // The count travels with the label: "is there anything in interviewing" is
    // the question, and bare labels make you pick one to find out.
    expect(dropdown.textContent).toContain('27')

    expect(container.querySelector('.sm\\:hidden')).not.toBeNull()
    expect(container.querySelector('[data-slot="tabs"]')!.className).toContain('max-sm:hidden')
  })

  it('does not let the tab strip scroll vertically', () => {
    // `overflow-x-auto` alone is not enough: per the CSS overflow spec a
    // `visible` value coerces to `auto` the moment the other axis scrolls, so
    // the strip was a scrollport on BOTH axes and drew a vertical scrollbar in
    // a 32px row with nothing to scroll to. Same coercion the table container
    // hit earlier the same day.
    const { container } = render(
      <StatusTabs value="all" onChange={() => {}} counts={COUNTS} />
    )
    const list = container.querySelector('[data-slot="tabs-list"]')!
    expect(list.className).toContain('overflow-x-auto')
    expect(list.className).toContain('overflow-y-hidden')
  })

  it('sizes the strip to its content, so clipping has nothing to clip', () => {
    // THE REGRESSION THIS EXISTS FOR. `overflow-y-hidden` on its own hid the
    // active tab's orange rule from tablet up: the list was a fixed 32px, its
    // triggers are 32px, and a horizontal scrollbar plus rounding pushed
    // content 1-5px past the padding box -- exactly the bottom edge that rule
    // sits on. Reported by Gabe within minutes of the fix that caused it.
    //
    // The height must carry the SAME variant as the rule it overrides.
    // `group-data-[orientation=horizontal]/tabs:h-8` is a variant class, so a
    // plain `h-auto` loses to it and is inert -- which is what the first
    // attempt shipped until the measurement showed the list still 32px.
    //
    // Verified in the browser afterwards: zero vertical overflow at 640, 768,
    // 1024, 1440 and 1600, and the rule painted orange at each.
    const { container } = render(
      <StatusTabs value="all" onChange={() => {}} counts={COUNTS} />
    )
    const list = container.querySelector('[data-slot="tabs-list"]')!
    expect(list.className).toContain('group-data-[orientation=horizontal]/tabs:h-auto')
  })
})

describe('the open record follows the list', () => {
  /**
   * THE BUG, 2026-09-06: "saved the application, new data is not rendering
   * immediately."
   *
   * The dialog held the whole `Job` in state, so it was a snapshot taken when
   * it opened. Saving invalidated the query, fresh rows arrived through the
   * `jobs` prop a moment later, and the dialog carried on showing the copy it
   * had. The save had worked; the view had not moved.
   *
   * Nothing in 1653 tests caught it, because every one of them rendered the
   * dialog once against a list that never changed underneath it. These
   * exercise the thing that actually happens: the list updates while a record
   * is open.
   */
  const openFirst = async (jobs: Job[]) => {
    const view = render(<ApplicationsPage jobs={jobs} />)
    // The row's `view` button: the company cell is plain text since 2026-09-13.
    await userEvent.click(screen.getByRole('button', { name: /^View .* at Initech$/ }))
    return view
  }

  it('shows values that arrive after the record was opened', async () => {
    const before = [makeJob({ id: '1', status: 'applied', company: 'Initech', location: null })]
    const { rerender } = await openFirst(before)
    expect(await screen.findByRole('dialog')).toBeTruthy()

    // What a refetch after a save looks like from this component's side.
    const after = [makeJob({ id: '1', status: 'applied', company: 'Initech', location: 'Pasig City' })]
    rerender(<ApplicationsPage jobs={after} />)

    // A VALUE IN A FIELD now, not text in a grid: the record shows and edits
    // one surface, so "the view moved" means the input moved.
    await waitFor(() => expect(screen.getByLabelText('location')).toHaveValue('Pasig City'))
  })

  it('follows a company rename without being told', async () => {
    const { rerender } = await openFirst([makeJob({ id: '1', status: 'applied', company: 'Initech' })])
    expect(await screen.findByRole('dialog')).toBeTruthy()

    rerender(<ApplicationsPage jobs={[makeJob({ id: '1', status: 'applied', company: 'Initrode' })]} />)
    // IN THE FIELD, which is the only place the company appears in the record
    // now -- the header that used to repeat it was removed on 2026-09-10.
    await waitFor(() => {
      expect(within(screen.getByRole('dialog')).getByLabelText(/^company/)).toHaveValue('Initrode')
    })
  })

  it('closes when the open row disappears from the list', async () => {
    // Already true before the change, and worth keeping: deriving the row
    // means a deleted one renders as nothing rather than as a stale record
    // with a live edit button.
    const { rerender } = await openFirst([makeJob({ id: '1', status: 'applied', company: 'Initech' })])
    expect(await screen.findByRole('dialog')).toBeTruthy()

    rerender(<ApplicationsPage jobs={[]} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('the insights band above the toolbar', () => {
  it('sits above the search and import row, not below it', () => {
    // Gabe, 2026-09-10: "before the row of search, filter dropdowns, and
    // import CTAs".
    const { container } = render(<ApplicationsPage jobs={JOBS} />)
    const band = container.querySelector('[data-applications-insights]')!
    const search = screen.getByPlaceholderText(/search company or role/i)
    expect(band).toBeTruthy()
    expect(band.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('pairs one chart with four statistics cards', async () => {
    // AWAITED, because the chart is `next/dynamic` now (2026-09-11). Without
    // the wait this passed only when some earlier test in the file had already
    // warmed the import -- it failed the moment it ran first, which is the
    // definition of an order-dependent test rather than a passing one.
    const { container } = render(<ApplicationsPage jobs={JOBS} />)
    const band = container.querySelector('[data-applications-insights]')!
    expect(band.querySelectorAll('[data-stat-card]')).toHaveLength(4)
    await waitFor(() =>
      expect(band.querySelector('[data-chart-sources-bars], [data-sources-empty]')).toBeTruthy()
    )
  })

  it('stays away entirely on an empty account', () => {
    // A chart of nothing over four zeros, between the page title and "add your
    // first application", would be pointing at itself instead of at the button.
    const { container } = render(<ApplicationsPage jobs={[]} />)
    expect(container.querySelector('[data-applications-insights]')).toBeNull()
    expect(screen.getByText(/no applications yet/i)).toBeTruthy()
  })
})

describe('a posting handed over from the calendar feed', () => {
  it('opens the add wizard with the link already in it', async () => {
    // `track it` on the calendar's feed is a deep link, not a write: nothing
    // from a third-party feed reaches the database until the app has read the
    // employer's own page.
    render(<ApplicationsPage jobs={JOBS} initialAddUrl="https://jobicy.com/jobs/1" />)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/posting url|link/i)).toHaveValue(
      'https://jobicy.com/jobs/1'
    )
  })

  it('stops at the first step rather than spending a scrape on a link nobody confirmed', async () => {
    render(<ApplicationsPage jobs={JOBS} initialAddUrl="https://jobicy.com/jobs/1" />)
    const dialog = await screen.findByRole('dialog')
    // Still on `link`: the continue control is there, the save is not.
    expect(within(dialog).getByRole('button', { name: /continue/i })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /save application/i })).toBeNull()
  })

  it('opens nothing without the parameter', () => {
    render(<ApplicationsPage jobs={JOBS} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
