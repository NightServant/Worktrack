import type { NavEntry } from '@/components/ui/sidebar'

/**
 * The demo's own nav, pointing inside /demo.
 *
 * Not a cosmetic copy of the app's NAV: a demo visitor clicking "applications"
 * and landing on the real /applications is bounced to /login by the (app)
 * layout guard, which reads as the demo being broken rather than as a
 * boundary working correctly.
 *
 * Same five labels and icons as the app, because it IS the app -- the demo is
 * the same screens over a fixture, not a reduced version of them.
 */
export const DEMO_NAV: NavEntry[] = [
  { href: '/demo/overview', label: 'overview', icon: 'Overview' },
  { href: '/demo/applications', label: 'applications', icon: 'Applications' },
  { href: '/demo/planner', label: 'planner', icon: 'Calendar' },
  { href: '/demo/documents', label: 'documents', icon: 'Documents' },
  { href: '/demo/analytics', label: 'analytics', icon: 'Analytics' },
]
