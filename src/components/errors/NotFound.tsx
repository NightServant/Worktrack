'use client'

import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { buttonVariants } from '@/components/ui/button-variants'
import { BrandLockup } from '@/components/ui/brand-mark'
import { ArrowRightIcon } from '@/components/icons'
import { ICON_MOTION_GROUP, iconMotion } from '@/components/icons/motion'

/**
 * The 404 page. Figma `Desktop / 404 — Not Found` (1:14, and 117:2395 dark).
 *
 * TRANSCRIBED FROM THE FRAME, which the first version was not. It invented its
 * own composition and got the most visible thing backwards: the frame draws
 * **404 at Display/XL, 56px, in the accent colour** as the largest element on
 * the page, and the first version rendered it as an 11px Label/Caps eyebrow --
 * five times too small, and grey. Gabe caught it. The rest of the frame is
 * here too: the 40px headline, the 2px `border/strong` rule beneath the copy,
 * and the `error 404 · worktrack` line pinned to the bottom by a pair of
 * flex-1 spacers.
 *
 * ONE BUTTON, AND WHICH ONE DEPENDS ON THE SESSION. This is Gabe's rule of
 * 2026-09-03 and it overrides the frame, which draws three recovery links --
 * overview, applications, documents. All three are private routes. Offered to
 * a signed-out visitor they are not recovery at all: every one bounces to
 * /login, so a page whose whole job is to get somebody unstuck hands them a
 * second wall. And offered to a signed-in visitor they are three ways to say
 * one thing.
 *
 *   signed out -> "back to the home page"     (the only page they can use)
 *   signed in  -> "return to dashboard"       (and no home link at all)
 *
 * The signed-in case drops the home link deliberately: somebody with an
 * account who hits a broken link wants their own data back, not the marketing
 * page, and a second button would make them choose between a real destination
 * and a worse one.
 *
 * IT IS A CLIENT COMPONENT, because that decision needs the session. The route
 * that renders it -- app/not-found.tsx -- stays a server component, so this is
 * one island rather than a client boundary around the whole page.
 *
 * THE SLOT KEEPS ITS HEIGHT WHILE AUTH RESOLVES. supabase-js reads the session
 * out of localStorage asynchronously, so the first render never knows the
 * answer. Rendering the signed-out button and swapping it a beat later would
 * flash the wrong destination on every load for anyone signed in -- and worse,
 * it would be clickable during the flash. The slot reserves its height instead
 * and fills once the answer exists, so nothing moves and nothing lies.
 *
 * IT NEVER ECHOES THE PATH. Reflecting the requested URL into the document is
 * the small standard mistake that turns a 404 into a reflected-XSS sink, and
 * even escaped it renders attacker-chosen text on our own domain. This
 * component reads no location at all; a test asserts the absence.
 *
 * Root-level and outside `(app)`, so it does not inherit the auth guard. A 404
 * that redirects a signed-out visitor to /login turns "this link is broken"
 * into "you are not allowed", which is a different and false claim.
 */
export function NotFound() {
  const { user, loading } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-bg-canvas px-5 py-8 md:px-16 md:py-12">
      {/*
        The frame's Header Row: the lockup alone, on the same 940px measure as
        the message below it, so both start on one vertical line.
      */}
      <header className="mx-auto w-full max-w-[940px]">
        <Link href="/" aria-label="Worktrack home">
          <BrandLockup />
        </Link>
      </header>

      {/* Figma 37:350 — pushes the message off the top edge. */}
      <div aria-hidden className="flex-1" />

      <main className="mx-auto flex w-full max-w-[940px] flex-col gap-5">
        {/*
          Display/XL in the accent. The largest element on the page and the
          only thing carrying colour, which is what makes the page read as an
          error at a glance rather than as a paragraph.
        */}
        <p className="text-display-xl font-bold text-accent-default">404</p>

        <h1 className="text-display-l font-bold text-text-primary">this page has moved on.</h1>

        <p className="max-w-[820px] text-body-l font-normal text-text-secondary">
          The link is broken or the page no longer exists. Nothing in your tracker
          has been lost.
        </p>

        {/* Figma 37:355 — 2px, border/strong. Heavier than a hairline on purpose. */}
        <div aria-hidden className="h-0.5 w-full bg-border-strong" />

        <p className="text-label-caps font-bold uppercase text-text-muted">
          {loading ? ' ' : user ? 'where you left off' : 'try this instead'}
        </p>

        {/*
          `min-h-10` is the height of a size-m button, held whether or not one
          is rendered yet. Without it the rule and the eyebrow above jump up by
          40px when auth resolves, on every load.
        */}
        <div className="flex min-h-10 flex-wrap items-start gap-3">
          {!loading &&
            (user ? (
              <Link
                href="/overview"
                data-variant="primary"
                data-cta="dashboard"
                className={`${ICON_MOTION_GROUP} ${buttonVariants({ variant: 'primary', size: 'm' })} group`}
              >
                Return to dashboard
                <ArrowRightIcon size={16} aria-hidden className={iconMotion('forward')} />
              </Link>
            ) : (
              <Link
                href="/"
                data-variant="primary"
                data-cta="home"
                className={`${ICON_MOTION_GROUP} ${buttonVariants({ variant: 'primary', size: 'm' })} group`}
              >
                Back to the home page
                <ArrowRightIcon size={16} aria-hidden className={iconMotion('forward')} />
              </Link>
            ))}
        </div>
      </main>

      {/* Figma 37:370 — the matching spacer that keeps the message centred. */}
      <div aria-hidden className="flex-1" />

      <p className="mx-auto w-full max-w-[940px] text-caption font-normal text-text-muted">
        error 404 · worktrack
      </p>
    </div>
  )
}
