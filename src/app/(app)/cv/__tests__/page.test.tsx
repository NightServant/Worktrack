import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ResumeDraft } from '@/services/resumeService'

/**
 * The CV editor route.
 *
 * These tests exist because M5 Task 7 split a live 670-line editor out of
 * `src/screens/ResumePage.tsx` and then deleted that file. A green build does
 * not prove an editor still works, so this covers the three things the split
 * could plausibly have broken: that each editor still mounts for its own mode,
 * that autosave still reaches the database, and that the snapshot timer still
 * fires. The route is driven through mocked hooks rather than react-query and
 * AuthProvider, matching `applications/[id]`'s wrapper test.
 */
const useSearchParamsMock = vi.hoisted(() => vi.fn())
const routerReplace = vi.hoisted(() => vi.fn())
const useResumeMock = vi.hoisted(() => vi.fn())
const createMutate = vi.hoisted(() => vi.fn())
const updateMutate = vi.hoisted(() => vi.fn())
const deleteMutate = vi.hoisted(() => vi.fn())
const createSnapshotMock = vi.hoisted(() => vi.fn())
const maybeCreateSnapshotMock = vi.hoisted(() => vi.fn())
const getSnapshotsMock = vi.hoisted(() => vi.fn())
const getSnapshotMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock,
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  // AppShell reads the path to mark the active nav item. Only the
  // hides-the-nav test renders the real shell, but the mock is module-wide.
  usePathname: () => '/cv',
}))

// The tailoring rail's application picker. Stubbed empty: the rail's own
// behaviour is covered in CvTailoring's tests, and importing the real hook
// here would drag a QueryClient into every route-state test.
const jobsMock = vi.hoisted(() =>
  vi.fn<() => { data: unknown[]; isLoading: boolean; error: unknown }>(() => ({
    data: [],
    isLoading: false,
    error: null,
  }))
)
vi.mock('@/hooks/useJobs', () => ({
  useJobs: () => jobsMock(),
}))

// The rail reaches /api/tailor through `authedFetch`, because tailoring spends
// a metered allowance and the route is authenticated.
const authedFetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/authedFetch', () => ({ authedFetch: authedFetchMock }))

// LIVE AGAIN. This mock was dead once the "sent to N applications" dropdown
// left WordResumeEditor (Gabe, Worktrack Revisions item 6). The route reads
// these links again for a different reason: they are what decides whether
// tailoring writes a new document or rewrites the open one, so `resumeLinks`
// is the input that switches between the two branches.
const resumeLinksMock = vi.hoisted(() =>
  vi.fn<() => { data: { job_id: string }[]; isLoading: boolean }>(() => ({
    data: [],
    isLoading: false,
  }))
)
const pinMutate = vi.hoisted(() => vi.fn().mockResolvedValue({}))
/**
 * The AI polish pass reads the stored profile (`usePolishDraft`), so this
 * route now has a second query hook in it. Mocked empty: these tests are about
 * the route's states, and a profile-less account is the one where no polish is
 * attempted at all.
 */
const userProfileMock = vi.hoisted(() =>
  vi.fn<() => { data: { profile: unknown; fetchedAt: string | null } }>(() => ({
    data: { profile: null, fetchedAt: null },
  }))
)
vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: () => userProfileMock(),
}))

vi.mock('@/hooks/useDocumentLinks', () => ({
  useResumeLinks: () => resumeLinksMock(),
  // Which applications already have a CV, for the tailoring picker's filter.
  // Empty here: these tests are about the route's own states.
  useLinkedJobIds: () => ({ data: [] }),
  usePinDocumentLink: () => ({ mutateAsync: pinMutate, isPending: false }),
}))
vi.mock('@/hooks/useResumes', () => ({
  useResume: useResumeMock,
  useCreateResume: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateResume: () => ({ mutateAsync: updateMutate, isPending: false }),
  useDeleteResume: () => ({ mutateAsync: deleteMutate, isPending: false }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

vi.mock('@/services/resumeSnapshotService', () => ({
  createSnapshot: createSnapshotMock,
  maybeCreateSnapshot: maybeCreateSnapshotMock,
  getSnapshots: getSnapshotsMock,
  getSnapshot: getSnapshotMock,
  deleteSnapshot: vi.fn(),
}))

// The shared client refuses to construct without real credentials, and Vitest
// redacts the ones in .env, so the two modules that reach for it directly (the
// PDF export call and its session read) get a stub instead.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'token-123' } },
      }),
    },
  },
  hasValidSupabaseConfig: false,
}))

