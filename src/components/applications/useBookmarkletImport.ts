'use client'

import * as React from 'react'

/**
 * Receives a page's source from a Worktrack bookmarklet.
 *
 * TWO SENDERS NOW, one mechanism (2026-09-18). The posting bookmarklet hands
 * over a job advert; the profile one hands over a logged-in LinkedIn page,
 * which is the only client that can see the About, the skills and the bullet
 * text under each role. `kind` is the only difference between them -- the
 * handshake, the retry, the ack and every guard below are the same, and a
 * second copy of this file would be a second place to get them wrong.
 *
 * WHY A BOOKMARKLET EXISTS AT ALL. Indeed answers an anonymous fetch with a
 * Cloudflare 401 and a redirect to `?from=bot-detection-anonymous`; no proxy we
 * can buy is measured to open it, and the ones that might cost money we have
 * decided not to spend (docs/EXTRACTION-FREE-OPTIONS.md). The reader's own
 * browser has already loaded that page, with their session and their consent.
 * It is not a scraper being disguised as a person -- it IS the person, handing
 * over a document they are looking at.
 *
 * THE HANDOFF IS `postMessage`, AND IT HAS TO BE. The bookmarklet runs on
 * indeed.com and this app runs on its own origin, so nothing is shared: not
 * storage, not cookies, not the Supabase session. The URL travels as the
 * existing `?add=` parameter the calendar's `track it` already uses; only the
 * source is too large for a query string, so only the source needs a channel.
 *
 * ANY ORIGIN MAY SEND, WHICH IS NOT A HOLE BUT IS WORTH STATING. A posting can
 * live on any site, so an origin allowlist would defeat the feature. Three
 * things keep that honest:
 *
 *   1. It listens only when the reader arrived on `?import=bookmarklet` -- a
 *      navigation they performed. A page cannot push source into a session
 *      that did not ask for it.
 *   2. Nothing is SAVED. The source seeds a wizard whose review step the
 *      reader still has to read and whose save button they still have to
 *      press. The worst a hostile sender achieves is a prefilled form.
 *   3. The source is a string that gets parsed into fields. It is never
 *      evaluated, never rendered as HTML, and the server enforces its own cap.
 *
 * The reply is the retry's off-switch: the bookmarklet cannot know when this
 * tab finished loading, so it posts every 250ms until something answers.
 */

/**
 * Refused above this, in characters.
 *
 * The server refuses at 3MB and would answer a bigger one with a 413; this is
 * the same number spent earlier, so a hostile or broken sender cannot park tens
 * of megabytes in this tab's memory to find that out.
 */
const MAX_HTML_CHARS = 3_000_000

export function useBookmarkletImport(
  enabled: boolean,
  kind: 'posting' | 'profile' = 'posting'
): string | null {
  const [html, setHtml] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!enabled) return
    const wanted = `worktrack:${kind}`

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; html?: unknown } | null
      if (!data || typeof data !== 'object' || data.type !== wanted) return
      const source = data.html
      if (typeof source !== 'string' || !source || source.length > MAX_HTML_CHARS) return

      setHtml(source)
      // Answer the sender so it stops retrying. `event.origin` rather than
      // `'*'`: this reply goes back to whoever sent the source and to nobody
      // else, and it carries no data of ours in any case.
      try {
        ;(event.source as Window | null)?.postMessage({ type: `${wanted}:received` }, event.origin)
      } catch {
        // A sender that has already closed cannot be acked, and does not need
        // to be -- it stopped retrying when it went away.
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [enabled, kind])

  return html
}
