import { describe, it, expect, vi } from 'vitest'
import {
  capabilitiesOf,
  configProblems,
  readIntegrationConfig,
  type IntegrationConfig,
} from '../config'
import { parseTailoringReply, tailorCv } from '../tailoring'

function configWith(overrides: Partial<IntegrationConfig> = {}): IntegrationConfig {
  return {
    tailoring: { model: '' },
    esco: { baseUrl: 'https://esco.test/api', enabled: true },
    ...overrides,
  }
}

describe('what this deployment can do', () => {
  it('reports every capability off when nothing is configured', () => {
    // The state of CI, a fresh clone and the demo. Every client degrades to a
    // documented fallback rather than throwing, so this is the normal case
    // and not an error one.
    const caps = capabilitiesOf(configWith())
    expect(caps.tailorCv).toBe(false)
    // ESCO needs no key at all, so it is on unless explicitly disabled.
    expect(caps.expandSkills).toBe(true)
  })

  it('needs base URL, key AND model before it will claim it can tailor', () => {
    // Two of three is not a working integration: a key with no base URL has
    // nowhere to go, and a model id means nothing without the endpoint it
    // belongs to. Claiming the capability on a partial config would move the
    // failure from a settings screen to the middle of a user's edit.
    const partial = configWith({ tailoring: { apiKey: 'k', model: 'm' } })
    expect(capabilitiesOf(partial).tailorCv).toBe(false)
    const whole = configWith({
      tailoring: { apiKey: 'k', model: 'm', baseUrl: 'https://api.test/v1' },
    })
    expect(capabilitiesOf(whole).tailorCv).toBe(true)
  })

  it('catches a base URL and a model swapped for each other', () => {
    // THIS IS A REAL BUG THAT SHIPPED INTO .env.local, not a hypothetical:
    // both vars come off the same provider dashboard on adjacent lines and are
    // easy to transpose. All three values were non-empty, so every presence
    // check passed, and the failure surfaced as a POST to
    // "openai/gpt-oss-120b/chat/completions" -- not a URL -- several layers
    // from the line that caused it.
    const swapped = configWith({
      tailoring: {
        apiKey: 'k',
        baseUrl: 'openai/gpt-oss-120b',
        model: 'https://api.groq.com/openai/v1',
      },
    })
    expect(capabilitiesOf(swapped).tailorCv).toBe(false)
    const problems = configProblems(swapped).join(' ')
    expect(problems).toMatch(/TAILORING_BASE_URL should be a URL/)
    expect(problems).toMatch(/TAILORING_MODEL looks like a URL/)
  })

  it('passes a correctly ordered config', () => {
    // The companion. Without it, "rejects the swap" would also pass if the
    // check rejected everything.
    const right = configWith({
      tailoring: {
        apiKey: 'k',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'openai/gpt-oss-120b',
      },
    })
    expect(capabilitiesOf(right).tailorCv).toBe(true)
    expect(configProblems(right)).toEqual([])
  })

  it('will not claim the capability on a deployment that is switched off', () => {
    // Production and Preview hold the SAME provider key, and every free tier
    // meters by key rather than by deployment -- so a preview branch that
    // tailors a CV spends the live site's daily quota, and the live site
    // reports the exhaustion as a model error. Preview carries
    // TAILORING_ENABLED=false, and it has to beat a config that is otherwise
    // complete, which is the entire point of it.
    const off = configWith({
      tailoring: {
        apiKey: 'k',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'openai/gpt-oss-120b',
        enabled: false,
      },
    })
    expect(capabilitiesOf(off).tailorCv).toBe(false)
    // And it is NOT a misconfiguration: nothing about this deployment is
    // wrong, so nothing is reported to the operator as though it were.
    expect(configProblems(off)).toEqual([])
  })

  it('reads the switch from the environment, and absent means on', () => {
    // The default matters more than the switch: every existing deployment has
    // no such variable, and none of them may lose tailoring by this field
    // coming into existence.
    vi.stubEnv('TAILORING_ENABLED', 'false')
    expect(readIntegrationConfig().tailoring.enabled).toBe(false)
    vi.stubEnv('TAILORING_ENABLED', '')
    expect(readIntegrationConfig().tailoring.enabled).toBe(true)
    vi.unstubAllEnvs()
  })

  it('names a half-configured integration instead of failing at the request', () => {
    const half = configWith({ tailoring: { apiKey: 'k', model: 'm' } })
    expect(configProblems(half).join(' ')).toMatch(/needs all three/)
    // Nothing set at all is not a problem -- it is the normal unconfigured state.
    expect(configProblems(configWith())).toEqual([])
  })

  it('defaults FormaTeX to the base URL that was actually probed', () => {
    // `/api/v1` is not a guess: POST /api/v1/compile answered 401 while
    // /v1/compile answered 404, which is how the path was established.
  })
})

