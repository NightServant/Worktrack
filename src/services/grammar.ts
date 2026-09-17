/**
 * The LanguageTool boundary: chunking text into it, typed issues out of it.
 *
 * WHY LANGUAGETOOL AND NOT GRAMMARBOT. GrammarBot is shutting down (Gabe,
 * 2026-09-11). LanguageTool replaces it and is a better fit on every axis that
 * mattered here, which is worth recording because it removed three compromises
 * rather than one:
 *
 *   NO API KEY. The public endpoint is keyless, so there is nothing to protect
 *   and nothing to configure before the feature works.
 *   CORS IS OPEN -- `access-control-allow-origin: *`, verified 2026-09-11 --
 *   so the browser calls it directly. GrammarBot refused browser requests and
 *   forced a server proxy; that proxy has been deleted, because with a
 *   per-IP rate limit a shared server address is strictly worse than each
 *   user's own.
 *   SEVERAL REPLACEMENTS PER ERROR, not one. Word's spelling card lists
 *   alternatives, and with GrammarBot that list could only ever hold a single
 *   entry. `replacements` is an array.
 *   A STYLE CATEGORY EXISTS. `REDUNDANCY`, `STYLE` and `TYPOGRAPHY` carry
 *   `issueType: style`, which is what makes Word's Refinements block real data
 *   instead of a section that had to be left out to avoid inventing numbers.
 *
 * THE CONTRACT, verified against the live endpoint rather than the docs:
 *
 *   POST https://api.languagetool.org/v2/check     (form-encoded)
 *   language=en-US&text=...
 *
 *   { "matches": [ { "offset": 40, "length": 3,
 *                    "message": "...", "shortMessage": "Spelling mistake",
 *                    "replacements": [ {"value": "the"}, {"value": "ten"} ],
 *                    "rule": { "issueType": "misspelling",
 *                              "category": { "id": "TYPOS" } } } ] }
 *
 * NOTE THE SHAPE CHANGE from the previous vendor: `offset`/`length`, not
 * `start`/`end`. The conversion happens here, once, so nothing downstream has
 * to remember which convention it is holding.
 */

/**
 * The public endpoint's per-request ceiling. Most CVs fit in one request; the
 * chunker exists for the ones that do not, and for the day this points at a
 * self-hosted instance with a different limit.
 */
export const MAX_CHUNK_CHARS = 20_000

export const LANGUAGETOOL_ENDPOINT = 'https://api.languagetool.org/v2/check'

export type IssueCategory = 'grammar' | 'style'

export interface GrammarIssue {
  /** Offsets into the WHOLE document, not the chunk that produced them. */
  start: number
  end: number
  /**
   * Every suggested replacement, best first, as the service ordered them.
   * Empty means the service flagged something without proposing a fix.
   */
  replacements: string[]
  category: IssueCategory
  /** The vendor's own category id, kept so an unknown one stays diagnosable. */
  rawCategory: string
  /** Short where the service gives one, falling back to the long message. */
  message: string
}

export interface LanguageToolMatch {
  offset: number
  length: number
  /** The vendor's rule id. Used to drop the noise rules by name. */
  message?: string
  shortMessage?: string
  replacements?: { value?: string }[]
  rule?: {
    id?: string
    issueType?: string
    category?: { id?: string; name?: string }
  }
}

export interface LanguageToolResponse {
  matches?: LanguageToolMatch[]
}

/**
 * Which tab a match belongs to.
 *
 * `issueType` FIRST, because it is the service's own normalisation and is
 * stable across the hundreds of individual rules. The category id is the
 * fallback for the handful of rules that omit it.
 *
 * ANYTHING UNRECOGNISED BECOMES GRAMMAR rather than being dropped. Losing an
 * issue entirely is a worse failure than filing it under the wrong heading,
 * and `rawCategory` carries the original through for diagnosis.
 */
