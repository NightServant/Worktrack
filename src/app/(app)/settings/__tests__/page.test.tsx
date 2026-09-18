import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// This route reads through useAuth (email, signOut) and useUserPreferences,
// and writes through useSetDefaultCurrency plus a direct RPC for account
// deletion. Mocking all four drives every state without standing up
// AuthProvider or QueryClientProvider -- the same technique every other
// (app) route test in this milestone uses.
const useAuthMock = vi.hoisted(() => vi.fn())
const useUserPreferencesMock = vi.hoisted(() => vi.fn())
const useSetDefaultCurrencyMock = vi.hoisted(() => vi.fn())
const useUserProfileMock = vi.hoisted(() => vi.fn())
const rpcMock = vi.hoisted(() => vi.fn())
const showErrorMock = vi.hoisted(() => vi.fn())
const showSuccessMock = vi.hoisted(() => vi.fn())
const replaceMock = vi.hoisted(() => vi.fn())
const assignMock = vi.hoisted(() => vi.fn())

vi.mock('@/contexts/AuthContext', () => ({ useAuth: useAuthMock }))
// The route navigates on sign-out, so it needs a router. jsdom has no app
// router mounted and useRouter throws an invariant without this.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  // The screen reads `?import=bookmarklet&profile=<url>`, which is how the
  // profile bookmarklet hands it a captured page. Empty here: these tests are
  // about the account group, and an unmocked hook throws before they get to it.
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: useUserPreferencesMock,
  useSetDefaultCurrency: useSetDefaultCurrencyMock,
}))
// The Profile tab reads and writes through its own hooks. Mocked for the same
// reason the preferences ones are: this suite drives the route's own logic --
// sign-out, deletion, the currency write -- without standing up a
// QueryClientProvider, and an unmocked useQuery throws before any of it runs.
vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: useUserProfileMock,
  // The route builds a profile from a LinkedIn URL through Firecrawl since
  // 2026-09-09. `useImportProfile` (the CSV-export parser) is still exported
  // and deliberately unused, so it stays mocked here rather than being
  // removed -- a mock that disappears is how the next person discovers the
  // hook was deleted, one confusing failure at a time.
  useImportProfileFromUrl: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClearUserProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
// error/success are hoisted mocks, not inline vi.fn()s, so a failure-path
// test can assert on the actual message a real Supabase error produces --
// not just that some toast fired.
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ success: showSuccessMock, error: showErrorMock, info: vi.fn() }),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: rpcMock },
  hasValidSupabaseConfig: true,
}))

import Page from '../page'

// jsdom refuses a real navigation, so the one call that matters is stubbed.
// It is stubbed rather than spied because `location.assign` is non-writable in
// newer jsdom, and a spy on it silently does nothing.
beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: assignMock },
  })
})

afterEach(() => {
  replaceMock.mockClear()
  assignMock.mockClear()
  cleanup()
  showErrorMock.mockClear()
  showSuccessMock.mockClear()
})

// Task 4 (M5.5): DangerZone's window.confirm became a ConfirmDialog, so
// triggering the delete now takes two clicks -- open the guard, then accept
// it inside the alertdialog -- rather than one click plus a stubbed global.
async function confirmDeleteAccount() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /delete account/i }))
  const dialog = screen.getByRole('alertdialog', { name: /delete your account/i })
  await user.click(within(dialog).getByRole('button', { name: /delete account/i }))
}

function setup({
  email = 'gabe@example.com',
  prefs = null as { user_id: string; default_currency: string; created_at: string; updated_at: string } | null,
  // Resolves a result now, not undefined: signOut reports whether the
  // server revoke succeeded, because a failed one no longer aborts the
  // sign-out.
  signOut = vi.fn().mockResolvedValue({ revokedEverywhere: true }),
  mutateAsync = vi.fn().mockResolvedValue(undefined),
} = {}) {
  useAuthMock.mockReturnValue({ user: { id: 'u1', email }, signOut })
  useUserPreferencesMock.mockReturnValue({ data: prefs, isLoading: false, error: null })
  useSetDefaultCurrencyMock.mockReturnValue({ mutateAsync, isPending: false })
  // Resolved and empty -- the state a fresh account is actually in.
  useUserProfileMock.mockReturnValue({
    data: { profile: null, fetchedAt: null },
    isPending: false,
  })
  return { signOut, mutateAsync }
}

/**
 * Renders the route and opens the `general` tab.
 *
 * Settings is two tabs since 2026-09-09 (Gabe, Worktrack Revisions item 8),
 * and `TabsContent` UNMOUNTS the panel that is not showing -- which is the
 * behaviour worth having, since a `hidden` panel would leave a second copy of
 * every control in the accessibility tree. Everything this suite asserts on --
 * the email, the currency segments, sign-out, the danger zone -- lives in
 * `general`, so it has to be opened first.
 */
async function renderGeneral() {
  const user = userEvent.setup({ delay: null })
  const result = render(<Page />)
  await user.click(screen.getByRole('tab', { name: 'general' }))
  await screen.findByRole('heading', { name: 'account' })
  return result
}

