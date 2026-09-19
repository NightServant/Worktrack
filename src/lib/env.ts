export interface SupabaseConfig {
  url: string
  anonKey: string
  isConfigured: boolean
}

const PLACEHOLDER_URL = [
  'your-project.supabase.co',
  'placeholder.supabase.co',
  'project-id.supabase.co',
]
const PLACEHOLDER_KEY = ['placeholder', 'anon-key-value', 'your-anon-key']

/**
 * Reads Supabase config from a plain object rather than a global.
 *
 * Taking the source as an argument is what makes this testable: import.meta.env
 * and process.env are both ambient and neither can be varied per test.
 *
 * THE `VITE_` FALLBACKS ARE GONE (2026-09-19), AND THEY COST A REAL OUTAGE.
 * They read as a safety net for a half-migrated repo. They are not one under
 * Next: a `VITE_` name can only arrive through `import.meta.env`, which does
 * not exist in the Next build, because `nextPublicEnv()` below returns a FIXED
 * LIST of `process.env.NEXT_PUBLIC_*` literals -- Next substitutes only the
 * exact text.
 *
 * So `?? source.VITE_SENTRY_DSN` looked like it was keeping error reporting
 * alive on the old variable name, and Sentry had in fact been dark in
 * production since the migration: the DSN was set in Vercel under
 * `VITE_SENTRY_DSN` alone, `sentryDsn` resolved to `''` in every browser, and
 * `initSentry()` returned early without a word. A fallback that cannot fire is
 * worse than no fallback, because it answers the question "is this
 * configured?" with a yes nobody checks.
 */
export function readSupabaseConfig(source: Record<string, string | undefined>): SupabaseConfig {
  const url = source.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = source.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const isConfigured =
    !!url &&
    !!anonKey &&
    !PLACEHOLDER_URL.some((p) => url.includes(p)) &&
    !PLACEHOLDER_KEY.some((p) => anonKey.toLowerCase().includes(p))
  return { url, anonKey, isConfigured }
}

/**
 * Reads one Next public variable as a literal.
 *
 * These accesses must stay written out in full. Next replaces the exact text
 * `process.env.NEXT_PUBLIC_FOO` at build time and does nothing for a spread or
 * a computed key, so `{ ...process.env }` is empty in a browser bundle and the
 * app would silently come up unconfigured. The try/catch covers Vite, where
 * `process` does not exist at all and the reference throws.
 */
function nextPublicEnv(): Record<string, string | undefined> {
  try {
    return {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
      NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
      NEXT_PUBLIC_BUILD_SHA: process.env.NEXT_PUBLIC_BUILD_SHA,
      NEXT_PUBLIC_BUILD_TIME: process.env.NEXT_PUBLIC_BUILD_TIME,
      NODE_ENV: process.env.NODE_ENV,
    }
  } catch {
    return {}
  }
}

/**
 * The ambient environment, merged across both runtimes.
 *
 * Vite exposes everything on import.meta.env; Next exposes only the literals
 * above. Reading both behind guards means this module loads in either without
 * throwing, which matters because it is imported during server prerender where
 * import.meta.env is undefined.
 */
export function currentEnvSource(): Record<string, string | undefined> {
  let fromImportMeta: Record<string, string | undefined> = {}
  try {
    // Must stay a property access. Aliasing `import.meta` to a variable, or
    // optional-chaining it, makes webpack emit "Accessing import.meta directly
    // is unsupported"; the cast is erased by TypeScript so this compiles to
    // plain `import.meta.env`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fromImportMeta = ((import.meta as any).env ?? {}) as Record<string, string | undefined>
  } catch {
    // No import.meta in this runtime; the Next literals below are the source.
  }
  return { ...nextPublicEnv(), ...fromImportMeta }
}

export interface RuntimeFlags {
  isDev: boolean
  isProd: boolean
  mode: string
  sentryDsn: string
  sentryEnvironment: string
  appVersion: string
  buildSha: string
  buildTime: string
}

/**
 * Build-mode flags, normalised across Vite and Next.
 *
 * Vite gives DEV/PROD/MODE; Next gives NODE_ENV. Reading whichever exists means
 * a component does not have to know which bundler compiled it -- and does not
 * crash during prerender by reaching for a Vite-only flag.
 */
export function readRuntimeFlags(source: Record<string, string | undefined>): RuntimeFlags {
  const nodeEnv = source.NODE_ENV
  const mode = (source.MODE as string | undefined) ?? nodeEnv ?? 'development'
  // Vite's PROD is a real boolean, Next has no PROD at all -- String() covers both
  // without widening the source type to `unknown` for one field.
  const isProd = String(source.PROD) === 'true' || nodeEnv === 'production'
  return {
    isDev: !isProd,
    isProd,
    mode,
    sentryDsn: (source.NEXT_PUBLIC_SENTRY_DSN ?? '').trim(),
    sentryEnvironment: (source.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? '').trim(),
    appVersion: source.NEXT_PUBLIC_APP_VERSION ?? '0.0.0',
    buildSha: source.NEXT_PUBLIC_BUILD_SHA ?? 'dev',
    buildTime: source.NEXT_PUBLIC_BUILD_TIME ?? '',
  }
}

export const runtimeFlags: RuntimeFlags = readRuntimeFlags(currentEnvSource())
