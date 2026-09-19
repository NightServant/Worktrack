import { Landing } from '@/components/landing/Landing'
import { SignedInRedirect } from '@/components/auth/SignedInRedirect'
import { SCREENS } from '@/components/landing/screens'

/**
 * The public landing page, and the homepage for everyone.
 *
 * SIGNED-OUT VISITORS GET THE LANDING PAGE; SIGNED-IN ONES GO TO /overview.
 * That is Gabe's 2026-09-03 ruling and it partially reverses 2026-09-02, when
 * `/` was made the homepage for everyone and redirected nobody. What survives
 * from that decision is the important half: this route is still STATIC and
 * still renders Landing for the anonymous traffic that is nearly all of it.
 *
 * THE REDIRECT MOVED TO MIDDLEWARE on 2026-09-11. It used to be a client
 * island because the session lived in localStorage and there was nothing on
 * the server to read; cookie-backed sessions ended that, and `decideRoute`
 * now sends a signed-in visitor to /overview before this component is ever
 * invoked. The route is STILL STATIC -- middleware runs in front of it and
 * nothing here reads a session -- so the anonymous majority still gets the
 * cached render.
 *
 * SignedInRedirect stays mounted, and not as a leftover. Middleware sees the
 * cookies that arrived WITH the request; it cannot see a session that appears
 * while this page is open. That is the only case left for it.
 *
 * Moving the demo to `/demo/*` is what removed the last objection to any of
 * this. The CTA is a link to a page rather than a session swap, so a
 * signed-in visitor following it stays signed in.
 */
export default function Page() {
  return (
    <>
      {/* First, so the browser decides before it parses anything below. */}
      <SignedInRedirect />
      <Landing
        screens={SCREENS}
        heroPosterSrc="/hero-poster.jpg"
        heroVideoSrc="/hero.mp4"
      />
    </>
  )
}
