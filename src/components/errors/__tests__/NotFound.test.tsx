import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NotFound } from '../NotFound'

const useAuthMock = vi.hoisted(() => vi.fn())
vi.mock('@/contexts/AuthContext', () => ({ useAuth: useAuthMock }))
vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }),
}))

const signedOut = () => useAuthMock.mockReturnValue({ user: null, loading: false })
const signedIn = () => useAuthMock.mockReturnValue({ user: { id: 'u1' }, loading: false })
const resolving = () => useAuthMock.mockReturnValue({ user: null, loading: true })

beforeEach(() => useAuthMock.mockReset())

describe('the 404 page', () => {
  it('says what happened without pretending it is an error the visitor caused', () => {
    signedOut()
    render(<NotFound />)
    expect(
      screen.getByRole('heading', { name: 'this page has moved on.' })
    ).toBeInTheDocument()
  })

  it('draws 404 at the display scale, in the accent, as the frame does', () => {
    // The first version rendered this as an 11px Label/Caps eyebrow in grey --
    // five times too small and the wrong colour. Figma 37:352 is Display/XL,
    // 56px, accent/default: the largest element on the page and the only thing
    // carrying colour.
    signedOut()
    const { container } = render(<NotFound />)
    const code = [...container.querySelectorAll('p')].find((p) => p.textContent === '404')
    expect(code, 'the 404 code is not rendered').toBeTruthy()
    expect(code!.className).toContain('text-display-xl')
    expect(code!.className).toContain('text-accent-default')
    expect(code!.className).not.toContain('text-label-caps')
  })

  it('does not guess what the visitor was looking for', () => {
    // A 404 that names the requested path reflects unsanitised URL input back
    // into the document. Nothing here reads the location at all.
    signedOut()
    render(<NotFound />)
    expect(document.body.textContent).not.toMatch(/localhost|https?:\/\//i)
  })

  it('carries no site footer, which would be a second navigation', () => {
    signedOut()
    render(<NotFound />)
    expect(screen.queryByRole('link', { name: /^source$/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /^privacy$/i })).toBeNull()
  })
})

describe('the 404 recovery button, which depends on the session', () => {
  it('sends a signed-OUT visitor home, and offers nothing else', () => {
    // Gabe's rule, 2026-09-03. It overrides the frame, which draws three
    // recovery links to private routes -- every one of which bounces a
    // signed-out visitor to /login, so the page that exists to unstick them
    // would hand them a second wall.
    signedOut()
    render(<NotFound />)

    const cta = screen.getByRole('link', { name: /Back to the home page/i })
    expect(cta).toHaveAttribute('href', '/')
    expect(cta).toHaveAttribute('data-variant', 'primary')

    expect(screen.queryByRole('link', { name: /overview/i })).toBeNull()
    expect(document.querySelectorAll('[data-cta]')).toHaveLength(1)
  })

  it('sends a signed-IN visitor to the dashboard, with no home link at all', () => {
    // The home link is dropped on purpose: somebody with an account who hits a
    // broken link wants their own data back, not the marketing page.
    signedIn()
    render(<NotFound />)

    const cta = screen.getByRole('link', { name: /Return to dashboard/i })
    expect(cta).toHaveAttribute('href', '/overview')
    expect(cta).toHaveAttribute('data-variant', 'primary')

    expect(screen.queryByRole('link', { name: /Back to the home page/i })).toBeNull()
    expect(document.querySelectorAll('[data-cta]')).toHaveLength(1)
  })

  it('shows no button at all until the session has resolved', () => {
    // supabase-js reads the session from localStorage asynchronously, so the
    // first render never knows. Rendering the signed-out button and swapping it
    // would flash the wrong destination for every signed-in visitor -- and it
    // would be clickable during the flash.
    resolving()
    render(<NotFound />)
    expect(document.querySelectorAll('[data-cta]')).toHaveLength(0)
  })

  it('holds the button slot open while it resolves, so nothing jumps', () => {
    // Positive companion to the above: without a reserved height, the rule and
    // the eyebrow above it move 40px on every load the moment auth answers.
    resolving()
    const { container } = render(<NotFound />)
    const slot = container.querySelector('.min-h-10')
    expect(slot, 'the button slot reserves no height').not.toBeNull()
  })
})
