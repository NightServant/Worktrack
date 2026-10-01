import { modelFor, providerFor, type IntegrationConfig } from './config'

/**
 * CV tailoring over any OpenAI-compatible chat endpoint.
 *
 * WHY IT IS NOT CALLED "NOVORESUME". The brief asked for Novoresume's career
 * AI tools "via API". They have no API -- no developer docs, no endpoints, no
 * developer programme; the tools are consumer web pages (checked 2026-09-04).
 * Gabe's instruction was to use free public APIs instead, so this is written
 * against the SHAPE those services share rather than against any one of them:
 * Groq, OpenRouter, Cloudflare Workers AI, Together and a local Ollama all
 * speak `POST /chat/completions`, and every one of their free tiers has moved
 * its limits at least once. The provider is therefore two environment
 * variables and never an import.
 *
 * SCORING IS NOT DONE HERE, and that is the important boundary. `atsMatch`
 * and `atsLint` already compute the score deterministically, in-repo, with
 * tests -- and a number a user is going to act on should not come back
 * different every time it is asked for. The model is used only for the part
 * that genuinely needs language: rewriting a summary, rewriting bullets, and
 * naming which missing keyword belongs in which section.
 *
 * NEVER THROWS. This sits behind a button with a spinner; a rejected promise
 * there is an unhandled rejection and a control stuck on "tailoring".
 */

export interface TailoringInput {
  /** The CV as plain text -- whatever the editor currently holds. */
  cvText: string
  jobDescription: string
  /** From `atsMatch`, so the model is told what is missing rather than guessing. */
  missingKeywords?: string[]
  role?: string
  company?: string
  /**
   * Which kind of document `cvText` is (Gabe, 2026-10-01: "Implement the same
   * logic of CV tailoring to enhance cover letters"). Absent means a CV, which
   * is every caller written before letters could be tailored.
   */
  kind?: 'word' | 'cover_letter'
  /** Where the posting was found, for a letter's "advertised on [...]". */
  source?: string
  /** Where the job is, for a letter's address block. */
  location?: string
  /**
   * THE REST OF THE APPLICATION RECORD, for a letter (Gabe, 2026-10-01:
   * "Fetch the information from the application overview dialog to tailor the
   * cover letter properly"). Each is a field on that dialog; none is required.
   */
  workMode?: string
  techStack?: string[]
  /** The application came through a referral -- the letter may say so. */
  referral?: boolean
  /**
   * The text of the CV linked to this application ("cv used"), if any.
   *
   * WHAT LETS A LETTER BE TAILORED RATHER THAN MERELY ADDRESSED. The letter
   * template leaves "[the outcome, with the number attached]" because the
   * template cannot know it -- but the writer's own CV for this application
   * often states it. Facts from it are the writer's own claims, so quoting
   * them is not invention; extending them still is.
   */
  writerCv?: string
}

export interface TailoringSuggestion {
  /** Which part of the CV this applies to, in the user's own words. */
  section: string
  /** What is there now, quoted so the user can find it. */
  before: string
  /** The proposed replacement. */
  after: string
  /** Why -- one sentence, so a suggestion can be judged rather than trusted. */
  rationale: string
}

export type TailoringResult =
  | { ok: true; summary: string | null; suggestions: TailoringSuggestion[] }
  | {
      ok: false
      reason: 'unconfigured' | 'auth' | 'rate-limit' | 'bad-response' | 'network'
      message: string
    }

