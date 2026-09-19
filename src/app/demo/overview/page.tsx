import type { Metadata } from 'next'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { DEMO } from '@/lib/demoFixture'

export const metadata: Metadata = {
  title: 'Demo · Overview',
  description: 'The overview screen, over invented data. No account needed.',
}


/**
 * The demo overview. No hooks, no queries, no auth -- the fixture is imported
 * directly, which is what lets this route be statically rendered: a reviewer
 * opening the demo gets HTML rather than a spinner and a round trip.
 */
export default function Page() {
  return <Dashboard jobs={DEMO.jobs} events={DEMO.events} />
}
