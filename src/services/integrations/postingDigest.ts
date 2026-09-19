import { readIntegrationConfig, capabilitiesOf, modelFor, type IntegrationConfig } from './config'
import { formatPostingText } from '../postingFormat'

/**
 * A job posting, summarised and mined for the fields the form needs.
 *
 * THE MODEL PROPOSES, THIS CODE VERIFIES. That is the whole design, and it is
 * the answer to "reduce hallucinations" -- a prompt asking a model not to
 * invent is a request, not a guarantee. Every value that comes back is checked
 * against the source text before it is allowed out:
 *
 *   FIELDS    must appear VERBATIM in the posting, compared on normalised
 *             text. A company the model was sure about but the posting never
 *             names is dropped, not shown.
 *   NUMBERS   a salary figure must have its digits present in the source.
 *   SUMMARY   must be built from the posting's own vocabulary. Every content
 *             word is checked; a summary that introduces one is thrown away
 *             and replaced with the extractive fallback.
 *   DESCRIPTION  the restructured posting, checked by `groundDescription`
 *             below, which explains why its rule cannot be the summary's.
 *
 * Anything dropped is REPORTED rather than silently discarded, so the caller
 * can say the model guessed rather than pretending it never spoke.
 *
 * IT DEGRADES TO SOMETHING USEFUL. With no provider configured there is no
 * request at all: the deterministic formatter and an extractive summary still
 * run, which is most of the value and works on any deployment.
 *
 * THE POSTING IS NOW READ RATHER THAN REPRODUCED (Gabe, 2026-09-14: "modify
 * the job-description extraction system so it does not simply scrape and
 * reproduce the source page ... read and understand the job posting first,
 * then generate a structured job description"). `formatted` was the whole
 * answer before this, and `formatted` is a tidy of the advert -- the same
 * eight hundred words with the emoji taken off. `description` is the posting
 * reorganised under headings, and it is what the record now stores and edits.
 */

export interface PostingFields {
  role: string | null
  company: string | null
  location: string | null
  work_mode: 'onsite' | 'hybrid' | 'remote' | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  tech_stack: string[]
  /**
   * The role-overview terms that have no column of their own -- employment
   * type, the office days, a shift pattern (Gabe, 2026-09-15: "role overview
   * information must be used to fill-up the application form").
   *
   * WHY THEY GO IN `tags` RATHER THAN A NEW COLUMN. The description used to
   * carry a `Role overview:` block precisely because "this app stores none of
   * them except the work arrangement, so if they are not here they are lost".
   * That block is gone now -- the description is duties and qualifications --
   * so the terms had to land somewhere or the instruction would trade one loss
   * for another. `tags` is a free string array that already exists on the form,
   * already round-trips to the database, and is already what a reader uses to
   * mark an application with something the schema never anticipated.
   *
   * Grounded verbatim, exactly like `tech_stack`: a tag the posting does not
   * contain is invention wearing a shorter word.
   */
  tags: string[]
}

export interface PostingDigest {
  /** Always present: the deterministic clean-up of the input. */
  formatted: string
  /**
   * The posting restructured under headings -- what the reader gets, and what
   * the draft stores.
   *
   * IT RIDES ALONGSIDE `formatted` RATHER THAN REPLACING IT, for one reason
   * that is not cosmetic: `formatted` is the SOURCE every grounding check
   * compares against. Overwriting it would mean checking the model's
   * restructure against the model's restructure, which passes everything.
   * `formatted` stays the evidence; `description` is the answer.
   *
   * Always a usable posting. When the model is absent, silent, or returns
   * something that fails verification, this IS `formatted` and `dropped` says
   * why -- so the caller never has to choose between two fields.
   */
  description: string
  fields: PostingFields
  /** Whether a model contributed, or this is formatter-only. */
  usedModel: boolean
  /**
   * What the model returned and could not be found in the posting.
   *
   * Surfaced deliberately. A silent drop looks identical to the model getting
   * it right, and the one thing a reader needs to know about a generated
   * field is whether anything was invented on the way.
   */
  dropped: string[]
}

