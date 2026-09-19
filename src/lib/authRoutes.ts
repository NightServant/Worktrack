/**
 * Which routes need a session, which refuse one, and where each sends you.
 *
 * A PURE FUNCTION, DELIBERATELY. The middleware around it does cookie work and
 * a network call to Supabase, neither of which is testable at speed; the
 * DECISION is a string and a boolean in, a destination or null out. Every rule
 * below is covered by a unit test, which is not true of anything that has to
 * be exercised through a real request.
 *
 * THREE KINDS OF ROUTE:
 *
 *   PRIVATE   -- the signed-in app. No session means /login, and the path that
 *                was asked for rides along as `?next=` so the sign-in can put
 *                the visitor where they were going rather than on a dashboard
 *                they did not ask for.
 *   SIGNED-IN  -- `/`, `/login` and `/signup`. A session means /overview: a
 *   ELSEWHERE     sign-in form whose only honest outcome is to put you back
 *                 where you already are is not worth showing, and neither is a
 *                 marketing page pitching a product you already have.
 *   PUBLIC     -- everything else, including `/privacy`, which a signed-in
 *                 person has an ordinary reason to read.
 *
 * `/` MOVED INTO THAT LIST ON 2026-09-11, reversing what this file said a few
 * hours earlier. The old reasoning was that redirecting `/` in middleware
 * would make a static marketing route dynamic for everyone and tax every
 * anonymous visitor to serve the minority who are signed in. That argument
 * stopped holding once the middleware gained its no-cookie short circuit: a
 * request with no session cookie is answered without a network call, and
 * middleware was already running on `/` regardless. The page itself is still
 * statically rendered and still served to everyone who is not signed in.
 *
 * What it replaces is a client-side redirect that could only fire AFTER the
 * landing page had painted -- so a signed-in visitor typing the bare domain
 * watched a marketing pitch appear and then vanish. Gabe asked for that frame
 * gone.
 */

/** Everything under these prefixes requires a session. */
const PRIVATE_PREFIXES = [
  '/overview',
  '/applications',
  '/planner',
  '/documents',
  '/cv',
  '/analytics',
  '/settings',
] as const

/**
 * Paths a signed-in visitor is moved off.
 *
 * `/login` and `/signup` exist to get you a session, so holding one makes them
 * pointless. `/` is the marketing pitch for a product you already have.
 *
 * `/` MATCHES EXACTLY AND NOTHING ELSE, which the comparison below already
 * guarantees but is worth saying out loud: the check is `=== prefix` or
 * `startsWith(prefix + '/')`, and for `/` that second form is `'//'` -- which
 * no ordinary path begins with. A naive `startsWith('/')` would have matched
 * every route in the app.
 */
const REDIRECT_WHEN_SIGNED_IN = ['/', '/login', '/signup'] as const

export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export function redirectsWhenSignedIn(pathname: string): boolean {
  return REDIRECT_WHEN_SIGNED_IN.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

/**
 * An app-relative path safe to send someone back to after signing in.
 *
 * THE OPEN-REDIRECT GUARD, and it is the reason this is a function rather than
 * a template string. `?next=` is attacker-controllable by construction -- it is
 * in a URL somebody can send you -- so `//evil.com` and `https://evil.com`,
 * both of which browsers happily treat as absolute, are refused. Only a single
 * leading slash followed by ordinary path characters survives.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith('/')) return null
  // `//host` and `/\host` are protocol-relative in enough browsers to matter.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  if (!/^\/[A-Za-z0-9/_\-.~%?&=+]*$/.test(raw)) return null
  return raw
}

export interface RouteDecision {
  /** Where to send them, or null to let the request through. */
  redirectTo: string | null
}

/**
 * The whole rule, in one place.
 *
 * `pathname` is the path being requested; `signedIn` is whether the cookies
 * carried a session Supabase accepted. Nothing else is consulted -- a decision
 * that depended on a header or a body would be a decision this could not test.
 */
export function decideRoute(
  pathname: string,
  signedIn: boolean,
  search = ''
): RouteDecision {
  if (isPrivatePath(pathname) && !signedIn) {
    // The destination travels with them, so signing in finishes the journey
    // they started rather than dropping them on the dashboard.
    const next = encodeURIComponent(`${pathname}${search}`)
    return { redirectTo: `/login?next=${next}` }
  }

  if (redirectsWhenSignedIn(pathname) && signedIn) {
    return { redirectTo: '/overview' }
  }

  return { redirectTo: null }
}