import { AppShell } from '@/components/shell/AppShell'
import Page from '../page'
import { makeJob } from '@/test/fixtures'

/**
 * The file commands moved behind one icon on 2026-09-13 ("compress this into a
 * settings/avatar icon with dropdown"), so a test that presses one has to open
 * the menu first. Save is deliberately still outside it.
 */
async function openActions() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /document actions/i }))
  })
}

function params(value: string | null) {
  useSearchParamsMock.mockReturnValue({ get: () => value })
}

/** For the routes that read more than one search param -- `draft` and `polish`. */
function paramMap(map: Record<string, string | null>) {
  useSearchParamsMock.mockReturnValue({ get: (key: string) => map[key] ?? null })
}

function wordDraft(overrides: Partial<ResumeDraft> = {}): ResumeDraft {
  return {
    id: 'cv-1',
    title: 'Backend CV',
    mode: 'word',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shipped the rewrite' }] }],
    },
    updated_at: '2026-08-20T10:00:00.000Z',
    ...overrides,
  }
}

function resolved(draft: ResumeDraft | null) {
  useResumeMock.mockReturnValue({ data: draft, isLoading: false, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  updateMutate.mockImplementation(async ({ patch }: { patch: { title?: string } }) =>
    wordDraft({ title: patch.title ?? 'Backend CV', updated_at: '2026-08-20T11:00:00.000Z' })
  )
  createMutate.mockResolvedValue(wordDraft({ id: 'cv-new' }))
  getSnapshotsMock.mockResolvedValue([])
  global.fetch = vi.fn().mockRejectedValue(new Error('offline'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('/cv route states', () => {
  it('sends a bare /cv to the documents list, which is where the drafts hub went', () => {
    params(null)
    resolved(null)
    render(<Page />)
    expect(routerReplace).toHaveBeenCalledWith('/documents')
  })

  it('shows a route skeleton while the CV is loading', async () => {
    params('cv-1')
    useResumeMock.mockReturnValue({ data: undefined, isLoading: true, error: null })
    render(<Page />)
    // `findBy`, not `queryBy`: the route skeleton sits behind a 200ms gate
    // (see ui/loading-skeletons) so a warm navigation never flashes a fake
    // page for one frame. Nothing is in the DOM at t=0 BY DESIGN, and an
    // immediate assertion was testing the absence of that gate.
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('closes the way out while a model is writing the document', async () => {
    // Gabe, 2026-09-19: "back to documents must be disabled when the model is
    // polishing the document". The request is in flight and its result is
    // saved when it returns -- a navigation unmounts the hook, the save never
    // happens, and the reader lands back on the list with a CV that quietly
    // stayed unpolished.
    paramMap({ draft: 'cv-1', polish: 'word-classic' })
    userProfileMock.mockReturnValue({
      data: { profile: { name: 'Gabe Cervantes' }, fetchedAt: null },
    })
    resolved(wordDraft())
    render(<Page />)

    // A DISABLED BUTTON, NOT A LINK. `pointer-events-none` on an anchor stops
    // the mouse and nothing else: it stays tabbable, still follows on Enter,
    // and still announces as a link.
    const back = await screen.findByRole('button', { name: 'back to documents' })
    expect(back).toHaveProperty('disabled', true)
    expect(screen.queryByRole('link', { name: 'back to documents' })).toBeNull()
  })

  it('says the CV could not be found rather than opening an empty editor', () => {
    params('does-not-exist')
    resolved(null)
    render(<Page />)
    expect(screen.getByText(/could not find that cv/i)).toBeTruthy()
    expect(screen.queryByLabelText(/cv title/i)).toBeNull()
  })

  it('says the read failed rather than treating a failed fetch as a missing CV', () => {
    params('cv-1')
    useResumeMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('offline') })
    render(<Page />)
    expect(screen.getByText(/could not open that cv/i)).toBeTruthy()
  })
})

describe('/cv?draft=<id> opens the right editor', () => {
  it('mounts the Word editor, with the stored document in it', () => {
    params('cv-1')
    resolved(wordDraft())
    const { container } = render(<Page />)
    // THE HEADING IS THE DOCUMENT'S NAME, not its category. It used to read
    // "Word CV" while the actual name sat below it in a field labelled CV
    // TITLE -- a category where a name belongs. "word" is now one crumb of
    // the path, and the name is the h1.
    expect(screen.getByRole('heading', { name: /backend cv/i })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Word CV' })).toBeNull()
    expect(container.querySelector('.ProseMirror')).toBeTruthy()
    expect(container.textContent).toContain('Shipped the rewrite')
    expect((screen.getByLabelText(/cv title/i) as HTMLInputElement).value).toBe('Backend CV')
  })

  /**
   * THE WIRING, WHICH IS THE PART THAT WAS MISSING (Gabe, 2026-09-17: "word
   * document editor for Cover Letter still reflects the CV version").
   *
   * `coverLetterEditor.test.tsx` proves the editor behaves as a letter when it
   * is TOLD it is one, and every assertion in it passed for months while every
   * real cover letter opened as a CV -- because this route never passed
   * `kind`, and the prop's default is `'word'`. A component test cannot catch
   * that; the omission is at the call site. This is the call site.
   */
  /**
   * THE STARTER IS A TEMPLATE NOW, AND THIS IS THE PATH THAT SHOWS IT RAW.
   *
   * `DEFAULT_WORD_CONTENT` carries `{{name}}` tokens since 2026-09-17 so that
   * creating a CV from scratch fills in the LinkedIn profile. "Reset to the
   * template" is the one place that puts it straight into the editor rather
   * than through the create path, so it is the one place a literal `{{` could
   * reach a person -- which is the failure the whole personalisation milestone
   * exists to prevent. This renders the real route and presses the real
   * button.
   */
  it('resets to the starter without showing a single template token', async () => {
    params('cv-1')
    resolved(wordDraft())
    const user = userEvent.setup()
    const { container } = render(<Page />)

    await user.click(screen.getByRole('button', { name: /document actions/i }))
    await user.click(screen.getByRole('button', { name: /reset to the template/i }))

    const text = container.querySelector('.ProseMirror')?.textContent ?? ''
    expect(text).not.toContain('{{')
    expect(text).toContain('Your name')
  })

  it('opens a cover letter AS a cover letter, not as the CV editor', () => {
    params('cv-2')
    resolved(wordDraft({ id: 'cv-2', title: 'Initech letter', mode: 'cover_letter' }))
    render(<Page />)

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent?.toLowerCase() ?? '')
    expect(tabs.some((name) => name.includes('letter check'))).toBe(true)
    expect(tabs.some((name) => name.includes('tailor'))).toBe(false)
    // And the rewrite controls a letter is never scored by are absent with it.
    expect(screen.queryByRole('button', { name: /tailor this/i })).toBeNull()
  })

})

describe('the editor still saves', () => {
  it('autosaves a title edit 1200ms after the last keystroke', async () => {
    vi.useFakeTimers()
    params('cv-1')
    resolved(wordDraft())
    render(<Page />)

    fireEvent.change(screen.getByLabelText(/cv title/i), { target: { value: 'Renamed CV' } })
    expect(updateMutate).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(updateMutate).toHaveBeenCalledWith({
      id: 'cv-1',
      patch: expect.objectContaining({ title: 'Renamed CV', mode: 'word' }),
    })
  })

  it('snapshots the CV 5000ms after an edit, so version history keeps filling up', async () => {
    vi.useFakeTimers()
    params('cv-1')
    resolved(wordDraft())
    render(<Page />)

    fireEvent.change(screen.getByLabelText(/cv title/i), { target: { value: 'Renamed CV' } })
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(maybeCreateSnapshotMock).toHaveBeenCalledWith(
      expect.anything(),
      'cv-1',
      'user-1',
      expect.anything(),
      {}
    )
  })

  it('saves on demand as well as on a timer', async () => {
    params('cv-1')
    resolved(wordDraft())
    render(<Page />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    })
    expect(updateMutate).toHaveBeenCalled()
  })

  it('forces a checkpoint snapshot on an explicit Save, bypassing the 5-minute floor', async () => {
    params('cv-1')
    resolved(wordDraft())
    render(<Page />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    })
    expect(maybeCreateSnapshotMock).toHaveBeenCalledWith(
      expect.anything(),
      'cv-1',
      'user-1',
      expect.anything(),
      { force: true }
    )
  })

})

describe('the editor chrome', () => {
  it('renders Save as a LABELLED button, glyph and all', () => {
    // REVERSED IN PART, 2026-09-05. This asserted Save had no glyph, "one of
    // the four icons the set eliminated" in M5. Gabe asked for icons on CTA
    // buttons and then on tertiary and danger ones, which supersedes that.
    //
    // The half of the old rule that still holds -- and that M5 was actually
    // protecting -- is asserted instead: an editor's Save says the word. A
    // glyph beside it is fine; a glyph INSTEAD of it is what was eliminated.
    params('cv-1')
    resolved(wordDraft())
    render(<Page />)
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save.textContent!.trim()).toBe('save')
    expect(save.querySelectorAll('svg').length).toBe(1)
  })

  it('leaves the drafts list reachable from the editor', () => {
    // THE BREADCRUMB IS GONE (Gabe, Worktrack Revisions item 7, 2026-09-09).
    // `documents / word / <name>` claimed a hierarchy the app does not have --
    // both `documents` and `word` pointed at the same destination -- so it is
    // a plain "back to documents" link now, with kindLabel beside it as a
    // fact about the document rather than a step in a path nobody walked.
    // This still matters MORE than it looks: the sidebar is hidden while a
    // document is open, so this is the only way out other than the browser.
    params('cv-1')
    resolved(wordDraft())
    render(<Page />)
    expect(screen.getByRole('link', { name: 'back to documents' }).getAttribute('href')).toBe(
      '/documents'
    )
  })

  it('keeps the Word editor\'s rails on OPPOSITE sides', () => {
    // The two editors differ deliberately. A Word CV is one block, so the
    // analysis belongs beside it; the LaTeX editor is already two panes, so a
    // second rail would squeeze both. Asserted as the difference, so it fails
    // if either editor drifts into the other's shape.
    //
    // The markers changed on 2026-09-11 when the fixed pair became tabs: the
    // left rail SELECTS (`data-document-rail`) and the right rail SHOWS
    // (`data-document-pane`). The assertion is unchanged in substance --
    // two rails, different parents, selector before panel.
    params('cv-1')
    resolved(wordDraft())
    const { container } = render(<Page />)
    const rail = container.querySelector('[data-document-rail]') as HTMLElement
    const pane = container.querySelector('[data-document-pane]') as HTMLElement
    expect(rail).toBeTruthy()
    expect(pane).toBeTruthy()
    expect(rail.parentElement).not.toBe(pane.parentElement)
  })

  it('points each rail tab at the pane it controls', () => {
    // The whole justification for splitting a selector and its panel across a
    // document is that `aria-controls` carries the relationship a sighted user
    // reads out of the layout. If those ids stop matching, the arrangement is
    // just two columns and a screen reader learns nothing.
    params('cv-1')
    resolved(wordDraft())
    const { container } = render(<Page />)
    const pane = container.querySelector('[data-document-pane]') as HTMLElement
    const tabs = [...container.querySelectorAll('[role="tab"]')] as HTMLElement[]

    expect(tabs.length).toBeGreaterThan(1)
    for (const tab of tabs) {
      expect(tab.getAttribute('aria-controls')).toBe(pane.id)
    }
    // Exactly one selected, and it is the one the panel names.
    const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(pane.getAttribute('aria-labelledby')).toBe(selected[0].id)
  })

  it('hides the app navigation while a document is open, and restores it after', () => {
    // Gabe, 2026-09-04: the sidebar goes when a CV is open. Asserted through
    // the real AppShell rather than by checking a prop, because the mechanism
    // is that an editor deep in the tree tells the shell.
    //
    // THE SHELL STAYS MOUNTED ACROSS THE CHANGE, which is the whole point. An
    // earlier version of this test unmounted the shell and rendered a second
    // one -- so the "restores it" half passed against a fresh shell with fresh
    // state, and kept passing when the release was deleted outright. The case
    // that actually matters is navigating from the editor to another screen
    // WITHIN one shell, and that is the only way the cleanup is exercised.
    params('cv-1')
    resolved(wordDraft())
    const { container, rerender } = render(
      <AppShell>
        <Page />
      </AppShell>
    )
    expect(container.querySelector('[data-document-workspace]')).toBeTruthy()
    expect(container.querySelector('nav[aria-label="Main"]')).toBeNull()

    // Navigate away, same shell.
    rerender(
      <AppShell>
        <p>some other screen</p>
      </AppShell>
    )
    expect(container.querySelector('[data-document-workspace]')).toBeNull()
    expect(container.querySelector('nav[aria-label="Main"]')).toBeTruthy()
  })
})

describe('deleting a CV from the editor', () => {
  it('confirms before deleting, and does not delete on Cancel', async () => {
    params('cv-1')
    resolved(wordDraft())
    const user = userEvent.setup()
    render(<Page />)

    await openActions()
    await user.click(screen.getByRole('button', { name: /delete this cv/i }))
    expect(screen.getByRole('alertdialog', { name: /delete this cv/i })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'cancel' }))
    expect(deleteMutate).not.toHaveBeenCalled()
  })

  it('deletes and returns to Documents once the confirm is accepted', async () => {
    params('cv-1')
    resolved(wordDraft())
    const user = userEvent.setup()
    render(<Page />)

    await openActions()
    await user.click(screen.getByRole('button', { name: /delete this cv/i }))
    await user.click(screen.getByRole('button', { name: 'delete' }))
    expect(deleteMutate).toHaveBeenCalledWith('cv-1')
    expect(routerReplace).toHaveBeenCalledWith('/documents')
  })
})