const STYLE_TYPES = new Set(['style', 'redundancy', 'locale-violation', 'register'])
const STYLE_CATEGORIES = new Set([
  'STYLE',
  'REDUNDANCY',
  'PLAIN_ENGLISH',
  'WORDINESS',
  'CASING',
])

/**
 * Findings this editor deliberately never shows.
 *
 * WHITESPACE, because Gabe reported it twice and it was right both times: a
 * doubled space between words is not an error in a CV, the replacement is
 * literally `" "` so the suggestion could not even render as a visible
 * control, and ProseMirror normalises runs of spaces on its own anyway. Two of
 * the five findings on a four-sentence test document were this rule.
 *
 * SPELLING, because Gabe asked for it to go and the numbers backed him. On a
 * real 949-word CV it produced 26 findings and roughly two thirds were proper
 * nouns LanguageTool has no dictionary for -- React, Next.js, shadcn/UI,
 * Laravel, Tarlac. A checker that is wrong two times in three is not a
 * checker, it is a list to dismiss.
 *
 * WHAT THIS COSTS, stated rather than buried: a genuine typo is no longer
 * flagged. "calandar" will go through. That is the trade, and it is reversible
 * by deleting `MORFOLOGIK` from this set -- but the browser's own spellcheck
 * still underlines misspellings in the editor, which is where a typo is
 * actually noticed.
 */
const DROPPED_RULES = new Set([
  'CONSECUTIVE_SPACES',
  'COMMA_PARENTHESIS_WHITESPACE',
  'WHITESPACE_RULE',
])
const DROPPED_TYPES = new Set(['whitespace', 'misspelling', 'typographical'])

/** True when a match is one this editor does not surface. See above. */
export function isDroppedMatch(match: LanguageToolMatch): boolean {
  const rule = match.rule
  if (rule?.id && DROPPED_RULES.has(rule.id)) return true
  if (DROPPED_TYPES.has((rule?.issueType ?? '').toLowerCase())) return true
  if ((rule?.category?.id ?? '').toUpperCase() === 'TYPOS') return true
  // A suggestion made only of whitespace cannot be rendered as a control and
  // is never worth a card, whatever rule produced it.
  const only = match.replacements ?? []
  return only.length > 0 && only.every((r) => (r.value ?? '').trim() === '' && r.value !== '')
}

/**
 * Which tab a match belongs to.
 *
 * `issueType` FIRST, because it is the service's own normalisation and is
 * stable across the hundreds of individual rules. The category id is the
 * fallback for the handful of rules that omit it. Anything unrecognised
 * becomes grammar rather than being dropped: losing an issue is worse than
 * filing it under the wrong heading, and `rawCategory` carries the original
 * through for diagnosis.
 */
export function categoryOf(issueType?: string, categoryId?: string): IssueCategory {
  const type = (issueType ?? '').toLowerCase()
  if (STYLE_TYPES.has(type)) return 'style'

  const id = (categoryId ?? '').toUpperCase()
  if (STYLE_CATEGORIES.has(id)) return 'style'
  return 'grammar'
}

/**
 * Split text into pieces the service will accept, preferring a natural break.
 *
 * OFFSETS ARE THE WHOLE POINT. Each chunk carries the index it started at so
 * `toIssues` can add it back, and every issue ends up addressing the document
 * the user is looking at. Chunking without that bookkeeping is how an
 * underline lands three paragraphs from the word it belongs to.
 */
