/**
 * Which integrations this deployment actually has, read once from the
 * environment.
 *
 * EVERY INTEGRATION HERE IS OPTIONAL, and that is a design rule rather than a
 * convenience. Worktrack has to keep working for someone who has configured
 * none of them -- the demo has no backend at all, CI has no secrets, and a
 * fresh clone has an empty .env. So each capability is a boolean the callers
 * branch on, and every client in this directory degrades to a documented
 * fallback instead of throwing.
 *
 * WHAT WAS VERIFIED, AND HOW, on 2026-09-04. Recorded because three of the
 * four services in the original brief turned out not to be what they looked
 * like, and the next person should not have to re-run the investigation:
 *
 *   ESCO      free, keyless, live. `GET ec.europa.eu/esco/api/search?text=react`
 *             returned 200 with 93 skill matches and no credentials.
 */

/** Read an env var from whichever runtime this is executing in. */
function env(name: string): string | undefined {
  // `process.env` in Next's server runtime and in vitest; `import.meta.env`
  // in the Vite client build. Neither is guaranteed to exist, so both are
  // probed defensively rather than assumed.
  const fromProcess =
    typeof process !== 'undefined' && process.env ? process.env[name] : undefined
  if (fromProcess) return fromProcess
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  return meta?.[name]
}

function trimmed(name: string): string | undefined {
  const value = env(name)?.trim()
  return value ? value : undefined
}

export interface IntegrationConfig {
  /** LaTeX compilation. `undefined` key means the capability is off. */
  /**
   * CV tailoring over any OpenAI-compatible chat endpoint.
   *
   * Named for the CONTRACT, not for a vendor. Groq, OpenRouter, Cloudflare
   * Workers AI, Together and a local Ollama all speak this shape, and every
   * one of their free tiers has changed its limits at least once -- so the
   * provider is configuration and never an import.
   */
  tailoring: {
    baseUrl?: string
    apiKey?: string
    model: string
    /**
     * A kill switch that does not require deleting the key.
     *
     * ABSENT MEANS ON, exactly as `ESCO_ENABLED` reads next door, so no
     * existing deployment changes behaviour by this field appearing.
     */
    enabled?: boolean
  }
  /** The EU skills taxonomy. No key, so it is on unless explicitly disabled. */
  esco: { baseUrl: string; enabled: boolean }
}

export function readIntegrationConfig(): IntegrationConfig {
  return {
    tailoring: {
      baseUrl: trimmed('TAILORING_BASE_URL'),
      apiKey: trimmed('TAILORING_API_KEY'),
      // No default that names a vendor. A model id is meaningless without the
      // base URL it belongs to, so the two are set together or not at all.
      model: trimmed('TAILORING_MODEL') ?? '',
      // OFF WITHOUT UNSETTING THE KEY (2026-09-17).
      //
      // Production and Preview hold the same provider key, and every free
      // tier meters by KEY rather than by deployment -- so one preview branch
      // that tailors a CV spends the live site's daily quota, and the live
      // site then reports the exhaustion as a model error rather than as a
      // quota one. Preview gets `TAILORING_ENABLED=false`.
      //
      // A SWITCH RATHER THAN AN ABSENT KEY, because the two differ in what it
      // costs to change your mind: unsetting the Preview copy of a secret is
      // undoable only by someone who can still read the value out of the
      // provider's dashboard, while this is one variable anybody can flip to
      // test a branch against a real model. The honest fix is a second key;
      // this is what holds until there is one.
      enabled: trimmed('TAILORING_ENABLED') !== 'false',
    },
    esco: {
      baseUrl: trimmed('ESCO_BASE_URL') ?? 'https://ec.europa.eu/esco/api',
      enabled: trimmed('ESCO_ENABLED') !== 'false',
    },
  }
}

/**
 * What this deployment can actually do, as four booleans.
 *
 * Callers branch on these rather than on the presence of a key, so the reason
 * a feature is unavailable stays in one place and the UI can say which one is
 * missing instead of failing at the request.
 */
export interface IntegrationCapabilities {
  tailorCv: boolean
  expandSkills: boolean
}

/**
 * Misconfigurations that are worth naming rather than discovering at the
 * request.
 *
 * THIS EXISTS BECAUSE IT HAPPENED. `TAILORING_BASE_URL` and `TAILORING_MODEL`
 * were set to each other's values -- an easy transposition, since they are
 * adjacent lines that both come from the same provider's dashboard. Every
 * capability check passed (all three vars were non-empty), and the failure
 * surfaced as a POST to `openai/gpt-oss-120b/chat/completions`, which is not a
 * URL, several layers away from the line that caused it.
 *
 * A non-empty check cannot catch that. A shape check can, and it is three
 * lines: a base URL is a URL, and a model id is not.
 */
export function configProblems(config: IntegrationConfig): string[] {
  const problems: string[] = []
  const { baseUrl, model, apiKey } = config.tailoring

  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    problems.push(
      `TAILORING_BASE_URL should be a URL but is "${baseUrl}". ` +
        'Check it has not been swapped with TAILORING_MODEL.'
    )
  }
  if (model && /^https?:\/\//i.test(model)) {
    problems.push(
      'TAILORING_MODEL looks like a URL. Check it has not been swapped with TAILORING_BASE_URL.'
    )
  }
  // Two of three is a half-configured integration, which fails at the request
  // rather than at startup unless someone says so here.
  const present = [baseUrl, model, apiKey].filter(Boolean).length
  if (present > 0 && present < 3) {
    problems.push(
      'AI tailoring needs all three of TAILORING_BASE_URL, TAILORING_MODEL and ' +
        'TAILORING_API_KEY; some are set and some are not.'
    )
  }

  return problems
}

export function capabilitiesOf(config: IntegrationConfig): IntegrationCapabilities {
  return {
    // Both, and neither alone: a base URL with no key cannot authenticate and
    // a key with no base URL has nowhere to go.
    // Shape-checked, not just presence-checked: three non-empty strings in the
    // wrong order passed the old test and failed at the request.
    // The switch is read FIRST: a deployment told not to spend the key cannot
    // claim the capability, however complete its config is.
    tailorCv:
      config.tailoring.enabled !== false &&
      !!config.tailoring.apiKey &&
      /^https?:\/\//i.test(config.tailoring.baseUrl ?? '') &&
      !!config.tailoring.model &&
      !/^https?:\/\//i.test(config.tailoring.model),
    expandSkills: config.esco.enabled,
  }
}
