import Papa from 'papaparse'
import { Job, JobFormData, JobStatus, WorkMode } from '@/types'
import { isSupportedCurrency, type SupportedCurrency } from '@/services/userPreferences'
import { escapeCsvCell } from '@/lib/uploadSafety'

export interface ParsedJobRow {
  rowNumber: number
  data: JobFormData
  dedupKey: string
}

export interface CsvParseIssue {
  rowNumber: number
  message: string
}

export interface ParseJobsCsvResult {
  rows: ParsedJobRow[]
  issues: CsvParseIssue[]
  fatalError?: string
}

const HEADER_ALIASES: Record<keyof JobFormData | 'tags' | 'tech_stack', string[]> = {
  company: ['company', 'company_name', 'employer'],
  role: ['role', 'title', 'position', 'job_title'],
  salary_min: ['salary_min', 'min_salary', 'salary_from', 'salary_low', 'min'],
  salary_max: ['salary_max', 'max_salary', 'salary_to', 'salary_high', 'max'],
  salary_currency: ['salary_currency', 'currency', 'salary_ccy'],
  url: ['url', 'job_url', 'posting_url', 'link'],
  description: ['description', 'job_description', 'posting', 'jd'],
  status: ['status', 'stage', 'pipeline_stage'],
  date_applied: ['date_applied', 'applied_date', 'date', 'application_date'],
  notes: ['notes', 'note'],
  contact_name: ['contact_name', 'recruiter', 'contact'],
  contact_email: ['contact_email', 'recruiter_email', 'email'],
  contact_linkedin: ['contact_linkedin', 'linkedin', 'contact_linkedin_url'],
  contact_notes: ['contact_notes'],
  location: ['location', 'city', 'office_location'],
  work_mode: ['work_mode', 'mode', 'workmode'],
  source: ['source', 'applied_via', 'platform'],
  is_referral: ['is_referral', 'referral', 'referred'],
  tags: ['tags', 'tag', 'labels'],
  tech_stack: ['tech_stack', 'tech', 'stack', 'technologies'],
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

function getFirstValue(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const raw = row[key]
    if (raw == null) continue
    const value = String(raw).trim()
    if (value) return value
  }
  return ''
}

function parseCommaList(value: string): string[] {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return Array.from(new Set(items))
}

function parseSalary(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '').trim()
  if (!cleaned) return null
  const num = Number(cleaned)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.round(num)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function dateToIsoLocal(date: Date): string {
  const y = date.getFullYear()
  const m = pad2(date.getMonth() + 1)
  const d = pad2(date.getDate())
  return `${y}-${m}-${d}`
}

function parseDateToIso(value: string): string | null {
  const v = value.trim()
  if (!v) return null

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v

  // MM/DD/YYYY or M/D/YYYY
  const slash = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const month = Number(slash[1])
    const day = Number(slash[2])
    const year = Number(slash[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`
    }
  }

  // MM-DD-YYYY
  const dash = v.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (dash) {
    const month = Number(dash[1])
    const day = Number(dash[2])
    const year = Number(dash[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`
    }
  }

  const parsed = new Date(v)
  if (!Number.isNaN(parsed.getTime())) return dateToIsoLocal(parsed)

  return null
}

function normalizeUrl(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  if (/^www\./i.test(v) || /^[a-z0-9.-]+\.[a-z]{2,}/i.test(v)) return `https://${v}`
  return v
}

function parseBoolean(value: string): boolean {
  const v = value.trim().toLowerCase()
  return v === 'true' || v === 'yes' || v === 'y' || v === '1'
}

function parseWorkMode(value: string): WorkMode | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (v === 'remote') return 'remote'
  if (v === 'hybrid') return 'hybrid'
  if (v === 'onsite' || v === 'on-site' || v === 'on site') return 'onsite'
  return null
}

function parseStatus(value: string): JobStatus {
  const v = value.trim().toLowerCase()
  if (!v) return 'wishlist'

  if (v.startsWith('wish')) return 'wishlist'
  if (v === 'saved') return 'wishlist'

  // 'appl', not 'apply': "applied" -- the value this module's own exporter
  // writes and the value stored on every row -- does not start with "apply",
  // so the canonical status was silently landing back as wishlist on import.
  if (v.startsWith('appl')) return 'applied'

  if (v.startsWith('interview')) return 'interviewing'
  if (v === 'screen') return 'interviewing'

  if (v.startsWith('offer')) return 'offer'
  if (v.startsWith('accept')) return 'offer'

  if (v.startsWith('reject')) return 'rejected'
  if (v.startsWith('declin')) return 'rejected'

  return 'wishlist'
}

