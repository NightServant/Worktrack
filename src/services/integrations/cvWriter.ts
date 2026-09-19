import { askForJson, type LlmOptions, type LlmResult } from './llm'
import type { UserProfile } from '../profile'
import { groupSkills } from '../skillGroups'

/**
 * A model writing the prose a CV needs, from the profile as facts.
 *
 * WHY A MODEL AND NOT MORE RULES (Gabe, 2026-09-19). The deterministic
 * composer gets skills and the summary to correct English, and it stops dead
 * at project bullets: a README says "Applications with company, role, salary
 * range", and the only rule that makes that a sentence is to prefix a verb,
 * which turns it into "Built applications with company, role" -- something the
 * author never said. Tested against real repositories before it was ruled out.
 * Telling a feature description from an action description is a language
 * problem, so it goes to a language model.
 *
 * THE FACTS GO IN AS FACTS, NOT AS PROSE TO EDIT. The model is given the
 * profile's fields and asked to write sentences from them; it is never given a
 * draft to "improve", because that is the shape where a model quietly upgrades
 * an internship into a staff role. Everything it may write about is in front
 * of it, and the prompt says so.
 *
 * IT IS ALWAYS OPTIONAL. `personalizeTemplate` stays deterministic and is the
 * fallback, so a deployment with no key, a rate-limited free tier and a model
 * that answers nonsense all produce the same CV they produced yesterday.
 */

/** What the model is asked to return, and all it is allowed to return. */
export interface CvProse {
  /** The opening paragraph. */
  summary: string | null
  /** One sentence per skill group, keyed by the group's own label. */
  skills: { label: string; sentence: string }[]
  /** Per project: a lead sentence, and its bullets rewritten as sentences. */
  projects: { title: string; lead: string; bullets: string[] }[]
}

/**
 * How many README lines per project the model is given, and asked back for.
 *
 * FOUR IS A CV ENTRY. Gabe's own CV runs three or four bullets per project and
 * the extractor already caps what it reads at six; passing all six means the
 * model reads six and writes six, and generation time is roughly linear in
 * what it writes. This is the single biggest saving available on this call
 * and it costs nothing a reader wanted.
 */
const MAX_README_LINES = 4

/**
 * The ceiling on the reply.
 *
 * SIZED FROM THE SCHEMA WITH HEADROOM, not guessed: a summary is about 80
 * tokens, each of up to fourteen skill groups about 30, and each project a
 * lead plus four bullets at about 30 each. That is roughly 1,600 for a full
 * profile, so 3,000 leaves room for a long one without leaving room to ramble.
 * A reply cut off mid-string is invalid JSON and costs the whole answer, so
 * this errs high -- the time control that actually bites is the reasoning
 * effort and the line cap above it.
 */
const MAX_REPLY_TOKENS = 3_000

/**
 * How long the reader waits before the deterministic CV is used instead.
 *
 * TWENTY-FIVE SECONDS, DOWN FROM SIXTY (Gabe, 2026-09-19: "implement shorter
 * budget for CV writing without loosing quality"). The three changes above
 * are what make that safe rather than merely shorter: low reasoning effort
 * removes the thinking tokens that are generated before the first character
 * of the answer, the line cap cuts roughly a third of what is written, and
 * the token ceiling stops a model that decides to explain itself.
 *
 * IT IS THE ONLY WAY OUT OF THAT SCREEN, which is why it has to be reliable:
 * `back to documents` is disabled while this runs, deliberately, so a hung
 * request with no timeout would be a trapped reader rather than a slow one.
 */
const WRITE_TIMEOUT_MS = 25_000

const SYSTEM_PROMPT = [
  'You write the prose for somebody\'s CV from the facts they give you.',
  'You must not invent employers, dates, job titles, qualifications, numbers,',
  'technologies or achievements. Every claim must be supported by the facts',
  'in the message. If a fact is missing, write around it or leave it out.',
  'Never describe proficiency you were not told about: do not write "expert",',
  '"advanced" or "solid command" unless those words are in the facts.',
  'Write in the same grammatical person as the summary you are given: if it',
  'uses "I" or "my", stay in the first person; otherwise use the third person',
  'and no pronoun ("Builds interfaces with...").',
  'Every bullet and every sentence must be a complete sentence with a verb,',
  'ending in a full stop.',
  `Give at most ${MAX_README_LINES} bullets per project, and keep each under 30 words.`,
  'Be concise: this is a CV, not a description of one.',
  'Reply with JSON only, in exactly this shape:',
  '{"summary": string|null,',
  '"skills": [{"label": string, "sentence": string}],',
  '"projects": [{"title": string, "lead": string, "bullets": [string]}]}',
  'Use the exact label and title strings you were given, so they can be matched.',
].join(' ')