describe('Settings route wrapper', () => {
  it('renders the signed-in user\'s email in the account group', async () => {
    setup({ email: 'gabe@example.com' })
    await renderGeneral()
    expect(screen.getByDisplayValue('gabe@example.com')).toBeTruthy()
  })

  // The whole point of this task: applications/page.tsx used to hardcode
  // resolveDefaultCurrency(null), so a stored preference never reached the
  // form. This proves the seam from the settings side -- a stored USD
  // preference has to reach this screen's currency control, not just exist
  // in the database.
  it('selects the stored default currency rather than always falling back to PHP', async () => {
    setup({
      prefs: { user_id: 'u1', default_currency: 'USD', created_at: 'x', updated_at: 'x' },
    })
    await renderGeneral()
    expect(screen.getByRole('radio', { name: 'USD' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'PHP' }).getAttribute('aria-checked')).toBe('false')
  })

  it('writes a new default currency through useSetDefaultCurrency, not a raw service call', async () => {
    const { mutateAsync } = setup()
    await renderGeneral()
    fireEvent.click(screen.getByRole('radio', { name: 'EUR' }))
    expect(mutateAsync).toHaveBeenCalledWith('EUR')
  })

  it('signs out through useAuth when the account group\'s sign-out button is clicked', async () => {
    const { signOut } = setup()
    await renderGeneral()
    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
  })

  it('still leaves, and still lands home, when the server revoke fails', async () => {
    // THE BUG THIS FIXES. auth-js returns early without removing the local
    // session if the revoke call fails with anything but 401/403/404, so an
    // offline or 500-ing server used to throw, show "Sign out failed", and
    // leave the user sitting on Settings still signed in. Signing out must not
    // be a request the network can veto.
    const { signOut } = setup({
      signOut: vi.fn().mockResolvedValue({
        revokedEverywhere: false,
        message: 'Signed out on this device. We could not reach the server.',
      }),
    })
    await renderGeneral()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(signOut).toHaveBeenCalled())
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/'))
  })

  it('says so when only this device was signed out', async () => {
    // Other devices keep their session until their own token expires. Someone
    // signing out on a shared machine deserves to know that did not reach the
    // rest, even though this browser is definitely done.
    setup({
      signOut: vi.fn().mockResolvedValue({
        revokedEverywhere: false,
        message: 'Signed out on this device. We could not reach the server.',
      }),
    })
    await renderGeneral()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(showErrorMock).toHaveBeenCalled())
    expect(showErrorMock.mock.calls[0][0]).toMatch(/signed out here only/i)
  })

  it('says nothing extra when the sign-out reached the server', async () => {
    setup()
    await renderGeneral()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/'))
    expect(showErrorMock).not.toHaveBeenCalled()
  })

  it('sends the person to the homepage after signing out, not to the sign-in form', async () => {
    // Reported from the deployed app: this landed on /login. Two redirects
    // were firing -- this one, and AppLayout's guard a beat later when the
    // auth state went null while the layout was still mounted.
    //
    // A DOCUMENT LOAD, not router.replace. AuthProvider lives in the root
    // layout, so a client-side navigation leaves it mounted and leaves the
    // `signingOut` flag raised, which would make the guard stand aside from a
    // later rejection it should make. It also drops every in-memory cache,
    // including the rows of the person who just left.
    const { signOut } = setup()
    await renderGeneral()
    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/'))
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('calls the delete_own_account RPC and signs out once account deletion is confirmed', async () => {
    const { signOut } = setup()
    rpcMock.mockResolvedValue({ error: null })
    await renderGeneral()
    await confirmDeleteAccount()
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('delete_own_account'))
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    // Same destination and mechanism, and more obviously right here -- there
    // is no account left to sign back into, and no cached row that should
    // survive the deletion.
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/'))
  })

  // CRITICAL from the review round: supabase.rpc() resolves { error } as a
  // plain Postgrest error object ({message, details, hint, code}), not an
  // Error instance -- that conversion only happens when .throwOnError() is
  // chained, which this call site does not do. `throw error` on that plain
  // object made `err instanceof Error` false in the catch block, so the
  // toast always read "Unknown error" no matter what Postgres actually
  // said. Both tests below assert on the real message reaching showError,
  // not just that signOut was skipped -- the original test only checked the
  // latter and could not see the bug even though it exercised the exact
  // failure path.
  it('surfaces the demo-account guard\'s real message, not "Unknown error"', async () => {
    const { signOut } = setup()
    rpcMock.mockResolvedValue({
      error: {
        message: 'The demo account cannot be deleted',
        code: '42501',
        details: null,
        hint: null,
      },
    })
    await renderGeneral()
    await confirmDeleteAccount()
    await waitFor(() => expect(rpcMock).toHaveBeenCalled())
    expect(showErrorMock).toHaveBeenCalledWith(
      'Could not delete account',
      'The demo account cannot be deleted'
    )
    expect(signOut).not.toHaveBeenCalled()
  })

  it('surfaces a generic RPC failure\'s real message too', async () => {
    const { signOut } = setup()
    rpcMock.mockResolvedValue({
      error: { message: 'boom', code: 'XX000', details: null, hint: null },
    })
    await renderGeneral()
    await confirmDeleteAccount()
    await waitFor(() => expect(rpcMock).toHaveBeenCalled())
    expect(showErrorMock).toHaveBeenCalledWith('Could not delete account', 'boom')
    expect(signOut).not.toHaveBeenCalled()
  })
})
