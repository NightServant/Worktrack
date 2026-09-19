import { NextResponse, type NextRequest } from 'next/server'

import { decideRoute } from '@/lib/authRoutes'
import { createMiddlewareClient } from '@/lib/supabase/server'

/**
 * The auth gate, moved to where a decision can be made before a page is sent.
 *
 * WHAT THIS REPLACES. Every redirect in this app was a client-side correction
 * applied after something was already on screen: `(app)/layout.tsx` rendered
 * null and then pushed you to /login, the auth pages rendered a form and then
 * pushed you to /overview, and an inline `<script>` existed purely to beat
 * React to the punch on a full page load. Each had a window it could not
 * cover, and the last of them -- a client-side navigation into /login while
 * signed in -- is the bug Gabe reported.
 *
 * Middleware has no such window. The cookies arrive with the request, so the
 * wrong page is never generated.
 *
 * `getUser()`, NOT `getSession()`, and the distinction is the security of this
 * file. `getSession()` decodes whatever is in the cookie and hands it back
 * without asking anyone -- a forged cookie passes. `getUser()` sends the token
 * to Supabase, which verifies its signature. On a gate, the cheap one is not
 * an option.
 *
 * IT IS NOT THE ONLY GUARD AND MUST NOT BECOME IT. Row-level security on every
 * table and `authenticate()` in every API route are what actually protect
 * data; this decides which page to render. A middleware bug should cost a
 * redirect, never a row.
 *
 * THE COOKIE REFRESH IS THE OTHER HALF of what this buys. `getUser()` will
 * refresh an expired token, and `createMiddlewareClient` writes the new
 * cookies onto the response -- so a returning visitor's session is renewed by
 * the act of navigating, rather than on whenever the client happens to wake up.
 * That is why the response object is threaded through rather than created at
 * the end: the cookies have to be set on the object that is actually returned.
 */
export async function middleware(request: NextRequest) {
  // Created up front so the Supabase client can write refreshed cookies onto
  // it. Returning a different object at the end would drop them.
  const response = NextResponse.next({ request })

  // NO AUTH COOKIE MEANS NO NETWORK CALL. `getUser()` asks Supabase to verify
  // the token, which is a round trip -- and running it for every anonymous
  // visitor to the landing page would put one in front of a static marketing
  // route. A request carrying no `sb-*-auth-token` cookie cannot be signed in,
  // so the answer is already known.
  //
  // `@supabase/ssr` splits a large session across `…auth-token.0`, `.1`, so
  // the test is a prefix rather than an exact name.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name))

  if (!hasAuthCookie) {
    const { redirectTo } = decideRoute(
      request.nextUrl.pathname,
      false,
      request.nextUrl.search
    )
    if (!redirectTo) return response
    const url = request.nextUrl.clone()
    const [pathname, query] = redirectTo.split('?')
    url.pathname = pathname
    url.search = query ? `?${query}` : ''
    return NextResponse.redirect(url)
  }

  const supabase = createMiddlewareClient(request, response)

  // NOT CONFIGURED IS NOT SIGNED OUT. A deployment missing its Supabase
  // variables would otherwise redirect every private route to /login, which
  // reads as "your session expired" rather than "this build is broken". Let
  // the request through; the screen behind it has its own error state.
  if (!supabase) return response

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { redirectTo } = decideRoute(
    request.nextUrl.pathname,
    Boolean(user),
    request.nextUrl.search
  )

  if (redirectTo) {
    const url = request.nextUrl.clone()
    const [pathname, query] = redirectTo.split('?')
    url.pathname = pathname
    url.search = query ? `?${query}` : ''
    // `redirect`, not `rewrite`: the address bar should say where you ended
    // up, and Back should not return to a page that will bounce again.
    const redirect = NextResponse.redirect(url)
    // Carry the refreshed cookies onto the redirect, or a token renewed on
    // this pass is thrown away and the next request refreshes it again.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie)
    }
    return redirect
  }

  return response
}

export const config = {
  /**
   * NODE, NOT EDGE, AND IT IS LOAD-BEARING IN BOTH DIRECTIONS.
   *
   * Required because vercel.json uses `services`, which reject Edge Function
   * output -- with this line absent the deploy fails the build. But this line
   * ALONE, without `experimental.nodeMiddleware` in next.config.ts, makes Next
   * 15.5 emit no middleware whatsoever while still reporting success: no
   * build error, no `ƒ Middleware` in the summary, and no auth gate in front
   * of any private route.
   *
   * The two settings are a pair. See next.config.ts for the full account.
   */
  runtime: 'nodejs',
  /**
   * Everything except static assets and images.
   *
   * `_next/static`, `_next/image` and the file extensions below are served
   * without a session check because they have nothing to protect and running
   * `getUser()` against Supabase for every font and icon would add a network
   * round trip to each one.
   *
   * `/api` IS DELIBERATELY INCLUDED but decides nothing: `decideRoute` returns
   * null for it, so the only thing that happens is the cookie refresh. Those
   * routes do their own `authenticate()` and must keep doing it -- a route
   * that trusted middleware to have checked would be unprotected the day the
   * matcher changed.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|woff2?)$).*)',
  ],
}
