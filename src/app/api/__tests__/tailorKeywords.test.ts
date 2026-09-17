import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MAX_TERMS } from '@/services/atsMatch'

/**
 * WHAT THE MODEL IS ACTUALLY TOLD IS MISSING.
 *
 * `/api/tailor` used to forward `body.missingKeywords.slice(0, 40)`. The
 * scorer caps a posting at `MAX_TERMS` (100), so on a posting the CV matches
 * poorly `missing` is most of that -- measured at 65 on a mid-level front-end
 * advert, of which 25 were dropped here without a word to anyone, and three of
 * the 25 were the only terms in the list the CV could honestly have answered.
 *
 * The rewrite button spends a metered allowance per press. Spending it on a
 * truncated brief is the expensive kind of silent bug, so this pins the
 * boundary rather than trusting the next reader to notice a literal.
 */

const tailorCv = vi.fn()
vi.mock('@/services/integrations/tailoring', () => ({
  tailorCv: (...args: unknown[]) => tailorCv(...args),
}))
vi.mock('@/lib/apiAuth', () => ({
  authenticate: async () => ({ ok: true, caller: { userId: 'user-1' } }),
}))

const ENV = { ...process.env }

beforeEach(() => {
  tailorCv.mockReset()
  tailorCv.mockResolvedValue({ ok: true, summary: null, suggestions: [] })
  process.env.TAILORING_BASE_URL = 'https://llm.test/v1'
  process.env.TAILORING_API_KEY = 'k'
  process.env.TAILORING_MODEL = 'test-model'
  delete process.env.TAILORING_ENABLED
})

afterEach(() => {
  process.env = { ...ENV }
})

async function post(missingKeywords: string[]) {
  const { POST } = await import('../tailor/route')
  await POST(
    new Request('https://worktrack.test/api/tailor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cvText: 'React and TypeScript developer.',
        jobDescription: 'We need React, TypeScript and a great deal more.',
        missingKeywords,
      }),
    })
  )
  return tailorCv.mock.calls[0]?.[0] as { missingKeywords?: string[] }
}

describe('/api/tailor forwards the whole missing list', () => {
  it('does not drop keywords the scorer was able to produce', async () => {
    // A posting the CV answers badly: the scorer's own cap is the most terms
    // that can ever arrive, so none of them may be thrown away here.
    const missing = Array.from({ length: MAX_TERMS }, (_, i) => `term${i}`)
    const input = await post(missing)
    expect(input.missingKeywords).toHaveLength(MAX_TERMS)
    // The tail is the part the old `slice(0, 40)` ate, and on a real posting
    // it held the only terms the CV could honestly have answered.
    expect(input.missingKeywords).toContain('term99')
  })

  it('still refuses a list longer than the scorer can produce', async () => {
    // Not a trusted input: this arrives in a request body like anything else,
    // and the bound is what stops a caller pasting a novel into the prompt.
    const input = await post(Array.from({ length: 500 }, (_, i) => `term${i}`))
    expect(input.missingKeywords).toHaveLength(MAX_TERMS)
  })
})
