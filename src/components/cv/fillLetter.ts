import type { Job } from '@/types'

/**
 * A letter's placeholders filled from the application it is being tailored
 * for, LOCALLY and AT ONCE.
 *
 * Gabe, 2026-10-19: "Once the letter is tailored to a specific job and company,
 * update the date, replace the prompt brackets with real information
 * immediately because I keep hitting the free tier limit." Only the model used
 * to fill `[Company]` and `[role]`, so a run the free tier refused left them
 * in, and the only way out was another run. Everything the application record
 * already states is filled here, before the model is asked, and survives the
 * model failing.
 *
 * ONLY WHAT THE APPLICATION KNOWS. `[employer]`, `[your job title]` and
 * `[the result, with a number]` are the WRITER's -- their employer, their
 * title, their result -- and are left for them or the model. A placeholder the
 * record has no value for is left too: a blank is worse than a bracket.
 */

export interface FillContext {
  job: Pick<Job, 'company' | 'role' | 'source' | 'contact_name' | 'is_referral'>
  today: Date
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH = MONTHS.join('|')
/** "October 19, 2026" -- what `{{today}}` writes -- and "19 October 2026". */
const MONTH_FIRST = new RegExp(`^(\\s*)(?:${MONTH}) \\d{1,2}, \\d{4}(\\s*)$`)
const DAY_FIRST = new RegExp(`^(\\s*)\\d{1,2} (?:${MONTH}) \\d{4}(\\s*)$`)

function value(text: string | null | undefined): string | null {
  const trimmed = text?.trim()
  return trimmed ? trimmed : null
}

/** The application's answer to one placeholder's inner text, or null. */
function answer(inner: string, { job }: FillContext): string | null {
  const key = inner.trim().toLowerCase().replace(/\s+/g, ' ')
  switch (key) {
    case 'company':
    case 'company name':
    case 'the company':
      return value(job.company)
    case 'role':
    case 'the role':
    case 'position':
      return value(job.role)
    case 'where':
    case 'where you found it':
      return value(job.source)
    case 'hiring manager':
    case 'hiring manager name':
    case 'name, if you have it, otherwise hiring manager':
    case 'name, or the team you are writing to':
      return value(job.contact_name) ?? 'Hiring Manager'
    case 'referrer full name':
    case 'referrer name':
      // The contact is the referrer only when the record says it was one.
      return job.is_referral ? value(job.contact_name) : null
    default:
      return null
  }
}

function dateLine(line: string, today: Date): string | null {
  const monthFirst = MONTH_FIRST.exec(line)
  if (monthFirst) {
    return `${monthFirst[1]}${MONTHS[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}${monthFirst[2]}`
  }
  const dayFirst = DAY_FIRST.exec(line)
  if (dayFirst) {
    return `${dayFirst[1]}${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()}${dayFirst[2]}`
  }
  return null
}

function fillBrackets(text: string, context: FillContext): string {
  return text.replace(/\[([^\][\n]{1,80})\]/g, (whole, inner: string) => answer(inner, context) ?? whole)
}

/**
 * The same fill over plain text, line by line -- what the editor hands the
 * model as `cvText`, so its suggestions quote the letter as it now reads.
 */
export function fillLetterText(text: string, context: FillContext): string {
  return text
    .split('\n')
    .map((line) => dateLine(line, context.today) ?? fillBrackets(line, context))
    .join('\n')
}

type Node = { type?: string; text?: string; content?: Node[]; [key: string]: unknown }

/**
 * The fill over the editor's JSON, every text node, marks kept. Returns the
 * SAME object when nothing changed, which is how the caller tells a fill that
 * did something from one that did not.
 */
export function fillLetter<T>(doc: T, context: FillContext): T {
  const walk = (node: Node): Node => {
    if (typeof node.text === 'string') {
      const next = dateLine(node.text, context.today) ?? fillBrackets(node.text, context)
      return next === node.text ? node : { ...node, text: next }
    }
    if (!Array.isArray(node.content)) return node
    const content = node.content.map(walk)
    return content.every((child, i) => child === node.content![i]) ? node : { ...node, content }
  }
  return walk(doc as Node) as T
}
