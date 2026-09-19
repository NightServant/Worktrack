import { describe, it, expect } from 'vitest'
import {
  capabilitiesOf,
  modelFor,
  readIntegrationConfig,
  type IntegrationConfig,
} from '../config'
import { parseJsonReply, askForJson } from '../llm'
import {
  fillPostingGaps,
  gapsIn,
  mergeFilled,
  MODEL_CONFIDENCE,
  type AutofillEnvelope,
} from '../postingFill'
import { readProse, factsFor } from '../cvWriter'
import { EMPTY_PROFILE } from '../../profile'

/**
 * Three models, one client, and the rules that keep any of them optional.
 *
 * The thing every test here is really defending: a deployment with no key, a
 * rate-limited free tier and a model that answers nonsense must all behave
 * like the app did before a model was involved.
 */

const CONFIG = (over: Partial<IntegrationConfig['tailoring']> = {}): IntegrationConfig => ({
  tailoring: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'k',
    model: 'fallback/model',
    ...over,
  },
  esco: { baseUrl: 'https://example.test', enabled: true },
})

describe('one model per job', () => {
  it('falls back to TAILORING_MODEL for every task', () => {
    // A deployment that set only the old variable keeps working and gains the
    // other two features on the same model rather than not at all.
    const config = CONFIG()
    expect(modelFor(config, 'extract')).toBe('fallback/model')
    expect(modelFor(config, 'cv')).toBe('fallback/model')
    expect(modelFor(config, 'tailor')).toBe('fallback/model')
  })

  it('prefers the per-task model where one is set', () => {
    const config = CONFIG({
      models: { extract: 'deepseek/v4:free', tailor: 'nvidia/ultra:free' },
    })
    expect(modelFor(config, 'extract')).toBe('deepseek/v4:free')
    expect(modelFor(config, 'tailor')).toBe('nvidia/ultra:free')
    // Unset ones still fall through rather than going empty.
    expect(modelFor(config, 'cv')).toBe('fallback/model')
  })

  it('reads all three from the environment', () => {
    const before = { ...process.env }
    process.env.TAILORING_BASE_URL = 'https://openrouter.ai/api/v1'
    process.env.TAILORING_API_KEY = 'k'
    process.env.TAILORING_MODEL = 'old/model'
    process.env.MODEL_EXTRACT = 'a/one'
    process.env.MODEL_CV = 'b/two'
    process.env.MODEL_TAILOR = 'c/three'
    const config = readIntegrationConfig()
    expect(modelFor(config, 'extract')).toBe('a/one')
    expect(modelFor(config, 'cv')).toBe('b/two')
    expect(modelFor(config, 'tailor')).toBe('c/three')
    process.env = before
  })

  it('claims a capability per task, and none of them when switched off', () => {
    expect(capabilitiesOf(CONFIG()).tailorCv).toBe(true)
    expect(capabilitiesOf(CONFIG()).writeCv).toBe(true)
    expect(capabilitiesOf(CONFIG()).fillPosting).toBe(true)
    // The kill switch is read first: a deployment told not to spend the shared
    // key cannot claim any of them, however complete its config is.
    const off = capabilitiesOf(CONFIG({ enabled: false }))
    expect([off.tailorCv, off.writeCv, off.fillPosting]).toEqual([false, false, false])
    // And a transposed base URL and model still fails the shape check.
    expect(capabilitiesOf(CONFIG({ model: 'https://not-a-model' })).writeCv).toBe(false)
  })
})

