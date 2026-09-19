import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The reset flow survives the session it creates halfway through.
 *
 * THE TRAP IS STRUCTURAL, not incidental. `verifyOtp({ type: 'recovery' })`
 * SIGNS THE PERSON IN -- that is how Supabase recovery works, and it is the
 * only reason step three can set a password without asking for the old one.
 * But both guards in the (auth) layout treat a new session as a reason to
 * leave: SignedInRedirect navigates to /overview, SignedOutOnly returns null
 * for the whole subtree.
 *
 * So without the hold, entering a correct code would throw somebody onto the
 * dashboard WITH THEIR OLD PASSWORD STILL SET, having been shown a reset flow
 * that appeared to work. They would find out at the next sign-in.
 *
 * The sign-up thank-you hit the same wall first and it shipped broken, because
 * its tests mounted the flow directly where no guard exists. This one is
 * mounted inside the real layout for exactly that reason.
 */

const replace = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }))

const requestPasswordReset = vi.fn()
const verifyRecoveryOtp = vi.fn()
const updatePassword = vi.fn()

/*
  THE MOCK RE-RENDERS ITS CONSUMERS, and that is not a detail -- it is what
  makes this file a test rather than a decoration.

  A plain `useAuth: () => ({ user: flagOrNull })` only reports a new value to a
  component that re-renders for some OTHER reason. The guards here are SIBLINGS
  of the page, mounted by the layout, so nothing about the flow's own state
  makes them re-read auth. The first version of this file passed with the fix
  deliberately removed: flipping the flag changed nothing anybody looked at.

  The real AuthContext pushes to every consumer through context. This models
  that with a subscription, so `setSignedIn` reaches the guards the way
  `onAuthStateChange` does in a browser -- and the test fails when the hold is
  taken away, which is the only reason to write it.
*/
const store = vi.hoisted(() => ({ signedIn: false, listeners: new Set<() => void>() }))
function setSignedIn(value: boolean) {
  store.signedIn = value
  store.listeners.forEach((notify) => notify())
}

vi.mock('@/contexts/AuthContext', async () => {
  const React = await import('react')
  return {
    useAuth: () => {
      const [, force] = React.useReducer((n: number) => n + 1, 0)
      React.useEffect(() => {
        store.listeners.add(force)
        return () => {
          store.listeners.delete(force)
        }
      }, [])
      return {
        user: store.signedIn ? { id: 'u1', email: 'gabe@example.com' } : null,
        session: null,
        loading: false,
        signIn: vi.fn(),
        signUp: vi.fn(),
        signOut: vi.fn(),
        requestPasswordReset,
        verifyRecoveryOtp,
        updatePassword,
      }
    },
  }
})

import AuthLayout from '../layout'
import ForgotPasswordRoute from '../forgot-password/page'

const STRONG = 'Str0ng!Passw0rd'

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
  setSignedIn(false)
  requestPasswordReset.mockResolvedValue(undefined)
  // Verifying is what creates the session. That ordering is the trap.
  verifyRecoveryOtp.mockImplementation(async () => {
    setSignedIn(true)
  })
  updatePassword.mockResolvedValue(undefined)
})
afterEach(() => window.localStorage.clear())

const renderRoute = () =>
  render(
    <AuthLayout>
      <ForgotPasswordRoute />
    </AuthLayout>
  )

async function reachPasswordStep() {
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'gabe@example.com' } })
  await userEvent.click(await screen.findByRole('button', { name: 'Send the code' }))
  await userEvent.type(await screen.findByLabelText(/^Verification code/), '123456')
  return screen.findByLabelText(/^New password/)
}

describe('resetting a password inside the real auth layout', () => {
  it('still shows the new-password step after the code signs you in', async () => {
    renderRoute()
    // THE ASSERTION. Without the hold this throws: SignedOutOnly has already
    // returned null for the entire subtree.
    expect(await reachPasswordStep()).toBeInTheDocument()
  })

  it('does not let the layout redirect before the password is set', async () => {
    renderRoute()
    await reachPasswordStep()
    // A replace() here means somebody landed on the dashboard with the old
    // password still in force.
    expect(replace).not.toHaveBeenCalled()
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('sets the password and only then leaves for the dashboard', async () => {
    renderRoute()
    await reachPasswordStep()
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: STRONG } })
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), { target: { value: STRONG } })
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }))

    await waitFor(() => expect(updatePassword).toHaveBeenCalledWith(STRONG))
    expect(replace).toHaveBeenCalledWith('/overview')
  })

  it('leaves the guards armed on the steps before the session exists', async () => {
    // The hold covers ONE step. A session appearing while the address form is
    // open -- another tab signing in -- must still be acted on.
    renderRoute()
    await screen.findByLabelText(/^Email/)
    // No manual rerender needed now: the mock notifies consumers, exactly as
    // a session arriving in another tab would.
    setSignedIn(true)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/overview'))
  })
})
