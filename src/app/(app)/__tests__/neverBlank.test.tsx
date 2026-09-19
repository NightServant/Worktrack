import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

/**
 * No state of the authenticated layout is ever a blank page.
 *
 * WRITTEN AS A MATRIX BECAUSE THE BUG CAME BACK TWICE. Gabe reported a blank
 * page three times. The first two fixes were real improvements to states that
 * were not the one he was seeing, and each shipped with a test that passed
 * while the screen was still white -- because each asserted on a MECHANISM
 * ("the skeleton renders", "the guard holds") rather than on the only thing
 * that was ever wrong: whether a person looking at the screen can see
 * anything.
 *
 * So this enumerates every state this layout can be in and asserts one thing
 * about each. A future state added to the guard that renders `null` fails
 * here the moment somebody writes it, which is the only way this stops
 * recurring.
 *
 * VISIBLE TEXT, not element counts: a wrapper div with nothing in it is still
 * a blank page.
 */

const st: Record<string, unknown> = {}
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => st }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/overview',
}))
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import AppLayout from '../layout'

const setState = (state: Record<string, unknown>) => {
  for (const k of Object.keys(st)) delete st[k]
  Object.assign(st, { loading: false, user: null, signingOut: false, ...state })
}

/** Everything a person could actually read, however it is nested. */
const onScreen = () => {
  const { baseElement } = render(<AppLayout>THE PAGE</AppLayout>)
  return (baseElement.textContent ?? '').replace(/\s+/g, ' ').trim()
}

beforeEach(() => setState({}))

describe('every state of the authenticated layout shows something', () => {
  const STATES: Array<[string, Record<string, unknown>]> = [
    ['auth still resolving (cold load, refresh, hard refresh)', { loading: true }],
    ['signed in', { user: { id: 'u' } }],
    ['signing out', { signingOut: true }],
    ['signed out, being sent to /login', {}],
    [
      'session expired',
      { sessionExpired: true, acknowledgeSessionExpiry: () => {} },
    ],
  ]

  it.each(STATES)('%s is not blank', (_name, state) => {
    setState(state)
    expect(onScreen().length).toBeGreaterThan(0)
  })

  it('tells the reader which direction they are going', () => {
    // One shared "please wait" would be worse than none on the way OUT:
    // somebody who pressed sign out and reads "signing you in" will think
    // they pressed the wrong control.
    setState({ signingOut: true })
    expect(onScreen()).toMatch(/signing you out/i)

    setState({})
    expect(onScreen()).toMatch(/sign in/i)
  })

  it('does not leak the private page in any state without a user', () => {
    // The states differ in what they SHOW; none of them may show the route.
    for (const state of [{ loading: true }, { signingOut: true }, {}]) {
      setState(state)
      expect(onScreen()).not.toContain('THE PAGE')
    }
  })

  it('puts the cold-load state in the SERVER html, not only the browser', () => {
    /*
      The one state that must survive SSR, and the reason is the bug that
      started this: a loading state built from `useState` plus an effect
      renders as nothing in the delivered document, so the page is blank for
      the whole of the network round trip it was meant to cover.

      The other states are unreachable on the server -- signing out and
      expiring are both things that happen to a page already open -- so they
      are asserted in the browser above and not here.
    */
    setState({ loading: true })
    expect(renderToString(<AppLayout>THE PAGE</AppLayout>)).toContain('data-route-skeleton')
  })
})
