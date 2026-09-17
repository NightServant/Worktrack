import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MAX_CHUNK_CHARS,
  PROOFREAD_CACHE_KEY,
  applyIssue,
  cacheIssues,
  cachedIssues,
  categoryOf,
  chunkText,
  contextOf,
  splitByCategory,
  toIssues,
  type GrammarIssue,
} from '../grammar'

/** The live shape, abbreviated: offset/length, an array of replacements. */
const match = (
  offset: number,
  length: number,
  replacements: string[],
  issueType = 'grammar',
  categoryId = 'GRAMMAR'
) => ({
  offset,
  length,
  shortMessage: 'Problem',
  replacements: replacements.map((value) => ({ value })),
  rule: { issueType, category: { id: categoryId } },
})

describe('chunkText', () => {
  it('leaves text the API already accepts in one piece', () => {
    expect(chunkText('a short CV')).toEqual([{ text: 'a short CV', offset: 0 }])
  })

  it('returns nothing for nothing, rather than one empty request', () => {
    expect(chunkText('')).toEqual([])
  })

  it('never exceeds the vendor ceiling', () => {
    // Deliberately past MAX_CHUNK_CHARS rather than a fixed number, so raising
    // the cap (5,000 under GrammarBot, 20,000 here) does not quietly stop this
    // test exercising the split at all.
    const text = 'word '.repeat(MAX_CHUNK_CHARS)
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS)
    }
  })

  it('reassembles into exactly the original text', () => {
    // THE INVARIANT THAT MATTERS. If chunking drops or duplicates a character,
    // every offset after that point is wrong and corrections land on the wrong
    // words -- which looks like a bad checker rather than a bad splitter.
    const text = 'Sentence one. Sentence two.\n\n' + 'filler words here. '.repeat(600)
    // An explicit window, so this asserts the reassembly invariant rather than
    // the vendor's current limit.
    const chunks = chunkText(text, 1000)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((c) => c.text).join('')).toBe(text)
  })

  it('reports an offset that indexes the original text', () => {
    const text = 'x'.repeat(120) + ' ' + 'y'.repeat(120)
    const chunks = chunkText(text, 100)
    for (const chunk of chunks) {
      expect(text.slice(chunk.offset, chunk.offset + chunk.text.length)).toBe(chunk.text)
    }
  })

  it('prefers a paragraph break to a mid-sentence cut', () => {
    const head = 'a'.repeat(85)
    const text = `${head}\n\ntail text here`
    const [first] = chunkText(text, 100)
    expect(first.text).toBe(`${head}\n\n`)
  })

  it('splits mid-word only when one word fills the whole window', () => {
    // A pasted base64 blob has no boundary to find; refusing to split would
    // mean never sending it at all.
    const blob = 'Z'.repeat(250)
    const chunks = chunkText(blob, 100)
    expect(chunks.map((c) => c.text).join('')).toBe(blob)
    expect(chunks[0].text.length).toBe(100)
  })

  it('refuses a nonsense window instead of looping forever', () => {
    expect(() => chunkText('abc', 0)).toThrow(RangeError)
  })
})

describe('categoryOf', () => {
  it('routes style and redundancy to the refinements section', () => {
    expect(categoryOf('style', 'STYLE')).toBe('style')
    expect(categoryOf('style', 'REDUNDANCY')).toBe('style')
    expect(categoryOf(undefined, 'REDUNDANCY')).toBe('style')
  })

  it('treats grammar, and anything unknown, as grammar', () => {
    // Deliberately one-sided: an unrecognised rule must still reach a tab.
    // Losing an issue is worse than filing it under the wrong heading.
    for (const [type, id] of [
      ['grammar', 'GRAMMAR'],
      ['whatever-is-new', 'SOMETHING_NEW'],
      [undefined, undefined],
    ] as const) {
      expect(categoryOf(type, id), `${type}/${id}`).toBe('grammar')
    }
  })
})

describe('toIssues', () => {
  it('converts offset/length into start/end', () => {
    // The vendor changed shape when GrammarBot was replaced. This conversion
    // happens once, here, so nothing downstream holds two conventions.
    expect(toIssues({ matches: [match(5, 2, ['is'])] })[0]).toMatchObject({
      start: 5,
      end: 7,
      replacements: ['is'],
      category: 'grammar',
    })
  })

  it('keeps every replacement, which is what the suggestion list needs', () => {
    const [issue] = toIssues({ matches: [match(40, 3, ['goes', 'went', 'go'])] })
    expect(issue.replacements).toEqual(['goes', 'went', 'go'])
    expect(issue.category).toBe('grammar')
  })

  it('caps the replacement list so a rail is not flooded', () => {
    const many = Array.from({ length: 20 }, (_, i) => `option${i}`)
    expect(toIssues({ matches: [match(0, 1, many)] })[0].replacements).toHaveLength(5)
  })

  it('shifts offsets by the chunk they came from', () => {
    // Chunk matches are chunk-relative; the document is what gets
    // highlighted. Forgetting this is the bug class chunking introduces.
    const [issue] = toIssues({ matches: [match(5, 2, ['is'])] }, 1000)
    expect(issue.start).toBe(1005)
    expect(issue.end).toBe(1007)
  })

  it('prefers shortMessage, falling back to the long one', () => {
    const long = { offset: 0, length: 1, message: 'A long explanation.', replacements: [] }
    expect(toIssues({ matches: [long] })[0].message).toBe('A long explanation.')
  })

  it('survives a response with no matches at all', () => {
    expect(toIssues({})).toEqual([])
    expect(toIssues({ matches: [] })).toEqual([])
  })

  it('drops a match whose range is impossible', () => {
    const bad = {
      matches: [
        { offset: -1, length: 2, replacements: [] },
        { offset: 0, length: -5, replacements: [] },
        match(0, 1, ['z']),
      ],
    }
    expect(toIssues(bad)).toHaveLength(1)
  })

  it('keeps a match that proposes nothing, which is still worth showing', () => {
    const [issue] = toIssues({ matches: [match(3, 4, [])] })
    expect(issue.replacements).toEqual([])
  })
})

