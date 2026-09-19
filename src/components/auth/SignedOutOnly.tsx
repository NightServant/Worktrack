'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useAuthHeld } from './authHold'
import { HandoffScreen } from './HandoffScreen'

/**
 * Holds an auth form back until it is known that the visitor needs one.
 *
 * THE BUG THIS FIXES (Gabe, 2026-09-11: "I am signed in but authentication
 * forms shows up even when I am logged in"). `(app)/layout.tsx` has always
 * returned `null` while `loading || !user`, so a private screen never paints
 * for somebody who is about to be bounced out. The `(auth)` group had no
 * mirror of that: it rendered `{children}` immediately and left the redirect
 * to catch up, so a signed-in visitor got a fully painted sign-in form for the
 * whole of the auth-resolution window, every time.
 *
 * `InstantSignedInRedirect` closes that window on a FULL PAGE LOAD -- it reads
 * localStorage before the document is parsed. It cannot close it on a
 * client-side navigation, which is exactly how somebody signed in arrives
 * here: the "sign in" link in the landing navbar is a `next/link`, so no
 * document is parsed and no inline script runs. That is the path that produced
 * the screenshot.
 *
 * IT KEYS ON `user` AND DELIBERATELY NOT ON `loading`, and that is the whole
 * design. The first version gated on both, which cost the form its SERVER
 * RENDER: `loading` starts true on the server, so the page shipped an empty
 * shell and the form appeared only after hydration -- measured on the deployed
 * build, `signup-email` appeared zero times in the HTML. That is a worse
 * regression than the flash it was fixing, and it hit every signed-out visitor
 * rather than the rare signed-in one.
 *
 * Keying on `user` alone restores the server render and still fixes the report,
 * because of where the bug actually lives. `AuthProvider` sits in the ROOT
 * layout, so on a CLIENT-SIDE navigation it is already mounted and `user` is
 * already populated -- there is no resolution window to flash through. The form
 * simply never renders. On a full page load the pre-paint script handles it
 * before this component exists.
 *
 * WHAT IS LEFT UNCOVERED, stated rather than discovered: a full page load, by
 * a signed-in visitor, where the inline script could not run -- localStorage
 * blocked, or a browser refusing it. There the form paints until
 * `getSession()` resolves, exactly as it did before any of this. That is rare,
 * and it is not worth every signed-out visitor losing their first paint.
 *
 * IT IS NOT A SECURITY BOUNDARY and must not be read as one. Nothing here
 * protects data: that is row-level security on every table plus the auth check
 * in every API route. This decides which of two public pages to paint, and a
 * visitor who defeated it would see a form they could already see by signing
 * out.
 *
 * WHY NOT ON `/` TOO. The landing page deliberately paints first for everyone
 * -- it is a static marketing route whose traffic is overwhelmingly signed
 * out, and holding it blank on an auth check would give every anonymous
 * visitor a blank first paint to serve the minority who are signed in. See
 * `SignedInRedirect`. A sign-in form is not marketing and does not get that
 * exemption.
 */
export function SignedOutOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const held = useAuthHeld()

  // A flow asking to finish its last screen. Returning null here is what
  // unmounted /signup's thank-you the instant the code verified -- the
  // redirect was only half the reason it was never seen. See ./authHold.
  if (held) return <>{children}</>

  /*
    SIGNED IN AND STILL ON AN AUTH ROUTE MEANS A HANDOFF IS IN FLIGHT, and
    what goes here used to be `return null`.

    THAT NULL WAS THE BLANK PAGE. Gabe recorded a real sign-in on 2026-09-15:
    the form is pressed, and roughly 900ms of PURE WHITE sits between it and
    the dashboard. This line is where the white came from. `signIn` resolves,
    `onAuthStateChange` sets `user`, and this component empties the entire
    /login document -- while `router.push('/overview')` is still fetching the
    next route. Rendering nothing was correct about the FORM and wrong about
    the PAGE.

    Confirmed rather than assumed: server-rendering the (auth) layout with a
    user present produced zero visible characters.

    IT COVERS EVERY AUTH ROUTE AT ONCE, which is why the fix belongs here
    rather than in the sign-in page. /login, /signup and /forgot-password all
    mount this, and all three end by creating a session and navigating. A fix
    in one page would have left the other two blanking.

    NOT the form, and not a skeleton of the dashboard either. The form is the
    thing that must go -- it is answered, and leaving it up invites a second
    submit. A dashboard skeleton would be a promise about a specific
    destination this component cannot see: /signup goes on to a thank-you,
    and a reset goes to a password field.
  */
  if (user) {
    return (
      <HandoffScreen
        title="signing you in"
        message="One moment while we get your account ready."
      />
    )
  }

  return <>{children}</>
}
