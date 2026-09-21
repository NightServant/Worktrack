import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * EVERY route under /api authenticates, and this is what keeps that true for
 * the next one somebody adds.
 *
 * The routes that existed at the time shipped unauthenticated -- `/api/tailor`
 * spends a metered LLM allowance, `/api/autofill` reaches a service that can
 * spend an Apify balance, `/api/cv/docx` spends CPU -- so anyone who found the
 * path could drain a paid allowance from a curl loop. Adding the gate fixed
 * those; without this test the NEXT route starts the problem over, and nothing
 * fails until a bill does. That is why this counts nothing and asserts a
 * property instead: the number of routes has more than doubled since, and a
 * test that named three would have gone stale before the fourth landed.
 *
 * It reads source rather than exercising handlers, deliberately. The invariant
 * is "no route file is missing the call", which is a property of the SET of
 * files -- a per-route behavioural test only ever covers the routes somebody
 * remembered to write one for, which is exactly the routes that were never the
 * risk.
 */
const API_DIR = join(process.cwd(), 'src/app/api')

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : routeFiles(full)
    }
    return entry === 'route.ts' || entry === 'route.tsx' ? [full] : []
  })
}

const FILES = routeFiles(API_DIR)

describe('the API surface', () => {
  it('has routes to check', () => {
    // Guards the guard: a scan that silently matches nothing passes every
    // assertion below.
    expect(FILES.length).toBeGreaterThanOrEqual(3)
  })

  it.each(FILES.map((f) => [relative(process.cwd(), f), f] as const))(
    '%s authenticates, and acts on the answer',
    (name, file) => {
      const source = readFileSync(file, 'utf8')
      expect(source, `${name} does not import the auth helper`).toContain("from '@/lib/apiAuth'")
      expect(source, `${name} never calls authenticate()`).toMatch(/await authenticate\(request\)/)
      // Importing and calling it while ignoring the answer is the shape of a
      // gate added to satisfy a reviewer rather than an attacker.
      expect(source, `${name} ignores the auth result`).toMatch(/if \(!auth\.ok\)/)
    }
  )

  it.each(FILES.map((f) => [relative(process.cwd(), f), f] as const))(
    '%s checks auth before spending anything',
    (name, file) => {
      const source = readFileSync(file, 'utf8')
      const gate = source.indexOf('await authenticate(request)')
      // A route that reads a 2MB body, or calls an upstream, and only then
      // 401s has already paid for the request it is rejecting.
      for (const spend of [
        'request.json()',
        'request.text()',
        'compileLatex(',
        'tailorCv(',
        'buildDocx(',
      ]) {
        const at = source.indexOf(spend)
        if (at === -1) continue
        expect(at, `${name} does "${spend}" before authenticating`).toBeGreaterThan(gate)
      }
    }
  )
})
