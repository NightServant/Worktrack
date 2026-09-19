import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.fn()
const signIn = vi.fn()
const signUp = vi.fn()
const verifySignUpOtp = vi.fn()
const resendSignUpOtp = vi.fn()
// `?next=` support arrived with the middleware (2026-09-11): a signed-out
// visitor is sent here with the path they asked for attached, and the page
// reads it back on submit.
//
// THE TESTS SET A REAL URL rather than mocking `useSearchParams`, because the
// page deliberately no longer calls it -- that hook opts a client page out of
// static prerendering and cost /login its server-rendered form. A mock would
// have happily passed either way, which is precisely the problem: it tests the
// parameter plumbing while hiding the thing that actually broke.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}))

/** Puts a query string on the jsdom URL the way arriving at the link would. */
function atUrl(search: string) {
  window.history.replaceState({}, '', `/login${search}`)
}
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    session: null,
    loading: false,
    signIn,
    signUp,
    verifySignUpOtp,
    resendSignUpOtp,
    signOut: vi.fn(),
  }),
}))

import LoginRoute from '../login/page'
import SignupRoute from '../signup/page'

beforeEach(() => {
  push.mockClear()
  signIn.mockReset()
  signUp.mockReset()
  verifySignUpOtp.mockReset()
  resendSignUpOtp.mockReset()
  window.localStorage.clear()
  // jsdom keeps the URL between tests, so a leftover `?next=` would leak into
  // the next one and pass it for the wrong reason.
  atUrl('')
})

async function fill(password = 'hunter22') {
  await userEvent.type(screen.getByLabelText(/^Email/), 'a@b.test')
  await userEvent.type(screen.getByLabelText(/^Password/), password)
}

/**
 * NEITHER ROUTE OFFERS AN OAUTH PROVIDER, and that is the assertion rather
 * than a side effect.
 *
 * Gabe, 2026-09-15: "remove the continue with google and microsoft buttons."
 * `/auth/v1/settings` on the project reports every external provider false --
 * Google and Microsoft have never been enabled -- so both buttons ran a full
 * round trip and came back with
 * `{"error_code":"validation_failed","msg":"Unsupported provider: provider is
 * not enabled"}`. A control that cannot work is worse than no control: it
 * reads as a broken app rather than a feature that is not set up.
 *
 * THE COMPONENTS ARE GONE NOW, not merely unwired (Gabe, 2026-09-19: "Remove
 * the OAuth buttons entirely"). `OAuthButtons`, `lib/oauthProviders`, the
 * vendor marks and `signInWithProvider` on the context were kept for four days
 * as a one-line-each restoration; kept code that nothing renders is a claim
 * the product makes and does not honour, and the git history is a better place
 * to restore from than a live module nobody imports.
 *
 * This stays because a provider button is exactly the kind of thing a UI
 * library or a copied auth screen reintroduces by accident, and the assertion
 * costs nothing.
 */
describe('neither route offers a provider button', () => {
  it('renders no provider button on /login', () => {
    render(<LoginRoute />)
    expect(screen.queryByRole('button', { name: /continue with/i })).toBeNull()
  })

  it('renders no provider button on /signup', () => {
    render(<SignupRoute />)
    expect(screen.queryByRole('button', { name: /continue with/i })).toBeNull()
  })
})

describe('the /login route', () => {
  it('signs in and sends the user to the dashboard', async () => {
    signIn.mockResolvedValue(undefined)
    render(<LoginRoute />)
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(signIn).toHaveBeenCalledWith('a@b.test', 'hunter22')
    expect(push).toHaveBeenCalledWith('/overview')
  })

  it('does not navigate when the sign-in is refused', async () => {
    // The redirect lives inside the resolved path only. Navigating on a
    // rejection is how the old single-screen version lost a form.
    signIn.mockRejectedValue(new Error('Invalid login credentials'))
    render(<LoginRoute />)
    await fill('wrong-one')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})

describe('the /signup route', () => {
  // The route now renders the three-step flow rather than a single screen, so
  // a successful signUp advances to verification -- it does NOT navigate. The
  // dashboard is reached only after the code is accepted, which is the whole
  // point of adding the step: an unverified address must not become a usable
  // session.
  async function fillDetails(email = 'a@b.test') {
    await userEvent.type(screen.getByLabelText(/^Email/), email)
    await userEvent.type(screen.getByLabelText(/^Password/), 'Str0ng!Passw0rd')
    await userEvent.type(screen.getByLabelText(/^Confirm password/), 'Str0ng!Passw0rd')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
  }

  it('creates the account and asks for the emailed code', async () => {
    signUp.mockResolvedValue(undefined)
    render(<SignupRoute />)
    await fillDetails()
    expect(signUp).toHaveBeenCalledWith('a@b.test', 'Str0ng!Passw0rd')
    expect(await screen.findByLabelText(/^Verification code/)).toBeInTheDocument()
    // Not yet: the address is unverified.
    expect(push).not.toHaveBeenCalled()
  })

  it('calls signUp, not signIn', async () => {
    // Two four-line files that differ in two identifiers is exactly the shape
    // a copy-paste gets wrong, and the wrong one still compiles.
    signUp.mockResolvedValue(undefined)
    render(<SignupRoute />)
    await fillDetails()
    expect(signUp).toHaveBeenCalled()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('reaches the dashboard only after the code is verified', async () => {
    signUp.mockResolvedValue(undefined)
    verifySignUpOtp.mockResolvedValue(undefined)
    render(<SignupRoute />)
    await fillDetails()
    // The sixth digit submits; no click. See OtpStep's `submit`.
    await userEvent.type(await screen.findByLabelText(/^Verification code/), '123456')

    expect(verifySignUpOtp).toHaveBeenCalledWith('a@b.test', '123456')
    expect(await screen.findByText('you are all set')).toBeInTheDocument()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/overview'), { timeout: 4000 })
  })

  it('does not advance when the signup is refused', async () => {
    signUp.mockRejectedValue(new Error('User already registered'))
    render(<SignupRoute />)
    await fillDetails()
    expect(await screen.findByText('User already registered')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Verification code/)).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })

  it('finishes the journey the visitor started, not the one we assume', async () => {
    // Middleware attaches `?next=` when it turns a signed-out visitor away
    // from a private route. Ignoring it would drop a deep link on every
    // sign-in -- somebody following a link to one application would land on
    // the dashboard and have to find it again.
    atUrl('?next=%2Fapplications%3Fapplication%3Dabc-123')
    signIn.mockResolvedValue(undefined)
    render(<LoginRoute />)
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/applications?application=abc-123')
    )
  })

  it('refuses a `next` that would leave this origin', async () => {
    // `?next=` is in a URL somebody can send you. `//evil.com` is a valid
    // navigation target to a browser and is exactly what an open redirect is.
    atUrl('?next=%2F%2Fevil.com')
    signIn.mockResolvedValue(undefined)
    render(<LoginRoute />)
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/overview'))
  })
})
