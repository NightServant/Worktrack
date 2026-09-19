import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/siteUrl'

/**
 * The sitemap, listing only what a signed-out visitor can actually read.
 *
 * Everything behind the auth guard is left out on purpose. A sitemap is a
 * statement that these URLs are worth indexing; listing a route that answers
 * with a redirect to /login is a promise the site does not keep, and Search
 * Console reports it back as an error rather than quietly ignoring it.
 *
 * `lastModified` is the build time rather than a hand-kept date. A literal
 * would be wrong the day after it was typed, and this is the same rule the
 * README's own staleness tests enforce: a claim nothing recomputes is a claim
 * that rots.
 *
 * Priorities are deliberately shallow -- 1.0 for the homepage, 0.8 for the
 * demo that sells it, 0.3 for the legal page nobody searches for. Crawlers
 * treat these as a hint about RELATIVE importance within one site, not as a
 * ranking lever, so a page marked 1.0 alongside nine others says nothing.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const page = (path: string, priority: number, changeFrequency: 'monthly' | 'yearly') => ({
    url: `${siteUrl}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  })

  return [
    page('/', 1, 'monthly'),
    page('/demo/overview', 0.8, 'monthly'),
    page('/demo/applications', 0.7, 'monthly'),
    page('/demo/analytics', 0.7, 'monthly'),
    page('/demo/documents', 0.7, 'monthly'),
    page('/demo/planner', 0.7, 'monthly'),
    page('/signup', 0.6, 'yearly'),
    page('/login', 0.4, 'yearly'),
    page('/privacy', 0.3, 'yearly'),
  ]
}
