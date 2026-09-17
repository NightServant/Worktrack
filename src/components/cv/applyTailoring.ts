import type { JSONContent } from '@tiptap/core'
import type { TailoringSuggestion } from '@/services/integrations/tailoring'
import type { ResumeContent } from '@/services/resumeService'

/**
 * Turning a model's list of rewrites into a document.
 *
 * THE SUGGESTION LIST WAS THE PRODUCT UNTIL 2026-09-13 AND IT SHOULD NOT HAVE
 * BEEN. `tailor this CV` used to return a column of before/after pairs, each
 * with its own `apply` button that edited the document you were looking at, so
 * taking eight rewrites was eight clicks and the original was gone by the end
 * of them. Gabe asked for the button to "create a new version of the
 * document": the tailored CV is the deliverable, and the one you had open is
 * the version you keep.
 *
 * PURE, AND IN ITS OWN FILE, because this is the only part of tailoring that
 * can silently corrupt somebody's CV. A walk that mutated a shared node, or a
 * replacement that fired on the wrong substring, would show up as a document
 * that looks fine and says something its author never wrote. It takes content
 * and gives back content -- no editor, no network, no React -- so it can be
 * tested on the shapes rather than through a rail.
 *
 * SUGGESTIONS APPLY IN ORDER, TO THE RUNNING RESULT, and that is accepted
 * rather than accidental (named in review, 2026-09-13). Suggestion n's
 * `before` can therefore match text suggestion n-1 just inserted:
 * `[led -> spearheaded, spearheaded -> drove]` ends at `drove`, a word the
 * model proposed for a different line. Applying all of them against the
 * ORIGINAL text instead would trade that for a worse problem -- two
 * suggestions whose spans overlap would both claim the same characters, and
 * merging them means picking a winner with no basis for the choice. Sequential
 * application at least produces a document every single edit was valid
 * against. The prompt asks for section-scoped rewrites, so the collision needs
 * two suggestions quoting each other's output to bite.
 *
 * NOTHING IS FORCED. A suggestion whose `before` is not in the document is
 * skipped, not approximated: the model quotes from a plain-text rendering of
 * the CV and Tiptap stores a node tree, so a quote that spans a bold run or a
 * list boundary will not be found in any single text node. Rewriting the
 * nearest thing instead is how a tool ends up editing a line nobody pointed at.
 */

/**
 * IDENTITY IS THE "NOTHING CHANGED" SIGNAL. Every function here returns the
 * value it was given when no replacement landed, so the caller can ask
 * `next === content` instead of deep-comparing two documents -- which is what
 * stops a run that matched nothing from creating a byte-identical duplicate.
 */
function rewrite(text: string, suggestions: TailoringSuggestion[]): string {
  let next = text
  for (const suggestion of suggestions) {
    const { before, after } = suggestion
    // An empty `before` matches everywhere and nowhere: `split('')` shatters
    // the string into characters. A non-string `after` is a malformed row.
    if (!before || typeof after !== 'string') continue
    if (!next.includes(before)) continue
    // `split`/`join` RATHER THAN `String.replace`. A string replacement in
    // `replace` is not literal -- `$&`, `$'` and `$1` in the model's `after`
    // would be expanded against the match -- and a CV line containing a price
    // or a regex is not a hypothetical. This is the same edit with no
    // substitution grammar, and it takes every occurrence rather than the
    // first, which is what a reader expects from "replace this phrase".
    next = next.split(before).join(after)
  }
  return next
}

/** Tiptap's tree, walked immutably: only the branches that changed are rebuilt. */
function walk(node: JSONContent, suggestions: TailoringSuggestion[]): JSONContent {
  let next = node
  if (typeof node.text === 'string') {
    const text = rewrite(node.text, suggestions)
    if (text !== node.text) next = { ...next, text }
  }
  if (Array.isArray(node.content)) {
    const children = node.content.map((child) => walk(child, suggestions))
    if (children.some((child, i) => child !== node.content![i])) {
      next = { ...next, content: children }
    }
  }
  return next
}


/**
 * Apply every suggestion to a COPY of the document.
 *
 * Both shapes, because both editors call it: the Word editor stores a Tiptap
 * doc and the LaTeX editor stores a source string, and a tailored CV has to be
 * possible in either. Returns the input unchanged -- by reference -- when no
 * suggestion matched.
 */
export function applySuggestions(
  content: ResumeContent,
  suggestions: TailoringSuggestion[]
): ResumeContent {
  if (suggestions.length === 0) return content
  return walk(content, suggestions)
}

/**
 * What the new document is called.
 *
 * `<original> — <company>` when the posting has one, `<original> — tailored`
 * when it does not. The company is the useful half: an account tailoring the
 * same CV to nine wishlisted roles gets nine titles it can tell apart in
 * `/documents`, where "Backend CV (copy 4)" would be nine it cannot.
 *
 * IT DOES NOT APPEND TWICE. Tailoring a tailored CV to the same company is an
 * ordinary thing to do -- run it, read it, run it again -- and the naive
 * version produces "Backend CV — Initech — Initech" on the second pass and a
 * title bar full of one word on the fifth.
 */