describe('splitByCategory', () => {
  it('separates the two sections and orders each by position', () => {
    const issues = toIssues({
      matches: [
        match(30, 2, ['a']),
        match(10, 2, ['b']),
        match(20, 2, ['d'], 'style', 'REDUNDANCY'),
      ],
    })
    const { grammar, style } = splitByCategory(issues)
    expect(grammar.map((i) => i.start)).toEqual([10, 30])
    expect(style.map((i) => i.start)).toEqual([20])
  })

  it('does not mutate the list it was given', () => {
    const issues = toIssues({ matches: [match(9, 1, []), match(1, 1, [])] })
    splitByCategory(issues)
    expect(issues.map((i) => i.start)).toEqual([9, 1])
  })
})

describe('applyIssue', () => {
  const text = 'This be the best'

  it('replaces exactly the flagged range with the chosen option', () => {
    const [issue] = toIssues({ matches: [match(5, 2, ['is', 'was'])] })
    expect(applyIssue(text, issue, 'is')).toBe('This is the best')
    // The SECOND suggestion, because the card lets you pick one.
    expect(applyIssue(text, issue, 'was')).toBe('This was the best')
  })

  it('deletes when the replacement is empty', () => {
    const [issue] = toIssues({ matches: [match(4, 3, [''])] })
    expect(applyIssue(text, issue, '')).toBe('This the best')
  })

  it('leaves the text alone when the issue does not fit it', () => {
    // A stale issue -- one produced before an earlier accept moved everything
    // after it -- must not be allowed to slice at a bad index.
    const [issue] = toIssues({ matches: [match(500, 400, ['x'])] })
    expect(applyIssue(text, issue, 'x')).toBe(text)
  })
})

describe('what the editor refuses to surface', () => {
  // Both of these were reported from the running app rather than imagined.
  const ruleMatch = (id: string, type: string, cat: string, reps: string[]) => ({
    offset: 0,
    length: 2,
    replacements: reps.map((value) => ({ value })),
    rule: { id, issueType: type, category: { id: cat } },
  })

  it('drops doubled-space findings, whose suggestion is a space', () => {
    // Gabe reported this twice. The replacement is literally " ", so the card
    // rendered an empty button, and ProseMirror normalises runs of spaces on
    // its own regardless.
    const dropped = toIssues({
      matches: [ruleMatch('CONSECUTIVE_SPACES', 'typographical', 'TYPOGRAPHY', [' '])],
    })
    expect(dropped).toEqual([])
  })

  it('drops the comma-spacing rule, which is the other whitespace one', () => {
    const dropped = toIssues({
      matches: [ruleMatch('COMMA_PARENTHESIS_WHITESPACE', 'whitespace', 'TYPOGRAPHY', [','])],
    })
    expect(dropped).toEqual([])
  })

  it('drops spelling, which was two-thirds proper nouns on a real CV', () => {
    const dropped = toIssues({
      matches: [ruleMatch('MORFOLOGIK_RULE_EN_US', 'misspelling', 'TYPOS', ['calendar'])],
    })
    expect(dropped).toEqual([])
  })

  it('keeps real grammar, which is the whole point of dropping the rest', () => {
    const kept = toIssues({
      matches: [ruleMatch('HE_VERB_AGR', 'grammar', 'GRAMMAR', ['goes', 'went'])],
    })
    expect(kept).toHaveLength(1)
    expect(kept[0].category).toBe('grammar')
  })

  it('keeps style findings, which are the refinements section', () => {
    const kept = toIssues({
      matches: [ruleMatch('REDUNDANCY_X', 'style', 'REDUNDANCY', ['use'])],
    })
    expect(kept).toHaveLength(1)
    expect(kept[0].category).toBe('style')
  })

  it('drops any finding whose only suggestions are whitespace', () => {
    // A backstop on the shape rather than the rule name: whatever produced it,
    // a suggestion that renders as nothing is not a control.
    const dropped = toIssues({
      matches: [ruleMatch('SOMETHING_NEW', 'grammar', 'GRAMMAR', ['  ', ' '])],
    })
    expect(dropped).toEqual([])
  })
})

