import type { Metadata } from 'next'
import { DemoCalendar } from './DemoCalendar'

export const metadata: Metadata = {
  title: 'Demo · Planner',
  description:
    'What is booked, what has gone quiet, newly posted remote roles, and a month grid — over invented data.',
}

/**
 * The screen moved into a client component (see `DemoCalendar`): holidays and
 * the remote-roles feed are live reads, and this file stays a server component
 * so the route keeps its metadata.
 */
export default function Page() {
  return <DemoCalendar />
}