describe('reading a tailoring reply', () => {
  const good = JSON.stringify({
    summary: 'Front-end developer with React and TypeScript.',
    suggestions: [
      { section: 'summary', before: 'old', after: 'new', rationale: 'uses the posting wording' },
    ],
  })

  it('accepts clean JSON', () => {
    const result = parseTailoringReply(good)
    expect(result).toMatchObject({ ok: true })
    expect(result.ok === true && result.suggestions).toHaveLength(1)
  })

  it('accepts JSON the model wrapped in a code fence anyway', () => {
    // Models add ```json even when told not to. Failing over the packaging
    // throws away a good answer.
    expect(parseTailoringReply('```json\n' + good + '\n```')).toMatchObject({ ok: true })
    expect(parseTailoringReply('Here you go:\n' + good)).toMatchObject({ ok: true })
  })

  it('drops a suggestion that is missing any of its four fields', () => {
    // A suggestion with no `after` is a control the user cannot act on, and
    // one with no rationale is a change they cannot judge. Both are dropped
    // rather than rendered half-blank.
    const partial = JSON.stringify({
      summary: null,
      suggestions: [
        { section: 'summary', before: 'a', after: 'b', rationale: 'ok' },
        { section: 'skills', before: 'a', after: 'b' },
        { section: 'skills', after: 'b', rationale: 'no before' },
      ],
    })
    const result = parseTailoringReply(partial)
    expect(result.ok === true && result.suggestions).toHaveLength(1)
  })

  it('reports malformed output as such, not as an empty result', () => {
    // An empty result reads as "nothing to change", which is the opposite of
    // "the model failed" and would quietly tell the user their CV is fine.
    expect(parseTailoringReply('I am sorry, I cannot do that.')).toMatchObject({
      ok: false,
      reason: 'bad-response',
    })
    expect(parseTailoringReply('{not json at all')).toMatchObject({ reason: 'bad-response' })
  })
})

describe('the tailoring request', () => {
  const config = configWith({
    tailoring: { apiKey: 'k', model: 'test-model', baseUrl: 'https://api.test/v1' },
  })

  it('gives a rate-limited free tier its own answer', async () => {
    // 429 is the ordinary state of a free tier, not a fault. It gets its own
    // reason so the UI can say "try again in a minute" instead of "something
    // went wrong".
    const fetchImpl = vi.fn().mockResolvedValue({ status: 429, ok: false }) as unknown as typeof fetch
    await expect(
      tailorCv({ cvText: 'cv', jobDescription: 'jd' }, { config, fetchImpl })
    ).resolves.toMatchObject({ ok: false, reason: 'rate-limit' })
  })

  it('forbids invention in the instruction it sends', async () => {
    // The single most likely harm from pointing a model at a CV is a claim
    // its owner has to defend in an interview. Asserted on the wire, so the
    // rule cannot be edited out of the prompt without a red test.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"summary":null,"suggestions":[]}' } }] }),
    }) as unknown as typeof fetch

    await tailorCv({ cvText: 'cv', jobDescription: 'jd' }, { config, fetchImpl })
    const body = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    )
    expect(body.messages[0].content).toMatch(/must not invent/i)
    expect(body.model).toBe('test-model')
  })

  it('asks the provider to constrain the reply to JSON', async () => {
    // Production returned "The model returned malformed JSON" while the prompt
    // alone was doing the asking. The prompt is still there, but a generated
    // reply can put a literal newline inside a string that quotes a multi-line
    // CV block, and no wording prevents that -- `response_format` does. If this
    // field is dropped the failure comes back intermittently and only under
    // real CVs, which is the hardest kind to reproduce, so it is pinned here.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"summary":null,"suggestions":[]}' } }] }),
    }) as unknown as typeof fetch

    await tailorCv({ cvText: 'cv', jobDescription: 'jd' }, { config, fetchImpl })
    const body = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    )
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('sends the ceilings that make the shorter wait safe', async () => {
    // Gabe, 2026-09-19: "apply the shorter model budget for CV tailoring and
    // application wizard". The wait went 45s -> 30s, and it is only honest
    // because the call was made cheaper first: reasoning tokens are generated
    // BEFORE the first character of the answer, so on a rewriting task they
    // are pure wait, and an uncapped suggestion list spends the rest of the
    // budget on a tail nobody scrolls to. Drop either and the timeout becomes
    // a promise the call cannot keep.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"summary":null,"suggestions":[]}' } }] }),
    }) as unknown as typeof fetch

    await tailorCv({ cvText: 'cv', jobDescription: 'jd' }, { config, fetchImpl })
    const body = JSON.parse(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    )
    expect(body.max_tokens).toBe(2500)
    expect(body.reasoning_effort).toBe('low')
    // AND NOT THE NESTED FORM, which is the regression this pins: Groq answers
    // `reasoning: { effort }` with `400 property 'reasoning' is unsupported`,
    // and a 400 here costs the whole answer rather than the saving.
    expect('reasoning' in body).toBe(false)
    expect(body.messages[0].content).toMatch(/at most 8 suggestions/i)
  })

  it('refuses to run without both halves', async () => {
    await expect(
      tailorCv({ cvText: '', jobDescription: 'jd' }, { config })
    ).resolves.toMatchObject({ ok: false })
    await expect(
      tailorCv({ cvText: 'cv', jobDescription: '' }, { config })
    ).resolves.toMatchObject({ ok: false })
  })
})
