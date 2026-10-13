import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'

// Importing layout.tsx (for its `metadata` export, below) transitively
// imports Providers -> AuthContext -> lib/supabase, which calls
// createClient() at module scope. Every other test that can reach that
// chain mocks it (see settings/page.test.tsx, shell.test.tsx); this file is
// the first to import layout.tsx itself, so it needs the same guard rather
// than depending on NEXT_PUBLIC_SUPABASE_URL being set in the test runner.
vi.mock('@/lib/supabase', () => ({ supabase: {}, hasValidSupabaseConfig: true }))

// next/font/google only resolves inside Next's own build pipeline; outside
// it (any Vitest run) calling Arimo() throws "Arimo is not a function". No
// other test imports layout.tsx, so no other test has hit this yet.
vi.mock('next/font/google', () => ({ Arimo: () => ({ variable: '--font-fallback' }) }))

import { metadata } from '../layout'

/**
 * The tab has shown the browser's default icon since M3, and public/ has been
 * shipping the Vite starter logo for three milestones. Next 15 generates the
 * <link rel="icon"> tags from files in src/app/ by convention, so the test is
 * that the files are there AND non-empty -- an existsSync on a zero-byte
 * placeholder is exactly the assertion class this project has shipped eight
 * times.
 */
const ICONS = ['src/app/icon.svg', 'src/app/apple-icon.png', 'src/app/opengraph-image.png', 'public/favicon.ico']

describe('app icon conventions', () => {
  for (const path of ICONS) {
    it(`ships a non-empty ${path}`, () => {
      expect(existsSync(path), `${path} is missing`).toBe(true)
      expect(statSync(path).size, `${path} is empty`).toBeGreaterThan(100)
    })
  }

  // favicon.ico is the one icon NOT under src/app/ (Gabe, 2026-10-13: the
  // Vercel dashboard card still showed the Vite logo). As a src/app/ file it
  // builds to a generated route, not a static file, and the dashboard's
  // favicon lookup only saw the Vite era's static /vite.svg. A static public/
  // file is what it reads. Both at once is a Next build error.
  it('serves favicon.ico from public/, not from src/app/', () => {
    expect(existsSync('src/app/favicon.ico')).toBe(false)
  })

  it('no longer ships the Vite starter logo', () => {
    expect(existsSync('public/vite.svg')).toBe(false)
  })

  it('references nothing from the deleted public/vite.svg', () => {
    const raw = readFileSync('package.json', 'utf8')
    expect(raw).not.toContain('vite.svg')
  })
})

describe('root metadata', () => {
  it('has a title and a description', () => {
    expect(metadata.title).toBeTruthy()
    expect(metadata.description).toBeTruthy()
  })

  it('declares an openGraph card so a shared link previews as more than a URL', () => {
    // M6 6.1's whole purpose is a landing page a stranger opens from a shared
    // link. Without this the preview is a bare URL.
    expect(metadata.openGraph).toBeTruthy()
    expect(metadata.openGraph?.title).toBeTruthy()
    expect(metadata.openGraph?.description).toBeTruthy()
  })

  it('sets metadataBase so the opengraph image resolves to an absolute URL', () => {
    // Next warns and emits a relative og:image without this, which most
    // scrapers drop.
    expect(metadata.metadataBase).toBeTruthy()
  })
})
