import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const readSupabaseConfig = vi.hoisted(() => vi.fn())
vi.mock('@/lib/env', () => ({ currentEnvSource: () => ({}), readSupabaseConfig }))

const authState = vi.hoisted(() => ({
  current: { user: null as { id: string } | null, loading: false },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authState.current }))

import { SessionAttributeScript } from '../SessionAttributeScript'
import { SessionAttributeSync } from '../SessionAttributeSync'
import { HomeOrDashboardLink } from '../HomeOrDashboardLink'

beforeEach(() => {
  readSupabaseConfig.mockReturnValue({
    isConfigured: true,
    url: 'https://somyuulytwgzltiboewm.supabase.co',
    anonKey: 'anon',
  })
  authState.current = { user: null, loading: false }
  // COOKIES LEAK BETWEEN TESTS. jsdom shares one `document.cookie` for the
  // whole file, so a session cookie set by one case was still present in the
  // next and made "leaves the document unmarked" fail. localStorage was
  // cleared per-test before the move to cookies; this is the equivalent.
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`
  }
  document.documentElement.removeAttribute('data-session')
  document.documentElement.removeAttribute('data-session')
})

describe('marking the document before it paints', () => {
  it('reads the session COOKIE, which is where the session lives now', () => {
    // It read localStorage until 2026-09-11, when the session moved to cookies
    // so middleware could see it. `document.cookie` is just as synchronous, so
    // the before-paint trick survives; only the source changed.
    const { container } = render(<SessionAttributeScript />)
    const script = container.querySelector('[data-session-attribute]')
    expect(script).toBeTruthy()
    expect(script!.innerHTML).toContain('document.cookie')
    expect(script!.innerHTML).not.toContain('localStorage')
    expect(script!.innerHTML).toContain('sb-somyuulytwgzltiboewm-auth-token')
    expect(script!.innerHTML).toContain('setAttribute("data-session","live")')
  })

  it('actually sets the attribute when a session cookie is present', () => {
    // The assertion above checks the text; this runs it. A script that reads
    // correctly and does nothing is the failure a substring match misses.
    document.cookie = 'sb-somyuulytwgzltiboewm-auth-token=base64-abc; Path=/'
    const { container } = render(<SessionAttributeScript />)
    const source = container.querySelector('[data-session-attribute]')!.innerHTML
    new Function(source)()
    expect(document.documentElement.getAttribute('data-session')).toBe('live')
    window.localStorage.clear()
  })

  it('leaves the document unmarked when there is no session cookie', () => {
    const { container } = render(<SessionAttributeScript />)
    new Function(container.querySelector('[data-session-attribute]')!.innerHTML)()
    expect(document.documentElement.hasAttribute('data-session')).toBe(false)
  })

  it('renders nothing when Supabase is not configured', () => {
    readSupabaseConfig.mockReturnValue({ isConfigured: false, url: '', anonKey: '' })
    const { container } = render(<SessionAttributeScript />)
    expect(container.querySelector('[data-session-attribute]')).toBeNull()
  })

  it('refuses a project ref that is not a plain identifier', () => {
    // The only interpolated value in a dangerouslySetInnerHTML string.
    readSupabaseConfig.mockReturnValue({
      isConfigured: true,
      url: 'https://evil").concat(alert(1)).concat(".supabase.co',
      anonKey: 'anon',
    })
    const { container } = render(<SessionAttributeScript />)
    expect(container.querySelector('[data-session-attribute]')).toBeNull()
  })
})

describe('keeping the mark honest afterwards', () => {
  it('removes it once the session is known not to exist', async () => {
    // The pre-paint script believes a token that expired while the tab was
    // closed. This is the half that can say no.
    document.documentElement.setAttribute('data-session', 'live')
    authState.current = { user: null, loading: false }
  // COOKIES LEAK BETWEEN TESTS. jsdom shares one `document.cookie` for the
  // whole file, so a session cookie set by one case was still present in the
  // next and made "leaves the document unmarked" fail. localStorage was
  // cleared per-test before the move to cookies; this is the equivalent.
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`
  }
  document.documentElement.removeAttribute('data-session')
    render(<SessionAttributeSync />)
    await waitFor(() =>
      expect(document.documentElement.hasAttribute('data-session')).toBe(false)
    )
  })

  it('does NOT strip it while the session is still being read', async () => {
    // The context reports `user: null` while loading. Acting on that would
    // undo the script and produce the exact flicker it exists to prevent,
    // only in the other direction.
    document.documentElement.setAttribute('data-session', 'live')
    authState.current = { user: null, loading: true }
    render(<SessionAttributeSync />)
    await Promise.resolve()
    expect(document.documentElement.getAttribute('data-session')).toBe('live')
  })

  it('sets it for a sign-in that happens while the page is open', async () => {
    authState.current = { user: { id: 'u1' }, loading: false }
    render(<SessionAttributeSync />)
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-session')).toBe('live')
    )
  })
})

describe('the way out of a public document', () => {
  it('offers both destinations, each tagged with who it is for', () => {
    render(<HomeOrDashboardLink />)
    const home = screen.getByRole('link', { name: /Back to the home page/i })
    const dashboard = screen.getByRole('link', { name: /Back to the overview/i })
    expect(home).toHaveAttribute('href', '/')
    expect(home).toHaveAttribute('data-when-signed-out')
    expect(dashboard).toHaveAttribute('href', '/overview')
    expect(dashboard).toHaveAttribute('data-when-signed-in')
  })

  it('is hidden and revealed by CSS, not by a React branch', () => {
    // THE RULES ARE THE MECHANISM. Both links are in the DOM on purpose -- it
    // is what lets the right one be on screen at the first paint instead of
    // after `useAuth()` resolves. Without these three declarations the page
    // simply shows two buttons, and every assertion above still passes.
    const css = readFileSync('src/index.css', 'utf8')

    // Hidden by default, and UNLAYERED: Tailwind's `utilities` layer is
    // ordered last, so a `display: none` written inside a layer loses to the
    // `inline-flex` on a button.
    expect(css).toMatch(/^\[data-when-signed-in\]\s*\{\s*display:\s*none;/m)
    expect(css).toMatch(
      /^:root\[data-session='live'\]\s\[data-when-signed-in\]\s*\{\s*display:\s*revert-layer;/m
    )
    expect(css).toMatch(
      /^:root\[data-session='live'\]\s\[data-when-signed-out\]\s*\{\s*display:\s*none;/m
    )
  })

  it('names the same storage the mark is read from', () => {
    // Belt and braces across the two halves: the script writes `data-session`
    // and the stylesheet reads it. A rename on either side is silent.
    const css = readFileSync('src/index.css', 'utf8')
    const { container } = render(<SessionAttributeScript />)
    const script = container.querySelector('[data-session-attribute]')!.innerHTML
    expect(script).toContain('data-session')
    expect(css).toContain("[data-session='live']")
  })
})

// The `hasLiveSession` block that stood here is gone with the function
// (2026-09-11). It existed so the redirect script and the attribute script
// could be shown to share one rule; there is only one script now, and the
// redirect it used to serialise is `src/middleware.ts`, which asks Supabase to
// verify the token rather than reading an expiry out of the browser.