export interface TailoringClientOptions {
  config: IntegrationConfig
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * How many rewrites the model is asked for.
 *
 * EIGHT IS ALREADY MORE THAN ANYBODY APPLIES. The panel lists these for a
 * person to read one at a time, and generation is roughly linear in what is
 * written -- every extra suggestion costs a quoted sentence, its rewrite and a
 * rationale. Asking for an unbounded list spends the budget on the tail
 * nobody scrolls to.
 */
const MAX_SUGGESTIONS = 8

/**
 * The ceiling on the reply.
 *
 * SIZED FROM THE SCHEMA WITH HEADROOM, not guessed: a summary is about 120
 * tokens and each of eight suggestions about 130 -- a quoted sentence, its
 * rewrite and one line of reasoning -- so a full answer is around 1,200. A
 * reply cut off mid-string is invalid JSON and costs the WHOLE run rather than
 * its tail, so this errs high; the control that actually bites is the
 * reasoning effort.
 */
const MAX_REPLY_TOKENS = 2_500

/**
 * How long the reader waits before the run is abandoned.
 *
 * THIRTY SECONDS, DOWN FROM FORTY-FIVE (Gabe, 2026-09-19: "apply the shorter
 * model budget for CV tailoring and application wizard"). Safe for the same
 * reason it was safe on the CV writer: the call was made cheaper FIRST. Low
 * reasoning effort removes the thinking tokens generated before the first
 * character of the answer, the suggestion cap removes a third of what is
 * written, and the token ceiling stops a model that decides to explain itself.
 *
 * IT KEEPS THE LONGEST BUDGET OF THE FOUR calls here, because it is the only
 * one that reads a whole CV and a whole posting before it writes a word.
 */
const TAILOR_TIMEOUT_MS = 30_000

/**
 * The instruction. Kept as a constant so it is reviewable and diffable rather
 * than assembled inline at the call site.
 *
 * It forbids invention explicitly. A CV that claims experience its owner does
 * not have is worse than a CV that scores badly -- it fails at the interview
 * instead of at the filter, and it is the single most likely harm from
 * pointing a language model at this problem.
 */
const SYSTEM_PROMPT = [
  'You rewrite CV text so it matches a job posting more closely.',
  'You must not invent experience, employers, dates, qualifications or numbers.',
  'Only rephrase what the CV already claims, using wording the posting uses.',
  'If a missing keyword is not supported by anything in the CV, say so in the',
  'rationale and leave it out rather than inserting it.',
  `Give at most ${MAX_SUGGESTIONS} suggestions: the ones that change the match`,
  'most, not every line you could touch.',
  'In "before", quote only the sentence you are rewriting, never a whole',
  'section.',
  'Reply with JSON only, no prose and no code fences, in exactly this shape:',
  '{"summary": string|null, "suggestions": [{"section": string, "before": string,',
  '"after": string, "rationale": string}]}',
].join(' ')

/**
 * The instruction for a cover letter.
 *
 * THE SAME RULE AGAINST INVENTION, and it matters more here: a letter is
 * prose, and prose is where a model most wants to add a sentence about
 * leadership nobody claimed.
 *
 * WHAT A LETTER HAS THAT A CV DOES NOT is its bracketed prompts --
 * `[Company]`, `[role]`, `[where you found it]` -- which the templates leave
 * for the writer. The posting and the application answer some of them, and
 * only those are filled. `[the outcome, with the number attached]` is the
 * writer's to answer, so it stays: a letter with a visible prompt in it is one
 * nobody sends by accident, and a letter with an invented number in it is.
 *
 * MORE SUGGESTIONS THAN A CV, because `[Company]` alone recurs in four
 * sentences of the standard template and each rewrite is one sentence.
 */
const LETTER_SUGGESTIONS = 12

const LETTER_PROMPT = [
  'You revise a cover letter so it answers one job posting.',
  'You must not invent experience, employers, dates, qualifications, achievements or numbers.',
  "Use only what the letter and the writer's CV, when one is given, already say about the writer.",
  'A fact from the CV -- a role, an employer, a result, a number -- may be quoted into the letter',
  'faithfully, never extended.',
  'The letter may contain placeholders in square brackets, such as [Company] or [role].',
  'Replace a placeholder only when the posting or the application details state the answer:',
  'the company name, the role title, where it was advertised, where the job is,',
  "or the writer's own experience as the CV states it.",
  'Leave every other placeholder exactly as written, brackets included.',
  'Do not mention salary.',
  "Where the letter describes the writer's experience, rephrase it so it speaks to what the",
  "posting asks for, in the posting's own words, without adding anything the letter does not say.",
  `Give at most ${LETTER_SUGGESTIONS} suggestions.`,
  'In "before", quote one sentence or one line of the letter exactly as written, never a whole',
  'paragraph.',
  'Reply with JSON only, no prose and no code fences, in exactly this shape:',
  '{"summary": string|null, "suggestions": [{"section": string, "before": string,',
  '"after": string, "rationale": string}]}',
].join(' ')

/** Pull a JSON object out of a reply, tolerating fences and stray prose. */
export function parseTailoringReply(raw: string): TailoringResult {
  const trimmed = raw.trim()
  // Models add ```json fences even when told not to. Strip rather than fail:
  // the alternative is discarding a good answer over its packaging.
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { ok: false, reason: 'bad-response', message: 'The model did not return JSON.' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1))
  } catch {
    return { ok: false, reason: 'bad-response', message: 'The model returned malformed JSON.' }
  }

  const body = parsed as { summary?: unknown; suggestions?: unknown }
  const suggestions: TailoringSuggestion[] = Array.isArray(body.suggestions)
    ? body.suggestions
        .map((item) => item as Record<string, unknown>)
        // Every field must be a real string. A suggestion missing its `after`
        // is a control the user cannot act on, and one missing its rationale
        // is a change they cannot judge.
        .filter(
          (item) =>
            typeof item?.section === 'string' &&
            typeof item?.before === 'string' &&
            typeof item?.after === 'string' &&
            typeof item?.rationale === 'string'
        )
        .map((item) => ({
          section: String(item.section),
          before: String(item.before),
          after: String(item.after),
          rationale: String(item.rationale),
        }))
    : []

  return {
    ok: true,
    summary: typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : null,
    suggestions,
  }
}

