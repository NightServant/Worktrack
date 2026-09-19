import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/siteUrl'

/**
 * robots.txt, generated rather than written by hand so its sitemap line cannot
 * name a host the deployment does not have.
 *
 * WHAT IS DISALLOWED AND WHY. The authenticated routes are already unreachable
 * without a session, so this is not what protects them -- (app)/layout.tsx and
 * row-level security are. What it does is keep them out of the index as
 * SOFT-404s: a crawler that requests /overview gets the sign-in redirect, and
 * a search result reading "Worktrack — Sign in" for the query "worktrack
 * dashboard" is worse than no result at all.
 *
 * /demo IS ALLOWED, deliberately. It is the strongest page this site has for
 * somebody evaluating the product, it needs no account, and it is static. The
 * one thing to be careful of is that it must not outrank the homepage for the
 * product's own name -- which is a titles problem, and the demo titles are all
 * prefixed "Demo ·" for exactly that reason.
 *
 * /gallery is the internal component gallery. It is not a product page and
 * would read as one.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/overview',
        '/applications',
        '/planner',
        '/documents',
        '/cv',
        '/analytics',
        '/settings',
        '/gallery',
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