/**
 * A promise the test resolves by hand, so a save can be held in flight while
 * more keystrokes arrive. Every earlier test in this file resolved the save in
 * a microtask, which is why none of them could see the race below.
 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('keystrokes during an in-flight save are not lost', () => {
  it('keeps the Word editor dirty when the document changed while the save was away', async () => {
    // Type A, the debounce fires and captures A, type B while A is in flight.
    // Marking the editor clean when A lands throws B away silently: the header
    // reads "Saved 3:42 PM" with no unsaved-changes marker, and B exists only
    // in the DOM.
    vi.useFakeTimers()
    params('cv-1')
    resolved(wordDraft())
    const inFlight = deferred<ReturnType<typeof wordDraft>>()
    updateMutate.mockReturnValueOnce(inFlight.promise)
    render(<Page />)

    const titleField = screen.getByLabelText(/cv title/i)
    fireEvent.change(titleField, { target: { value: 'A' } })
    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(updateMutate).toHaveBeenCalledTimes(1)

    fireEvent.change(titleField, { target: { value: 'AB' } })
    await act(async () => {
      inFlight.resolve(wordDraft({ title: 'A', updated_at: '2026-08-20T11:00:00.000Z' }))
    })

    expect(screen.getByText(/unsaved changes/i)).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(updateMutate).toHaveBeenLastCalledWith({
      id: 'cv-1',
      patch: expect.objectContaining({ title: 'AB' }),
    })
  })

})

describe('the Word autosave keeps running after a failure', () => {
  it('re-arms on a body edit that changes no other state', async () => {
    // Reset rewrites the document and touches nothing else -- no title, no new
    // editor instance. With the debounce keyed only on [isDirty, title,
    // editor] and isDirty already true after a failed save, nothing re-armed
    // it: one RLS denial and the editor stopped autosaving for the rest of the
    // session while still looking like it was working.
    vi.useFakeTimers()
    params('cv-1')
    resolved(wordDraft())
    updateMutate.mockRejectedValueOnce(new Error('permission denied'))
    render(<Page />)

    fireEvent.change(screen.getByLabelText(/cv title/i), { target: { value: 'Renamed' } })
    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(updateMutate).toHaveBeenCalledTimes(1)

    await openActions()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    })
    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(updateMutate).toHaveBeenCalledTimes(2)
  })
})

describe('snapshots survive the autosave that precedes them', () => {
  it('still snapshots when the save resolves before the 5s timer', async () => {
    // The save debounce is 1200ms and the snapshot debounce is 5000ms, so in
    // any real session the save lands first. Clearing the snapshot timer as
    // soon as the editor went clean meant the 5s timer was cancelled every
    // time and version history was never written at all.
    vi.useFakeTimers()
    params('cv-1')
    resolved(wordDraft())
    render(<Page />)

    fireEvent.change(screen.getByLabelText(/cv title/i), { target: { value: 'Renamed' } })
    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(maybeCreateSnapshotMock).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(3800)
    })
    expect(maybeCreateSnapshotMock).toHaveBeenCalledWith(
      expect.anything(),
      'cv-1',
      'user-1',
      expect.anything(),
      {}
    )
  })
})

describe('PDF export does not paper over a failed save', () => {
  // Export saves first and then posts the same content to `/api/cv/pdf`.
  // Both halves are asserted so the negative case cannot pass for some
  // unrelated reason -- an absent session used to stop the request anyway.
  //
  // THROUGH `authedFetch` SINCE 2026-09-15, not `global.fetch`. PDF export
  // used to call a Supabase edge function directly, and that function launched
  // Chromium against a runtime capped at 256MB and a 20MB bundle -- so it was
  // never deployable, never deployed, and every press ended in "Failed to
  // fetch". It is a Next route beside the docx and latex exports now.
  function exportFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' })),
    })
    authedFetchMock.mockImplementation(fetchMock)
    return fetchMock
  }

  it('stops rather than exporting a PDF of content the database rejected', async () => {
    params('cv-1')
    resolved(wordDraft())
    updateMutate.mockRejectedValueOnce(new Error('permission denied'))
    const fetchMock = exportFetch()
    render(<Page />)

    await openActions()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /export pdf/i }))
    })
    expect(updateMutate).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/exporting/i)).toBeNull()
  })

  it('still exports when the save lands, so the guard is not just switching it off', async () => {
    params('cv-1')
    resolved(wordDraft())
    const fetchMock = exportFetch()
    global.URL.createObjectURL = vi.fn(() => 'blob:cv')
    global.URL.revokeObjectURL = vi.fn()
    render(<Page />)

    await openActions()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /export pdf/i }))
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cv/pdf',
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('an overlapping pair of saves cannot un-save the newer one', () => {
  // Revision 1 starts saving on a slow connection; a keystroke makes it
  // revision 2, whose save overtakes it and lands first. When the older write
  // finally resolves it must not stamp its own revision over the newer one --
  // that flips a correctly-saved editor back to dirty and sends a redundant
  // write of content the database already has. `Math.max` in saveDraft is the
  // clause under test, and nothing exercised it until now.
  async function overlap(draft: ReturnType<typeof wordDraft>, label: string, edit: (value: string) => void) {
    vi.useFakeTimers()
    params(draft.id)
    resolved(draft)
    const first = deferred<ReturnType<typeof wordDraft>>()
    const second = deferred<ReturnType<typeof wordDraft>>()
    updateMutate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<Page />)

    edit(`${label}-1`)
    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    edit(`${label}-2`)
    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(updateMutate).toHaveBeenCalledTimes(2)

    // Newer write lands first, then the older one.
    await act(async () => {
      second.resolve(wordDraft({ updated_at: '2026-08-20T12:00:00.000Z' }))
    })
    await act(async () => {
      first.resolve(wordDraft({ updated_at: '2026-08-20T11:00:00.000Z' }))
    })
    return { first, second }
  }

  it('leaves the Word editor clean after the slower write finally lands', async () => {
    await overlap(wordDraft(), 'Title', (value) =>
      fireEvent.change(screen.getByLabelText(/cv title/i), { target: { value } })
    )
    expect(screen.queryByText(/unsaved changes/i)).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(updateMutate).toHaveBeenCalledTimes(2)
  })

})

describe('restoring a version persists the version that was restored', () => {
  async function restore(draftValue: ReturnType<typeof wordDraft>, content: unknown) {
    vi.useFakeTimers()
    params(draftValue.id)
    resolved(draftValue)
    getSnapshotsMock.mockResolvedValue([
      { id: 's-2', resume_id: draftValue.id, version: 2, created_at: '2026-08-20T10:00:00.000Z' },
      { id: 's-1', resume_id: draftValue.id, version: 1, created_at: '2026-08-19T10:00:00.000Z' },
    ])
    getSnapshotMock.mockResolvedValue({ id: 's-1', content })
    render(<Page />)

    fireEvent.click(screen.getByRole('button', { name: /versions/i }))
    await act(async () => {})
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /restore/i })[1])
    })
  }

  it('does the same for a restored Word document', async () => {
    await restore(wordDraft(), {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Restored body' }] }],
    })
    expect(updateMutate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/unsaved changes/i)).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(updateMutate).toHaveBeenCalledTimes(1)
  })
})


/**
 * Re-tailoring the SAME application has to change what is on screen.
 *
 * `created` navigates to the new CV, which remounts the editor and loads the
 * new text for free. `updated` rewrites the document already open and stays
 * here -- and the editor's content sync keys on `draft.id` so that a refetch
 * cannot clobber someone's typing. Without the explicit refresh the row would
 * change, the screen would not, and the match panel -- which scores
 * `editor.getText()` -- would go on reporting the score of the CV this one
 * just replaced.
 */
