import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { capabilitiesOf, readIntegrationConfig } from '@/services/integrations/config'
import { writeCvProse } from '@/services/integrations/cvWriter'
import { EMPTY_PROFILE, normalizeProfile, type UserProfile } from '@/services/profile'

/**
 * A model writing the prose for a new CV.
 *
 * WHY IT IS A ROUTE AND NOT A CLIENT CALL: the provider key is a server
 * secret, the same reason `/api/tailor` exists. The profile travels up rather
 * than being read from the database here, because the client already holds it
 * and a second read would be a second chance for the two to disagree.
 *
 * IT IS ALWAYS OPTIONAL, WHICH IS THE WHOLE CONTRACT. Every failure -- not
 * configured, switched off, rate limited, nonsense reply -- returns a body the
 * caller treats the same way: fall back to the deterministic composer and make
 * the CV anyway. Nothing on this path may stop a document being created, so
 * nothing on this path returns a status the caller has to special-case.
 *
 * `runtime = 'nodejs'`: this waits on a large model over a free tier, which is
 * a poor fit for an edge budget.
 */
export const runtime = 'nodejs'

export async function POST(request: Request) {
  // Authenticated before anything is spent, like every other route that costs
  // a provider call.
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, reason: 'unauthorized', message: auth.message },
      { status: auth.status }
    )
  }

  const config = readIntegrationConfig()
  if (!capabilitiesOf(config).writeCv) {
    // 200, NOT 501, and that is the difference between this route and
    // `/api/tailor`. Tailoring is a feature somebody asked for and is owed an
    // explanation when it is off; this one runs on the way to creating a
    // document that is going to be created either way. An error status here
    // would put a failure in the console of every CV made on a deployment
    // with no key, describing a thing that did not fail.
    return NextResponse.json({
      ok: false,
      reason: 'disabled',
      message: 'No CV model is configured, so the CV was written without one.',
    })
  }

  let body: { profile?: unknown }
  try {
    body = (await request.json()) as { profile?: unknown }
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'bad-response', message: 'Invalid JSON.' },
      { status: 400 }
    )
  }

  // NORMALISED, NOT CAST. This is a client-supplied object shaped like a
  // profile; `normalizeProfile` is what makes every record complete before
  // anything reads `.length` on it.
  const profile: UserProfile =
    normalizeProfile((body.profile ?? null) as Partial<UserProfile> | null) ?? EMPTY_PROFILE

  const result = await writeCvProse(profile, { config })
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason, message: result.message })
  }
  return NextResponse.json({ ok: true, prose: result.data })
}