export function tailoredTitle(originalTitle: string, company?: string | null): string {
  const collapse = (value: string) => value.trim().replace(/\s+/g, ' ')
  const base = collapse(originalTitle)
  const suffix = collapse(company ?? '') || 'tailored'
  const tail = ` — ${suffix}`
  if (!base) return suffix
  return base.endsWith(tail) ? base : `${base}${tail}`
}

/**
 * Whether a tailoring run rewrites the open document or writes a new one.
 *
 * NEW APPLICATION = NEW FILE; SAME APPLICATION AGAIN = REWRITE (Gabe,
 * 2026-09-15). Every run used to create a document, which is right the first
 * time and wrong every time after -- re-tailoring against one posting left a
 * pile of files with the same title, differing only in which run made them.
 *
 * IT TAKES TWO PIECES OF EVIDENCE, AND THE SECOND ONE IS THE IMPORTANT ONE.
 *
 * A LINK IS NOT "THIS IS THE TAILORED CV" -- it is "this CV was SENT to this
 * application", which is a different fact and a much commoner one. The first
 * version of this asked only "is the open document linked to this job?", and
 * on the real account that meant a master CV pinned to FIFTY-TWO applications
 * would be REWRITTEN the moment it was tailored against any of them. The
 * master CV is the one document that must never be overwritten; it is what
 * every tailored copy is made from.
 *
 * So the title has to agree. `tailoredTitle` is idempotent -- it appends
 * ` -- <company>` unless the title already ends that way -- so the tailored
 * name computed for this run equals the open document's own name EXACTLY when
 * that document is already the tailored one for this company. A master called
 * "Gabe - CV (ATS)" never matches "Gabe - CV (ATS) -- Initech", so it is safe
 * however many applications it is pinned to.
 *
 * The link is still required, and still does the job the title cannot: two
 * different roles at the same employer produce the same tailored title, and
 * only the link says which of the two this document was made for.
 *
 * IT IS A PREDICATE IN THIS FILE RATHER THAN A CONDITION IN THE ROUTE because
 * it chooses between a destructive write and a safe one, which is the class of
 * harm the rest of this file exists to prevent, and a condition spelled inline
 * in a handler is one nothing can test.
 */
/**
 * Which application a tailored CV was written for, or null if it cannot be
 * said for certain.
 *
 * THE JOB COMES FROM THE LINK. NEVER FROM THE TITLE. That distinction is the
 * whole of this function, and getting it wrong is a bug that shipped on
 * 2026-09-17: the route derived the job by finding the first link whose
 * COMPANY produced the open document's title, which is the collision
 * `isRetailorOfSameApplication` below already warns about in prose. Two
 * applications at one employer give two links with the same company, so
 * `.find()` returned whichever came back first and the rail confidently named
 * the wrong role.
 *
 * A title can only ever narrow to a company -- `tailoredTitle` appends the
 * employer and nothing else -- so it is usable as a GUARD and not as a finder.
 * Here it does only the job it can do: prove this document is a tailored copy
 * rather than a master, which matters because a master CV can be linked to
 * fifty applications and must never be mistaken for a tailored one.
 *
 * WHY "EXACTLY ONE" IS THE RIGHT TEST AND NOT A COMPROMISE. Tailoring writes a
 * NEW file per application (see `isRetailorOfSameApplication`), so two roles at
 * the same employer produce two documents -- identically titled, each carrying
 * its own single link. One link each is the normal, correct shape, and it
 * resolves both. More than one surviving the title guard means this document
 * really was sent to several roles at one company, and then nothing here can
 * say which it was MADE for, so it says nothing: the caller shows the picker,
 * which is the honest outcome rather than a guess with a 50% error rate.
 */
export function tailoredJobIdFor(input: {
  /** The open document's title. */
  draftTitle: string
  /** Applications this document has been linked to. */
  links: { job_id: string; company: string }[]
}): string | null {
  const { draftTitle, links } = input
  if (!draftTitle) return null
  // The guard: this document is the tailored copy for that link's employer,
  // not a master that happens to have been sent there.
  const tailored = links.filter(
    (link) => tailoredTitle(draftTitle, link.company) === draftTitle
  )
  return tailored.length === 1 ? tailored[0].job_id : null
}

export function isRetailorOfSameApplication(input: {
  /** The open document, or null when there is not one yet. */
  draftId: string | null
  /** The open document's current title. */
  draftTitle: string
  /** The name this run would give a NEW document -- `tailoredTitle`'s answer. */
  tailoredName: string
  /** The application this run was tailored against. */
  jobId: string
  /** Applications the open document has been linked to. */
  links: { job_id: string }[]
}): boolean {
  const { draftId, draftTitle, tailoredName, jobId, links } = input
  // No open document, or no application chosen, is not a re-tailor of
  // anything: there is nothing to overwrite and nothing to match against.
  if (!draftId || !jobId) return false
  // The document must already BE the tailored one for this company, not merely
  // a CV that was once sent to it. See above -- this is what protects a master.
  if (!draftTitle || draftTitle !== tailoredName) return false
  return links.some((link) => link.job_id === jobId)
}