describe('the shared client', () => {
  it('reports a missing configuration rather than calling anything', async () => {
    const result = await askForJson(
      { task: 'cv', system: 's', user: 'u' },
      {
        config: CONFIG({ apiKey: undefined }),
        fetchImpl: () => {
          throw new Error('must not be called')
        },
      }
    )
    expect(result).toMatchObject({ ok: false, reason: 'disabled' })
  })

  it('tells a rate limit from a key problem from a fault', async () => {
    const reply = (status: number) =>
      askForJson(
        { task: 'cv', system: 's', user: 'u' },
        {
          config: CONFIG(),
          fetchImpl: async () => new Response('{}', { status }),
        }
      )
    // 429 is the ORDINARY state of a free tier and gets its own sentence.
    expect(await reply(429)).toMatchObject({ ok: false, reason: 'rate-limit' })
    expect(await reply(401)).toMatchObject({ ok: false, reason: 'auth' })
    expect(await reply(500)).toMatchObject({ ok: false, reason: 'network' })
  })

  it('sends the chosen task’s model and asks for JSON', async () => {
    let sent: Record<string, unknown> = {}
    await askForJson(
      { task: 'extract', system: 's', user: 'u' },
      {
        config: CONFIG({ models: { extract: 'deepseek/v4:free' } }),
        fetchImpl: async (_url, init) => {
          sent = JSON.parse(String((init as RequestInit).body))
          return new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }))
        },
      }
    )
    expect(sent.model).toBe('deepseek/v4:free')
    // ASKED FOR, NOT HOPED FOR -- the production bug this shares with tailoring.
    expect(sent.response_format).toEqual({ type: 'json_object' })
  })

  it('sends the ceilings that make a short budget safe', async () => {
    // Gabe, 2026-09-19: "shorter budget for CV writing without loosing
    // quality". The budget is only safe because the call was made cheaper
    // first -- reasoning tokens are generated BEFORE the first character of
    // the answer, so they are pure wait on a writing task.
    let sent: Record<string, unknown> = {}
    await askForJson(
      {
        task: 'cv',
        system: 's',
        user: 'u',
        maxTokens: 3000,
        reasoningEffort: 'low',
      },
      {
        config: CONFIG(),
        fetchImpl: async (_url, init) => {
          sent = JSON.parse(String((init as RequestInit).body))
          return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }))
        },
      }
    )
    expect(sent.max_tokens).toBe(3000)
    expect(sent.reasoning_effort).toBe('low')
    // AND NOT THE NESTED FORM, which is the regression this pins: Groq answers
    // `reasoning: { effort }` with `400 property 'reasoning' is unsupported`,
    // and a 400 here costs the whole answer rather than the saving.
    expect('reasoning' in sent).toBe(false)
  })

  it('omits both when the caller does not ask, so other tasks are unchanged', async () => {
    let sent: Record<string, unknown> = {}
    await askForJson(
      { task: 'tailor', system: 's', user: 'u' },
      {
        config: CONFIG(),
        fetchImpl: async (_url, init) => {
          sent = JSON.parse(String((init as RequestInit).body))
          return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }))
        },
      }
    )
    expect('max_tokens' in sent).toBe(false)
    expect('reasoning_effort' in sent).toBe(false)
  })

  it('strips the fences a model adds even when told not to', () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ ok: true, data: { a: 1 } })
    expect(parseJsonReply('no json here')).toMatchObject({ ok: false, reason: 'bad-response' })
  })
})