const EMPTY_FIELDS: PostingFields = {
  role: null,
  company: null,
  location: null,
  work_mode: null,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  tech_stack: [],
  tags: [],
}

const WORK_MODES = new Set(['onsite', 'hybrid', 'remote'])

/** Words too common to prove anything about grounding. */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'to', 'of', 'in', 'on', 'for', 'with', 'at',
  'by', 'from', 'as', 'is', 'are', 'be', 'will', 'you', 'your', 'we', 'our',
  'this', 'that', 'it', 'its', 'they', 'their', 'has', 'have', 'who', 'which',
])

/**
 * Comparable text: lowercase, punctuation gone, one space between words.
 *
 * DOTS ARE KEPT ONLY BETWEEN CHARACTERS, so `node.js` survives and the period
 * ending `Acme Corp.` does not. Without that distinction a company named at
 * the end of a sentence never matched itself and was reported as invented --
 * which is the failure mode that matters most here, because it makes the
 * grounding check look like it is working while it quietly rejects the truth.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    // Protect an internal dot, drop every other one, then restore.
    /* NUL is the sentinel on purpose: the one character a job posting cannot
       contain, which is what makes it safe to park an intra-word dot on while
       every other dot is spaced out. NO eslint-disable on this line: the NUL
       is in a replacement STRING, not in a pattern, so `no-control-regex` has
       nothing to say about it. The directive below is the one that is needed,
       because that one really is a regex. */
    .replace(/([a-z0-9])\.(?=[a-z0-9])/g, '$1\u0000')
    .replace(/\./g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/\u0000/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether a value the model returned actually appears in the posting. */
function isGrounded(value: string, source: string): boolean {
  const needle = normalise(value)
  if (!needle) return false
  return normalise(source).includes(needle)
}

/** Whether a run of digits appears in the posting, separators or not. */
function hasDigitRun(digits: string, source: string): boolean {
  const stripped = source.replace(/[,\s]/g, '')
  // Both `50000` and `50,000` in the source satisfy 50000.
  return stripped.includes(digits) || source.includes(digits)
}

/** Whether every digit-run in a number appears in the posting. */
function isNumberGrounded(value: number, source: string): boolean {
  return hasDigitRun(String(Math.round(value)), source)
}

/**
 * Every number in `text` the posting does not contain.
 *
 * `isNumberGrounded` generalised from one salary figure to every digit-run in
 * a document, and it is the sharpest check in this file: a restructure may
 * legitimately introduce a word, and may never introduce a number. A salary,
 * a notice period, a headcount or a year that the posting does not state is
 * invention, whatever the sentence around it reads like.
 *
 * SEPARATORS ARE CLOSED UP FIRST ON BOTH SIDES. `50,000` has to be read as one
 * run rather than as `50` and `000`, or the check would pass anything built
 * out of small numbers.
 */
export function ungroundedNumbers(text: string, source: string): string[] {
  const runs = text.replace(/(\d)[,\s](?=\d)/g, '$1').match(/\d+/g) ?? []
  return [...new Set(runs)].filter((run) => !hasDigitRun(run, source))
}

/**
 * Whether a word is in the posting's vocabulary, allowing the inflections the
 * caller names.
 *
 * Shared by the two grounding checks in this file at two different strictnesses
 * -- see `groundDescription` for why one of them is looser than the other.
 */
function inVocabulary(word: string, vocabulary: Set<string>, suffixes: string[]): boolean {
  if (vocabulary.has(word)) return true
  for (const suffix of suffixes) {
    // Tolerated on either side: `interfaces` in the posting grounds
    // `interface`, and `build` grounds `building`. That is grammar, not
    // invention.
    if (vocabulary.has(`${word}${suffix}`)) return true
    if (word.length > suffix.length && word.endsWith(suffix)) {
      if (vocabulary.has(word.slice(0, -suffix.length))) return true
    }
  }
  return false
}

/**
 * The headings the restructure is allowed to bring with it.
 *
 * A DESCRIPTION HAS TO BE ABLE TO SAY `Qualifications:` over a posting that
 * never uses the word -- that is what organising IS -- so these words are
 * exempt from grounding. They are also the complete list of what a heading may
 * introduce: any other capitalised word in a heading is checked like any
 * other, which is what stops `Working at Google:` walking in as structure.
 */
const STRUCTURE_WORDS = new Set([
  'responsibilities', 'duties', 'qualifications', 'requirements', 'technical',
  'skills', 'experience', 'role', 'what', 'you', 'will',
])

/**
 * The headings the description MUST NOT carry, however the model words them.
 *
 * WHY A DENYLIST AND NOT AN ALLOWLIST (Gabe, 2026-09-15: "role overview
 * information must be used to fill-up the application form and duties and
 * responsibilities and qualifications must be used for job description
 * section. Do not include benefits since it affects the ATS scoring and
 * matching").
 *
 * An allowlist of three exact strings was the first draft and it is a trap:
 * the moment a model writes "Duties and responsibilities:" -- which is Gabe's
 * own phrasing -- an allowlist drops the duties, and a description with its
 * duties removed falls back to the raw advert, which contains every benefit.
 * The denylist fails the safe way round: an unforeseen heading survives, and
 * only the content that was named as unwanted is removed.
 *
 * WHAT IS ON IT, and each entry is a different reason:
 *
 *   BENEFITS AND PERKS -- the instruction, and the reason is ATS scoring.
 *     src/services/atsMatch.ts mines the description for the terms a CV is
 *     matched against, and it cannot tell a requirement from a perk: "free
 *     catered lunches, gym membership, unlimited holiday" becomes six
 *     "requirements" no CV will ever contain, and every one of them counts as
 *     a miss. That is the 30%-on-a-good-CV failure that grew the stopword list
 *     in the first place, arriving through a different door.
 *
 *   COMPENSATION, SALARY -- not because they are noise but because they are
 *     already FIELDS. `salary_min`, `salary_max` and `salary_currency` are
 *     mined from the same reply and rendered as a band on the record; leaving
 *     the figures in the description too states them twice and adds digits to
 *     the keyword pool.
 *
 *   ROLE OVERVIEW, ABOUT, CULTURE, WHY JOIN -- the first is where the
 *     instruction sends its content (to the form's own fields and to `tags`);
 *     the rest are the advert selling itself, which states no requirement.
 *
 *   HOW TO APPLY, NEXT STEPS -- genuinely useful to a reader, and dropped
 *     anyway. They are neither duties nor qualifications, the posting's own URL
 *     is on the record one click away, and an application process described in
 *     the ATS keyword pool is more unmatched tokens.
 */
const EXCLUDED_HEADING =
  /\b(benefits?|perks?|compensation|salar(y|ies)|pay|remuneration|package|role overview|overview|about (us|the company|our)|who we are|why join|culture|how to apply|apply|next steps|we offer|our offer)\b/i

/**
 * Word for word the rule `components/applications/record/postingSections`
 * parses by, and restated here rather than imported because nothing in
 * `services/` reaches into `components/`.
 *
 * THE PARSER IS THE VALIDATOR. Checking "every heading ends in a colon and is
 * at most 80 characters" separately would be a second copy of a rule that is
 * already the definition of a heading: a line this returns false for is body,
 * and body that is not a bullet is rejected below. So a description that
 * survives is one the record's section parser reads exactly as it was written
 * -- which is the property the per-section edit CTAs depend on.
 */
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length > 0 && trimmed.length <= 80 && trimmed.endsWith(':')
}