describe('contextOf', () => {
  const text = 'The team was great. He go to work early. Everyone agreed on that.'
  const [issue] = toIssues({
    matches: [{ offset: 23, length: 2, replacements: [{ value: 'goes' }], rule: { id: 'HE_VERB_AGR', issueType: 'grammar', category: { id: 'GRAMMAR' } } }],
  })

  it('returns the flagged span and what surrounds it', () => {
    const ctx = contextOf(text, issue)
    expect(ctx.flagged).toBe('go')
    expect(ctx.before).toContain('He ')
    expect(ctx.after).toContain(' to work')
  })

  it('marks a truncated edge with an ellipsis, and a clean edge without', () => {
    const long = 'x'.repeat(200) + text
    const moved = { ...issue, start: issue.start + 200, end: issue.end + 200 }
    expect(contextOf(long, moved).before.startsWith('…')).toBe(true)
    expect(contextOf(text, issue).before.startsWith('…')).toBe(false)
  })
})

/**
 * The cache in front of the request.
 *
 * IT IS A RATE-LIMIT GUARD, NOT A SPEED ONE, and that is what these assert.
 * The check runs on its own when the grammar pane opens (2026-09-17), and the
 * free LanguageTool endpoint is limited per IP -- so "answers from storage"
 * and "never grows without bound" are both correctness properties here, not
 * optimisations. The behaviour the pane depends on is covered end to end in
 * `components/cv/__tests__/proofreadAutoCheck.test.tsx`; what is left for this
 * file is the two paths a rendered pane cannot reach: eviction, and storage
 * refusing the write.
 */
describe('the proofread cache', () => {
  const issue = (start: number): GrammarIssue => ({
    start,
    end: start + 2,
    replacements: ['goes'],
    category: 'grammar',
    rawCategory: 'GRAMMAR',
    message: 'Agreement error',
  })

  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('answers for the exact text it was given, and not for any other', () => {
    cacheIssues('He go to work.', [issue(3)])
    expect(cachedIssues('He go to work.')).toEqual([issue(3)])
    // One character different is a different document: those offsets index
    // text that is no longer there.
    expect(cachedIssues('He go to work!')).toBeNull()
  })

  it('separates "nothing wrong" from "never checked"', () => {
    // `[]` is a real answer and `null` is a miss. Reading a clean document as
    // a miss would re-check exactly the CVs that never need it again.
    cacheIssues('A clean sentence.', [])
    expect(cachedIssues('A clean sentence.')).toEqual([])
    expect(cachedIssues('An unseen sentence.')).toBeNull()
  })

  it('keeps five documents and drops the oldest, so comparing CVs still hits', () => {
    // One entry was the first shape and it thrashes on the thing people
    // actually do -- flipping between two CVs -- where every switch back is a
    // fresh request and the cache has bought nothing.
    for (let n = 0; n < 6; n += 1) cacheIssues(`document ${n}`, [issue(n)])

    expect(cachedIssues('document 0')).toBeNull()
    for (let n = 1; n < 6; n += 1) {
      expect(cachedIssues(`document ${n}`)).toEqual([issue(n)])
    }
  })

  it('re-checking a document moves it to the front rather than duplicating it', () => {
    cacheIssues('the CV', [issue(1)])
    cacheIssues('the CV', [issue(2)])
    expect(cachedIssues('the CV')).toEqual([issue(2)])
    expect(JSON.parse(window.localStorage.getItem(PROOFREAD_CACHE_KEY)!)).toHaveLength(1)
  })

  it('evicts the rest rather than storing nothing when the quota refuses', () => {
    // `setItem` throws QuotaExceededError SYNCHRONOUSLY, and the payload
    // scales with the document -- a 50,000-word CV is several hundred KB of
    // text and findings. A failed write is retried with only the new entry,
    // so the document somebody is looking at is the one that survives.
    cacheIssues('an older CV', [issue(1)])

    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (JSON.parse(value).length > 1) throw new Error('QuotaExceededError')
      real.call(this, key, value)
    })

    cacheIssues('a very long CV', [issue(2)])
    expect(cachedIssues('a very long CV')).toEqual([issue(2)])
    expect(cachedIssues('an older CV')).toBeNull()
  })

  it('caches nothing, and throws nothing, when storage is unavailable', () => {
    // Private windows and blocked site data throw on access. Losing the cache
    // costs a request; letting the throw out costs the pane.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('access denied')
    })

    expect(() => cacheIssues('the CV', [issue(1)])).not.toThrow()
    expect(cachedIssues('the CV')).toBeNull()
  })

  it('ignores a stored value it does not recognise', () => {
    // The value outlives the code that wrote it and is editable by anyone with
    // devtools open. A malformed entry taken as a hit renders findings that
    // index nothing.
    window.localStorage.setItem(PROOFREAD_CACHE_KEY, 'not json at all')
    expect(cachedIssues('the CV')).toBeNull()

    window.localStorage.setItem(
      PROOFREAD_CACHE_KEY,
      JSON.stringify([{ text: 'the CV', issues: 'nonsense' }, { text: 'the CV' }])
    )
    expect(cachedIssues('the CV')).toBeNull()
  })
})
