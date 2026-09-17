import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeJob } from '@/test/fixtures'
import { selectedLabel } from '@/test/select'

// Every read and write on this route goes through the useJobs hooks so they
// all land on the same ['jobs', user?.id] cache entry the dashboard reads.
// Mocking the module drives the wrapper's three states without standing up
// AuthProvider or QueryClientProvider.
const useJobsMock = vi.hoisted(() => vi.fn())
const useCreateJobMock = vi.hoisted(() => vi.fn())
const useUpdateJobMock = vi.hoisted(() => vi.fn())
const useCreateJobsBulkMock = vi.hoisted(() => vi.fn())
const useUserPreferencesMock = vi.hoisted(() => vi.fn())
const deleteJobMutate = vi.hoisted(() => vi.fn())
const idleMutation = vi.hoisted(() => () => ({ mutateAsync: vi.fn(), isPending: false }))

vi.mock('@/hooks/useJobs', () => ({
  useJobs: useJobsMock,
  useCreateJob: useCreateJobMock,
  useCreateJobsBulk: useCreateJobsBulkMock,
  useUpdateJob: useUpdateJobMock,
  useDeleteJob: () => ({ mutateAsync: deleteJobMutate, isPending: false }),
  useUpdateJobStatus: idleMutation,
  useAutofillJobFromUrl: idleMutation,
  // `useApplicationRecord` reads the status history for the record's pipeline
  // bar -- the one question the `jobs` row cannot answer, which is whether a
  // rejected application ever reached interviewing.
  useJobStatusHistory: () => ({ data: [], isLoading: false, error: null }),
}))

// The currency seam this route used to leave open: resolveDefaultCurrency
// was always called with a hardcoded null, so a stored preference could
// never reach the form. Mocking the read half of that seam lets the tests
// below prove a stored preference actually gets there now.
vi.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: useUserPreferencesMock,
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

