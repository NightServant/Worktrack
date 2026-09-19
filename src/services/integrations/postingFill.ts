import { askForJson, type LlmOptions } from './llm'

/**
 * Filling the posting fields the parser could not, from the posting's own text.
 *
 * WHY A MODEL HERE AT ALL (Gabe, 2026-09-19: "one for job description
 * filling"). `extractor/core.py` reads a posting's JSON-LD, its meta tags and
 * its markup, and on a board that publishes structured data it gets
 * everything. On one that does not, it gets a role and a company and leaves
 * salary, work mode, location and the tech stack empty -- and those are all
 * sitting in the description in plain English, which is a reading problem
 * rather than a parsing one.
 *
 * THE PARSER IS AUTHORITATIVE AND IS NEVER OVERWRITTEN. Every value it
 * produced came from a machine-readable field on the page; every value this
 * produces came from a model reading prose. Only the gaps are offered to the
 * model, and only the gaps it fills are merged back -- so turning this on can
 * add fields and can never change one.
 *
 * WHAT IT MAY NOT DO: invent. A salary that is not in the posting is worse
 * than an empty salary field, because the empty one gets typed in correctly
 * and the invented one gets saved and believed. The prompt says so, and every
 * value comes back with a confidence the UI can show as a guess.
 */

/** The fields worth asking for, and the shape the caller already speaks. */
export const FILLABLE = [
  'company',
  'role',
  'location',
  'work_mode',
  'salary_min',
  'salary_max',
  'salary_currency',
  'tech_stack',
  'tags',
] as const

export type FillableField = (typeof FILLABLE)[number]

export interface AutofillEnvelope {
  values: Record<string, unknown>
  confidence: Record<string, number>
  warnings: string[]
}

const SYSTEM_PROMPT = [
  'You read a job posting and report only the facts it states.',
  'You must not guess, infer or invent. If the posting does not state a value,',
  'omit that key entirely rather than filling it.',
  'work_mode must be exactly one of "remote", "hybrid" or "onsite".',
  'salary_min and salary_max are plain numbers with no currency symbol, commas',
  'or units, and salary_currency is a three-letter ISO code.',
  'Do not convert or annualise a salary: report the numbers as written.',
  'tech_stack is technologies the posting names. tags is employment type,',
  'industry or category, never technologies.',
  'Reply with JSON only, in exactly this shape, with unknown keys omitted:',
  '{"company": string, "role": string, "location": string, "work_mode": string,',
  '"salary_min": number, "salary_max": number, "salary_currency": string,',
  '"tech_stack": [string], "tags": [string]}',
].join(' ')

/**
 * How sure the caller should be about a value a model read out of prose.
 *
 * DELIBERATELY BELOW EVERY PARSED FIELD. `core.py` scores a JSON-LD hit at
 * 0.9 and a meta-tag hit at 0.6; this sits under both, so a UI that sorts or
 * styles by confidence treats a read value as the weakest thing on the form
 * without needing to know where it came from.
 */
export const MODEL_CONFIDENCE = 0.4

/** Which fields are still empty, and therefore worth asking about. */
export function gapsIn(envelope: AutofillEnvelope): FillableField[] {
  return FILLABLE.filter((field) => {
    const value = envelope.values[field]
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return value.trim().length === 0
    if (Array.isArray(value)) return value.length === 0
    return false
  })
}

/**
 * The envelope with the model's answers merged into its gaps.
 *
 * EXPORTED AND PURE so the merge rules are testable without a provider: the
 * one thing that must never regress is that a parsed value survives.
 */
export function mergeFilled(
  envelope: AutofillEnvelope,
  filled: Record<string, unknown>,
  gaps: FillableField[]
): AutofillEnvelope {
  const values = { ...envelope.values }
  const confidence = { ...envelope.confidence }
  let added = 0

  for (const field of gaps) {
    const value = filled[field]
    if (value === null || value === undefined) continue
    if (typeof value === 'string' && !value.trim()) continue
    if (Array.isArray(value)) {
      const items = value.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0
      )
      if (items.length === 0) continue
      values[field] = items
    } else if (field === 'salary_min' || field === 'salary_max') {
      // A salary that is not a finite number is not a salary. Models answer
      // "competitive" and "DOE" to this question surprisingly often.
      const number = typeof value === 'number' ? value : Number(String(value).replace(/[,\s]/g, ''))
      if (!Number.isFinite(number) || number <= 0) continue
      values[field] = number
    } else if (field === 'work_mode') {
      const mode = String(value).trim().toLowerCase()
      if (mode !== 'remote' && mode !== 'hybrid' && mode !== 'onsite') continue
      values[field] = mode
    } else {
      values[field] = String(value).trim()
    }
    confidence[field] = MODEL_CONFIDENCE
    added += 1
  }

  if (added === 0) return envelope
  return {
    values,
    confidence,
    // SAID OUT LOUD, ONCE. A value read out of prose by a model is a different
    // kind of fact from one lifted off a JSON-LD block, and the person about
    // to save it is the one who should decide whether it is right.
    warnings: [
      ...envelope.warnings,
      `${added} field${added === 1 ? ' was' : 's were'} read from the posting text by a model rather than from the page's own data. Check them before saving.`,
    ],
  }
}

/**
 * The posting text, capped.
 *
 * A DESCRIPTION IS THE ONLY THING SENT. Not the page, not the URL's other
 * fields -- the model is answering "what does this text say", and everything
 * else is either already known or not its business.
 */
const MAX_DESCRIPTION_CHARS = 20_000

export async function fillPostingGaps(
  envelope: AutofillEnvelope,
  options: LlmOptions
): Promise<AutofillEnvelope> {
  const description = String(envelope.values.description ?? '').trim()
  const gaps = gapsIn(envelope)
  // NOTHING TO READ, OR NOTHING TO ASK. Either way this is not worth a
  // free-tier call, and the envelope goes back untouched.
  if (!description || gaps.length === 0) return envelope

  const result = await askForJson<Record<string, unknown>>(
    {
      task: 'extract',
      system: SYSTEM_PROMPT,
      user: [
        `Report only these fields, and omit any the posting does not state: ${gaps.join(', ')}.`,
        '--- JOB POSTING ---',
        description.slice(0, MAX_DESCRIPTION_CHARS),
      ].join('\n\n'),
      // Extraction wants the same answer every time.
      temperature: 0,
      // Somebody is watching a form fill in. A slow answer here is worse than
      // no answer, because the fields it would have filled can be typed.
      timeoutMs: 20_000,
    },
    options
  )

  // EVERY FAILURE IS THE PARSER'S RESULT, UNCHANGED. Not configured, rate
  // limited, timed out, nonsense -- auto-fill worked before this existed and
  // has to keep working exactly as well when it is unavailable.
  if (!result.ok) return envelope
  return mergeFilled(envelope, result.data, gaps)
}
