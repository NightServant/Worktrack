import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The thank-you screen survives the session it just created.
 *
 * THIS IS THE TEST THAT WAS MISSING, and its absence is the whole story.
 * `SignUpFlow` has had a third step since it was written -- a success screen
 * that holds for 2.5s and then leaves for /overview -- and it was covered by
 * tests that passed. Those tests mounted `SignUpFlow` DIRECTLY. In a browser
 * the flow renders inside the (auth) layout, which mounts two guards, and
 * verifying the code creates a session that makes both of them act at once:
 * `SignedInRedirect` navigates away and `SignedOutOnly` returns null. The step
 * never got a frame. Gabe, 2026-09-15: "there is no auth layout thank you page
 * before dashboard."
 *
 * So the unit under test here is deliberately the COMPOSITION -- layout plus
 * route -- because every piece was individually correct and the defect lived
 * only in how they met. A test of either half alone would still pass today
 * with the fix reverted.
 *
 * `user` FLIPS FROM null TO A SESSION mid-test, which is the event that broke
 * it. A fixed `user: null` would sail through against the old code too.
 */

const replace = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}))

const verifySignUpOtp = vi.fn()

/*
  THE MOCK NOTIFIES ITS CONSUMERS, like the real context does.

  A plain `useAuth: () => ({ user: flagOrNull })` only reports a change to a
  component that re-renders for some other reason, and the guards here are
  SIBLINGS of the page. This file passed for a while on a mock that just
  flipped a variable -- which meant it was not exercising the guards at all.
  See forgotPasswordRoute.test, where the same weakness hid a real one-await
  window between the session appearing and the hold being applied.
*/
const store = vi.hoisted(() => ({ signedIn: false, listeners: new Set<() => void>() }))
function setSignedIn(value: boolean) {
  store.signedIn = value
  store.listeners.forEach((notify) => notify())
}

/*
  THE PROFILE MUTATIONS, STUBBED. `/signup` gained a fourth step on 2026-09-21
  that reads the addresses somebody gives it, and these two hooks are how it
  does that -- neither is what any test in this file is about, and both need a
  QueryClientProvider these tests have no reason to stand up.
*/
vi.mock('@/hooks/useUserProfile', () => ({
  useImportProfileFromUrl: () => ({ mutateAsync: vi.fn(async () => {}), isPending: false }),
  useSaveProfileDetails: () => ({ mutateAsync: vi.fn(async () => {}), isPending: false }),
}))

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
        signUp: vi.fn().mockResolvedValue(undefined),
        verifySignUpOtp,
        resendSignUpOtp: vi.fn(),
        signOut: vi.fn(),
      }
    },
  }
})

import AuthLayout from '../layout'
import SignupRoute from '../signup/page'

beforeEach(() => {
  vi.clearAllMocks()
  setSignedIn(false)
  // Verifying is what creates the session. That ordering is the entire bug.
  verifySignUpOtp.mockImplementation(async () => {
    setSignedIn(true)
  })
})

const renderRoute = () =>
  render(
    <AuthLayout>
      <SignupRoute />
    </AuthLayout>
  )

async function reachTheCodeStep() {
  await userEvent.type(screen.getByLabelText(/^Email/), 'gabe@example.com')
  await userEvent.type(screen.getByLabelText(/^Password/), 'Hunter22!pass')
  await userEvent.type(screen.getByLabelText(/^Confirm password/), 'Hunter22!pass')
  await userEvent.click(screen.getByRole('button', { name: /create account/i }))
  return screen.findByLabelText(/^Verification code/)
}

describe('signing up inside the real auth layout', () => {
/**
 * Verify the code and skip the sources form, landing on the thank-you.
 *
 * THE FOURTH STEP SITS BETWEEN THEM SINCE 2026-09-21 and is not what any test
 * in this file is about -- these are all about the auth layout's guards not
 * unmounting the subtree the moment a session appears, which is a thing that
 * happens on verification whichever screen follows it.
 */
const passThePersonaliseStep = async () => {
  await screen.findByText(/where should we read you from/i)
  await userEvent.click(document.querySelector('[data-personalise-skip]') as HTMLElement)
}

  it('shows the thank-you after the code verifies, instead of vanishing', async () => {
    renderRoute()
    const field = await reachTheCodeStep()
    await userEvent.type(field, '123456')

    await waitFor(() => expect(verifySignUpOtp).toHaveBeenCalled())
    await passThePersonaliseStep()
    // THE ASSERTION. Against the old code this is absent: SignedOutOnly has
    // already returned null for the whole subtree.
    expect(await screen.findByText('you are all set')).toBeInTheDocument()
  })

  it('does not let the layout redirect out from under it', async () => {
    renderRoute()
    const field = await reachTheCodeStep()
    await userEvent.type(field, '123456')

    await passThePersonaliseStep()
    await screen.findByText('you are all set')
    // The flow owns the navigation now, on its own delay. A replace() here
    // would mean the guard fired anyway and the screen is about to be lost.
    expect(replace).not.toHaveBeenCalled()
  })

  it('still offers a way out if the automatic redirect never happens', async () => {
    renderRoute()
    const field = await reachTheCodeStep()
    await userEvent.type(field, '123456')

    await passThePersonaliseStep()
    await screen.findByText('you are all set')
    expect(screen.getByRole('link', { name: /go to the overview now/i })).toHaveAttribute(
      'href',
      '/overview'
    )
  })

  it('leaves the guards armed on the steps before the thank-you', async () => {
    // The hold is for ONE screen. If a session appears while the credentials
    // form is open -- another tab signing in -- the guard must still act, or
    // this becomes a permanent hole rather than a pause.
    renderRoute()
    await screen.findByLabelText(/^Email/)
    // No manual rerender: the mock notifies consumers, as a session arriving
    // in another tab would.
    setSignedIn(true)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/overview'))
  })
})
