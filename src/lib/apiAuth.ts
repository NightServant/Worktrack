import { createClient } from '@supabase/supabase-js'
import { currentEnvSource, readSupabaseConfig } from './env'
import { logSecurityEvent } from './securityLog'

/**
 * Who is calling one of this app's API routes.
 *
 * WHY THESE ROUTES NEEDED IT. `/api/tailor` spends a metered LLM allowance,
 * `/api/autofill` and `/api/jobfeed` reach a service that can spend an Apify
 * balance, and `/api/cv/docx` spends CPU. They shipped unauthenticated, which
 * means anyone who found the path could drain a paid allowance from a curl
 * loop. Nothing about them is public -- every one exists to serve a signed-in
 * user -- so the gate is simply the one that was missing.
 *
 * (This paragraph used to lead with `/api/latex/compile` and FormaTeX quota.
 * Both are gone: the LaTeX editor went on 2026-09-13 and the compiler with
 * it. The rule did not change, only the examples, which is the way a docblock
 * usually goes wrong.)
 *
 * THE SCHEME IS THE ONE THE APP ALREADY USES, not a new one. `WordResumeEditor`
 * has always sent `Authorization: Bearer <session.access_token>`, first to the
 * Deno functions these routes replaced and now to the routes themselves, which
 * read the same header and validate it the same way -- so there is one answer
 * to "how does a Worktrack request prove who it is" rather than two.
 *
 * VALIDATED, NOT DECODED. `getUser(token)` asks Supabase to verify the
 * signature and expiry. Reading the JWT's claims locally would accept any
 * well-formed token, including one the caller wrote, which is not
 * authentication -- it is a formality that looks like one.
 *
 * EVERY REFUSAL IS LOGGED (2026-09-15), and until now none of them was. A 401
 * went back to the caller and left no trace on the server, which means a
 * thousand of them left no trace either -- so "log authentication attempts so
 * suspicious behaviour can be detected" was unmet in the one place every API
 * route funnels through. The event carries the route and a short reason and
 * NEVER the token or an email; see lib/securityLog for why the second matters
 * as much as the first.
 *
 * SUCCESSES ARE NOT LOGGED. A line per authorised request is the application's
 * ordinary traffic written twice, and it buries the refusals in it. The
 * interesting signal here is the rate of failure, which needs only failures.
 */
export interface ApiCaller {
  id: string
  email: string | null
}

export type AuthResult =
  | { ok: true; user: ApiCaller }
  | { ok: false; status: 401 | 503; message: string }

function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!header) return null
  const [scheme, token] = header.split(/\s+/, 2)
  // Case-insensitive per RFC 7235; some clients send "bearer".
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null
  return token.trim() || null
}

export async function authenticate(request: Request): Promise<AuthResult> {
  // The path only. A full URL carries a query string, and this app puts job
  // ids in one.
  const route = (() => {
    try {
      return new URL(request.url).pathname
    } catch {
      return 'unknown'
    }
  })()

  const config = readSupabaseConfig(currentEnvSource())
  if (!config.isConfigured) {
    // 503, not 401: the caller did nothing wrong and retrying with a better
    // token will not help. A misconfigured deployment must not read as a
    // rejected user.
    logSecurityEvent({ kind: 'config.missing', route, reason: 'supabase-unconfigured', status: 503 })
    return {
      ok: false,
      status: 503,
      message: 'This deployment has no Supabase configuration, so it cannot verify who is calling.',
    }
  }

  const token = bearerFrom(request)
  if (!token) {
    logSecurityEvent({ kind: 'auth.rejected', route, reason: 'no-bearer-token', status: 401 })
    return { ok: false, status: 401, message: 'Sign in to use this.' }
  }

  // A per-request client with no session persistence: this runs on a shared
  // server, and a client that remembered the last caller's session would be a
  // way for one user's token to answer another user's request.
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  try {
    const { data, error } = await client.auth.getUser(token)
    if (error || !data.user) {
      // `invalid-token` and not the provider's own message: that string is
      // Supabase's to change, and an error body copied into a log is how an
      // upstream's diagnostics end up in a drain nobody audited.
      logSecurityEvent({ kind: 'auth.rejected', route, reason: 'invalid-token', status: 401 })
      return { ok: false, status: 401, message: 'That session is not valid. Sign in again.' }
    }
    return { ok: true, user: { id: data.user.id, email: data.user.email ?? null } }
  } catch {
    // Supabase unreachable. Failing CLOSED is the only safe direction on an
    // endpoint that spends money -- an outage must not become an open door.
    //
    // Logged under its OWN kind rather than as a rejection: a spike of these
    // is an outage and a spike of rejections is an attack, and a dashboard
    // that cannot tell them apart will page somebody for the wrong reason.
    logSecurityEvent({ kind: 'auth.unavailable', route, reason: 'verify-failed', status: 503 })
    return { ok: false, status: 503, message: 'Could not verify your session. Try again shortly.' }
  }
}
