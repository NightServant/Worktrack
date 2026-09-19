import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

/**
 * The two settings that keep the auth gate deployed, held together.
 *
 * THE FAILURE THIS EXISTS FOR IS SILENT, which is the only reason a test that
 * reads source as text earns its place. vercel.json declares `services`, and
 * services reject Edge Function output; Next compiles middleware to Edge by
 * default, so `runtime: 'nodejs'` in src/middleware.ts is what lets the
 * project deploy at all. But that export on its own, WITHOUT
 * `experimental.nodeMiddleware` in next.config.ts, makes Next 15.5 emit no
 * middleware at all -- and say nothing. The build is green, the `ƒ Middleware`
 * line simply vanishes from the summary, and every private route ships with
 * no gate in front of it.
 *
 * Nothing else in this suite would notice. authRoutes.test.ts covers
 * `decideRoute` exhaustively and it is a pure function: it passes identically
 * whether the middleware that calls it is deployed or absent. That is the
 * hole. A guard that fails the moment the pair is broken is the cheapest thing
 * that closes it.
 *
 * IT IS NOT A SUBSTITUTE FOR CHECKING THE REAL THING. Both halves being
 * present is necessary, not sufficient -- `next start` and a signed-out GET to
 * /overview expecting 307 is what actually proves the gate runs, because
 * middleware-manifest.json reports `{"middleware":{}}` for node middleware
 * even when it is working. This catches the regression that arrives by
 * somebody deleting a line, which is the likely one.
 */
describe('the middleware runtime pair', () => {
  const middleware = readFileSync('src/middleware.ts', 'utf8')
  const nextConfig = readFileSync('next.config.ts', 'utf8')

  it('still has a middleware to run', () => {
    // Positive companion: if the file stopped exporting a middleware the
    // assertions below could pass while nothing was gated.
    expect(middleware).toMatch(/export\s+async\s+function\s+middleware\s*\(/)
  })

  it('asks for the node runtime, because services reject Edge output', () => {
    expect(
      middleware,
      'src/middleware.ts must export `runtime: "nodejs"` or the Vercel build ' +
        'fails: services do not support Edge Functions'
    ).toMatch(/runtime:\s*'nodejs'/)
  })

  it('enables nodeMiddleware, without which the middleware is dropped', () => {
    expect(
      nextConfig,
      'next.config.ts must set `experimental.nodeMiddleware: true`. Without ' +
        'it, `runtime: "nodejs"` makes Next emit NO middleware and still ' +
        'report a successful build -- the auth gate disappears silently'
    ).toMatch(/nodeMiddleware:\s*true/)
  })
})
