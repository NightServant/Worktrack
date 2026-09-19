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
  title: 'Overview',
  description: 'What is moving, what has stalled, and what is next in your job search.',
  robots: { index: false, follow: false },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
