import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ResumeSummary } from '@/services/resumeService'
import { EMPTY_PROFILE } from '@/services/profile'

/**
 * The Documents route wrapper. `DocumentsPage` itself is covered over plain
 * props in `src/components/documents/__tests__`; this covers the three states
 * the wrapper owns and the wiring between them, which is where the last
 * whole-branch review found handlers that were never exercised.
 */
const useResumesMock = vi.hoisted(() => vi.fn())
const useResumeVersionsMock = vi.hoisted(() => vi.fn())
const deleteMutate = vi.hoisted(() => vi.fn())
const createMutate = vi.hoisted(() => vi.fn())
const routerPush = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useResumes', () => ({
  useResumes: useResumesMock,
  useResumeVersions: useResumeVersionsMock,
  useDeleteResume: () => ({ mutateAsync: deleteMutate, isPending: false }),
  useCreateResume: () => ({ mutateAsync: createMutate, isPending: false }),
}))

// `useCreateDocument` reads the stored LinkedIn profile so a template is
// already personalised when it is written. The real hook reaches `@/lib/
// supabase`, which throws at module load without env, so it is stubbed the way
// the settings route's own test stubs it.
const useUserProfileMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: useUserProfileMock }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

import Page from '../page'

function makeDoc(overrides: Partial<ResumeSummary> = {}): ResumeSummary {
  return {
    id: 'cv-1',
    title: 'Backend CV',
    mode: 'word',
    updated_at: '2026-08-20T10:00:00.000Z',
    sections: null,
    version: 2,
    hasVersions: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useResumeVersionsMock.mockReturnValue({ data: [], isLoading: false, error: null })
  useUserProfileMock.mockReturnValue({ data: { profile: null, fetchedAt: null } })
  deleteMutate.mockResolvedValue(undefined)
  createMutate.mockResolvedValue({ id: 'cv-new' })
})

afterEach(() => cleanup())

