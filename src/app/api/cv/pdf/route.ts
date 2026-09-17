import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/apiAuth'
import { buildPdf } from '@/services/integrations/pdfExport'

/**
 * PDF export for the CV editor.
 *
 * MOVED HERE FROM A SUPABASE EDGE FUNCTION (2026-09-15), which is where the
 * "Export failed / Failed to fetch" came from: the function launched headless
 * Chromium against a runtime capped at 256MB of memory and 20MB of bundle, so
 * it was never deployable and never deployed. The browser called a function
 * that did not exist, and the platform's 404 fails CORS preflight -- which
 * surfaces as a TypeError with no status to report.
 *
 * `runtime = 'nodejs'`, and NO `maxDuration`: `buildPdf` lays the document out
 * in JavaScript rather than booting a browser, so it is the same order of work
 * as the docx and latex exports beside it. See `pdfExport` for why there is no
 * browser here any more.
 */
export const runtime = 'nodejs'

/** A CV is a few pages of JSON. Matches `/api/cv/docx`. */
const MAX_BYTES = 2_000_000

/** Safe for a Content-Disposition header and for every filesystem. */
function safeFileName(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return base || 'cv'
}

export async function POST(request: Request) {
  // Authenticated before anything is spent. Booting a browser is the most
  // expensive thing this app does per request, so the check comes first.
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, reason: 'unauthorized', message: auth.message }, {
      status: auth.status,
    })
  }

  let body: { title?: unknown; content?: unknown; naturalLineHeight?: unknown }
  try {
    const raw = await request.text()
    if (raw.length > MAX_BYTES) {
      return NextResponse.json({ error: 'That document is too large.' }, { status: 413 })
    }
    body = JSON.parse(raw) as { title?: unknown; content?: unknown; naturalLineHeight?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const title = typeof body.title === 'string' ? body.title : 'CV'
  if (!body.content || typeof body.content !== 'object') {
    return NextResponse.json({ error: 'There is nothing to export.' }, { status: 400 })
  }

  /**
   * What `line-height: normal` measured as in the browser, for the face the
   * editor drew. Optional, and range-checked rather than trusted: it is a
   * number from a client, it multiplies every line of the document, and a
   * nonsense value would silently produce a CV at the wrong density rather
   * than an error anybody could see. Out of range, or absent, and the exporter
   * falls back to the drawn font's own metric.
   */
  const natural =
    typeof body.naturalLineHeight === 'number' &&
    Number.isFinite(body.naturalLineHeight) &&
    body.naturalLineHeight > 0.5 &&
    body.naturalLineHeight < 4
      ? body.naturalLineHeight
      : undefined

  try {
    const pdf = await buildPdf(body.content, title, natural)
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFileName(title)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    // NAMED, because the two failures here need different answers: a missing
    // browser is a deployment problem and a bad document is the user's.
    console.error('[cv/pdf] build failed', err)
    return NextResponse.json({ error: 'Could not build the PDF.' }, { status: 500 })
  }
}