describe('filling a posting’s gaps', () => {
  const envelope = (values: Record<string, unknown>): AutofillEnvelope => ({
    values,
    confidence: { role: 0.9 },
    warnings: [],
  })

  it('offers only the fields the parser left empty', () => {
    const gaps = gapsIn(envelope({ role: 'Engineer', company: '', tech_stack: [] }))
    expect(gaps).toContain('company')
    expect(gaps).toContain('tech_stack')
    expect(gaps).not.toContain('role')
  })

  it('never overwrites what the parser found', () => {
    const before = envelope({ role: 'Engineer', company: '' })
    const after = mergeFilled(before, { role: 'Something Else', company: 'Acme' }, ['company'])
    expect(after.values.role).toBe('Engineer')
    expect(after.values.company).toBe('Acme')
    // A read value is the weakest thing on the form.
    expect(after.confidence.company).toBe(MODEL_CONFIDENCE)
    expect(after.confidence.role).toBe(0.9)
  })

  it('refuses a salary that is not a number, and a work mode that is not one', () => {
    // Models answer "competitive" and "DOE" to this question surprisingly often.
    const after = mergeFilled(
      envelope({}),
      { salary_min: 'competitive', work_mode: 'flexible', salary_max: '90,000' },
      ['salary_min', 'work_mode', 'salary_max']
    )
    expect(after.values.salary_min).toBeUndefined()
    expect(after.values.work_mode).toBeUndefined()
    // And a number written with a comma is still a number.
    expect(after.values.salary_max).toBe(90000)
  })

  it('says out loud that a model read them, once', () => {
    const after = mergeFilled(envelope({}), { company: 'Acme', location: 'Manila' }, [
      'company',
      'location',
    ])
    expect(after.warnings).toHaveLength(1)
    expect(after.warnings[0]).toContain('2 fields were read')
  })

  it('spends a short budget on it, because somebody is watching the form', async () => {
    // Gabe, 2026-09-19: "apply the shorter model budget for CV tailoring and
    // application wizard". The wait went 20s -> 15s, and these are what pay
    // for it -- reading a posting is a copying task, so reasoning tokens are
    // spent before the answer starts, and the schema is nine keys wide.
    let sent: Record<string, unknown> = {}
    await fillPostingGaps(envelope({ description: 'Pays PHP 50,000 a month.', company: '' }), {
      config: CONFIG(),
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(String((init as RequestInit).body))
        return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }))
      },
    })
    expect(sent.max_tokens).toBe(800)
    expect(sent.reasoning_effort).toBe('low')
  })

  it('returns the envelope untouched when the model filled nothing', () => {
    const before = envelope({ role: 'Engineer' })
    expect(mergeFilled(before, {}, ['company'])).toBe(before)
  })
})

describe('what the CV writer is allowed to send and keep', () => {
  it('sends at most four README lines per project', async () => {
    // Generation time is roughly linear in what is written, and a CV entry is
    // three or four bullets -- so sending nine means the model reads nine and
    // writes nine, both of them time spent on lines the reader will delete.
    const { EMPTY_PROFILE: EMPTY } = await import('../../profile')
    const facts = factsFor({
      ...EMPTY,
      projects: [
        {
          title: 'Worktrack',
          description: 'A tracker.',
          url: null,
          highlights: ['one', 'two', 'three', 'four', 'five', 'six'],
          tech: [],
          language: null,
          stars: null,
          homepage: null,
          updatedAt: null,
        },
      ],
    })
    const readme = JSON.parse(facts).projects[0].readme as string[]
    expect(readme).toEqual(['one', 'two', 'three', 'four'])
  })

  it('never sends the address or the birth date', () => {
    // They are in `UserProfile` and have no business in a prompt to a third
    // party.
    const facts = factsFor({
      ...EMPTY_PROFILE,
      name: 'Elijah Gabe Cervantes',
      address: 'Block 2, Lot 29, Bamban, Tarlac',
      birthDate: 'Mar 7',
      email: 'someone@example.com',
      headline: 'Front-end developer',
    })
    expect(facts).not.toContain('Bamban')
    expect(facts).not.toContain('Mar 7')
    expect(facts).not.toContain('someone@example.com')
    expect(facts).toContain('Front-end developer')
  })

  it('keeps a half-answer rather than throwing it away', () => {
    // A model that writes good project prose and forgets the summary should
    // contribute the projects.
    const prose = readProse({
      summary: '   ',
      skills: [
        { label: 'Frontend & UI', sentence: 'Builds interfaces with React.' },
        { label: 'Broken', sentence: '' },
      ],
      projects: [
        { title: 'Worktrack', lead: 'A job tracker.', bullets: ['Tracks applications.', ''] },
        { title: '', lead: 'no title', bullets: [] },
      ],
    } as never)
    expect(prose.summary).toBeNull()
    expect(prose.skills).toEqual([
      { label: 'Frontend & UI', sentence: 'Builds interfaces with React.' },
    ])
    expect(prose.projects).toHaveLength(1)
    expect(prose.projects[0].bullets).toEqual(['Tracks applications.'])
  })
})