// The record dialog's four secondary reads, which this route now owns for
// whichever row is open. They are stubbed rather than exercised here -- the
// record's own behaviour is covered in detail.test.tsx -- but they have to be
// stubbed, or importing them drags in the real Supabase client.
vi.mock('@/hooks/useActivity', () => ({ useActivity: () => ({ data: [], isLoading: false }) }))
// The route now also writes CV links -- the "cv used" field on the form
// pins a row in `application_documents` after the application itself saves.
vi.mock('@/hooks/useDocumentLinks', () => ({
  useDocumentLinks: () => ({ data: [], isLoading: false }),
  useResumeLinks: () => ({ data: [], isLoading: false }),
  usePinDocumentLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnpinDocumentLink: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
// The form's "cv used" field offers the user's CVs.
vi.mock('@/hooks/useResumes', () => ({ useResumes: () => ({ data: [], isLoading: false }) }))
// Tidy-and-summarise runs through its own mutation, which needs a
// QueryClient this suite deliberately does not stand up.
vi.mock('@/hooks/usePostingDigest', () => ({
  usePostingDigest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useJobEvents', () => ({
  useJobEvents: () => ({ data: [], isLoading: false }),
  // The record's interview date writes through this one. Mocked rather than
  // exercised here: the route only forwards to it, and the interview field's
  // own behaviour is covered in components/applications/__tests__.
  useScheduleInterview: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useCvText', () => ({ useCvText: () => ({ data: undefined }) }))

// `?application=<id>` is how a desktop deep link off /applications/<id>
// arrives. Returning no param is the ordinary case; one test overrides it.
// KEY-AWARE, because this route now reads TWO parameters. `?application=<id>`
// opens an existing record; `?add=<url>` opens the add wizard on a posting the
// calendar's job feed handed over. A mock that answered the same value to both
// opened both dialogs at once.
const searchParamMock = vi.hoisted(() => vi.fn((_key: string) => null as string | null))
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: searchParamMock }),
}))

import Page from '../page'

/**
 * Adding an application is FOUR STEPS now, not a form (Worktrack Revisions
 * item 5): a link, a status, the model reading the posting, then the review
 * where it is corrected and saved. Every test that used to click `add` and
 * type into a field has to walk that path first.
 *
 * `useAutofillJobFromUrl` is the idle mutation stub above, so the read step
 * has nothing useful to call and falls through to the review with the fields
 * empty -- which is the branch these tests want, since what they are about is
 * what the ROUTE does with the save.
 */
async function addUpToReview(user: ReturnType<typeof userEvent.setup>) {
  /*
    WHICHEVER "add" THE SCREEN IS ACTUALLY OFFERING. These tests run against an
    empty board, and since 2026-09-15 the header's `add` is suppressed there --
    two primary buttons pointing at one action is the screen arguing with
    itself, so the empty state's CTA is the only one. A fixed
    `{ name: 'add' }` broke on all three, which is the right kind of break:
    the affordance moved and the test was naming the old one.

    Matching either keeps this helper honest for a populated board too, where
    the header button IS the way in and the empty state is not rendered.
  */
  await user.click(
    screen.getByRole('button', { name: /^(add|add your first application)$/ })
  )
  // A LINK IS REQUIRED FROM THE FIRST STEP (Gabe, 2026-09-11): `continue` is
  // disabled until there is one, because every step after it is built from
  // that page. These tests are about the save, but they still have to get
  // past the door like anybody else.
  await user.type(screen.getByLabelText(/job posting url/i), 'https://careers.example.com/j/1')
  await user.click(screen.getByRole('button', { name: /continue/i }))
  await user.click(screen.getByRole('button', { name: /fill it in/i }))
  return screen.findByRole('button', { name: /save application/i })
}

beforeEach(() => {
  useCreateJobMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  useUpdateJobMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  useCreateJobsBulkMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  useUserPreferencesMock.mockReturnValue({ data: null, isLoading: false, error: null })
  deleteJobMutate.mockReset().mockResolvedValue(undefined)
  searchParamMock.mockImplementation(() => null)
})

afterEach(() => cleanup())

describe('Applications route wrapper', () => {
  it('shows a route skeleton while jobs are loading, not an empty board', async () => {
    useJobsMock.mockReturnValue({ data: undefined, isLoading: true, error: null })
    render(<Page />)
    // `findBy`, not `queryBy`: the route skeleton sits behind a 200ms gate
    // (see ui/loading-skeletons) so a warm navigation never flashes a fake
    // page for one frame. Nothing is in the DOM at t=0 BY DESIGN, and an
    // immediate assertion was testing the absence of that gate.
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'applications' })).toBeNull()
  })

  it('surfaces a fetch error instead of the empty-account copy', () => {
    // "No applications yet" is a claim about the account. A failed read has
    // no basis for making it.
    useJobsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('network down'),
    })
    render(<Page />)
    expect(screen.getByText(/network down/)).toBeTruthy()
    expect(screen.queryByText(/no applications yet/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy()
  })

  it('renders the screen from the shared jobs cache once loaded', () => {
    useJobsMock.mockReturnValue({ data: [], isLoading: false, error: null })
    render(<Page />)
    expect(screen.getByRole('heading', { name: 'applications' })).toBeTruthy()
    expect(useJobsMock).toHaveBeenCalled()
  })

  // The original bug lived exactly here: handleCreate/handleUpdate/handleImport
  // caught the mutation's rejection, showed a toast, and then fell off the end
  // of the function returning undefined -- which is truthy enough that
  // ApplicationsPage's `ok !== false` gate closed the panel anyway. Driving the
  // rejection through the real mutateAsync from here, rather than stubbing
  // ApplicationsPage's onCreate/onUpdate/onImport props directly, is what
  // proves the handler itself produces the falsy value the gate depends on --
  // not just that the gate honours a false someone hands it.
  it('resolves handleCreate to false and keeps the form open when the mutation rejects', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('permission denied'))
    useCreateJobMock.mockReturnValue({ mutateAsync, isPending: false })
    useJobsMock.mockReturnValue({ data: [], isLoading: false, error: null })
    const user = userEvent.setup()
    render(<Page />)

    const save = await addUpToReview(user)
    fireEvent.change(screen.getByLabelText(/^company/), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText(/^position/), { target: { value: 'Engineer' } })
    fireEvent.click(save)

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('heading', { name: /new application/i })).toBeTruthy()
    expect(screen.getByLabelText(/^company/)).toHaveValue('Acme')
  })

  it('resolves handleUpdate to false and keeps the edit form open when the mutation rejects', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('permission denied'))
    useUpdateJobMock.mockReturnValue({ mutateAsync, isPending: false })
    const job = makeJob({ id: '1', status: 'applied', company: 'Initech' })
    useJobsMock.mockReturnValue({ data: [job], isLoading: false, error: null })
    const user = userEvent.setup()
    render(<Page />)

    // OPENED FROM THE ROW'S `view` BUTTON. The table's `edit` button is gone
    // (the record shows and edits one surface), and since 2026-09-13 the
    // company cell is plain text rather than a link -- so the actions column
    // is the only way in.
    await user.click(screen.getByRole('button', { name: /^View / }))
    // SOMETHING HAS TO CHANGE FIRST. Save is disabled on an untouched record
    // (Gabe, 2026-09-10) -- there is nothing to write, and a live button over
    // a no-op invites the click that teaches you it was one.
    fireEvent.change(await screen.findByLabelText(/^company/), {
      target: { value: 'Initech Two' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save application/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    // Still open, with the values intact. The dialog's heading is the role
    // alone -- company and status moved into the header's own slots beside it
    // -- so the check that it stayed open is the presence of a field carrying
    // the value, which is the thing a rejected save must not throw away.
    expect(screen.getByLabelText(/^company/)).toHaveValue('Initech Two')
    expect(screen.getByRole('button', { name: /save application/i })).toBeTruthy()
  })

  it('stays on the record, not back to the list, once an edit saves', async () => {
    // The dialog is the whole record. Closing it after a save would throw away
    // the context the edit was made in, and the saved values are exactly what
    // the person who just typed them wants to check.
    //
    // WHAT THIS USED TO ASSERT was that Save DISAPPEARED -- the dialog fell
    // back from an edit mode to a read-only one. There are no modes now, so
    // Save stays where it is and what proves the save landed is that the
    // record no longer considers itself dirty (see the discard tests in
    // components/applications/__tests__/applications.test.tsx).
    const mutateAsync = vi.fn().mockResolvedValue(undefined)
    useUpdateJobMock.mockReturnValue({ mutateAsync, isPending: false })
    const job = makeJob({ id: '1', status: 'applied', company: 'Initech', role: 'QA Lead' })
    useJobsMock.mockReturnValue({ data: [job], isLoading: false, error: null })
    const user = userEvent.setup()
    render(<Page />)

    await user.click(screen.getByRole('button', { name: /^View / }))
    fireEvent.change(await screen.findByLabelText(/^company/), {
      target: { value: 'Initech Two' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save application/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    // Still open, still on the record it just saved. Its heading names the
    // SCREEN now -- company and position are editable fields inside it -- so
    // what proves the right row is open is the field, not the title.
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'application overview' })).toBeTruthy()
    expect(screen.getByLabelText(/^position/)).toHaveValue('QA Lead')
  })

  it('opens the named record on mount when a deep link redirected here', async () => {
    // `/applications/<id>` is a redirect at every width now -- the record is a
    // bottom sheet on this screen rather than a route of its own -- and it
    // arrives as `?application=<id>`. This is the half that makes the intent
    // survive the redirect.
    searchParamMock.mockImplementation((key: string) => (key === 'application' ? '1' : null))
    const job = makeJob({ id: '1', status: 'applied', company: 'Initech', role: 'QA Lead' })
    useJobsMock.mockReturnValue({ data: [job], isLoading: false, error: null })
    render(<Page />)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByLabelText(/^position/)).toHaveValue('QA Lead')
  })

  it('resolves handleImport to false and keeps the parsed CSV summary when the bulk mutation rejects', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('permission denied'))
    useCreateJobsBulkMock.mockReturnValue({ mutateAsync, isPending: false })
    useJobsMock.mockReturnValue({ data: [], isLoading: false, error: null })
    render(<Page />)

    const file = {
      name: 'jobs.csv',
      text: () => Promise.resolve('company,role\nAcme,Engineer'),
    } as unknown as File
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByText(/jobs\.csv/i)
    fireEvent.click(screen.getByRole('button', { name: /^import 1$/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(screen.getByText(/jobs\.csv/i)).toBeTruthy()
  })

  // Task 9's whole point: this route used to call
  // resolveDefaultCurrency(null) unconditionally, so a stored preference
  // could never reach the form -- a user could set USD in Settings and every
  // new application still opened at PHP. These two tests prove the read half
  // of that seam is actually wired, not just that resolveDefaultCurrency
  // itself works in isolation.
  it('defaults a new application to PHP when the user has no stored preference', async () => {
    useUserPreferencesMock.mockReturnValue({ data: null, isLoading: false, error: null })
    useJobsMock.mockReturnValue({ data: [], isLoading: false, error: null })
    const user = userEvent.setup()
    render(<Page />)

    await addUpToReview(user)
    // The control is a button now, not a <select>, so it has no `value` --
    // what it SHOWS is the assertion, which is what a user checks anyway.
    expect(selectedLabel(screen.getByLabelText(/^currency/))).toBe('PHP')
  })

  it('defaults a new application to the stored preference instead of PHP', async () => {
    useUserPreferencesMock.mockReturnValue({
      data: { user_id: 'user-1', default_currency: 'USD', created_at: 'x', updated_at: 'x' },
      isLoading: false,
      error: null,
    })
    useJobsMock.mockReturnValue({ data: [], isLoading: false, error: null })
    const user = userEvent.setup()
    render(<Page />)

    await addUpToReview(user)
    expect(selectedLabel(screen.getByLabelText(/^currency/))).toBe('USD')
  })

  // Item 2's second half: window.confirm is the same defect class as the
  // dialog Gabe asked back for, and it guarded a destructive action, so the
  // replacement has to keep that guard rather than just re-skin it.
  it('asks before deleting, naming the application, and does not delete on Cancel', async () => {
    const job = makeJob({ id: '1', status: 'applied', company: 'Initech', role: 'Engineer' })
    useJobsMock.mockReturnValue({ data: [job], isLoading: false, error: null })
    const user = userEvent.setup()
    render(<Page />)

    await user.click(screen.getAllByRole('button', { name: /^delete/i })[0])
    expect(
      screen.getByRole('alertdialog', { name: 'Delete Engineer at Initech?' })
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'cancel' }))
    expect(deleteJobMutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('deletes the named application once the confirm is accepted', async () => {
    const job = makeJob({ id: '1', status: 'applied', company: 'Initech', role: 'Engineer' })
    useJobsMock.mockReturnValue({ data: [job], isLoading: false, error: null })
    const user = userEvent.setup()
    render(<Page />)

    await user.click(screen.getAllByRole('button', { name: /^delete/i })[0])
    await user.click(screen.getByRole('button', { name: 'delete' }))
    await waitFor(() => expect(deleteJobMutate).toHaveBeenCalledWith('1'))
  })
})