export function buildJobDedupKey(input: {
  company: string
  role: string
  date_applied?: string | null
  url?: string | null
}): string {
  const company = input.company.trim().toLowerCase()
  const role = input.role.trim().toLowerCase()
  const date = (input.date_applied ?? '').trim()
  const url = (input.url ?? '').trim().toLowerCase()
  return `${company}|${role}|${date}|${url}`
}

export function parseJobsCsvText(csvText: string): ParseJobsCsvResult {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normalizeHeader,
  })

  if (parsed.errors?.length) {
    return {
      rows: [],
      issues: parsed.errors.map((err) => ({
        rowNumber: (err.row ?? 0) + 1,
        message: err.message,
      })),
      fatalError: 'CSV parse error',
    }
  }

  const rows: ParsedJobRow[] = []
  const issues: CsvParseIssue[] = []

  const dataRows = Array.isArray(parsed.data) ? parsed.data : []

  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i] ?? {}
    const rowNumber = i + 2 // header row is line 1

    const company = getFirstValue(row, HEADER_ALIASES.company)
    const role = getFirstValue(row, HEADER_ALIASES.role)

    if (!company || !role) {
      issues.push({
        rowNumber,
        message: 'Missing required Company and/or Role',
      })
      continue
    }

    const statusRaw = getFirstValue(row, HEADER_ALIASES.status)
    const status = parseStatus(statusRaw)

    const salaryMinRaw = getFirstValue(row, HEADER_ALIASES.salary_min)
    const salaryMaxRaw = getFirstValue(row, HEADER_ALIASES.salary_max)
    const salary_min = salaryMinRaw ? parseSalary(salaryMinRaw) : null
    const salary_max = salaryMaxRaw ? parseSalary(salaryMaxRaw) : null

    if (
      salary_min != null &&
      salary_max != null &&
      Number.isFinite(salary_min) &&
      Number.isFinite(salary_max) &&
      salary_min > salary_max
    ) {
      issues.push({
        rowNumber,
        message: 'Salary min is greater than max',
      })
      continue
    }

    const urlRaw = getFirstValue(row, HEADER_ALIASES.url)
    const url = urlRaw ? normalizeUrl(urlRaw) : null

    const dateAppliedRaw = getFirstValue(row, HEADER_ALIASES.date_applied)
    const date_applied = dateAppliedRaw ? parseDateToIso(dateAppliedRaw) : null

    // AN APPLIED ROW NEEDS ITS DATE (2026-10-01), the rule jobValidation and
    // the database both enforce. Skipped here rather than left to the bulk
    // insert, which would refuse the whole file for one row.
    if (status === 'applied' && !date_applied) {
      issues.push({
        rowNumber,
        message: 'Status is Applied but the date applied is missing or unreadable',
      })
      continue
    }

    const workModeRaw = getFirstValue(row, HEADER_ALIASES.work_mode)
    const work_mode = workModeRaw ? parseWorkMode(workModeRaw) : null

    const referralRaw = getFirstValue(row, HEADER_ALIASES.is_referral)
    const is_referral = referralRaw ? parseBoolean(referralRaw) : false

    const tagsRaw = getFirstValue(row, HEADER_ALIASES.tags)
    const techRaw = getFirstValue(row, HEADER_ALIASES.tech_stack)

    // An unrecognised currency is dropped rather than passed through: the column
    // has a CHECK constraint, so one bad cell would fail the whole insert. The
    // row still imports, taking the column default.
    const currencyRaw = getFirstValue(row, HEADER_ALIASES.salary_currency).trim().toUpperCase()
    const salary_currency = isSupportedCurrency(currencyRaw)
      ? (currencyRaw as SupportedCurrency)
      : undefined
    if (currencyRaw && !salary_currency) {
      issues.push({
        rowNumber,
        message: `Unrecognised currency "${currencyRaw}", imported with the default instead`,
      })
    }

    const data: JobFormData = {
      company,
      role,
      status,
      salary_min,
      salary_max,
      ...(salary_currency ? { salary_currency } : {}),
      url,
      description: getFirstValue(row, HEADER_ALIASES.description) || null,
      date_applied,
      notes: getFirstValue(row, HEADER_ALIASES.notes) || null,
      contact_name: getFirstValue(row, HEADER_ALIASES.contact_name) || null,
      contact_email: getFirstValue(row, HEADER_ALIASES.contact_email) || null,
      contact_linkedin: normalizeUrl(getFirstValue(row, HEADER_ALIASES.contact_linkedin) || '') ?? null,
      contact_notes: getFirstValue(row, HEADER_ALIASES.contact_notes) || null,
      location: getFirstValue(row, HEADER_ALIASES.location) || null,
      work_mode,
      source: getFirstValue(row, HEADER_ALIASES.source) || null,
      is_referral,
      tags: tagsRaw ? parseCommaList(tagsRaw) : [],
      tech_stack: techRaw ? parseCommaList(techRaw) : [],
    }

    const dedupKey = buildJobDedupKey({
      company: data.company,
      role: data.role,
      date_applied: data.date_applied ?? null,
      url: data.url ?? null,
    })

    rows.push({ rowNumber, data, dedupKey })
  }

  const hasAnyRows = rows.length > 0
  const hasCompanyHeader =
    dataRows.length > 0 &&
    Object.keys(dataRows[0] ?? {}).some((key) => HEADER_ALIASES.company.includes(key))

  if (!hasAnyRows && !hasCompanyHeader) {
    return {
      rows: [],
      issues,
      fatalError: 'No rows found. Make sure your CSV includes a header row (Company, Role, etc.)',
    }
  }

  return { rows, issues }
}

