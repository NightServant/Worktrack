import Link from 'next/link'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button-variants'
import { ICON_MOTION_GROUP, iconMotion } from '@/components/icons/motion'
import { ArrowRightIcon, OverviewIcon } from '@/components/icons'

/**
 * The way out of a public document, pointing wherever the reader came from.
 *
 * Gabe's 2026-09-05 ruling: on `/privacy`, the button back to the landing page
 * should say "back to the dashboard" for somebody who is signed in. The
 * landing page is where you decide whether to sign up; offering it to a person
 * who already did is offering them a step backwards.
 *
 * IT IS NOT A REDIRECT, and that distinction is the whole design of this page.
 * `/`, `/login` and `/signup` bounce a signed-in visitor to the dashboard,
 * because those three exist to get you an account and you have one. A privacy
 * policy is a document with an ordinary reason to be read by a user, so this
 * page stays put and changes its exit instead.
 *
 * BOTH LINKS ARE RENDERED AND CSS PICKS ONE. That is what lets the right one
 * be on screen at the FIRST paint rather than after `useAuth()` resolves --
 * see SessionAttributeScript, which sets the attribute the rules key off, and
 * the `[data-when-signed-in]` block in index.css. Branching in React here
 * would render the signed-out version for everybody and swap it a beat later,
 * which is the flicker this avoids.
 *
 * The cost is honest: an unstyled document (no CSS, a text browser, a
 * scraper) shows both links. Two correct destinations is a mild redundancy;
 * the alternatives are a wrong one or a missing one.
 */
export function HomeOrDashboardLink({ className }: { className?: string }) {
  const shape = cn(
    buttonVariants({ variant: 'secondary', size: 's' }),
    ICON_MOTION_GROUP,
    className
  )

  return (
    <>
      <Link href="/" data-variant="secondary" data-when-signed-out className={shape}>
        Back to the home page
        <ArrowRightIcon size={14} aria-hidden className={iconMotion('forward')} />
      </Link>
      <Link href="/overview" data-variant="secondary" data-when-signed-in className={shape}>
        Back to the overview
        <OverviewIcon size={14} aria-hidden className={iconMotion('lift')} />
      </Link>
    </>
  )
}