export function chunkText(
  text: string,
  maxChars: number = MAX_CHUNK_CHARS
): { text: string; offset: number }[] {
  if (maxChars <= 0) throw new RangeError('maxChars must be positive')
  if (text.length === 0) return []

  const chunks: { text: string; offset: number }[] = []
  let cursor = 0

  while (cursor < text.length) {
    if (text.length - cursor <= maxChars) {
      chunks.push({ text: text.slice(cursor), offset: cursor })
      break
    }

    const window = text.slice(cursor, cursor + maxChars)
    // Only accept a boundary in the last fifth, or a paragraph break near the
    // start would produce a tiny chunk and many more requests than necessary.
    const earliest = Math.floor(maxChars * 0.8)

    let cut = -1
    for (const pattern of ['\n\n', '. ', ' ']) {
      const at = window.lastIndexOf(pattern)
      if (at >= earliest) {
        cut = at + pattern.length
        break
      }
    }
    if (cut <= 0) cut = maxChars

    chunks.push({ text: text.slice(cursor, cursor + cut), offset: cursor })
    cursor += cut
  }

  return chunks
}

/**
 * Map one response onto document-absolute issues.
 *
 * `offset` is the chunk's start. Malformed matches are dropped rather than
 * rendered: a negative offset or length would either throw on slice or
 * highlight the wrong span.
 */
export function toIssues(
  response: LanguageToolResponse,
  offset = 0
): GrammarIssue[] {
  const matches = Array.isArray(response.matches) ? response.matches : []

  return matches
    .filter(
      (match) =>
        Number.isFinite(match.offset) &&
        Number.isFinite(match.length) &&
        match.offset >= 0 &&
        match.length >= 0 &&
        !isDroppedMatch(match)
    )
    .map((match) => ({
      start: match.offset + offset,
      end: match.offset + match.length + offset,
      replacements: (match.replacements ?? [])
        .map((replacement) => replacement.value)
        .filter((value): value is string => typeof value === 'string')
        // Word shows a handful, not forty; the rest are noise in a 320px rail.
        .slice(0, 5),
      category: categoryOf(match.rule?.issueType, match.rule?.category?.id),
      rawCategory: match.rule?.category?.id ?? '',
      message: match.shortMessage?.trim() || match.message?.trim() || '',
    }))
}

/** Issues split into the sections that show them, in document order. */
export function splitByCategory(issues: GrammarIssue[]): {
  grammar: GrammarIssue[]
  style: GrammarIssue[]
} {
  const byPosition = [...issues].sort((a, b) => a.start - b.start)
  return {
    grammar: byPosition.filter((i) => i.category === 'grammar'),
    style: byPosition.filter((i) => i.category === 'style'),
  }
}

/**
 * The sentence a finding sits in, with where the flagged span falls inside it.
 *
 * WORD SHOWS THE SENTENCE and this pane did not, which is most of what made a
 * finding hard to judge: "Agreement error" over a bare fragment tells you
 * there is a problem but not whether the checker has understood you. It
 * matters more now that spelling is gone and what is left is grammar, where
 * false positives are subtler and the surrounding words are how you spot one.
 */
export function contextOf(
  text: string,
  issue: GrammarIssue,
  radius = 60
): { before: string; flagged: string; after: string } {
  const start = Math.max(0, issue.start - radius)
  const end = Math.min(text.length, issue.end + radius)
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, issue.start),
    flagged: text.slice(issue.start, issue.end),
    after: text.slice(issue.end, end) + (end < text.length ? '…' : ''),
  }
}

/**
 * Apply one replacement to the text it came from.
 *
 * Callers must re-check rather than applying a second issue to the result:
 * every offset after the edit has moved by the length difference, so a stale
 * list would cut at the wrong index. `useProofread` enforces that by clearing
 * the list on accept.
 */
export function applyIssue(text: string, issue: GrammarIssue, replacement: string): string {
  if (issue.start < 0 || issue.end > text.length || issue.end < issue.start) {
    return text
  }
  return text.slice(0, issue.start) + replacement + text.slice(issue.end)
}

