import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import AppLayout from '../layout'

/**
 * The sign-out race, driven through the REAL AuthProvider and the REAL guard.
 *
 * layout.test.tsx asserts the guard respects a `signingOut` flag, which is
 * necessary and not sufficient: it hands the flag to the component rather than
 * letting the provider produce it, so it cannot prove the flag is raised
 * before the guard reads it. That gap is exactly the shape of the original
 * bug -- a test that asserted the intended call happened while the clobbering
 * call went unobserved.
 *
 * This wires the two together and drives them from a fake Supabase whose
 * signOut() fires onAuthStateChange the way the real one does, then asserts on
 * the ONE thing that matters: where the person ends up.
 */

const replaceMock = vi.hoisted(() => vi.fn())
const pushMock = vi.hoisted(() => vi.fn())
/**
 * Whether the page loads WITH a session, which is the only thing separating
 * the two signed-out stories this file tells.
 *
 * A stranger who never had one is a guard rejection and belongs at /login. A
 * reader whose session died underneath them is an expiry and gets told so.
 * `AuthContext` tells them apart by whether it ever saw a session, so a test
 * that wants the first must not seed one -- which the single hard-coded
 * `getSession` here used to do for both, quietly making the "uninvited
 * visitor" case an expiry wearing its name.
 */
const startsSignedIn = vi.hoisted(() => ({ value: true }))
let emitAuthChange: ((session: null) => void) | null = null

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, refresh: vi.fn() }),
  usePathname: () => '/overview',
}))
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/lib/supabase', () => ({
  hasValidSupabaseConfig: true,
  supabaseConfigError: null,
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: startsSignedIn.value ? { user: { id: 'u1' } } : null },
        }),
      onAuthStateChange: (cb: (event: string, session: null) => void) => {
        emitAuthChange = (session) => cb('SIGNED_OUT', session)
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      // The real client clears the session and notifies subscribers. Firing
      // the callback here is what reproduces the race: the layout re-renders
      // with user === null while it is still mounted.
      signOut: async () => {
        emitAuthChange?.(null)
        return { error: null }
      },
    },
  },
}))

function SignOutButton() {
  const { signOut } = useAuth()
  return (
    <button
      onClick={async () => {
        await signOut()
        // What the settings page does: the sign-out flow owns the destination.
        replaceMock('/')
      }}
    >
      sign out
    </button>
  )
}

beforeEach(() => {
  replaceMock.mockClear()
  pushMock.mockClear()
  startsSignedIn.value = true
  emitAuthChange = null
})

describe('signing out of the authenticated shell', () => {
  it('lands on the home page, and never on the sign-in form', async () => {
    // Reported from the deployed app on 2026-09-03. Both redirects fired; the
    // guard ran second and won, so a deliberate sign-out was answered with a
    // sign-in form.
    render(
      <AuthProvider>
        <AppLayout>
          <SignOutButton />
        </AppLayout>
      </AuthProvider>
    )

    const button = await screen.findByRole('button', { name: 'sign out' })
    await userEvent.click(button)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'))
    expect(
      replaceMock.mock.calls.map((c) => c[0]),
      'the guard clobbered the sign-out destination'
    ).not.toContain('/login')
  })

  it('still sends an uninvited visitor to the sign-in form', async () => {
    // Positive companion. Without it, a guard that had simply been deleted
    // would pass the test above -- and deleting the guard is the tempting
    // wrong fix, since it makes the symptom disappear.
    //
    // `startsSignedIn = false` IS THE WHOLE POINT OF THIS TEST NOW. It used to
    // seed a session and then emit null, and call that "an uninvited visitor"
    // -- but that is a session ENDING, which is an expiry. The distinction did
    // not exist when this was written, so the two were the same code path and
    // the mis-naming cost nothing. It does now: an expiry is explained rather
    // than bounced (see the test below), so leaving this seeded would have
    // made this assert the opposite of the shipped behaviour.
    startsSignedIn.value = false
    emitAuthChange = null
    render(
      <AuthProvider>
        <AppLayout>
          <div>private</div>
        </AppLayout>
      </AuthProvider>
    )
    await waitFor(() => expect(emitAuthChange).not.toBeNull())
    emitAuthChange!(null)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'))
  })

  it('explains an expiry rather than bouncing silently to the sign-in form', async () => {
    /*
      THE THIRD WAY TO HAVE NO USER, and the one the guard must NOT answer with
      a redirect. A session that the server ended while somebody was reading is
      not a request for a private page without credentials -- it is the app
      taking something away -- and the old behaviour was a silent replace() to
      /login, which reads as being logged out at random.

      Two assertions, and the negative one is the load-bearing half: a dialog
      that appears and is immediately navigated away from is the same as no
      dialog. `not.toHaveBeenCalled` on the guard's own redirect is what pins
      the early return in the layout's effect.
    */
    render(
      <AuthProvider>
        <AppLayout>
          <div>private</div>
        </AppLayout>
      </AuthProvider>
    )
    await waitFor(() => expect(emitAuthChange).not.toBeNull())
    emitAuthChange!(null)

    expect(await screen.findByText('your session expired')).toBeInTheDocument()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('carries the screen the reader was on into the sign-in link', async () => {
    // `?next=` is how they come back to what they were reading instead of to a
    // dashboard they did not ask for. The route is `usePathname`'s value at
    // the moment the session died, captured then rather than read at click
    // time -- see SessionExpiredDialog for why those differ.
    render(
      <AuthProvider>
        <AppLayout>
          <div>private</div>
        </AppLayout>
      </AuthProvider>
    )
    await waitFor(() => expect(emitAuthChange).not.toBeNull())
    emitAuthChange!(null)

    await userEvent.click(await screen.findByRole('button', { name: 'sign in again' }))
    expect(pushMock).toHaveBeenCalledWith('/login?next=%2Foverview')
  })
})
