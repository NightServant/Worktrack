import type { Metadata } from 'next'
import { Arimo } from 'next/font/google'
import '../index.css'
import { VercelAnalytics } from '@/components/analytics/VercelAnalytics'
import { siteUrl } from '@/lib/siteUrl'
import { Providers } from './providers'

/**
 * Helvetica Neue is licensed and cannot be self-hosted, and there is no free
 * weights package for it. Mac visitors have it; nobody else does. Arimo is
 * metric-compatible with Arial (and therefore with Helvetica), so it holds the
 * same line breaks, and it ships a real 700 -- which matters now that the type
 * scale sets weights and `font-synthesis: none` forbids a faked bold.
 *
 * Licence: SIL Open Font License 1.1. Self-hosted at build time by next/font,
 * so no request leaves the origin at runtime.
 */
const arimo = Arimo({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-fallback',
  display: 'swap',
})

/**
 * No custom domain is registered for this project yet -- `VERCEL_URL` is the
 * per-deployment host Vercel injects automatically (preview and production
 * alike), so metadataBase tracks wherever this actually deploys rather than
 * a fabricated domain. Falls back to localhost for `next dev`/tests, where
 * the var is unset.
 *
 * `icons` is deliberately absent: icon.svg / apple-icon.png /
 * opengraph-image.png in this directory are Next 15's file-convention names,
 * and Next generates the <link rel="icon"> etc. tags from them on its own --
 * hand-writing `icons` here would just be a second, driftable source of truth.
 * favicon.ico lives in public/ instead, as a static file, so the Vercel
 * dashboard can find it (see appIcons.test.ts); browsers request
 * /favicon.ico by default, so it needs no tag.
 *
 * `description` stays a sentence fragment, lowercase chrome under the item-10
 * rule ("Worktrack" itself is the product's proper noun and keeps its case).
 * `openGraph.description` reuses the sidebar footer's retired M5 line rather
 * than inventing a tagline; `CV` keeps its case as an acronym.
 */
// One definition, shared with robots.ts and sitemap.ts. See lib/siteUrl.

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // `template` is what lets every other route state only its own name. Without
  // it each page has to repeat the product name, and one of them eventually
  // will not -- which is how a site ends up with a tab reading "analytics" and
  // no clue whose analytics they are.
  //
  // `default` is used where a route sets no title of its own, and it carries
  // the product name plus what the product IS. A bare "Worktrack" as the
  // homepage title tells a search result nothing.
  title: {
    default: 'Worktrack — job search tracker with analytics and a CV builder',
    template: '%s · Worktrack',
  },
  description:
    'Track every application, see what is actually working, and keep every version of your CV in one place. Open source, with row-level security on every table.',
  openGraph: {
    type: 'website',
    siteName: 'Worktrack',
    title: 'Worktrack — job search tracker with analytics and a CV builder',
    description: 'every application, every version of your CV, in one place.',
    // The file-convention opengraph-image.png in this directory is picked up
    // by Next on its own; naming it here would be a second source of truth.
    // What DOES need saying is the type, so a card renders as a summary with
    // a large image rather than a thumbnail beside a line of text.
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Worktrack — job search tracker with analytics and a CV builder',
    description: 'every application, every version of your CV, in one place.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning is required: next-themes sets the class on <html>
  // before React hydrates, which would otherwise log a mismatch on every load.
  return (
    <html lang="en" className={arimo.variable} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
        <VercelAnalytics />
      </body>
    </html>
  )
}
