import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { readIntegrationConfig, capabilitiesOf, configProblems } from '@/services/integrations/config'
import { tailorCv, type TailoringInput } from '@/services/integrations/tailoring'
import { MAX_TERMS } from '@/services/atsMatch'

/**
 * The server side of AI CV tailoring.
 *
 * IT EXISTS SO THE KEY DOES NOT REACH THE BROWSER. `tailorCv` needs a bearer
 * token for whichever OpenAI-compatible provider is configured, and a token
 * shipped to the client is a token anyone can read out of the network tab and
 * spend. `TAILORING_API_KEY` is deliberately NOT prefixed `NEXT_PUBLIC_`, so
 * Next will not inline it into the bundle even by accident -- the rails call
 * this route instead.
 *
 * `runtime = 'nodejs'` rather than edge: the request holds a whole CV and a
 * whole posting and can take tens of seconds against a free tier, which is a
 * poor fit for an edge function's shorter budget.
 */
export const runtime = 'nodejs'

/** A CV and a posting are both long, but neither is megabytes. */
const MAX_CHARS = 24_000

export async function POST(request: Request) {
  // Authenticated before anything is spent. These routes cost money per
  // call, so the check comes first -- before parsing the body, before reading
  // config, before any upstream request.
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, reason: 'unauthorized', message: auth.message }, {
      status: auth.status,
    })
  }

  const config = readIntegrationConfig()
  if (!capabilitiesOf(config).tailorCv) {
    // 501, not 500: nothing is broken, the capability was never configured,
    // and the UI says "set these variables" rather than "something failed".
    //
    // TWO DIFFERENT FAULTS SHARE THIS BRANCH, and until now they shared one
    // sentence. "Never set up" is fixed by setting the three variables;
    // "set up wrong" -- the base URL and the model transposed, which is what
    // `configProblems` was written for -- leaves all three NON-EMPTY, so the
    // old message told the operator to do the one thing they had already
    // done. `configProblems` is the only thing that can tell them apart, and
    // it was being computed nowhere.
    const problems = configProblems(config)
    if (problems.length) {
      // Server-side, not in the response: a problem string quotes the value it
      // objected to, and that is deployment configuration rather than
      // something a signed-in user asked for. `console.*` reaches Vercel
      // Runtime Logs, which is this app's whole logging story -- see
      // lib/securityLog for why that is deliberate. The API key is never part
      // of a problem string, and must not become one.
      console.warn(JSON.stringify({ at: 'integrations', route: '/api/tailor', problems }))
    }
    return NextResponse.json(
      {
        ok: false,
        reason: 'unconfigured',
        // THREE FAULTS NOW, and the third one has a complete config: a
        // deployment can be told not to spend the shared provider key
        // (`TAILORING_ENABLED=false`, which Preview carries so a branch
        // cannot burn production's free-tier quota). Telling that operator to
        // set three variables they have already set is the same mistake the
        // comment above this one was written about, so it is checked first.
        message: config.tailoring.enabled === false
          ? 'AI tailoring is switched off on this deployment (TAILORING_ENABLED=false).'
          : problems.length
            ? 'AI tailoring is misconfigured on the server. The deployment logs name the problem.'
            : 'AI tailoring is not configured. Set TAILORING_BASE_URL, TAILORING_API_KEY and TAILORING_MODEL.',
      },
      { status: 501 }
    )
  }

  let body: Partial<TailoringInput>
  try {
    body = (await request.json()) as Partial<TailoringInput>
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-response', message: 'Invalid JSON.' }, { status: 400 })
  }

  const cvText = String(body.cvText ?? '').slice(0, MAX_CHARS)
  const jobDescription = String(body.jobDescription ?? '').slice(0, MAX_CHARS)
  if (!cvText.trim() || !jobDescription.trim()) {
    return NextResponse.json(
      { ok: false, reason: 'bad-response', message: 'Tailoring needs both a CV and a job description.' },
      { status: 400 }
    )
  }

  const result = await tailorCv(
    {
      cvText,
      jobDescription,
      // BOUNDED BY THE THING THAT PRODUCES IT, not by a number of its own.
      //
      // This was `slice(0, 40)`. `matchKeywords` already caps a posting at
      // `MAX_TERMS`, so `missing` cannot exceed that -- and where a posting
      // and CV are far apart, `missing` is most of it. Measured on a
      // mid-level front-end advert: 65 terms missing, 40 forwarded, 25
      // dropped, and three of the dropped ones were the only terms in the
      // whole list the CV could honestly have answered. The model was being
      // denied the actionable tail to save a hundred short words next to a
      // body that already carries 24,000 characters of CV and posting.
      missingKeywords: Array.isArray(body.missingKeywords)
        ? body.missingKeywords.slice(0, MAX_TERMS).map(String)
        : undefined,
      role: body.role ? String(body.role) : undefined,
      company: body.company ? String(body.company) : undefined,
    },
    { config }
  )

  // `tailorCv` never throws, so every outcome is a value with a reason on it.
  // A rate-limited free tier is 429 so the client can say "try again shortly"
  // rather than "something went wrong".
  const status = result.ok ? 200 : result.reason === 'rate-limit' ? 429 : result.reason === 'auth' ? 502 : 400
  return NextResponse.json(result, { status })
}
