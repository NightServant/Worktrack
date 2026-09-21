/**
 * `fetch` with the caller's Supabase session attached.
 *
 * Every route under /api costs something to serve -- an LLM allowance, an
 * Apify balance, CPU -- so every one of them is authenticated, and every one
 * needs the token. This is that one place: without it each caller grows its own
 * `getSession()` dance, and the one that forgets does not fail loudly, it
 * just starts 401ing after a change nobody connected to it.
 *
 * The header name and shape are the ones the app has always used -- the Deno
 * functions these routes replaced read the same `Authorization: Bearer
 * <token>` -- so the app has one answer to "how does a request prove who it
 * is". Those functions are gone (2026-09-17); the convention outlived them.
 *
 * THE SUPABASE CLIENT IS IMPORTED LAZILY. `@/lib/supabase` constructs a real
 * client at module load and throws on an invalid URL, so a static import here
 * would drag that into every module that so much as mentions this helper --
 * including two test files that inject their own `fetchImpl` and never call it.
 * Deferring the import to the moment a request is actually made keeps the cost
 * where the work is.
 *
 * A MISSING SESSION IS NOT SHORT-CIRCUITED HERE. It would be tempting to
 * throw early, but the routes already return a 401 with a sentence worth
 * showing, and two places deciding what "signed out" means is how the two
 * come to disagree. The request goes out without the header and the server
 * answers.
 */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { supabase } = await import('./supabase')
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const headers = new Headers(init.headers)
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }
  return fetch(input, { ...init, headers })
}
