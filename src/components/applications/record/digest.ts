import { isSupportedCurrency } from '@/services/userPreferences'
import type { JobFormData, WorkMode } from '@/types'

/**
 * What `/api/posting/digest` resolves to, as the browser sees it.
 *
 * It lived on `ApplicationForm`, which no longer exists. Three surfaces import
 * it now -- the record's description column, the add wizard, and the route
 * that owns the mutation -- so it belongs in a module none of them owns.
 */
export interface PostingDigestResult {
  /** The deterministic tidy of the scrape, and the evidence `description` was checked against. */
  formatted: string
  /** The posting restructured under headings; `formatted` when that could not be verified. */
  description: string
  fields: Partial<JobFormData> & { tech_stack?: string[] }
  usedModel: boolean
  dropped: string[]
}

/**
 * The fields the digest mined, over the ones the form left empty.
 *
 * WHY IT EXISTS (Gabe, 2026-09-19: "it does not fill the application overview
 * dialog"). `digestPosting` returns `fields` as well as `description`, and the
 * READ step has always applied both -- but the SAVE step, which is the one
 * that runs on a PASTED posting, kept the description and threw the fields
 * away. So the reader a failed fetch sends to the paste box got a tidied
 * description onto an application with no location, no work mode, no salary
 * and no tech stack, out of a posting that stated all four. That is the exact
 * reader the JobStreet and Indeed copy is written for, which made this the
 * worst possible half to drop.
 *
 * EMPTY FIELDS ONLY. Anything already on the form was typed by a person or
 * found by the extractor, and both outrank a model reading prose -- the same
 * rule `fillEmpty` enforces on the read step and `mergeFilled` enforces in the
 * service.
 *
 * BOTH UNIONS ARE GUARDED HERE rather than trusted from the reply. A work mode
 * outside the three the form knows fails a CHECK constraint at the insert, and
 * an unsupported currency relabels a figure without converting it.
 */
export function applyMinedFields(
  data: JobFormData,
  fields: PostingDigestResult['fields']
): JobFormData {
  const blank = (value: unknown) =>
    value === null || value === undefined || value === '' ||
    (Array.isArray(value) && value.length === 0)

  const next = { ...data }
  if (blank(next.company) && fields.company) next.company = fields.company
  if (blank(next.role) && fields.role) next.role = fields.role
  if (blank(next.location) && fields.location) next.location = fields.location
  if (blank(next.salary_min) && fields.salary_min != null) next.salary_min = fields.salary_min
  if (blank(next.salary_max) && fields.salary_max != null) next.salary_max = fields.salary_max
  if (blank(next.tech_stack) && fields.tech_stack?.length) next.tech_stack = fields.tech_stack
  if (blank(next.tags) && fields.tags?.length) next.tags = fields.tags
  if (
    blank(next.work_mode) &&
    fields.work_mode &&
    ['remote', 'hybrid', 'onsite'].includes(fields.work_mode)
  ) {
    next.work_mode = fields.work_mode as WorkMode
  }
  // THE CURRENCY TRAVELS WITH THE FIGURES, and only with them: a code applied
  // to an empty salary relabels nothing and outlives the posting.
  if (
    blank(next.salary_currency) &&
    fields.salary_currency &&
    isSupportedCurrency(fields.salary_currency) &&
    (next.salary_min != null || next.salary_max != null)
  ) {
    next.salary_currency = fields.salary_currency
  }
  return next
}