describe('re-tailoring the open CV for the same application', () => {
  // WISHLIST, deliberately: `useCvTailoring` narrows the picker to the
  // wishlist, and an `applied` fixture leaves the input disabled with
  // "nothing on the wishlist to tailor to".
  const JOB = makeJob({
    id: 'job-1',
    status: 'wishlist',
    company: 'Initech',
    role: 'Backend Engineer',
    description: 'We need React and TypeScript and Postgres experience.',
  })

  beforeEach(() => {
    jobsMock.mockReturnValue({ data: [JOB], isLoading: false, error: null })
    // The open document IS the tailored CV for Initech, and is linked to it.
    resumeLinksMock.mockReturnValue({ data: [{ job_id: 'job-1' }], isLoading: false })
    authedFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        summary: null,
        suggestions: [
          {
            section: 'summary',
            before: 'Shipped the rewrite',
            after: 'Delivered the rewrite with React and TypeScript',
            rationale: 'closer to the posting',
          },
        ],
      }),
    })
  })

  it('rewrites the open document and puts the new text on screen', async () => {
    // `pointerEventsCheck: 0`: the rail sits inside a vendored tab panel, and
    // the inert/pointer-events bookkeeping those panels do makes userEvent
    // refuse the click on the picker even though it is the visible tab.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    params('cv-1')
    resolved(wordDraft({ title: 'Backend CV — Initech' }))

    await act(async () => {
      render(<Page />)
    })

    // The rail lives behind a tab strip, so the tailoring pane has to be the
    // active one before its picker exists.
    await user.click(await screen.findByRole('tab', { name: /tailor to a job/i }))

    // Pick the application: the picker is a combobox, not a select.
    await user.click(await screen.findByRole('combobox', { name: /application/i }))
    const listbox = await screen.findByRole('listbox')
    await user.click(await within(listbox).findByRole('option', { name: /initech/i }))

    await user.click(await screen.findByRole('button', { name: /tailor this cv/i }))

    // The SAME document was rewritten -- no second file.
    await waitFor(() => expect(updateMutate).toHaveBeenCalled())
    expect(createMutate).not.toHaveBeenCalled()

    // And the rewrite is on screen, which is the part that was missing.
    await waitFor(() =>
      expect(screen.getByText(/Delivered the rewrite with React and TypeScript/)).toBeTruthy()
    )
    expect(screen.queryByText(/^Shipped the rewrite$/)).toBeNull()
  })
})

/**
 * `.tex` leads the exports and is the only one marked.
 *
 * Gabe, 2026-09-15: ".tex ... is the best version of the CV". It used to sit
 * last under a comment arguing it was the niche one, so this is a reversal
 * rather than an addition -- and a reversal is exactly what a later tidy-up
 * puts back, which is why the ORDER is asserted and not just the marker.
 */
describe('the export menu recommends .tex', () => {
  it('puts .tex above .docx and PDF', async () => {
    params('cv-1')
    resolved(wordDraft())
    render(<Page />)
    await openActions()

    const tex = screen.getByRole('button', { name: /export \.tex/i })
    const docx = screen.getByRole('button', { name: /export \.docx/i })
    const pdf = screen.getByRole('button', { name: /export pdf/i })

    expect(tex.compareDocumentPosition(docx) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(docx.compareDocumentPosition(pdf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('marks exactly one row, and it is the .tex one', async () => {
    params('cv-1')
    resolved(wordDraft())
    render(<Page />)
    await openActions()

    // A list where two things are recommended has recommended nothing.
    const marks = screen.getAllByText(/^recommended$/i)
    expect(marks).toHaveLength(1)
    expect(screen.getByRole('button', { name: /export \.tex/i })).toContainElement(marks[0])
  })
})