describe('Documents route wrapper', () => {
  it('shows a route skeleton while the CVs are loading', async () => {
    useResumesMock.mockReturnValue({ data: undefined, isLoading: true, error: null })
    render(<Page />)
    // `findBy`, not `queryBy`: the route skeleton sits behind a 200ms gate
    // (see ui/loading-skeletons) so a warm navigation never flashes a fake
    // page for one frame. Nothing is in the DOM at t=0 BY DESIGN, and an
    // immediate assertion was testing the absence of that gate.
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('says the read failed rather than falling through to the no-CVs state', () => {
    useResumesMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('offline') })
    render(<Page />)
    expect(screen.getByText(/could not load your cvs/i)).toBeTruthy()
    expect(screen.queryByText(/no cvs yet/i)).toBeNull()
  })

  it('renders the list once the read resolves', () => {
    useResumesMock.mockReturnValue({ data: [makeDoc()], isLoading: false, error: null })
    render(<Page />)
    expect(screen.getByRole('link', { name: 'Backend CV' })).toBeTruthy()
  })

  // Item 2's second half, and the same defect class as window.confirm
  // everywhere else: a native confirm is unstyled, unthemeable and
  // untestable without stubbing a global.
  it('confirms before deleting, and does not delete when Cancel is chosen', async () => {
    useResumesMock.mockReturnValue({ data: [makeDoc()], isLoading: false, error: null })
    const user = userEvent.setup()
    render(<Page />)
    await user.click(screen.getByRole('button', { name: /delete backend cv/i }))
    expect(screen.getByRole('alertdialog', { name: /delete backend cv/i })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'cancel' }))
    expect(deleteMutate).not.toHaveBeenCalled()
  })

  it('deletes the CV the row names once the confirm is accepted', async () => {
    useResumesMock.mockReturnValue({ data: [makeDoc()], isLoading: false, error: null })
    const user = userEvent.setup()
    render(<Page />)
    await user.click(screen.getByRole('button', { name: /delete backend cv/i }))
    await user.click(screen.getByRole('button', { name: 'delete' }))
    expect(deleteMutate).toHaveBeenCalledWith('cv-1')
  })

  it('only asks for a CV version history once its row has been expanded', () => {
    // One query per row on load would be a version history nobody opened for
    // every CV in the list.
    useResumesMock.mockReturnValue({ data: [makeDoc()], isLoading: false, error: null })
    render(<Page />)
    expect(useResumeVersionsMock).toHaveBeenLastCalledWith(null)

    fireEvent.click(screen.getByRole('button', { name: /version history for/i }))
    expect(useResumeVersionsMock).toHaveBeenLastCalledWith('cv-1')
  })

  it('stops asking for versions once the dialog is dismissed', async () => {
    // Was "collapses when the same row is toggled again", back when the
    // history was an inline disclosure you clicked twice. It is a dialog now
    // (M5.5 Item 4), so the trigger is behind an overlay while it is open and
    // Escape is the real dismissal path. What matters either way is that
    // closing releases the query, rather than leaving it subscribed to a row
    // nobody is looking at.
    const user = userEvent.setup()
    useResumesMock.mockReturnValue({ data: [makeDoc()], isLoading: false, error: null })
    render(<Page />)

    await user.click(screen.getByRole('button', { name: /version history for/i }))
    expect(useResumeVersionsMock).toHaveBeenLastCalledWith('cv-1')

    await user.keyboard('{Escape}')
    expect(useResumeVersionsMock).toHaveBeenLastCalledWith(null)
  })

  it('says the version read failed rather than claiming the CV has no versions', () => {
    useResumesMock.mockReturnValue({ data: [makeDoc()], isLoading: false, error: null })
    useResumeVersionsMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('x') })
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: /version history for/i }))
    expect(screen.getByText(/could not load the saved versions/i)).toBeTruthy()
    expect(screen.queryByText(/no versions saved yet/i)).toBeNull()
  })

  it('creates the KIND of document the chooser was answered with', async () => {
    // The header button no longer creates anything by itself; it asks first.
    // This is the wiring from that answer to the row that gets written.
    useResumesMock.mockReturnValue({ data: [makeDoc()], isLoading: false, error: null })
    const user = userEvent.setup()
    render(<Page />)

    await user.click(screen.getByRole('button', { name: /new document/i }))
    await user.click(screen.getByRole('button', { name: /cover letter/i }))

    expect(createMutate).toHaveBeenCalledTimes(1)
    expect(createMutate.mock.calls[0][0]).toMatchObject({
      mode: 'cover_letter',
      title: 'Untitled cover letter',
    })
    expect(routerPush).toHaveBeenCalledWith('/cv?draft=cv-new')
  })

  it('writes the user’s own details into a template instead of the specimen text', async () => {
    // THE FEATURE, and the bug it is guarding: a template written straight to
    // the database ships literal `{{name|Your Name}}` to a person, and a
    // template that still says "Your Name" after this is the same failure
    // wearing better punctuation.
    useResumesMock.mockReturnValue({ data: [], isLoading: false, error: null })
    useUserProfileMock.mockReturnValue({
      data: {
        profile: { ...EMPTY_PROFILE, name: 'Gabe Cervantes', headline: 'Software Engineer' },
        fetchedAt: null,
      },
    })
    const user = userEvent.setup()
    const { container } = render(<Page />)

    await user.click(container.querySelector('[data-template-card="cover-standard"]')!)

    const written = JSON.stringify(createMutate.mock.calls[0][0].content)
    expect(written).toContain('Gabe Cervantes')
    // No token survives: an unknown one is deleted rather than left visible.
    expect(written).not.toContain('{{')
  })

  it('writes the user’s own details into a document started FROM SCRATCH too', async () => {
    /*
      THE HALF THAT WAS MISSED (Gabe, 2026-09-17: "creating new CV and cover
      letter from scratch, required credentials fetched from LinkedIn is
      missing"). Picking a template personalised; starting from scratch wrote
      a starter that said the literal words "Your name" and "[email]", so
      somebody who had connected a profile still had to type it all in. Both
      starters carry tokens now, and both go through the same call.
    */
    useResumesMock.mockReturnValue({ data: [], isLoading: false, error: null })
    useUserProfileMock.mockReturnValue({
      data: {
        profile: { ...EMPTY_PROFILE, name: 'Gabe Cervantes', email: 'gabe@example.com' },
        fetchedAt: null,
      },
    })
    const user = userEvent.setup()
    render(<Page />)

    await user.click(screen.getByRole('button', { name: /new document/i }))
    await user.click(screen.getByRole('button', { name: /curriculum vitae/i }))

    const written = JSON.stringify(createMutate.mock.calls[0][0].content)
    expect(written).toContain('Gabe Cervantes')
    expect(written).toContain('gabe@example.com')
    expect(written).not.toContain('{{')
    expect(written).not.toContain('Your name')
  })

  it('gives a blank cover letter the same sender block', async () => {
    // A letter's body stays empty on purpose -- the templates are one click
    // away -- but who it is from is not scaffolding, it is the profile.
    useResumesMock.mockReturnValue({ data: [], isLoading: false, error: null })
    useUserProfileMock.mockReturnValue({
      data: {
        profile: { ...EMPTY_PROFILE, name: 'Gabe Cervantes', email: 'gabe@example.com' },
        fetchedAt: null,
      },
    })
    const user = userEvent.setup()
    render(<Page />)

    await user.click(screen.getByRole('button', { name: /new document/i }))
    await user.click(screen.getByRole('button', { name: /cover letter/i }))

    expect(createMutate.mock.calls[0][0]).toMatchObject({ mode: 'cover_letter' })
    const written = JSON.stringify(createMutate.mock.calls[0][0].content)
    expect(written).toContain('Gabe Cervantes')
    expect(written).not.toContain('{{')
  })

  it('falls back to the template’s own wording when no profile is connected', async () => {
    // `personalizeTemplate` is called unconditionally BECAUSE every token
    // carries its own readable default -- skipping the call to "save" it is
    // what would ship the raw markers.
    useResumesMock.mockReturnValue({ data: [], isLoading: false, error: null })
    const user = userEvent.setup()
    const { container } = render(<Page />)

    await user.click(container.querySelector('[data-template-card="word-classic"]')!)

    const written = JSON.stringify(createMutate.mock.calls[0][0].content)
    expect(written).not.toContain('{{')
  })
})
