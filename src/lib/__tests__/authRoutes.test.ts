import { describe, it, expect } from 'vitest'
import {
  decideRoute,
  isPrivatePath,
  redirectsWhenSignedIn,
  safeNextPath,
} from '../authRoutes'

describe('which routes need a session', () => {
  it('covers every screen behind the app shell, including child routes', () => {
    for (const path of [
      '/overview',
      '/applications',
      '/applications/abc-123',
      '/planner',
      '/documents',
      '/documents/templates',
      '/cv',
      '/analytics',
      '/settings',
    ]) {
      expect(isPrivatePath(path), path).toBe(true)
    }
  })

  it('leaves the public surface alone', () => {
    // None of these needs a session to READ. `/` and the auth pages move a
    // signed-in visitor along, which is a different rule -- see below -- and
    // not a reason to demand a session from a signed-out one.
    for (const path of ['/', '/privacy', '/login', '/signup', '/demo/overview']) {
      expect(isPrivatePath(path), path).toBe(false)
    }
  })

  it('does not treat a lookalike prefix as private', () => {
    // `/settings-export` is not under `/settings`, and a naive `startsWith`
    // would have locked it. There is no such route today; the guard is for the
    // day somebody adds one.
    expect(isPrivatePath('/settingsomething')).toBe(false)
    expect(isPrivatePath('/cvs')).toBe(false)
    expect(redirectsWhenSignedIn('/loginhelp')).toBe(false)
  })
})

describe('which routes move a signed-in visitor along', () => {
  it('is the landing page and the two auth pages', () => {
    for (const path of ['/', '/login', '/signup']) {
      expect(redirectsWhenSignedIn(path), path).toBe(true)
    }
  })

  it('does not swallow the whole app now that `/` is in the list', () => {
    // THE TEST THIS FILE EXISTS FOR. Every path starts with `/`, so a prefix
    // list containing `/` is one `startsWith` away from redirecting every
    // route in the app to the dashboard -- including the dashboard, which is
    // a redirect loop. The match is `=== '/'` or `startsWith('//')`, and
    // nothing here is either.
    for (const path of [
      '/privacy',
      '/demo/overview',
      '/overview',
      '/applications/abc-123',
      '/settings',
    ]) {
      expect(redirectsWhenSignedIn(path), path).toBe(false)
    }
  })
})

describe('decideRoute', () => {
  it('sends a signed-out visitor to sign in, carrying where they were going', () => {
    expect(decideRoute('/applications', false).redirectTo).toBe(
      '/login?next=%2Fapplications'
    )
  })

  it('keeps the query string on the way through', () => {
    // A deep link like /applications?application=<id> must survive the round
    // trip, or signing in drops the thing the link was for.
    expect(decideRoute('/applications', false, '?application=abc').redirectTo).toBe(
      '/login?next=%2Fapplications%3Fapplication%3Dabc'
    )
  })

  it('sends a signed-in visitor off the auth pages', () => {
    expect(decideRoute('/login', true).redirectTo).toBe('/overview')
    expect(decideRoute('/signup', true).redirectTo).toBe('/overview')
  })

  it('sends a signed-in visitor off the landing page too', () => {
    // Gabe, 2026-09-11. This file used to assert the opposite -- that `/` was
    // left to a client-side redirect -- so that the marketing route could stay
    // static. It is still static for everyone signed out; what changed is that
    // a signed-in visitor no longer watches the pitch paint and then vanish.
    expect(decideRoute('/', true).redirectTo).toBe('/overview')
  })

  it('still serves the landing page to everyone signed out', () => {
    expect(decideRoute('/', false).redirectTo).toBeNull()
  })

  it('lets everyone through where the answer does not depend on a session', () => {
    expect(decideRoute('/applications', true).redirectTo).toBeNull()
    expect(decideRoute('/login', false).redirectTo).toBeNull()
    expect(decideRoute('/privacy', true).redirectTo).toBeNull()
    expect(decideRoute('/privacy', false).redirectTo).toBeNull()
    expect(decideRoute('/demo/overview', false).redirectTo).toBeNull()
  })
})

describe('safeNextPath', () => {
  it('accepts an ordinary app path', () => {
    expect(safeNextPath('/applications')).toBe('/applications')
    expect(safeNextPath('/applications?application=abc-123')).toBe(
      '/applications?application=abc-123'
    )
  })

  it('refuses anything that leaves this origin', () => {
    // `?next=` is in a URL somebody can send you, so it is attacker-controlled
    // by construction. Every one of these is a valid navigation target to a
    // browser and none of them is this app.
    for (const hostile of [
      'https://evil.com',
      '//evil.com',
      '/\\evil.com',
      'javascript:alert(1)',
      'evil.com',
      '',
    ]) {
      expect(safeNextPath(hostile), hostile).toBeNull()
    }
  })

  it('refuses nothing at all', () => {
    expect(safeNextPath(null)).toBeNull()
    expect(safeNextPath(undefined)).toBeNull()
  })
})
