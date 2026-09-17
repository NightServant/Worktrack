import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import nextConfig from '../../next.config'
import { FONT_DIRECTORY } from '@/services/integrations/pdfExport'

/**
 * The PDF route's fonts have to reach the server, and nothing local notices
 * when they do not.
 *
 * THIS IS HERE BECAUSE IT SHIPPED BROKEN. `@react-pdf/renderer` renders
 * through `pdfkit`, which loads the PDF standard fonts by a package IMPORTS
 * subpath -- `require('#standard-fonts/Helvetica')`, mapped inside pdfkit's
 * own package.json to `./js/standard-fonts/*.cjs`. No bundler and no file
 * tracer can follow that: the specifier is not a path, and the `*` is filled
 * in at runtime from a font name. So the build passed, every test passed, the
 * PDF rendered perfectly on a developer's machine -- where node_modules is
 * simply on disk -- and production answered 500 with
 * `Cannot find module '/var/task/node_modules/pdfkit/js/standard-fonts/
 * Helvetica.cjs'`.
 *
 * Measured, not assumed: the route traced 0 standard-font files without the
 * config below and 30 with it.
 *
 * A test on the CONFIG rather than on the output, deliberately. The real
 * check -- reading `.next/server/app/api/cv/pdf/route.js.nft.json` -- needs a
 * production build, which the suite does not run. This is the cheap guard that
 * fails in CI the moment somebody tidies these two lines away, which is the
 * realistic way this breaks again: they look like dead configuration.
 */
describe('the PDF route ships the fonts pdfkit loads at runtime', () => {
  it('externalizes @react-pdf/renderer so pdfkit resolves from node_modules', () => {
    expect(nextConfig.serverExternalPackages).toContain('@react-pdf/renderer')
  })

  it('force-includes pdfkit standard fonts for /api/cv/pdf', () => {
    const includes = nextConfig.outputFileTracingIncludes ?? {}
    const forRoute = includes['/api/cv/pdf'] ?? []
    expect(forRoute.some((pattern) => pattern.includes('pdfkit/js/standard-fonts'))).toBe(true)
  })

  /**
   * AND THE FOUR FAMILIES THE EXPORT BUNDLES ITSELF (2026-09-17). Same
   * un-traceable shape as pdfkit's: they are read by a path built at runtime
   * from `process.cwd()`, so nothing static can see them. The failure is
   * quieter than the one above -- registration is fail-soft, so a CV in
   * Garamond simply prints in Times, which looks like a mapping bug in the
   * exporter rather than a missing file in the deployment.
   */
  it('force-includes the bundled CV font files, and they are really there', () => {
    const includes = nextConfig.outputFileTracingIncludes ?? {}
    const forRoute = includes['/api/cv/pdf'] ?? []
    expect(forRoute.some((pattern) => pattern.includes(FONT_DIRECTORY))).toBe(true)

    // The pattern is only half of it: it has to match something. Every face
    // the exporter names must exist, or the fallback is silent.
    const files = readdirSync(FONT_DIRECTORY)
    for (const face of [
      'Carlito-Regular.ttf',
      'Carlito-Bold.ttf',
      'Carlito-Italic.ttf',
      'Carlito-BoldItalic.ttf',
      'Caladea-Regular.ttf',
      'Caladea-Bold.ttf',
      'Caladea-Italic.ttf',
      'Caladea-BoldItalic.ttf',
      'Gelasio-Regular.ttf',
      'Gelasio-Bold.ttf',
      'Gelasio-Italic.ttf',
      'Gelasio-BoldItalic.ttf',
      'EBGaramond-Regular.ttf',
      'EBGaramond-Bold.ttf',
      'EBGaramond-Italic.ttf',
      'EBGaramond-BoldItalic.ttf',
    ]) {
      expect(files, face).toContain(face)
    }
  })

  /** OFL 1.1 requires the licence to travel with the fonts. */
  it('keeps each family\u2019s licence beside it', () => {
    const files = readdirSync(FONT_DIRECTORY)
    for (const licence of ['OFL-Carlito.txt', 'OFL-Caladea.txt', 'OFL-Gelasio.txt', 'OFL-EBGaramond.txt']) {
      expect(files, licence).toContain(licence)
    }
  })
})
