import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Demo',
  description: 'The real screens over invented data. No account, no sign-in, nothing to enter.',
}


/** /demo has no content of its own; the overview is the demo's front door. */
export default function Page() {
  redirect('/demo/overview')
}
