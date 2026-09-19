import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    // Vite injected __APP_VERSION__ via `define`. Next has no equivalent global,
    // so the same value is published as a normal public variable and read
    // through src/lib/env.ts like everything else.
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version ?? '0.0.0',
    // Vercel exposes the commit as VERCEL_GIT_COMMIT_SHA; locally there is none.
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  // The Vite app still lives in src/ and must not be swept into the Next build.
  pageExtensions: ['tsx', 'ts'],
  /**
   * `docx` is required at runtime, never bundled.
   *
   * Bundling it BROKE THE BUILD, and not in a way that named itself: with
   * /api/cv/docx present, `next build` failed at "Collecting page data" with
   * `Cannot find module for page: /_not-found` and `/gallery` -- two pages
   * that have nothing to do with Word export -- and a MODULE_NOT_FOUND deep
   * inside `.next/server/webpack-runtime.js`. Removing that one route made it
   * pass, which is how it was traced. `docx` pulls jszip and a pile of Node
   * built-ins; webpack tripped over them and corrupted the shared runtime
   * chunk the other pages resolve through.
   *
   * Listing it here tells Next to `require()` it from node_modules at request
   * time instead, which is correct for a server-only library anyway -- it is
   * ~2MB of zip machinery no client should ever receive.
   */
  /**
   * `@react-pdf/renderer` IS HERE FOR THE SAME REASON AS `docx` AND A SHARPER
   * ONE. It renders through `pdfkit`, which loads the PDF standard fonts by a
   * package IMPORTS subpath -- `require('#standard-fonts/Helvetica')`, mapped
   * in pdfkit's own package.json to `./js/standard-fonts/*.cjs`. A bundler
   * cannot follow that: the specifier is not a path and the `*` is filled in
   * at runtime from the font name. Webpack inlined the JS, the `.cjs` metric
   * files were never traced, and production answered 500 with
   * `Cannot find module '/var/task/node_modules/pdfkit/js/standard-fonts/
   * Helvetica.cjs'` -- Helvetica because pdfkit loads it as the document's
   * default before anything asks for Times.
   *
   * Listing it here makes Next `require()` it from node_modules at runtime;
   * `outputFileTracingIncludes` below is what actually puts the font files in
   * the deployment, since tracing cannot discover them either.
   */
  serverExternalPackages: ['docx', '@react-pdf/renderer'],
  /**
   * The files no static analysis can find. Scoped to the one route that needs
   * them rather than the whole app, so nothing else carries the weight.
   */
  outputFileTracingIncludes: {
    '/api/cv/pdf': [
      './node_modules/pdfkit/js/standard-fonts/**',
      './node_modules/pdfkit/js/data/**',
      // THE FOUR BUNDLED FAMILIES, for the same reason as the two lines above:
      // nothing can discover them statically. `pdfExport` reads them by path
      // at `process.cwd()`, which is a string no tracer follows, and a CV set
      // in Garamond silently prints in Times when they are missing. See
      // `services/integrations/pdfExport` for why that is a fallback rather
      // than a failure, and `__tests__/pdfFontTracing` for the guard.
      './src/services/integrations/fonts/**',
    ],
  },
  /**
   * THE MIDDLEWARE RUNS ON NODE, AND THIS FLAG IS WHAT MAKES THAT REAL.
   *
   * vercel.json declares `services` -- `web` (this app) bound to `extractor`
   * (the FastAPI scraper in scraper/). Services do not support the Edge
   * runtime, and Next compiles middleware to an Edge Function by default, so
   * the first deploy of src/middleware.ts failed the build outright:
   *
   *   Edge Runtime is not supported in services. Service "web" produced Edge
   *   Function output "src/middleware".
   *
   * `runtime: 'nodejs'` in the middleware's own config is the other half. ON
   * ITS OWN IT IS WORSE THAN USELESS: without this flag Next 15.5 accepts the
   * export, builds successfully, and SILENTLY EMITS NO MIDDLEWARE AT ALL --
   * the `ƒ Middleware` line disappears from the build summary and the auth
   * gate ceases to exist. A green build that quietly removes the thing
   * standing in front of every private route is the worst shape a failure can
   * take, so neither half of this may be removed without the other.
   *
   * NEXT 15.5.23 WARNS "Unrecognized key(s) in object: 'nodeMiddleware'" AND
   * HONOURS IT ANYWAY -- the config schema lags the feature. The same build
   * prints "Experiments (use with caution): ✓ nodeMiddleware". Do not chase
   * that warning; it is noise, and the behaviour is verified below.
   *
   * DO NOT TRUST middleware-manifest.json TO CONFIRM ANY OF THIS. For node
   * middleware it stays `{"middleware":{},"sortedMiddleware":[]}` even when
   * the middleware is present and running. The only honest check is a request:
   * `next start`, then GET /dashboard signed out and expect 307 -> /login.
   *
   * This is also the direction Vercel recommends independently of the services
   * constraint -- Edge is no longer the preferred runtime, and Node middleware
   * runs in the same regions.
   */
  experimental: {
    nodeMiddleware: true,
    /*
      THE CAST IS THE TYPE LAGGING THE FEATURE, not a value Next ignores.
      `ExperimentalConfig` in 15.5.23 has no `nodeMiddleware` key -- the same
      gap the build warns about in prose ("Unrecognized key(s) in object") while
      printing "Experiments (use with caution): nodeMiddleware" two lines later
      and honouring it. Everything above is the account of why it must stay.

      It only became a TYPE error on 2026-09-15, when securityHeaders.test.ts
      started importing this file to assert on the headers it returns -- that
      import is what first pulled this config into the tsconfig program, which
      lists only `src`. The behaviour did not change; the checking did.

      `as` rather than `@ts-expect-error`: the directive would itself become an
      error the day Next adds the key, turning a fixed upstream bug into a
      broken build here.
    */
  } as NextConfig['experimental'],
  eslint: {
    // The repo already lints via `npm run lint` with its own config. Next bundles
    // a stricter one that fails the build on pre-existing `any` usages across
    // M1/M2 service code. Adopting it here would mean rewriting working code for
    // no migration benefit, and would hide a real regression behind noise.
    // Lint remains a separate gate; revisit when M5 rewrites those files anyway.
    ignoreDuringBuilds: true,
  },
  /**
   * The routes whose URL used to disagree with their own name.
   *
   * `/jobs` moved to `/applications` in M5. `/dashboard` and `/calendar`
   * followed on 2026-09-19 (Gabe: "URL names must be changed to match the page
   * name") -- the sidebar had said "overview" and "planner" for weeks while the
   * address bar said something else, which is visible in every screenshot on
   * the landing page and in every link anyone shares.
   *
   * ALL OF THEM ARE LIVE IN PRODUCTION, so none of them may 404. `permanent`
   * is a 308: it keeps the method, and it tells a browser and a search engine
   * to stop asking. The demo pair is listed separately rather than by pattern
   * because `/demo/:page` would also swallow paths that were never renamed.
   */
  async redirects() {
    return [
      { source: '/jobs', destination: '/applications', permanent: true },
      { source: '/dashboard', destination: '/overview', permanent: true },
      { source: '/calendar', destination: '/planner', permanent: true },
      { source: '/demo/dashboard', destination: '/demo/overview', permanent: true },
      { source: '/demo/calendar', destination: '/demo/planner', permanent: true },
    ]
  },
  /**
   * THE RESPONSE HEADERS, AND UNTIL 2026-09-15 THERE WERE NONE.
   *
   * Every one of these is a browser-enforced rule the server has to ask for.
   * Nothing in the application code can substitute for any of them, which is
   * why their absence was not visible in review: the app behaved correctly and
   * was simply not protected against the attacks these close.
   *
   * WHAT EACH ONE IS FOR, because a list of header names ages into cargo cult:
   *
   *   Strict-Transport-Security  "enforce HTTPS", from the brief. Vercel
   *     already redirects http to https, and a redirect is one plaintext
   *     request the first time -- long enough to strip the upgrade on a hostile
   *     network. HSTS makes the browser refuse plaintext for two years without
   *     asking. `includeSubDomains` and `preload` are both required to submit
   *     the domain to the browsers' preload list, which closes even the very
   *     first visit. NOTE: this is effectively irreversible for the duration --
   *     serving this domain over plain HTTP again would need the max-age run
   *     down to 0 and time to pass.
   *
   *   X-Content-Type-Options   stops a browser second-guessing a Content-Type.
   *     This app serves user-uploaded document text back through /api/cv/docx;
   *     a sniffed `text/html` is how an uploaded file becomes a script on our
   *     own origin.
   *
   *   X-Frame-Options + frame-ancestors  clickjacking. The app has a delete
   *     button, a sign-out and a settings screen; a transparent iframe over a
   *     page the victim thinks is something else is how those get pressed.
   *     Both are sent because the first is understood everywhere and the second
   *     is the one that is actually specified.
   *
   *   Referrer-Policy   an application URL can carry a job id
   *     (`?application=<uuid>`), and a full Referer on an outbound click hands
   *     that to whichever job board the user just opened.
   *
   *   Permissions-Policy   this app needs no camera, microphone, geolocation
   *     or payment API. Denying them means a compromised dependency cannot ask
   *     for them either.
   *
   * THE CSP IS DELIBERATELY PARTIAL, AND THAT IS THE HONEST SHAPE.
   *
   * `script-src` is ABSENT. A real one needs a per-request nonce threaded
   * through Next's own inline bootstrap and hydration scripts, plus the two
   * legitimate inline scripts this app ships (`SessionAttributeScript` and
   * shadcn's chart theme block). That is a middleware change with a large
   * breakage surface, and a `script-src` with `'unsafe-inline'` in it is
   * ceremony rather than defence -- it permits exactly the thing it looks like
   * it forbids.
   *
   * `default-src` IS ALSO ABSENT, AND THAT ABSENCE IS DELIBERATE RATHER THAN
   * AN OVERSIGHT. `default-src 'self'` looks like the obvious floor and would
   * have taken the application down: it supplies `connect-src`, and this app's
   * browser talks to three origins that are not itself -- Supabase (every
   * query and every auth call), Sentry's ingest endpoint, and jobicy.com for
   * the remote-roles rail. Enumerating those means baking a build-time env var
   * into a header and re-deploying whenever a project ref changes, which is a
   * new way to break auth in production for a directive that buys nothing the
   * ones below do not.
   *
   * ponytail: what IS here is the set of directives that block real attacks
   * with no nonce, no allowlist and no breakage -- `base-uri` (a planted
   * <base> silently re-pointing every relative URL), `form-action` (a planted
   * form posting credentials elsewhere), `object-src` (plugin-based
   * injection), `frame-ancestors` (clickjacking) and
   * `upgrade-insecure-requests`. Each is absolute: none of them has a
   * legitimate exception in this app, which is exactly why they can be set
   * without a list. The upgrade path is nonce middleware plus an explicit
   * `connect-src`, and it should be taken the day this app renders anything a
   * user typed as markup.
   *
   * APPLIED TO EVERY PATH INCLUDING /api, which matters for nosniff and
   * frame-ancestors on a JSON response.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              'upgrade-insecure-requests',
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
