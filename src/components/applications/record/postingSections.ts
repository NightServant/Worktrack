/**
 * A job posting, split into the sections it was already written in.
 *
 * WHY THIS EXISTS AS A PARSER rather than as more JSX (Gabe, 2026-09-13:
 * "implement section layout for the job description with proper titles ... make
 * sure each title has an edit CTA at the farthest right"). The posting used to
 * render as a flat run of blocks and edit as ONE textarea holding the whole
 * advert -- so changing a bullet under `KEY RESPONSIBILITIES` meant finding it
 * inside eight hundred words of plain text. An edit CTA per section needs the
 * sections to be addressable, which means knowing where each one starts and
 * ends, which means parsing rather than rendering.
 *
 * IT INVENTS NOTHING, and that rule is why the heading test is the same
 * mechanical one the reader already sees: a line is a heading if it is short
 * and ends in a colon. A parser that guessed at structure would one day be
 * wrong about somebody's job advert, and the thing it would be wrong about is
 * which text an edit overwrites.
 *
 * THE BODY IS KEPT VERBATIM. Every section holds the raw lines between its
 * heading and the next one -- no trimming beyond the edges, no re-wrapping, no
 * normalising of bullet glyphs -- because `serializePosting` has to be able to
 * put the document back together after one section changed. Anything this file
 * tidied on the way in would be a silent edit to the nine sections nobody
 * touched.
 */

export interface PostingSection {
  /**
   * The heading LINE, verbatim, colon and all -- or `null` for the text that
   * comes before the first heading.
   *
   * Verbatim rather than stripped so serialising is lossless; the display
   * strips the colon, which is a presentation decision and belongs in the view.
   */
  heading: string | null
  /** The lines under it, verbatim. */
  body: string
}

/** Word for word the rule `postingBlocks` renders by; see the docblock. */
function isHeading(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length > 0 && trimmed.length <= 80 && trimmed.endsWith(':')
}

/** `About the role:` renders as `about the role`. */
export function sectionTitle(heading: string): string {
  return heading.trim().replace(/:$/, '')
}

export function parsePosting(text: string): PostingSection[] {
  if (!text.trim()) return []

  const sections: PostingSection[] = []
  let heading: string | null = null
  let body: string[] = []

  const push = () => {
    const joined = body.join('\n').replace(/^\n+|\n+$/g, '')
    // An intro of nothing is not a section. A HEADING with nothing under it is
    // -- an empty section is where somebody is about to type, and dropping it
    // would delete the heading they were typing under.
    if (heading === null && !joined.trim()) return
    sections.push({ heading, body: joined })
  }

  for (const line of text.split(/\r?\n/)) {
    if (isHeading(line)) {
      push()
      heading = line.trim()
      body = []
      continue
    }
    body.push(line)
  }
  push()

  return sections
}

/**
 * Put it back together.
 *
 * ONE BLANK LINE BETWEEN SECTIONS, which is what the renderer's block grouping
 * already reads as a break and what `services/postingFormat` writes. Round
 * trips: `parsePosting(serializePosting(parsePosting(t)))` is
 * `parsePosting(t)` for any `t`, which is the property that makes editing one
 * section safe for the others.
 */
export function serializePosting(sections: PostingSection[]): string {
  return sections
    .map((section) =>
      [section.heading, section.body.replace(/^\n+|\n+$/g, '')].filter(Boolean).join('\n')
    )
    .join('\n\n')
}

/**
 * One section gone, the rest untouched.
 *
 * NO CONFIRMATION HERE, and that is a decision rather than an omission: this
 * function only rewrites a string in the draft. Nothing is stored until the
 * record is saved, and the dialog's own discard guard already stands between
 * an accidental delete and the database.
 */
export function removeSection(sections: PostingSection[], index: number): string {
  return serializePosting(sections.filter((_, i) => i !== index))
}

/** One section's body replaced, the rest untouched. */
export function replaceSectionBody(
  sections: PostingSection[],
  index: number,
  body: string
): string {
  return serializePosting(
    sections.map((section, i) => (i === index ? { ...section, body } : section))
  )
}

/**
 * The longest a heading may be and still parse back as one.
 *
 * `isHeading` caps a heading at 80 characters INCLUDING the colon it ends in,
 * so a name typed to the cap would serialise and then come back as a
 * paragraph -- the section would vanish into the one above it the moment the
 * draft round-tripped. Truncating here is the only place that cannot happen.
 */
const MAX_HEADING = 79

/**
 * One new section, named, at the end.
 *
 * THE NAME IS NORMALISED RATHER THAN VALIDATED, because the only rule a
 * heading has to obey is the parser's own -- short, and ending in a colon --
 * and a person typing `Benefits` or `Benefits:` means the same section either
 * way. Whitespace collapses for the same reason `parsePosting` trims: a
 * heading with a line break in it is two lines, and only the first would be
 * read as the heading.
 *
 * Returns the whole posting, like its neighbours here, so the caller keeps
 * writing one string back.
 */
export function addSection(sections: PostingSection[], name: string): string {
  const cleaned = name.replace(/\s+/g, ' ').trim().replace(/:+$/, '').slice(0, MAX_HEADING)
  return serializePosting([...sections, { heading: `${cleaned}:`, body: '' }])
}