/**
 * ONE FINISHED CHECK PER DOCUMENT, KEYED ON THE TEXT IT RAN AGAINST.
 *
 * THE RATE LIMIT IS WHY THIS EXISTS, AND IT IS NOT A SPEED TWEAK. The public
 * endpoint is keyless and limited PER IP -- that is the whole reason this is
 * called from the browser rather than through a server proxy, as the docblock
 * at the top of this file records -- so the allowance being spent is the
 * reader's own. Since 2026-09-17 the check runs on its own when the grammar
 * pane opens rather than on a press (Gabe: run it automatically), and without
 * a cache the same unedited CV would be sent again on every open, every
 * remount and every trip back to the tab. Running out does not announce
 * itself: the request simply fails and the pane says the checker could not be
 * reached, which reads as the feature being broken.
 *
 * THE TEXT IS THE KEY, STORED WHOLE RATHER THAN HASHED. An unedited document
 * hits and an edited one misses, which is exactly the rule wanted. A 32-bit
 * hash was the first instinct and it is the wrong trade here: a collision
 * hands back findings computed against a DIFFERENT document, and those offsets
 * underline whatever words happen to sit at those indices. A CV is a few KB of
 * text against a findings payload that is bigger, so the exact key is the
 * cheaper half of what gets stored anyway.
 *
 * FIVE DOCUMENTS, NEWEST LAST. A single entry was the first shape and it
 * thrashes on the thing people actually do -- comparing two CVs -- where every
 * switch back is a fresh request and the cache has bought nothing.
 *
 * QUOTA IS WHY THE WRITE RETRIES. `setItem` throws `QuotaExceededError`
 * synchronously when the payload does not fit, and the payload scales with the
 * document: a 50,000-word CV is several hundred KB of text and findings, and
 * five of those against a 5MB origin quota shared with the rest of the app is
 * no longer a rounding error. So a failed write is retried with ONLY the new
 * entry, evicting the other four; if even that does not fit, nothing is stored
 * and that document simply re-checks. A cache that cannot be written is a
 * missing optimisation, never a broken feature.
 *
 * EVERY READ AND WRITE IS WRAPPED, because a private window and blocked site
 * data THROW on access rather than returning null. Same rule and same key
 * prefix as `worktrack:document-tab` in `WordResumeEditor`.
 */
export const PROOFREAD_CACHE_KEY = 'worktrack:proofread-cache'

/** How many documents' findings are kept. See the docblock. */
const CACHED_DOCUMENTS = 5

interface CachedCheck {
  text: string
  issues: GrammarIssue[]
}

function readCache(): CachedCheck[] {
  try {
    const raw = window.localStorage.getItem(PROOFREAD_CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    // ANYTHING UNRECOGNISED IS DISCARDED, NOT TRUSTED. This value outlives the
    // code that wrote it and is editable by anyone with devtools open; a
    // malformed entry taken as a hit would render findings that index nothing.
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is CachedCheck =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as CachedCheck).text === 'string' &&
        Array.isArray((entry as CachedCheck).issues)
    )
  } catch {
    return []
  }
}

/** True when the entries landed; false is a quota refusal, never a throw. */
function writeCache(entries: CachedCheck[]): boolean {
  try {
    window.localStorage.setItem(PROOFREAD_CACHE_KEY, JSON.stringify(entries))
    return true
  } catch {
    return false
  }
}

/**
 * The findings already known for exactly this text, or `null` to go and ask.
 *
 * `null` RATHER THAN `[]` FOR A MISS, because an empty array is a real answer
 * -- a document the checker found nothing wrong with -- and conflating the two
 * would re-check every clean CV forever.
 */
export function cachedIssues(text: string): GrammarIssue[] | null {
  const hit = readCache().find((entry) => entry.text === text)
  return hit ? hit.issues : null
}

/** Remember one completed check. Storage being unavailable is not an error. */
export function cacheIssues(text: string, issues: GrammarIssue[]): void {
  const entry: CachedCheck = { text, issues }
  const next = [...readCache().filter((other) => other.text !== text), entry].slice(
    -CACHED_DOCUMENTS
  )
  if (!writeCache(next)) writeCache([entry])
}
