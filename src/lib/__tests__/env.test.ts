import { describe, it, expect } from 'vitest'
import { readSupabaseConfig } from '../env'

describe('readSupabaseConfig', () => {
  it('reads the NEXT_PUBLIC_ names', () => {
    const cfg = readSupabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: 'https://next.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'next-key',
    })
    expect(cfg.url).toBe('https://next.supabase.co')
    expect(cfg.anonKey).toBe('next-key')
  })

  it('does NOT fall back to a VITE_ name, which cannot reach a Next bundle', () => {
    // THIS ASSERTION IS INVERTED FROM WHAT IT REPLACED, and the inversion is
    // the bug report. The fallback existed for the Vite app and survived the
    // migration, where it can never fire -- `import.meta.env` is absent and
    // `nextPublicEnv()` only forwards NEXT_PUBLIC_ literals. Its Sentry
    // equivalent kept error reporting dark in production for weeks while
    // looking configured. A fallback that cannot resolve must not report a
    // value, or the next reader trusts it again.
    const cfg = readSupabaseConfig({
      VITE_SUPABASE_URL: 'https://vite.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'vite-key',
    })
    expect(cfg.url).toBe('')
    expect(cfg.isConfigured).toBe(false)
  })

  it('reports unconfigured when values are missing', () => {
    expect(readSupabaseConfig({}).isConfigured).toBe(false)
  })

  it('treats a placeholder URL as unconfigured', () => {
    const cfg = readSupabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: 'https://your-project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k',
    })
    expect(cfg.isConfigured).toBe(false)
  })

  it('treats a placeholder key as unconfigured', () => {
    const cfg = readSupabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'your-anon-key',
    })
    expect(cfg.isConfigured).toBe(false)
  })
})