export async function tailorCv(
  input: TailoringInput,
  options: TailoringClientOptions
): Promise<TailoringResult> {
  // PER TASK, NOT OFF THE SHARED PAIR (2026-09-22). This destructured
  // `config.tailoring` directly, which is why tailoring could not be moved to
  // a second provider without dragging the wizard and CV generation with it.
  // See `providerFor`, and the test that posts to the override host.
  const { apiKey, baseUrl } = providerFor(options.config, 'tailor')
  // ITS OWN MODEL SINCE 2026-09-19. Tailoring is the judgement task of the
  // three -- what to emphasise, and what would be a lie -- so it gets the
  // largest model the deployment configures. Falls back to `TAILORING_MODEL`,
  // which is what every deployment before today set.
  const model = modelFor(options.config, 'tailor')
  if (!apiKey || !baseUrl || !model) {
    return {
      ok: false,
      reason: 'unconfigured',
      message:
        'AI tailoring is not configured. Set PROVIDER_BASE_URL, PROVIDER_API_KEY and ' +
        'MODEL_DEFAULT — or PROVIDER_REWRITE_BASE_URL, PROVIDER_REWRITE_API_KEY and ' +
        'MODEL_REWRITE to give this one task its own provider.',
    }
  }
  if (!input.cvText.trim() || !input.jobDescription.trim()) {
    return {
      ok: false,
      reason: 'bad-response',
      message: 'Tailoring needs both a document and a job description.',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TAILOR_TIMEOUT_MS)
  const doFetch = options.fetchImpl ?? fetch

  const letter = input.kind === 'cover_letter'
  const user = (
    letter
      ? [
          // NAMED FIELDS, so the model can quote them into a placeholder
          // rather than guess at them from the posting's prose.
          [
            input.company ? `Company: ${input.company}` : '',
            input.role ? `Role: ${input.role}` : '',
            input.source ? `Advertised on: ${input.source}` : '',
            input.location ? `Location: ${input.location}` : '',
            input.workMode ? `Work mode: ${input.workMode}` : '',
            input.techStack?.length ? `Tech stack: ${input.techStack.join(', ')}` : '',
            input.referral ? 'Came through a referral: yes' : '',
          ]
            .filter(Boolean)
            .join('\n'),
          '--- JOB POSTING ---',
          input.jobDescription,
          input.writerCv?.trim() ? "--- THE WRITER'S CV FOR THIS APPLICATION ---" : '',
          input.writerCv?.trim() ?? '',
          '--- CURRENT COVER LETTER ---',
          input.cvText,
        ]
      : [
          input.role || input.company ? `Target role: ${input.role ?? ''} ${input.company ?? ''}`.trim() : '',
          input.missingKeywords?.length
            ? `Keywords the CV is currently missing: ${input.missingKeywords.join(', ')}`
            : '',
          '--- JOB POSTING ---',
          input.jobDescription,
          '--- CURRENT CV ---',
          input.cvText,
        ]
  )
    .filter(Boolean)
    .join('\n\n')

  try {
    const response = await doFetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        // Low but not zero: this is a rewriting task where a little variation
        // helps, and the no-invention rule is carried by the prompt.
        temperature: 0.3,
        // A CEILING, NOT A TARGET -- see `MAX_REPLY_TOKENS`. Generation is
        // roughly linear in output tokens, so the honest way to make this
        // finish sooner is to ask for less of it.
        max_tokens: MAX_REPLY_TOKENS,
        // JUDGEMENT, BUT NOT THE KIND REASONING TOKENS BUY. What may be
        // claimed is a rule in the prompt, and what is missing arrives already
        // computed in `missingKeywords` -- so a chain of thought here mostly
        // restates the task, and every token of it is generated BEFORE the
        // first character of the answer. Every suggestion is read and accepted
        // one at a time by the person it is for, which is the check that
        // matters. OpenRouter normalises this and drops it for models that do
        // not support it.
        //
        // FLAT, NOT NESTED: Groq answers `reasoning: { effort }` with a 400,
        // which costs the whole call. See `llm.ts` for the measurement.
        reasoning_effort: 'low',
        // ASKED FOR, NOT HOPED FOR (2026-09-15). The prompt already says "JSON
        // only, no prose and no code fences", and the model mostly complies --
        // but "mostly" surfaced in production as "The model returned malformed
        // JSON". A reply is generated token by token, so nothing stops a
        // literal newline landing inside a `before` string that quotes a
        // multi-line CV block, and that is invalid JSON however good the
        // rewrite is. This constrains generation at the provider instead of
        // asking politely, which also removes the fences and the stray prose
        // `parseTailoringReply` currently has to strip. Verified against Groq
        // with `openai/gpt-oss-120b`: valid JSON even when the completion is
        // cut short, where the unconstrained call returned nothing usable.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: letter ? LETTER_PROMPT : SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
      }),
    })

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'auth', message: 'The tailoring provider rejected the API key.' }
    }
    // 429 is the ordinary state of a free tier, not an error worth a stack
    // trace -- so it gets its own reason and its own sentence.
    if (response.status === 429) {
      return {
        ok: false,
        reason: 'rate-limit',
        message: 'The free tier is rate-limited right now. Try again in a minute.',
      }
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: 'network',
        message: `The tailoring provider returned ${response.status}.`,
      }
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[]
    }
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      return { ok: false, reason: 'bad-response', message: 'The provider returned no message.' }
    }
    return parseTailoringReply(content)
  } catch (err) {
    return {
      ok: false,
      reason: 'network',
      message:
        err instanceof Error && err.name === 'AbortError'
          ? 'The tailoring provider took too long.'
          : 'Could not reach the tailoring provider.',
    }
  } finally {
    clearTimeout(timer)
  }
}