/**
 * The model's description, reshaped into the document the record renders, or
 * null if it is not one.
 *
 * Rebuilt from the lines rather than trusted as a string, so what comes out is
 * byte-identical to what `serializePosting(parsePosting(text))` would produce:
 * a heading, its bullets, one blank line, the next heading.
 */
function asSections(
  raw: string
): { sections: { heading: string; bullets: string[] }[]; excluded: string[] } | null {
  const sections: { heading: string; bullets: string[] }[] = []
  for (const line of raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (isHeadingLine(line)) {
      sections.push({ heading: line, bullets: [] })
      continue
    }
    // Loose text the parser could not place under a heading, or a paragraph
    // where a bullet was asked for. Either one renders as an orphan block in a
    // document that is supposed to be sections.
    if (sections.length === 0 || !line.startsWith('- ')) return null
    sections[sections.length - 1].bullets.push(line)
  }
  if (sections.length === 0) return null
  // A heading with nothing under it renders as "nothing under this heading
  // yet", which is an invitation in an editor and a defect in generated text.
  //
  // CHECKED BEFORE THE EXCLUSION BELOW, deliberately. An empty `Benefits:` is
  // still a malformed reply, and letting it through because the section was
  // going to be dropped anyway would mean the shape of the answer stopped
  // being checked whenever the model happened to break a rule we also enforce.
  if (sections.some((section) => section.bullets.length === 0)) return null

  /*
    THE EXCLUDED SECTIONS ARE DROPPED, NOT REJECTED, and the difference is the
    whole point. Rejecting would return null, the caller would fall back to
    `formatted`, and `formatted` is the advert -- benefits, culture, salary and
    all. Refusing the description because it mentions benefits would therefore
    put MORE benefits in front of the reader than accepting it. See
    EXCLUDED_HEADING.
  */
  const kept = sections.filter((section) => !EXCLUDED_HEADING.test(section.heading))
  const excluded = sections
    .filter((section) => EXCLUDED_HEADING.test(section.heading))
    .map((section) => section.heading.replace(/:$/, ''))

  // Everything was excluded. There is no description left to show, so this is
  // a genuine fallback rather than a filtered one -- and `formatted` at least
  // contains the duties somewhere, unlabelled, which is more than nothing.
  if (kept.length === 0) return null

  return { sections: kept, excluded }
}