/**
 * The profile, as the facts the model may write from.
 *
 * SENT AS JSON RATHER THAN AS A PARAGRAPH, so there is no prose for the model
 * to pattern-match and continue. Only the fields a CV prints are included --
 * an address and a birth date are in `UserProfile` and have no business in a
 * prompt to a third party.
 */
export function factsFor(profile: UserProfile): string {
  return JSON.stringify(
    {
      headline: profile.headline,
      summary: profile.summary,
      about: profile.about.map((entry) => entry.text),
      currentRole: profile.experiences[0]
        ? {
            title: profile.experiences[0].title,
            company: profile.experiences[0].company,
            period: profile.experiences[0].period,
          }
        : null,
      education: profile.education.map((entry) => ({
        school: entry.school,
        degree: entry.degree,
        year: entry.graduationYear ?? entry.period,
      })),
      skillGroups: groupSkills(profile.skills).map((group) => ({
        label: group.label,
        skills: group.skills,
      })),
      projects: profile.projects.map((project) => ({
        title: project.title,
        description: project.description,
        tech: project.tech,
        // THE README'S OWN LINES, which are the thing being turned into
        // sentences. They are facts about the project and the only source for
        // what it does.
        //
        // CAPPED AT `MAX_README_LINES`. A CV entry is three or four bullets;
        // sending nine means the model reads nine and writes nine, and both
        // halves of that are time spent on lines the reader will delete. See
        // `MAX_README_LINES`.
        readme: project.highlights.slice(0, MAX_README_LINES),
      })),
    },
    null,
    1
  )
}

export async function writeCvProse(
  profile: UserProfile,
  options: LlmOptions
): Promise<LlmResult<CvProse>> {
  const result = await askForJson<Partial<CvProse>>(
    {
      task: 'cv',
      system: SYSTEM_PROMPT,
      user: factsFor(profile),
      // Prose wants a little variation; the no-invention rule is the prompt's.
      temperature: 0.3,
      // See each constant for why this is now a quarter of a minute rather
      // than a full one, and why that is not the same as hoping it is faster.
      timeoutMs: WRITE_TIMEOUT_MS,
      maxTokens: MAX_REPLY_TOKENS,
      // WRITING IS NOT A REASONING PROBLEM. The facts are already in front of
      // it; a chain of thought about how to phrase them is generated before
      // the first character of the answer and buys nothing a reader can see.
      reasoningEffort: 'low',
    },
    options
  )
  if (!result.ok) return result
  return { ok: true, data: readProse(result.data) }
}

/**
 * The reply, with everything that is not a usable string discarded.
 *
 * A HALF-ANSWER IS STILL AN ANSWER. A model that writes good project prose and
 * forgets the summary should contribute the projects, not be thrown away -- so
 * every field is validated on its own and the caller merges what survives over
 * the deterministic version.
 */
export function readProse(body: Partial<CvProse> | null | undefined): CvProse {
  const line = (value: unknown): string | null =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

  return {
    summary: line(body?.summary),
    skills: Array.isArray(body?.skills)
      ? body.skills.flatMap((item) => {
          const label = line((item as { label?: unknown })?.label)
          const sentence = line((item as { sentence?: unknown })?.sentence)
          return label && sentence ? [{ label, sentence }] : []
        })
      : [],
    projects: Array.isArray(body?.projects)
      ? body.projects.flatMap((item) => {
          const entry = item as { title?: unknown; lead?: unknown; bullets?: unknown }
          const title = line(entry?.title)
          const lead = line(entry?.lead)
          if (!title || !lead) return []
          const bullets = Array.isArray(entry.bullets)
            ? entry.bullets.map(line).filter((value): value is string => value !== null)
            : []
          return [{ title, lead, bullets }]
        })
      : [],
  }
}
