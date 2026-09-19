import type { Metadata } from 'next'

/**
 * Metadata only. The page beside this file is a client component, and a client
 * component cannot export `metadata` -- so the title lives in a server layout
 * that renders its children and nothing else.
 *
 * `robots: noindex` on every authenticated route. A crawler cannot reach these
 * anyway, since they sit behind the guard in (app)/layout.tsx, but a route that
 * is private by ACCIDENT of authentication and not by declaration is one
 * misconfiguration away from being indexed. Saying it costs one line.
 */
export const metadata: Metadata = {
  // `Planner`, not `Calendar` (Gabe, 2026-09-11, catching the browser tab the
  // rename missed). The path is still /planner -- every bookmark and the
  // Overview's own link point at it -- but nothing a reader SEES should still
  // say calendar: not the sidebar, not the heading, and not the tab.
  title: 'Planner',
  description:
    'What is booked, what has gone quiet, newly posted remote roles, and your month.',
  robots: { index: false, follow: false },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