/**
 * The column order an exported file is written in. These are the first alias
 * of each field in HEADER_ALIASES, so a file this function writes is a file
 * `parseJobsCsvText` reads back without an import mapping step -- export,
 * edit in a spreadsheet, re-import is the round trip people actually perform.
 */
const EXPORT_COLUMNS = [
  'company', 'role', 'status', 'date_applied', 'salary_min', 'salary_max',
  'salary_currency', 'location', 'work_mode', 'source', 'is_referral', 'url',
  'tags', 'tech_stack', 'contact_name', 'contact_email', 'contact_linkedin',
  'contact_notes', 'notes', 'description',
] as const

/**
 * Serialise jobs to CSV text.
 *
 * Nulls become empty cells rather than the string "null", and the two array
 * columns are joined with the same comma-space the import splits on. Salary
 * currency is written per row and never dropped: a column of bare numbers with
 * the code left behind is how a peso figure gets re-imported as dollars.
 */
export function buildJobsCsvText(
  jobs: Array<Partial<Job> & Pick<Job, 'company' | 'role' | 'status'>>
): string {
  const rows = jobs.map((job) => ({
    company: job.company,
    role: job.role,
    status: job.status,
    date_applied: job.date_applied ?? '',
    salary_min: job.salary_min ?? '',
    salary_max: job.salary_max ?? '',
    salary_currency: job.salary_currency ?? '',
    location: job.location ?? '',
    work_mode: job.work_mode ?? '',
    source: job.source ?? '',
    is_referral: job.is_referral ? 'true' : 'false',
    url: job.url ?? '',
    tags: (job.tags ?? []).join(', '),
    tech_stack: (job.tech_stack ?? []).join(', '),
    contact_name: job.contact_name ?? '',
    contact_email: job.contact_email ?? '',
    contact_linkedin: job.contact_linkedin ?? '',
    contact_notes: job.contact_notes ?? '',
    notes: job.notes ?? '',
    description: job.description ?? '',
  }))

  /*
    EVERY CELL GOES THROUGH `escapeCsvCell` (2026-09-15), and this is the one
    change in the file-handling pass that protects somebody OTHER than the
    person clicking.

    `Papa.unparse` quotes correctly and that is not the problem. A spreadsheet
    UN-quotes the cell and then evaluates it: a value beginning `=`, `+`, `-`
    or `@` is a formula, and Excel's formula language reaches outside the
    document (`=HYPERLINK`, `=WEBSERVICE`, DDE). Every column below is text
    somebody typed into a form, and `company` is routinely pasted straight off
    a job posting -- so a crafted posting becomes a crafted row becomes a
    crafted CSV mailed to a recruiter, and the payload runs on their machine.
    CSV injection, CWE-1236, and correct quoting is exactly why it is missed.

    A LEADING APOSTROPHE is the conventional fix and the only one that does not
    corrupt honest data: Excel, Sheets and Numbers all read it as "this is
    text", strip it on display, and never evaluate what follows. Refusing or
    stripping the character would mangle a salary note reading `-` or a role
    called `@Home`.

    APPLIED AT EXPORT, NOT AT IMPORT, because import is not where the value
    becomes dangerous -- it is a harmless string in a database until something
    writes it into a spreadsheet. Sanitising on the way in would also silently
    rewrite a company name the user can see on screen.
  */
  const safeRows = rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, escapeCsvCell(value)]))
  )

  return Papa.unparse(safeRows, { columns: [...EXPORT_COLUMNS] })
}
