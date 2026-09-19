import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { render, screen } from '@testing-library/react'

/**
 * No auth route is ever blank, at any moment of the handoff.
 *
 * THIS IS THE TEST THE LAST TWO ATTEMPTS NEEDED. Gabe reported a blank page,
 * twice, and I fixed the `(app)` layout twice -- the wrong layout both times.
 * The white in his recording was `SignedOutOnly` returning `null`: the instant
 * `signIn` resolves and `onAuthStateChange` sets a user, this component
 * emptied the whole /login document, and it stayed empty for the ~900ms that
 * `router.push('/overview')` took to land.
 *
 * WHY IT ASSERTS ON VISIBLE TEXT rather than on any particular component: the
 * requirement is "the page is not blank", and every previous attempt passed a
 * test about the mechanism while the screen was still white. Stripping tags
 * and counting what a person could actually read is the only version of this
 * that cannot be satisfied by the wrong fix.
 *
 * `renderToString`, because the blank includes the server render. A jsdom
 * render with a `waitFor` would let an effect-driven fallback pass while the
 * delivered HTML was still empty -- which is exactly how the previous fix
 * shipped broken.
 */

const store = { signedIn: false, held: false }

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: store.signedIn ? { id: 'u1', email: 'gabe@example.com' } : null,
    session: null,
    loading: false,
    signingOut: false,
  }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/login',
}))

import AuthLayout from '../layout'

const visibleText = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

beforeEach(() => {
  store.signedIn = false
  store.held = false
})

describe('the sign-in handoff never shows a blank page', () => {
  it('shows the form while signed out', () => {
    const html = renderToString(<AuthLayout><p>THE FORM</p></AuthLayout>)
    expect(visibleText(html)).toContain('THE FORM')
  })

  it('shows SOMETHING the instant a session appears', () => {
    // THE ASSERTION THAT WOULD HAVE CAUGHT IT. Before this, visible text here
    // was the empty string -- measured, not guessed.
    store.signedIn = true
    const html = renderToString(<AuthLayout><p>THE FORM</p></AuthLayout>)
    expect(visibleText(html).length).toBeGreaterThan(0)
  })

  it('does not leave the answered form on screen', () => {
    // The form must still go: it has been submitted, and leaving it up
    // invites a second submit against a session that already exists.
    store.signedIn = true
    const html = renderToString(<AuthLayout><p>THE FORM</p></AuthLayout>)
    expect(visibleText(html)).not.toContain('THE FORM')
  })

  it('says what is happening rather than just spinning', () => {
    store.signedIn = true
    render(<AuthLayout><p>THE FORM</p></AuthLayout>)
    expect(screen.getByText(/signing you in/i)).toBeInTheDocument()
  })

  it('is announced, not only drawn', () => {
    store.signedIn = true
    render(<AuthLayout><p>THE FORM</p></AuthLayout>)
    // A blank page and a silent one are the same thing to a screen reader.
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
