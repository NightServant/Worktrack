import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import AppLayout from '../layout'

const useAuthMock = vi.hoisted(() => vi.fn())
const replaceMock = vi.hoisted(() => vi.fn())
const pathnameMock = vi.hoisted(() => vi.fn(() => '/overview'))

vi.mock('@/contexts/AuthContext', () => ({ useAuth: useAuthMock }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  // The layout reads the path to choose WHICH skeleton to show while auth
  // resolves -- a route-shaped outline rather than the blank page this used to
  // paint. See SKELETON_BY_PREFIX in the layout.
  usePathname: () => pathnameMock(),
}))
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

beforeEach(() => {
  replaceMock.mockClear()
  useAuthMock.mockReset()
  pathnameMock.mockReturnValue('/overview')
})

describe('the authenticated shell guard', () => {
  it('sends a signed-out visitor to the sign-in form', () => {
    // The guard's actual job: somebody who asked for a private page without a
    // session gets the sign-in form, not an empty frame.
    useAuthMock.mockReturnValue({ user: null, loading: false, signingOut: false })
    render(<AppLayout>x</AppLayout>)
    expect(replaceMock).toHaveBeenCalledWith('/login')
  })

  it('waits for the session to resolve before deciding', () => {
    useAuthMock.mockReturnValue({ user: null, loading: true, signingOut: false })
    render(<AppLayout>x</AppLayout>)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('does not redirect a signed-in visitor', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, loading: false, signingOut: false })
    render(<AppLayout>x</AppLayout>)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('stands aside while a sign-out is in flight', () => {
    // THE BUG THIS EXISTS FOR, reported from the deployed app on 2026-09-03:
    // signing out from /settings landed on /login instead of the home page.
    //
    // Both redirects fire. The settings page calls replace('/') the moment
    // signOut() resolves; a beat later onAuthStateChange sets user to null,
    // this layout re-renders, and its effect calls replace('/login') while it
    // is still mounted. The guard runs second, so the guard wins.
    //
    // The two events are not the same event. A guard rejection means "you
    // asked for a private page without a session", and /login is right. A
    // sign-out means "you chose to leave", and being handed a sign-in form
    // reads as the app refusing to let go. Only intent separates them, so
    // intent is what the flag carries.
    useAuthMock.mockReturnValue({ user: null, loading: false, signingOut: true })
    render(<AppLayout>x</AppLayout>)
    expect(replaceMock).not.toHaveBeenCalled()
  })
})


/**
 * What a signed-in visitor looks at while the session resolves.
 *
 * IT WAS A BLANK PAGE. This guard returned `null` for `loading`, so every cold
 * load of a private route painted an empty document until
 * `supabase.auth.getSession()` came back -- a network round trip. The page's
 * own skeleton could not help, because it lives inside `children`, which the
 * gate had already refused to render. Gabe, 2026-09-15: "there are blank
 * pages".
 *
 * THE SHAPE IS THE FEATURE, which is why these assert on the variant rather
 * than on "something rendered". A spinner says work is happening; a skeleton
 * in the shape of the route says WHAT is arriving, so the page resolves into
 * an outline the reader has already started on instead of replacing a spinner
 * with a screen.
 */
describe('the loading state, which used to be nothing at all', () => {
  const loading = { user: null, loading: true, signingOut: false }

  it('paints a skeleton instead of an empty page', async () => {
    useAuthMock.mockReturnValue(loading)
    const { container } = render(<AppLayout>x</AppLayout>)
    // AWAITED, because `RouteSkeleton` sits behind `DelayedSkeleton`'s 200ms
    // gate -- see the test below, which asserts that gate is still there.
    // THE ASSERTION THAT WOULD HAVE CAUGHT IT: before this, the container
    // stayed empty forever rather than for 200ms.
    await waitFor(() => expect(container.querySelector('[data-route-skeleton]')).toBeTruthy())
  })

  it('renders on the FIRST pass, so it exists in the server HTML', async () => {
    /*
      THIS TEST ASSERTED THE OPPOSITE FOR ONE COMMIT, and the opposite was the
      bug. It claimed the 200ms gate should apply here too, "so a fast session
      never flashes a skeleton" -- which sounds right and is wrong, because
      the gate is `useState` plus an effect and EFFECTS DO NOT RUN DURING SSR.
      Gated, this branch renders as nothing in the delivered document and
      stays nothing for another 200ms after hydration: exactly the window it
      was added to cover. A screen recording caught ~900ms of white between
      the sign-in form and the dashboard with the gated version deployed.

      There is also no warm case to protect. This branch is reached only when
      `loading` is true, and `loading` starts true once per AuthProvider mount
      -- that is, once per document load, where `getSession()` must make a
      network round trip. Client-side navigations inside the app never reach
      it, because the provider is already resolved.

      `renderToString` rather than `render`, because "synchronously" is the
      whole claim and jsdom would let an effect-driven render pass a
      `waitFor`. This is the actual server output.
    */
    const { renderToString } = await import('react-dom/server')
    useAuthMock.mockReturnValue(loading)
    const html = renderToString(<AppLayout>x</AppLayout>)
    expect(html).toContain('data-route-skeleton')
    expect(html).not.toContain('x</')
  })

  it('tells a screen reader it is loading, not just a sighted one', async () => {
    useAuthMock.mockReturnValue(loading)
    render(<AppLayout>x</AppLayout>)
    const status = await screen.findByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveTextContent('Loading')
  })

  it('does not leak the route content while auth is unresolved', () => {
    // The skeleton replaces `children`; it does not render alongside them.
    useAuthMock.mockReturnValue(loading)
    const { container } = render(<AppLayout>secret</AppLayout>)
    expect(container.textContent).not.toContain('secret')
  })

  const variantAfterGate = async (container: HTMLElement) => {
    await waitFor(() => expect(container.querySelector('[data-route-skeleton]')).toBeTruthy())
    return container.querySelector('[data-route-skeleton]')!.getAttribute('data-route-skeleton')
  }

  it('chooses the skeleton that matches the route', async () => {
    useAuthMock.mockReturnValue(loading)
    pathnameMock.mockReturnValue('/analytics')
    const { container } = render(<AppLayout>x</AppLayout>)
    expect(await variantAfterGate(container)).toBe('analytics')
  })

  it('prefers the longer prefix, so a record is not shown a list', async () => {
    // `/applications/123` matches both `/applications/` and `/applications`,
    // and a record shown a table outline resolves into something a different
    // shape -- the exact jump a skeleton exists to prevent.
    useAuthMock.mockReturnValue(loading)
    pathnameMock.mockReturnValue('/applications/123')
    const { container } = render(<AppLayout>x</AppLayout>)
    expect(await variantAfterGate(container)).toBe('detail')
  })

  it('falls back to a plausible outline on a route it does not know', async () => {
    useAuthMock.mockReturnValue(loading)
    pathnameMock.mockReturnValue('/something-new')
    const { container } = render(<AppLayout>x</AppLayout>)
    expect(await variantAfterGate(container)).toBe('dashboard')
  })

  it('shows nothing when signed out and NOT loading, because a redirect is in flight', () => {
    // A skeleton here would promise a page that is deliberately not coming.
    useAuthMock.mockReturnValue({ user: null, loading: false, signingOut: false })
    const { container } = render(<AppLayout>x</AppLayout>)
    expect(container.querySelector('[data-route-skeleton]')).toBeNull()
  })

  it('lets an expiry outrank the skeleton', () => {
    // An expiry arrives as `user === null` like every other signed-out state.
    // Telling somebody whose session just ended to wait for a page would be a
    // lie, so the dialog wins even while `loading` is true.
    useAuthMock.mockReturnValue({
      user: null,
      loading: true,
      signingOut: false,
      sessionExpired: true,
      acknowledgeSessionExpiry: vi.fn(),
    })
    const { container } = render(<AppLayout>x</AppLayout>)
    expect(container.querySelector('[data-route-skeleton]')).toBeNull()
  })
})
