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

/**
 * The three jobs a model does here, which are three different jobs.
 *
 * `extract` fills a posting's fields: mechanical, schema-shaped, wants speed
 * and a big context window and no judgement at all. `cv` writes prose. `tailor`
 * rewrites a CV against a posting, which is judgement -- what to emphasise,
 * and what would be a lie -- and wants the largest model available.
 */
export type LlmTask = 'extract' | 'cv' | 'tailor'

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
    /**
     * The tailoring model, and the default for the other two.
     *
     * KEPT AS `model` BECAUSE IT IS WHAT PRODUCTION SETS. `TAILORING_MODEL`
     * has been live since 2026-09-15; renaming the field would mean renaming
     * the variable, and a rename of a production secret is an outage with a
     * deploy in the middle of it.
     */
    model: string
    /**
     * One model per job (Gabe, 2026-09-19, with an OpenRouter key: "we will
     * use three open-sourced models ... one for job description filling, one
     * for CV generation, one for CV tailoring").
     *
     * THEY ARE DIFFERENT JOBS AND THEY WANT DIFFERENT MACHINES. Filling a
     * posting's fields is mechanical extraction against a strict schema, where
     * speed and a big context window matter and judgement does not. Writing a
     * CV is prose. Tailoring one is judgement -- what to emphasise, and what
     * would be a lie -- and wants the largest model available.
     *
     * EACH FALLS BACK TO `model`, so a deployment that sets only
     * `TAILORING_MODEL` keeps working exactly as it did and gains the other
     * two features on the same model rather than not at all.
     */
    models?: Partial<Record<LlmTask, string>>
    /**
     * One PROVIDER per job, for the deployment where one task cannot live
     * where the others do (Gabe, 2026-09-22).
     *
     * WHY THIS HAD TO EXIST. Tailoring was timing out on an OpenRouter `:free`
     * endpoint -- a 550B model on shared capacity, against a 30s budget --
     * while the wizard and CV generation were perfectly happy on the same
     * account. Moving the deployment to Groq fixed tailoring and was refused
     * for a good reason: "do not change the models for application wizard and
     * generating CVs". There was no way to honour both, because ONE base URL
     * and ONE key served all three calls and the other two model ids do not
     * exist on Groq. A model override without a provider override only gets
     * you a model-not-found.
     *
     * BOTH HALVES OR NEITHER, enforced in `providerFor`. A host from one
     * vendor with a key from another authenticates against nothing -- which is
     * precisely the 401 that cost an afternoon on the way here, so the shape
     * that produced it is not reachable through this field.
     *
     * ABSENT IS THE NORMAL CASE. A deployment that sets none of these behaves
     * exactly as it did before this field existed.
     */
    providers?: Partial<Record<LlmTask, { baseUrl?: string; apiKey?: string }>>
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
      /*
        THE SHARED PROVIDER, AND IT IS NO LONGER CALLED `TAILORING_` (Gabe,
        2026-09-22: "change the variable name ... not tailor").
        
        THE OLD NAME HAD COME TO MEAN THE OPPOSITE OF WHAT IT SAID. Once
        tailoring got a provider of its own, `TAILORING_API_KEY` was the key
        that served the application wizard and CV generation and did NOT serve
        tailoring -- so the one variable with "tailoring" in its name was the
        one tailoring never touched. `PROVIDER_*` is what it actually is: the
        default every task uses unless `PROVIDER_<TASK>_*` overrides it.

        THE OLD NAMES STILL READ, and that is not politeness. A rename of a
        production secret is an outage with a deploy in the middle of it --
        this file has said so since `model` was kept under its old spelling for
        exactly that reason -- and Preview is still configured entirely under
        `TAILORING_*`. New name first, old name second, neither required.
      */
      baseUrl: trimmed('PROVIDER_BASE_URL') ?? trimmed('TAILORING_BASE_URL'),
      apiKey: trimmed('PROVIDER_API_KEY') ?? trimmed('TAILORING_API_KEY'),
      // No default that names a vendor. A model id is meaningless without the
      // base URL it belongs to, so the two are set together or not at all.
      //
      // `MODEL_DEFAULT` PAIRS WITH `MODEL_<TASK>`: the fallback of the same
      // family, rather than a fourth spelling of the same idea.
      model: trimmed('MODEL_DEFAULT') ?? trimmed('TAILORING_MODEL') ?? '',
      /*
        THE ENV NAME IS `REWRITE`, THE INTERNAL KEY IS `tailor` (Gabe,
        2026-09-22: "do not use tailor, use another term"). The word had been
        spent: `TAILORING_*` was the SHARED provider, `TAILOR_*` was one task's
        override, and three letters told them apart while they meant opposite
        things. `REWRITE` is what the call literally does -- the system prompt
        opens "You rewrite CV text so it matches a job posting more closely" --
        and it collides with nothing.

        THE INTERNAL `LlmTask` KEEPS ITS KEY because nobody types it. Renaming
        a union member touches every call site for no change to what anybody
        reads; the translation lives here, on one line, where it can be seen.

        `MODEL_TAILOR` STILL READS, so production is not broken by the rename
        landing before the variable does.
      */
      models: {
        extract: trimmed('MODEL_EXTRACT'),
        cv: trimmed('MODEL_CV'),
        tailor: trimmed('MODEL_REWRITE') ?? trimmed('MODEL_TAILOR'),
      },
      /*
        `PROVIDER_<TASK>_*`, PAIRING WITH `MODEL_<TASK>`: the model says WHICH
        machine, the provider says WHERE it lives. Unset is the normal case and
        means "use the shared pair" -- see `providerFor`, which also refuses a
        half override.

        THE PREFIX IS NOT DECORATION (Gabe, 2026-09-22: "change the variable
        name"). These were `TAILOR_BASE_URL` and `TAILOR_API_KEY` for about an
        hour, which differ from the SHARED `TAILORING_API_KEY` by three letters
        while meaning something entirely different -- one serves tailoring
        only, the other serves the wizard and CV generation. An hour was long
        enough for the wrong key to be pasted into the wrong one and for the
        result to surface as "the tailoring provider rejected the API key".
        A name that has to be read carefully is a name that will be misread.
      */
      providers: {
        extract: {
          baseUrl: trimmed('PROVIDER_EXTRACT_BASE_URL'),
          apiKey: trimmed('PROVIDER_EXTRACT_API_KEY'),
        },
        cv: {
          baseUrl: trimmed('PROVIDER_CV_BASE_URL'),
          apiKey: trimmed('PROVIDER_CV_API_KEY'),
        },
        tailor: {
          baseUrl: trimmed('PROVIDER_REWRITE_BASE_URL'),
          apiKey: trimmed('PROVIDER_REWRITE_API_KEY'),
        },
      },
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
      enabled: (trimmed('PROVIDER_ENABLED') ?? trimmed('TAILORING_ENABLED')) !== 'false',
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
  /** Whether a model writes the CV's prose, or the deterministic composer does. */
  writeCv: boolean
  /** Whether a model fills the fields the posting parser could not. */
  fillPosting: boolean
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
  /*
    THE SAME SHAPE CHECK, PER TASK. An override is two variables a person types
    by hand beside three they already typed, so the swap that catches the
    shared pair catches these too -- and a host that is really a model id fails
    at the request rather than at startup unless it is named here.
  */
  // `tailor` is the internal key; `REWRITE` is what somebody actually types.
  const ENV_NAME: Record<LlmTask, string> = { extract: 'EXTRACT', cv: 'CV', tailor: 'REWRITE' }
  for (const task of ['extract', 'cv', 'tailor'] as const) {
    const own = config.tailoring.providers?.[task]
    const name = ENV_NAME[task]
    if (own?.baseUrl && !/^https?:\/\//i.test(own.baseUrl)) {
      problems.push(
        `PROVIDER_${name}_BASE_URL should be a URL but is "${own.baseUrl}". ` +
          `Check it has not been swapped with MODEL_${name}.`
      )
    }
    // HALF AN OVERRIDE IS IGNORED RATHER THAN MERGED (see `providerFor`), and
    // silently ignoring what somebody deliberately set is worth a sentence.
    if (!!own?.baseUrl !== !!own?.apiKey && (own?.baseUrl || own?.apiKey)) {
      problems.push(
        `PROVIDER_${name}_BASE_URL and PROVIDER_${name}_API_KEY must be set together. ` +
          'Only one is set, so both are ignored and the shared provider is used.'
      )
    }
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

/**
 * Whether one model id is runnable on this deployment.
 *
 * THE SWITCH IS READ FIRST: a deployment told not to spend the key cannot
 * claim any of these, however complete its config is. Then both halves of the
 * connection -- a base URL with no key cannot authenticate and a key with no
 * base URL has nowhere to go -- and finally the SHAPE, because three non-empty
 * strings in the wrong order passed the old presence check and failed at the
 * request.
 */
export function modelFor(config: IntegrationConfig, task: LlmTask): string {
  return config.tailoring.models?.[task]?.trim() || config.tailoring.model
}

/**
 * Where one task's request is sent, and what signs it.
 *
 * THE PAIR MOVES TOGETHER OR NOT AT ALL. A half override -- a Groq host still
 * carrying the OpenRouter key -- authenticates against nothing and reports as
 * "the tailoring provider rejected the API key", which is a long way from the
 * variable that caused it. So an override with only one half is ignored
 * entirely rather than merged into the shared pair.
 */
export function providerFor(
  config: IntegrationConfig,
  task: LlmTask
): { baseUrl?: string; apiKey?: string } {
  const own = config.tailoring.providers?.[task]
  const baseUrl = own?.baseUrl?.trim()
  const apiKey = own?.apiKey?.trim()
  if (baseUrl && apiKey) return { baseUrl, apiKey }
  return { baseUrl: config.tailoring.baseUrl, apiKey: config.tailoring.apiKey }
}

function canRun(config: IntegrationConfig, task: LlmTask): boolean {
  // RESOLVED PER TASK, not read off the shared pair: since 2026-09-22 one task
  // can be configured while the others are not, so a single answer for all
  // three would claim a capability the request cannot make.
  const { baseUrl, apiKey } = providerFor(config, task)
  const model = modelFor(config, task)
  return (
    config.tailoring.enabled !== false &&
    !!apiKey &&
    /^https?:\/\//i.test(baseUrl ?? '') &&
    !!model &&
    !/^https?:\/\//i.test(model)
  )
}

export function capabilitiesOf(config: IntegrationConfig): IntegrationCapabilities {
  return {
    // Both, and neither alone: a base URL with no key cannot authenticate and
    // a key with no base URL has nowhere to go.
    // Shape-checked, not just presence-checked: three non-empty strings in the
    // wrong order passed the old test and failed at the request.
    // The switch is read FIRST: a deployment told not to spend the key cannot
    // claim the capability, however complete its config is.
    tailorCv: canRun(config, 'tailor'),
    writeCv: canRun(config, 'cv'),
    fillPosting: canRun(config, 'extract'),
    expandSkills: config.esco.enabled,
  }
}