/**
 * The share of a description's content words that may be new to it.
 *
 * ponytail: a blunt ratio, and the upgrade path is a better one, not a bigger
 * one. Below it the check is toothless against a model that quietly rewrites a
 * posting in its own words; far above it, honest restructuring gets rejected.
 * A quarter is roomy for connectives and tight against wholesale invention.
 */
const MAX_NEW_WORD_SHARE = 0.25

/** Words, keeping the case -- which is the evidence the check below runs on. */
const WORDS = /[A-Za-z][A-Za-z0-9+#.]*/g

/**
 * The restructured description, verified, or a reason it cannot be used.
 *
 * WHY IT IS NOT THE STRICTER RULE THIS FILE USED TO HAVE. Until 2026-09-14
 * the only generated prose here was a two-sentence summary, guarded by a check
 * that rejected ANY content word the posting did not contain. That was exactly
 * right for what it guarded: the summary lifted the posting's own sentences,
 * so a new word meant it had stopped lifting.
 *
 * A RESTRUCTURE legitimately writes words the posting never did -- it groups
 * scattered facts under headings, joins two bullets into one line, and says
 * what the role is. Run the old rule over that and every honest description is
 * rejected, which does not make the feature safe, it makes it never run. (The
 * summary itself is gone: the description now opens with `Role overview:`, so
 * it was the same information twice.)
 *
 * So the check splits by what a word can prove:
 *
 *   NUMBERS        every digit-run must be in the posting. No exceptions, no
 *                  tolerance, no ratio. This is the one that catches an
 *                  invented salary, and it is absolute.
 *   CAPITALISED    every word carrying a capital -- companies, places,
 *                  technologies, job titles, months, acronyms -- must be in
 *                  the posting, allowing an inflection. This is what catches
 *                  `Kubernetes` and `Google` in a posting that names neither.
 *   EVERYTHING ELSE  ordinary lowercase vocabulary is allowed, because that is
 *                  the connective tissue reorganising needs, and counted:
 *                  above `MAX_NEW_WORD_SHARE` the model has stopped
 *                  reorganising and started writing.
 *
 * WHAT IT DOES NOT CATCH, said plainly rather than left to be discovered: an
 * invented fact in ordinary lowercase words -- "- free lunch and gym access"
 * over a posting that mentions neither -- passes the first two checks and is
 * only a few percent of the third. Recombination passes too: a posting naming
 * `Google Cloud` and `Amazon` grounds `Amazon Cloud`, because words are
 * checked one at a time. Both are narrower holes than the alternative, which
 * is a check so tight the restructure never ships.
 *
 * REJECTION IS A RESULT, NOT A FAILURE. Every path here returns a reason and
 * the caller falls back to the deterministic formatting, which is the posting
 * itself and cannot be wrong about it.
 */
export function groundDescription(
  raw: string,
  source: string
):
  | { description: string; reason: null; excluded: string[] }
  | { description: null; reason: string; excluded: string[] } {
  const parsed = asSections(raw)
  if (!parsed) {
    return { description: null, reason: 'description (not headings and bullets)', excluded: [] }
  }
  const { sections, excluded } = parsed

  const text = sections
    .map((section) => [section.heading, ...section.bullets].join('\n'))
    .join('\n\n')

  const numbers = ungroundedNumbers(text, source)
  if (numbers.length > 0) {
    return {
      description: null,
      reason: `description (invented figures: ${numbers.slice(0, 5).join(', ')})`,
      excluded,
    }
  }

  const vocabulary = new Set(normalise(source).split(' '))
  const named: string[] = []
  const loose: string[] = []
  let content = 0
  for (const token of text.match(WORDS) ?? []) {
    const word = normalise(token)
    if (!word || word.length < 3) continue
    if (FUNCTION_WORDS.has(word) || STRUCTURE_WORDS.has(word)) continue
    content += 1
    if (inVocabulary(word, vocabulary, ['s', 'es', 'ing', 'ed'])) continue
    if (/[A-Z]/.test(token)) named.push(word)
    else loose.push(word)
  }

  if (named.length > 0) {
    return {
      description: null,
      reason: `description (invented: ${[...new Set(named)].slice(0, 5).join(', ')})`,
      excluded,
    }
  }
  if (content > 0 && loose.length / content > MAX_NEW_WORD_SHARE) {
    return {
      description: null,
      reason: `description (rewritten: ${[...new Set(loose)].slice(0, 5).join(', ')})`,
      excluded,
    }
  }

  return { description: text, reason: null, excluded }
}

/**
 * THE POSTING IS SPLIT IN TWO, NOT SUMMARISED (Gabe, 2026-09-15: "the AI model
 * must be smart enough to distinguish role overview, duties and
 * responsibilities, and qualifications. Role overview information must be used
 * to fill-up the application form and duties and responsibilities and
 * qualifications must be used for job description section. Do not include
 * benefits since it affects the ATS scoring and matching").
 *
 * WHAT CHANGED AND WHY IT IS NOT COSMETIC. The old prompt asked for one
 * document with seven allowed headings, `Role overview:` first and `Benefits:`
 * among them, and the form fields were mined from the same reply as a
 * side-effect. So the same facts landed in two places: the job title was a
 * form field AND the first line of the description, the salary was two numeric
 * fields AND a `Compensation:` bullet.
 *
 * That duplication is not merely untidy -- it is measurable, because
 * src/services/atsMatch.ts mines the DESCRIPTION for the terms a CV is scored
 * against and cannot tell a requirement from anything else in there. A perk is
 * a requirement to it. "Free catered lunches, gym membership and unlimited
 * holiday" is six terms no CV will contain and six misses on the score.
 *
 * So the two halves now have one home each:
 *
 *   THE FORM        every fact a reader DECIDES on -- title, company, place,
 *                   arrangement, money, and the terms with no column of their
 *                   own (employment type, office days, shift), which go to
 *                   `tags`. See `PostingFields.tags`.
 *   THE DESCRIPTION what the job ASKS OF YOU -- duties, qualifications, the
 *                   technical skills. Which is exactly the text ATS matching
 *                   should be reading, and nothing else.
 *
 * THE PROMPT IS NOT THE ENFORCEMENT. A model told not to write benefits will
 * sometimes write benefits, at temperature 0 and with a plain instruction.
 * `EXCLUDED_HEADING` drops the section afterwards, which is what makes the
 * rule true rather than requested -- the same "propose, then verify" split
 * this whole file is built on.
 */
/**
 * The ceiling on the reply.
 *
 * THE BIGGEST OF THE FOUR, because this call writes as well as reads: three
 * headed lists at one fact per line run to about 600 tokens on a long advert,
 * with the fields beside them. 2,000 is headroom for a posting that really
 * does state that much -- and a reply cut off mid-string parses as nothing,
 * which costs the restructure rather than its tail.
 */
const MAX_REPLY_TOKENS = 2_000

/**
 * How long the save waits.
 *
 * TWENTY-FIVE SECONDS, DOWN FROM THIRTY (Gabe, 2026-09-19: "apply the shorter
 * model budget for CV tailoring and application wizard"). This one runs on the
 * wizard's SAVE with the button disabled behind it, so it is the one wait the
 * reader cannot do anything else during. Cheap first, shorter second: the
 * reasoning effort and the token ceiling below are what make the smaller
 * window enough.
 *
 * A TIMEOUT COSTS THE RESTRUCTURE AND NEVER THE POSTING. `base` is the
 * deterministically tidied text, which is what a deployment with no provider
 * gets and what this falls back to.
 */
const DIGEST_TIMEOUT_MS = 25_000

const SYSTEM_PROMPT = `You read a job posting and report what it says. You never infer, guess or complete.

You produce TWO separate things and they must not overlap.

1. THE FIELDS: what the reader decides on. Copy each EXACTLY as the posting
   writes it. If the posting does not state something, return null. Returning
   null is always correct when unsure.
   - role, company, location, work_mode, salary_min, salary_max,
     salary_currency, tech_stack.
   - tags: the other terms the posting states about the ARRANGEMENT and nowhere
     else can hold - employment type ("full-time", "contract", "part-time"),
     the hours or shift ("night shift", "40 hours"), the office pattern
     ("3 days onsite"). Short phrases, each one the posting's own words. Not
     skills, not duties, not selling.

2. THE DESCRIPTION: what the job asks OF the applicant, and nothing else.
   - ONLY these three headings, each on its own line, ending in a colon:
     "Responsibilities:", "Qualifications:", "Technical skills:"
     Use only the ones the posting actually covers.
   - Under every heading, one fact per line, each line starting "- ". Nothing
     else: no paragraphs, no text above the first heading, no heading with
     nothing under it.
   - NEVER write a section about benefits, perks, compensation, salary, the
     company, its culture, why to join, or how to apply. Those are either
     fields above or they are not information. A benefits list is scored
     against the reader's CV as if it were a list of requirements, which costs
     them a match they deserved.
   - Do not repeat the fields. The job title, the company, the location, the
     work arrangement and the money are already reported above; writing them
     here states them twice.
   - Combine facts that belong together and drop repeats.
   - Job adverts sell. Do not carry the selling across. Drop "exciting",
     "dynamic", "fast-paced", "world-class", "rockstar", "passionate" and
     anything like them even when the posting uses them - they describe no
     fact.
   - No inflated significance: nothing "plays a vital role", "stands as a
     testament" or "offers a unique opportunity". Never write "not just X,
     but Y".
   - End a line on a fact. "Five years with React" is a fact. "...offering
     excellent growth" is not.
   - Plain connectives. "and", "but", "so" - not "moreover", "furthermore",
     "additionally".
   - Keep every concrete requirement wherever it appeared. A certification
     named in the last paragraph belongs under Qualifications.
   - USE THE POSTING'S OWN WORDS for every name, company, place, technology,
     title, date and figure. Write no number the posting does not contain.

Reply with JSON only, no prose and no code fence:
{"description": string,
 "role": string|null, "company": string|null, "location": string|null,
 "work_mode": "onsite"|"hybrid"|"remote"|null,
 "salary_min": number|null, "salary_max": number|null, "salary_currency": string|null,
 "tech_stack": string[], "tags": string[]}`

interface Options {
  config?: IntegrationConfig
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Strips a code fence a model added despite being told not to. */
function parseReply(content: string): Record<string, unknown> | null {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Keeps only what the posting can back up.
 *
 * Exported because it is the interesting half and deserves its own tests
 * without a network in the way.
 */
export function groundFields(
  raw: Record<string, unknown>,
  source: string
): { fields: PostingFields; dropped: string[] } {
  const fields: PostingFields = { ...EMPTY_FIELDS, tech_stack: [], tags: [] }
  const dropped: string[] = []

  const text = (key: keyof PostingFields, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return
    if (isGrounded(value, source)) {
      // @ts-expect-error -- narrowed by the caller's key choice.
      fields[key] = value.trim()
    } else {
      dropped.push(`${key}: "${value.trim()}"`)
    }
  }

  text('role', raw.role)
  text('company', raw.company)
  text('location', raw.location)

  const mode = typeof raw.work_mode === 'string' ? raw.work_mode.toLowerCase() : ''
  if (WORK_MODES.has(mode)) {
    // Grounded differently: the WORD need not appear -- "work from home" means
    // remote -- so this is validated against the union instead, which is the
    // only place a wrong value could do harm.
    fields.work_mode = mode as PostingFields['work_mode']
  } else if (mode) {
    dropped.push(`work_mode: "${mode}"`)
  }

  for (const key of ['salary_min', 'salary_max'] as const) {
    const value = raw[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (isNumberGrounded(value, source)) fields[key] = value
    else dropped.push(`${key}: ${value}`)
  }

  if (typeof raw.salary_currency === 'string' && raw.salary_currency.trim()) {
    const code = raw.salary_currency.trim().toUpperCase()
    // Only alongside a figure it belongs to, and only if the posting says it.
    if ((fields.salary_min !== null || fields.salary_max !== null) && isGrounded(code, source)) {
      fields.salary_currency = code
    } else {
      dropped.push(`salary_currency: "${code}"`)
    }
  }

  // Two string arrays, one rule. Both are lists of short phrases lifted from
  // the posting, and both are invention the moment a phrase is not in it.
  for (const key of ['tech_stack', 'tags'] as const) {
    const value = raw[key]
    if (!Array.isArray(value)) continue
    for (const entry of value.slice(0, 40)) {
      if (typeof entry !== 'string' || !entry.trim()) continue
      if (isGrounded(entry, source)) fields[key].push(entry.trim())
      else dropped.push(`${key}: "${entry.trim()}"`)
    }
  }

  return { fields, dropped }
}

export async function digestPosting(rawText: string, options: Options = {}): Promise<PostingDigest> {
  const formatted = formatPostingText(rawText)
  const base: PostingDigest = {
    formatted,
    // THE FALLBACK IS THE POSTING ITSELF, and it is load-bearing: a deployment
    // with no provider configured -- CI, a fresh clone, anyone who has not
    // bought a key -- still gets a readable, tidied advert rather than an
    // empty description. `usedModel: false` is what says it was not
    // restructured, so this costs nothing in `dropped`.
    description: formatted,
    fields: { ...EMPTY_FIELDS, tech_stack: [], tags: [] },
    usedModel: false,
    dropped: [],
  }

  const config = options.config ?? readIntegrationConfig()
  // `fillPosting`, NOT `tailorCv`, AND THE MODEL BELOW IS WHY THAT MATTERS.
  // This asked whether tailoring could run and then posted `TAILORING_MODEL`
  // -- so a deployment that set the three per-task variables and dropped the
  // legacy one passed its own gate and sent an empty model id, which fails at
  // the provider and falls back to the tidied text with nothing said. The gate
  // and the model now read the SAME variable, so they cannot disagree again.
  if (!formatted || !capabilitiesOf(config).fillPosting) return base

  const { baseUrl, apiKey } = config.tailoring
  // THE EXTRACT MODEL, BECAUSE THIS IS AN EXTRACTION. Reading a posting's
  // fields and restructuring what it asks of the applicant is the job
  // `MODEL_EXTRACT` is configured for -- mechanical, schema-shaped, wants a
  // big context window and no judgement. It was running on the tailoring model
  // by inheritance rather than by choice. Still falls back to
  // `TAILORING_MODEL`, which is what every deployment before 2026-09-19 set.
  const model = modelFor(config, 'extract')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DIGEST_TIMEOUT_MS)
  const doFetch = options.fetchImpl ?? fetch

  try {
    const response = await doFetch(`${baseUrl!.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        // ZERO, unlike tailoring's 0.3. That is a writing task where a little
        // variation helps; this is a reading one, where every degree of
        // freedom is a chance to invent a salary.
        temperature: 0,
        // A CEILING, NOT A TARGET -- see `MAX_REPLY_TOKENS`. This is the
        // largest reply of the four calls in this directory, because it writes
        // a description as well as reading fields.
        max_tokens: MAX_REPLY_TOKENS,
        // READING, NOT REASONING -- which is what the prompt above already
        // demands of it: report what the posting says, infer nothing, return
        // null when unsure. A chain of thought about a copying task is spent
        // before the first character of the answer. OpenRouter normalises this
        // and drops it for models that do not support it.
        reasoning: { effort: 'low' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: formatted.slice(0, 16_000) },
        ],
      }),
    })
    if (!response.ok) return base

    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] }
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string') return base

    const raw = parseReply(content)
    if (!raw) return base

    const { fields, dropped } = groundFields(raw, formatted)

    // THE RESTRUCTURE IS CHECKED AGAINST `formatted`, never against itself,
    // and it is checked for figures and names rather than for selling: a
    // description rejected for echoing the advert's own "cutting-edge" would
    // fall back to text that says "cutting-edge" too, so that gate would cost
    // the reader the structure and win them nothing.
    let description = base.description
    if (typeof raw.description === 'string' && raw.description.trim()) {
      const checked = groundDescription(raw.description, formatted)
      // Against `null` rather than for truthiness: that is what tells the two
      // halves of the result apart, and an empty string would take the wrong
      // branch of the other test.
      if (checked.description === null) dropped.push(checked.reason)
      else description = checked.description
      // REPORTED, NOT SILENTLY REMOVED. `dropped` exists so a reader can tell
      // "the model got it right" from "something was taken out on the way",
      // and a benefits block the prompt asked for and did not get is exactly
      // the kind of thing that should be visible rather than inferred from an
      // absence. It is listed even when the description was then rejected for
      // another reason, because the model still wrote it.
      for (const heading of checked.excluded) {
        dropped.push(`description section: "${heading}" (not duties or qualifications)`)
      }
    } else {
      // Asked for and not delivered. Worth saying: the reader is looking at a
      // tidied advert on a deployment that paid for a restructure.
      dropped.push('description (missing)')
    }

    return { formatted, description, fields, usedModel: true, dropped }
  } catch {
    return base
  } finally {
    clearTimeout(timer)
  }
}
