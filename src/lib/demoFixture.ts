import type { Job, JobStatus } from '@/types'
import type { CalendarEvent } from '@/services/events'
import type { ResumeSummary } from '@/services/resumeService'
import type { FeedJob } from '@/services/jobFeed'
import type {
  CohortAnalysis,
  ConversionFunnelMetric,
  ConversionMetrics,
  StatusTransition,
  TimeInStageMetric,
} from '@/services/analyticsService'

/**
 * The dataset behind `/demo/*`.
 *
 * THIS FIXTURE IS THE PRODUCT DEMO. A reviewer's entire impression of the app
 * comes from it, so it is content work rather than scaffolding, and the tests
 * beside it are about whether it makes a good argument -- enough rows for
 * every panel to say something, all five statuses, a real source split, and
 * transitions for the pipeline flow.
 *
 * IT IS INVENTED, AND IT IS PUBLISHED. Committed to a public repo and served
 * to strangers, so every company, name and address here is made up and every
 * email is `@example.com`. There is no route by which real data reaches this
 * file, and there must not be.
 *
 * DATES ARE RELATIVE TO `now`, WHICH IS THE ONLY REAL LOGIC HERE. Hardcoded
 * dates mean the demo says "applied 8 months ago" by spring and the trend
 * chart runs off the left edge of its window. `applicationsPerMonth` buckets
 * on `created_at` against the real clock, so `created_at` in particular has to
 * land inside the six-month window or the chart is empty however many rows
 * exist. `scripts/demoSeedData.mjs` pins a fixed TODAY on purpose -- that one
 * seeds a database and wants reproducibility; this one is rendered live and
 * wants currency. The company list is shared with it; nothing else is.
 *
 * `buildDemoFixture(now)` takes the clock as a parameter rather than reading
 * it, the same way `lib/calendar.ts` and `lib/analyticsRange.ts` do, so the
 * date logic is testable without freezing timers.
 *
 * ANALYTICS ARE DERIVED FROM THE JOBS, never hand-written. Hand-written
 * numbers that contradict the applications list is a subtle lie: a reviewer
 * clicking between Analytics and Applications sees two different totals and
 * correctly concludes one of them is fake. Everything in `analytics` is
 * computed from the same rows the other screens render.
 */

export interface DemoFixture {
  jobs: Job[]
  events: CalendarEvent[]
  resumes: ResumeSummary[]
  analytics: {
    timeInStage: TimeInStageMetric[]
    conversionFunnel: ConversionFunnelMetric[]
    statusTransitions: StatusTransition[]
    cohortAnalysis: CohortAnalysis[]
    conversionMetrics: ConversionMetrics
  }
  /**
   * Postings from the four paid boards, invented.
   *
   * WHY THE DEMO NEEDS ITS OWN (Gabe, 2026-09-21: "why can I not see
   * information from other job posting websites in the demo pages"). On the
   * real planner these come from Apify actors behind `/api/jobfeed`, which
   * needs a session to authenticate and an account to bill. `/demo` has
   * neither by design, so calling it there would answer 401 -- and a public
   * URL anyone can open must not carry a button that spends money.
   *
   * A FIXTURE IS THE ANSWER RATHER THAN A LESSER SCREEN, which is the whole
   * premise of this file: the demo shows the real rail with every board on it,
   * the toggles work, and nothing is fetched or charged. Jobicy stays LIVE
   * beside them -- it is keyless and public, so a demo visitor gets the real
   * thing where the real thing is free.
   */
  boardJobs: FeedJob[]
}

const DEMO_USER_ID = 'demo-user'

/**
 * How far each application actually got, independent of where it sits now.
 *
 * A rejection is an EXIT from the funnel at whatever stage it happened, not a
 * fifth rung below Offer -- see ConversionFunnelMetric.isExit. So a rejected
 * row still records the stage it reached, and the funnel counts it there.
 */
type Reached = 'wishlist' | 'applied' | 'interviewing' | 'offer'

interface Seed {
  ref: string
  company: string
  role: string
  status: JobStatus
  reached: Reached
  /** Days before `now` the application was sent. null for wishlist. */
  appliedDaysAgo: number | null
  /** Days before `now` the row was created. Drives the trend chart. */
  createdDaysAgo: number
  salaryMin: number
  salaryMax: number
  source: string
  tags: string[]
  stack: string[]
  /** A few rows carry an invented contact so the detail view is not empty. */
  contact?: { name: string; email: string; notes: string }
}

/**
 * Sources are skewed deliberately. `rankedSources` shows a primary, a
 * secondary and collapses the rest into "others", so a single source (which is
 * what scripts/demoSeedData.mjs has -- every row is LinkedIn) renders a chart
 * with nothing to compare. This spread gives all three ranks real content.
 */
const SEEDS: Seed[] = [
  { ref: 'stripe', company: 'Northwind Pay', role: 'Software Engineer', status: 'offer', reached: 'offer', appliedDaysAgo: 34, createdDaysAgo: 38, salaryMin: 180000, salaryMax: 240000, source: 'Referral', tags: ['fintech'], stack: ['TypeScript', 'React', 'Postgres'], contact: { name: 'Dana Reyes', email: 'dana.reyes@example.com', notes: 'Recruiter, responsive' } },
  { ref: 'linear', company: 'Meridian Labs', role: 'Product Engineer', status: 'interviewing', reached: 'interviewing', appliedDaysAgo: 22, createdDaysAgo: 26, salaryMin: 170000, salaryMax: 220000, source: 'LinkedIn', tags: ['product'], stack: ['TypeScript', 'React'], contact: { name: 'Sam Cruz', email: 'sam.cruz@example.com', notes: 'Hiring manager' } },
  { ref: 'vercel', company: 'Halcyon Systems', role: 'Frontend Engineer', status: 'interviewing', reached: 'interviewing', appliedDaysAgo: 29, createdDaysAgo: 33, salaryMin: 160000, salaryMax: 210000, source: 'Referral', tags: ['devtools'], stack: ['Next.js', 'React'], contact: { name: 'Alex Tan', email: 'alex.tan@example.com', notes: 'Referred me in' } },
  { ref: 'supabase', company: 'Cindershore', role: 'Full Stack Engineer', status: 'interviewing', reached: 'interviewing', appliedDaysAgo: 41, createdDaysAgo: 45, salaryMin: 150000, salaryMax: 200000, source: 'LinkedIn', tags: ['devtools'], stack: ['TypeScript', 'Postgres'] },
  { ref: 'grab', company: 'Tanglewood Transit', role: 'Backend Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 12, createdDaysAgo: 14, salaryMin: 140000, salaryMax: 190000, source: 'LinkedIn', tags: ['logistics'], stack: ['Go', 'Postgres'] },
  { ref: 'gcash', company: 'Baywalk Digital', role: 'Senior Frontend Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 18, createdDaysAgo: 20, salaryMin: 130000, salaryMax: 180000, source: 'JobStreet', tags: ['fintech'], stack: ['React', 'TypeScript'] },
  { ref: 'kumu', company: 'Palawan Media', role: 'Software Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 25, createdDaysAgo: 27, salaryMin: 90000, salaryMax: 130000, source: 'LinkedIn', tags: ['media'], stack: ['React', 'Node.js'] },
  { ref: 'sprout', company: 'Verdant HR', role: 'Full Stack Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 31, createdDaysAgo: 34, salaryMin: 100000, salaryMax: 145000, source: 'Kalibrr', tags: ['hr-tech'], stack: ['React', 'Django'] },
  { ref: 'shopee', company: 'Marketside', role: 'Web Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 47, createdDaysAgo: 50, salaryMin: 120000, salaryMax: 165000, source: 'LinkedIn', tags: ['ecommerce'], stack: ['React', 'TypeScript'] },
  { ref: 'canva', company: 'Lumen Studio', role: 'Frontend Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 55, createdDaysAgo: 58, salaryMin: 175000, salaryMax: 230000, source: 'Company site', tags: ['design-tools'], stack: ['React', 'TypeScript'] },
  { ref: 'atlassian', company: 'Bridgeforth', role: 'Software Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 63, createdDaysAgo: 66, salaryMin: 165000, salaryMax: 215000, source: 'LinkedIn', tags: ['saas'], stack: ['React', 'Java'] },
  { ref: 'xendit', company: 'Harborline', role: 'Backend Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 71, createdDaysAgo: 74, salaryMin: 135000, salaryMax: 185000, source: 'JobStreet', tags: ['fintech'], stack: ['Go', 'Postgres'] },
  { ref: 'maya', company: 'Solstice Bank', role: 'Platform Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 78, createdDaysAgo: 82, salaryMin: 125000, salaryMax: 175000, source: 'LinkedIn', tags: ['fintech'], stack: ['Kubernetes', 'Go'] },
  { ref: 'coins', company: 'Tidewater Exchange', role: 'Software Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 86, createdDaysAgo: 90, salaryMin: 115000, salaryMax: 160000, source: 'Kalibrr', tags: ['fintech'], stack: ['TypeScript', 'Node.js'] },
  { ref: 'deel', company: 'Farlight Remote', role: 'Backend Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 94, createdDaysAgo: 98, salaryMin: 145000, salaryMax: 195000, source: 'LinkedIn', tags: ['remote-first'], stack: ['Node.js', 'Postgres'] },
  { ref: 'remote', company: 'Ashgrove Works', role: 'Full Stack Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 102, createdDaysAgo: 106, salaryMin: 150000, salaryMax: 200000, source: 'Company site', tags: ['remote-first'], stack: ['React', 'Ruby'] },
  { ref: 'payretailers', company: 'Cortez Payments', role: 'Frontend Engineer', status: 'rejected', reached: 'interviewing', appliedDaysAgo: 110, createdDaysAgo: 114, salaryMin: 110000, salaryMax: 150000, source: 'LinkedIn', tags: ['fintech'], stack: ['Vue', 'TypeScript'] },
  { ref: 'zalora', company: 'Stonebrook Retail', role: 'Software Engineer', status: 'rejected', reached: 'applied', appliedDaysAgo: 118, createdDaysAgo: 122, salaryMin: 105000, salaryMax: 145000, source: 'JobStreet', tags: ['ecommerce'], stack: ['React', 'PHP'] },
  { ref: 'lalamove', company: 'Quickstep Freight', role: 'Backend Engineer', status: 'rejected', reached: 'applied', appliedDaysAgo: 126, createdDaysAgo: 130, salaryMin: 120000, salaryMax: 165000, source: 'LinkedIn', tags: ['logistics'], stack: ['Node.js', 'MongoDB'] },
  { ref: 'ninjavan', company: 'Kestrel Logistics', role: 'Full Stack Engineer', status: 'rejected', reached: 'interviewing', appliedDaysAgo: 134, createdDaysAgo: 138, salaryMin: 115000, salaryMax: 158000, source: 'Kalibrr', tags: ['logistics'], stack: ['React', 'Java'] },
  { ref: 'tonik', company: 'Aurelia Bank', role: 'Frontend Engineer', status: 'rejected', reached: 'applied', appliedDaysAgo: 142, createdDaysAgo: 146, salaryMin: 108000, salaryMax: 148000, source: 'LinkedIn', tags: ['fintech'], stack: ['React', 'TypeScript'] },
  { ref: 'gitlab', company: 'Ravenswood OSS', role: 'Frontend Engineer', status: 'wishlist', reached: 'wishlist', appliedDaysAgo: null, createdDaysAgo: 9, salaryMin: 190000, salaryMax: 250000, source: 'Company site', tags: ['remote-first'], stack: ['Vue', 'Ruby'] },
  { ref: 'figma', company: 'Inkwell Design', role: 'Product Engineer', status: 'wishlist', reached: 'wishlist', appliedDaysAgo: null, createdDaysAgo: 7, salaryMin: 200000, salaryMax: 260000, source: 'LinkedIn', tags: ['design-tools'], stack: ['TypeScript', 'React'] },
  { ref: 'notion', company: 'Foldercraft', role: 'Software Engineer', status: 'wishlist', reached: 'wishlist', appliedDaysAgo: null, createdDaysAgo: 5, salaryMin: 195000, salaryMax: 255000, source: 'Kalibrr', tags: ['productivity'], stack: ['TypeScript', 'React'] },
  { ref: 'posthog', company: 'Beacon Analytics', role: 'Full Stack Engineer', status: 'wishlist', reached: 'wishlist', appliedDaysAgo: null, createdDaysAgo: 4, salaryMin: 170000, salaryMax: 225000, source: 'Company site', tags: ['analytics'], stack: ['React', 'Python'] },
  { ref: 'railway', company: 'Trackline Cloud', role: 'Platform Engineer', status: 'wishlist', reached: 'wishlist', appliedDaysAgo: null, createdDaysAgo: 3, salaryMin: 165000, salaryMax: 215000, source: 'JobStreet', tags: ['devtools'], stack: ['Go', 'Kubernetes'] },
  { ref: 'cursor', company: 'Glasswing AI', role: 'Software Engineer', status: 'wishlist', reached: 'wishlist', appliedDaysAgo: null, createdDaysAgo: 2, salaryMin: 210000, salaryMax: 280000, source: 'Referral', tags: ['ai'], stack: ['TypeScript', 'React'] },

  // THE LAST FORTNIGHT, ADDED 2026-09-10, and it is the calendar that needed
  // it. Every seed above was sent between 12 and 142 days ago, so the month
  // grid -- which shows ONE month -- had nothing of the user's own on it and
  // drew forty-two empty cells beside a busy applications list. These land
  // inside the current month, which is also what gives `waiting on a reply`,
  // `added in <month>` and the follow-up nudge something true to say.
  //
  // TWO ON THE SAME DAY, deliberately: a cell reading "2 sent" is the case a
  // per-day count exists for, and a fixture where every day holds at most one
  // would never show it.
  { ref: 'aboitiz', company: 'Cordillera Power', role: 'Frontend Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 1, createdDaysAgo: 2, salaryMin: 95000, salaryMax: 135000, source: 'JobStreet', tags: ['energy'], stack: ['React', 'TypeScript'] },
  { ref: 'unionbank', company: 'Rivermouth Bank', role: 'Software Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 2, createdDaysAgo: 3, salaryMin: 110000, salaryMax: 150000, source: 'LinkedIn', tags: ['fintech'], stack: ['TypeScript', 'Node.js'] },
  { ref: 'globe', company: 'Skyline Telecom', role: 'Full Stack Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 4, createdDaysAgo: 5, salaryMin: 105000, salaryMax: 145000, source: 'Company site', tags: ['telco'], stack: ['React', 'Postgres'] },
  { ref: 'smart', company: 'Northbend Comms', role: 'Web Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 4, createdDaysAgo: 6, salaryMin: 90000, salaryMax: 125000, source: 'LinkedIn', tags: ['telco'], stack: ['React', 'PHP'] },
  { ref: 'cloudstaff', company: 'Ridgeway Outsourcing', role: 'Junior Developer', status: 'interviewing', reached: 'interviewing', appliedDaysAgo: 8, createdDaysAgo: 10, salaryMin: 70000, salaryMax: 95000, source: 'Kalibrr', tags: ['bpo'], stack: ['React', 'Node.js'], contact: { name: 'Rina Lopez', email: 'rina.lopez@example.com', notes: 'Talent partner' } },
  { ref: 'penbrothers', company: 'Fairwind Talent', role: 'Frontend Engineer', status: 'applied', reached: 'applied', appliedDaysAgo: 9, createdDaysAgo: 11, salaryMin: 85000, salaryMax: 120000, source: 'JobStreet', tags: ['bpo'], stack: ['Vue', 'TypeScript'] },
]

const jd = (role: string, stack: string[]) =>
  `We are hiring a ${role}. You will work across ${stack.join(', ')}, ship to production weekly, ` +
  `and own features end to end. We value clear written communication and small reviewable changes. ` +
  `Experience with testing and observability is expected.`

function shift(now: Date, days: number): Date {
  const d = new Date(now.getTime())
  d.setDate(d.getDate() - days)
  return d
}

const dayOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Stable per-row variation, so stage durations differ without being random. */
function spread(ref: string, lo: number, hi: number): number {
  let h = 0
  for (const ch of ref) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return lo + (h % (hi - lo + 1))
}

const CHAIN: Reached[] = ['wishlist', 'applied', 'interviewing', 'offer']
const rank = (r: Reached) => CHAIN.indexOf(r)

function buildJobs(now: Date): Job[] {
  return SEEDS.map((seed) => {
    const created = shift(now, seed.createdDaysAgo)
    return {
      id: `demo-${seed.ref}`,
      user_id: DEMO_USER_ID,
      company: seed.company,
      role: seed.role,
      salary_min: seed.salaryMin,
      salary_max: seed.salaryMax,
      salary_currency: 'PHP',
      url: `https://careers.example.com/${seed.ref}`,
      description: jd(seed.role, seed.stack),
      status: seed.status,
      date_applied: seed.appliedDaysAgo === null ? null : dayOf(shift(now, seed.appliedDaysAgo)),
      notes: null,
      contact_name: seed.contact?.name ?? null,
      contact_email: seed.contact?.email ?? null,
      contact_linkedin: null,
      contact_notes: seed.contact?.notes ?? null,
      location: 'Remote',
      work_mode: 'remote',
      source: seed.source,
      is_referral: seed.source === 'Referral',
      tags: seed.tags,
      tech_stack: seed.stack,
      created_at: created.toISOString(),
      updated_at: created.toISOString(),
    }
  })
}

function buildEvents(now: Date): CalendarEvent[] {
  const at = (days: number, hour: number) => {
    const d = shift(now, -days)
    d.setHours(hour, 0, 0, 0)
    return d.toISOString()
  }
  return [
    { id: 'demo-ev-1', job_id: 'demo-linear', user_id: DEMO_USER_ID, kind: 'interview', title: 'Technical interview', starts_at: at(1, 10), duration_minutes: 60, notes: null },
    { id: 'demo-ev-2', job_id: 'demo-supabase', user_id: DEMO_USER_ID, kind: 'take_home', title: 'Take-home due', starts_at: at(2, 17), duration_minutes: null, notes: null },
    { id: 'demo-ev-3', job_id: 'demo-vercel', user_id: DEMO_USER_ID, kind: 'interview', title: 'Hiring manager call', starts_at: at(4, 14), duration_minutes: 45, notes: null },
    { id: 'demo-ev-4', job_id: 'demo-stripe', user_id: DEMO_USER_ID, kind: 'deadline', title: 'Offer decision deadline', starts_at: at(6, 9), duration_minutes: null, notes: null },
    { id: 'demo-ev-5', job_id: 'demo-grab', user_id: DEMO_USER_ID, kind: 'follow_up', title: 'Follow up, no reply yet', starts_at: at(9, 11), duration_minutes: 15, notes: null },
    // The record dialog's interview date reads the FIRST `kind: 'interview'`
    // event on a job (see useApplicationRecord), so an interviewing row without
    // one opens with an empty date field and nothing to demonstrate. Added
    // 2026-09-10 alongside the recent applications above.
    { id: 'demo-ev-6', job_id: 'demo-cloudstaff', user_id: DEMO_USER_ID, kind: 'interview', title: 'Interview — Ridgeway Outsourcing', starts_at: at(3, 15), duration_minutes: 45, notes: null },
  ]
}

/**
 * The CVs, and why there are twelve of them.
 *
 * TWO WAS A DEMO OF NOTHING once the documents screen grew a format filter and
 * a pager (2026-09-10). Two rows cannot show a filter narrowing anything, and
 * ten-a-page over two documents renders a pager that is permanently on its
 * first and only page -- so the two features Gabe had just asked for were
 * invisible on the screen that has them.
 *
 * TWELVE IS NOT PADDING, it is what this app is for. Eight Word and four
 * LaTeX, most of them named after the role they were tailored to, which is the
 * product's own argument: you do not send one CV to thirty companies, you send
 * a version. Eleven would have been enough for a second page; twelve keeps the
 * count honest against the applications list, where four of these companies
 * appear by name.
 *
 * Dates are spread so `modified` sorts to something readable rather than
 * twelve rows of the same day.
 */
/**
 * The demo's documents list.
 *
 * IT CARRIES COVER LETTERS AS WELL AS CVS (2026-09-14), because the list has a
 * kind filter again and a fixture with one kind in it would leave a visitor
 * choosing "cover letters" and being told the demo account has none -- a
 * working control that looks broken, which is the exact failure the demo
 * exists to avoid. Four of sixteen, and dated in among the CVs rather than
 * appended, so the list does not sort into a block of CVs followed by a block
 * of letters and give away that they were bolted on.
 *
 * Each letter is named after a company that exists in the applications
 * fixture. The demo's whole discipline is that its screens do not contradict
 * each other, and a cover letter addressed to a company nobody applied to is
 * the kind of detail a reviewer notices.
 */
function buildResumes(now: Date): ResumeSummary[] {
  const cv = (
    id: string,
    title: string,
    mode: ResumeSummary['mode'],
    daysAgo: number,
    version: number
  ): ResumeSummary => ({
    id,
    title,
    mode,
    updated_at: shift(now, daysAgo).toISOString(),
    sections: null,
    version,
    // A version history exists once there is more than one version of it, which
    // is the same rule the real `resumeService` applies.
    hasVersions: version > 1,
  })

  return [
    cv('demo-cv-word', 'Software Engineer CV', 'word', 3, 4),
    cv('demo-cl-meridian', 'Cover letter — Meridian Labs', 'cover_letter', 4, 2),
    cv('demo-cv-frontend', 'Frontend Engineer CV', 'word', 5, 3),
    cv('demo-cv-meridian', 'Product Engineer — Meridian Labs', 'word', 8, 2),
    cv('demo-cv-northwind', 'Software Engineer — Northwind Pay', 'word', 12, 5),
    cv('demo-cl-northwind', 'Cover letter — Northwind Pay', 'cover_letter', 13, 3),
    cv('demo-cv-fullstack', 'Full Stack Engineer CV', 'word', 16, 2),
    cv('demo-cv-backend', 'Backend Engineer CV', 'word', 24, 1),
    cv('demo-cl-halcyon', 'Cover letter — Halcyon Systems', 'cover_letter', 28, 1),
    cv('demo-cv-junior', 'Junior Developer CV', 'word', 33, 1),
    cv('demo-cv-ats', 'ATS-safe plain CV', 'word', 41, 2),
    cv('demo-cv-engineer', 'Software Engineer CV', 'word', 21, 2),
    cv('demo-cv-academic', 'Academic CV', 'word', 29, 3),
    cv('demo-cv-compact', 'Compact one-page CV', 'word', 47, 1),
    cv('demo-cl-speculative', 'Speculative letter — Lumen Studio', 'cover_letter', 52, 1),
    cv('demo-cv-halcyon', 'Frontend Engineer — Halcyon', 'word', 55, 2),
  ]
}

/**
 * Everything below derives from the jobs above.
 *
 * The funnel's chain counts are "ever reached this stage or a later one",
 * which is why each seed records `reached` rather than the funnel inferring it
 * from the current status: a rejected row still got as far as it got, and
 * losing that would make Interviewing look emptier than the history was.
 */
/**
 * EXPORTED so the demo's analytics screen can rebuild its numbers for a
 * narrowed date range.
 *
 * The picker there used to move one table and leave five panels labelled "all
 * time" -- the same dead-dropdown Gabe reported on the real screen. The real
 * one is fixed at the service, which the demo has none of; recomputing from
 * the filtered rows is the demo's equivalent, and it is honest for the same
 * reason the fixture derives these from the jobs in the first place: numbers
 * that contradict the applications list are a lie a reviewer will catch.
 */
export function buildAnalytics(jobs: Job[]): DemoFixture['analytics'] {
  const bySeed = new Map(SEEDS.map((s) => [`demo-${s.ref}`, s]))
  const seedOf = (job: Job) => bySeed.get(job.id)!

  const timeInStage: TimeInStageMetric[] = (
    ['wishlist', 'applied', 'interviewing', 'offer', 'rejected'] as JobStatus[]
  ).map((status) => {
    const rows = jobs.filter((j) => j.status === status)
    const days = rows.map((j) => spread(j.id + status, 3, 28)).sort((a, b) => a - b)
    const sum = days.reduce((s, d) => s + d, 0)
    return {
      status,
      avgDays: days.length ? Math.round((sum / days.length) * 10) / 10 : 0,
      medianDays: days.length ? days[Math.floor(days.length / 2)] : 0,
      minDays: days.length ? days[0] : 0,
      maxDays: days.length ? days[days.length - 1] : 0,
      count: rows.length,
    }
  })

  const reachedAtLeast = (r: Reached) =>
    jobs.filter((j) => rank(seedOf(j).reached) >= rank(r)).length
  const total = jobs.length
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10)

  const conversionFunnel: ConversionFunnelMetric[] = [
    { stage: 'Wishlist', count: total, percentage: 100, avgDaysToStage: 0, isExit: false },
    { stage: 'Applied', count: reachedAtLeast('applied'), percentage: pct(reachedAtLeast('applied')), avgDaysToStage: 4, isExit: false },
    { stage: 'Interviewing', count: reachedAtLeast('interviewing'), percentage: pct(reachedAtLeast('interviewing')), avgDaysToStage: 16, isExit: false },
    { stage: 'Offer', count: reachedAtLeast('offer'), percentage: pct(reachedAtLeast('offer')), avgDaysToStage: 34, isExit: false },
    {
      stage: 'Rejected',
      count: jobs.filter((j) => j.status === 'rejected').length,
      percentage: pct(jobs.filter((j) => j.status === 'rejected').length),
      avgDaysToStage: 21,
      isExit: true,
    },
  ]

  // Forward moves only -- the Sankey draws progress through the pipeline, and
  // a self-transition is not a move at all.
  const step = (from: Reached, to: Reached): StatusTransition => ({
    from: from as JobStatus,
    to: to as JobStatus,
    count: jobs.filter((j) => rank(seedOf(j).reached) >= rank(to)).length,
  })
  const rejectedFrom = (r: Reached): StatusTransition => ({
    from: r as JobStatus,
    to: 'rejected',
    count: jobs.filter((j) => j.status === 'rejected' && seedOf(j).reached === r).length,
  })
  const statusTransitions: StatusTransition[] = [
    step('wishlist', 'applied'),
    step('applied', 'interviewing'),
    step('interviewing', 'offer'),
    rejectedFrom('applied'),
    rejectedFrom('interviewing'),
  ].filter((t) => t.count > 0)

  const cohorts = new Map<string, Job[]>()
  for (const job of jobs) {
    if (!job.date_applied) continue
    const key = job.date_applied.slice(0, 7)
    const bucket = cohorts.get(key)
    if (bucket) bucket.push(job)
    else cohorts.set(key, [job])
  }
  const cohortAnalysis: CohortAnalysis[] = [...cohorts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, rows]) => {
      const offered = rows.filter((j) => rank(seedOf(j).reached) >= rank('offer')).length
      return {
        cohort,
        jobsApplied: rows.length,
        jobsInterviewing: rows.filter((j) => rank(seedOf(j).reached) >= rank('interviewing')).length,
        jobsOffered: offered,
        jobsRejected: rows.filter((j) => j.status === 'rejected').length,
        conversionRate: rows.length ? Math.round((offered / rows.length) * 1000) / 10 : 0,
        avgTimeToOffer: offered ? 34 : null,
      }
    })

  const conversionBySource: Record<string, number> = {}
  for (const job of jobs) {
    const source = job.source ?? 'unknown'
    const reachedInterview = rank(seedOf(job).reached) >= rank('interviewing')
    const seen = conversionBySource[source] ?? 0
    conversionBySource[source] = seen + (reachedInterview ? 1 : 0)
  }

  const offers = reachedAtLeast('offer')
  const conversionMetrics: ConversionMetrics = {
    totalJobs: total,
    timeToFirstInterview: 16,
    timeToOffer: 34,
    conversionRate: total ? Math.round((offers / total) * 1000) / 10 : 0,
    conversionBySource,
  }

  return { timeInStage, conversionFunnel, statusTransitions, cohortAnalysis, conversionMetrics }
}


/**
 * Invented postings from the four paid boards, dated against the clock.
 *
 * RELATIVE DATES, LIKE EVERYTHING ELSE HERE. A posting pinned to a literal day
 * reads "posted 8 months ago" by spring, and this rail's entire subject is how
 * recent something is -- see the note on `buildDemoFixture`.
 *
 * THE COMPANIES ARE INVENTED and the addresses point at each board's real
 * domain, which is the same trade the rest of this fixture makes: nothing here
 * is a real person's or a real employer's data, and a link that goes nowhere
 * plausible would make the demo look broken rather than honest. They are
 * `example` paths on purpose -- they resolve to the board's own 404 rather
 * than to somebody's actual listing.
 */
function buildBoardJobs(now: Date): FeedJob[] {
  const daysAgo = (days: number, hour: number) => {
    const when = new Date(now)
    when.setDate(when.getDate() - days)
    when.setHours(hour, 0, 0, 0)
    return when.toISOString()
  }

  const rows: (Omit<FeedJob, 'id' | 'publishedAt'> & { days: number; hour: number })[] = [
    {
      source: 'linkedin',
      title: 'Senior Frontend Engineer',
      company: 'Meridian Labs',
      url: 'https://www.linkedin.com/jobs/view/example-senior-frontend-engineer',
      geo: 'Singapore · Hybrid',
      level: 'Mid-Senior level',
      industry: 'Software Development',
      excerpt: 'Own the design system and the component library behind three products.',
      salaryMin: 8000,
      salaryMax: 11000,
      salaryCurrency: 'SGD',
      days: 0,
      hour: 9,
    },
    {
      source: 'linkedin',
      title: 'Product Engineer, Growth',
      company: 'Cindershore',
      url: 'https://www.linkedin.com/jobs/view/example-product-engineer-growth',
      geo: 'Remote · APAC',
      level: 'Associate',
      industry: 'Software Development',
      excerpt: 'Ship experiments end to end, from the hypothesis to the rollout.',
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      days: 1,
      hour: 14,
    },
    {
      source: 'jobstreet',
      title: 'Full Stack Developer (React / Node)',
      company: 'Baywalk Digital',
      url: 'https://ph.jobstreet.com/job/example-full-stack-developer',
      geo: 'Taguig City, Metro Manila',
      level: 'Full time',
      industry: 'Information & Communication Technology',
      excerpt: 'A small team, a large codebase, and a rewrite that is already underway.',
      salaryMin: 90000,
      salaryMax: 130000,
      salaryCurrency: 'PHP',
      days: 0,
      hour: 11,
    },
    {
      source: 'jobstreet',
      title: 'Backend Engineer (Go)',
      company: 'Harborline',
      url: 'https://ph.jobstreet.com/job/example-backend-engineer-go',
      geo: 'Cebu City, Central Visayas',
      level: 'Full time',
      industry: 'Information & Communication Technology',
      excerpt: 'Payments infrastructure, and the reconciliation that sits behind it.',
      salaryMin: 120000,
      salaryMax: 165000,
      salaryCurrency: 'PHP',
      days: 2,
      hour: 10,
    },
    {
      source: 'indeed',
      title: 'Software Engineer II',
      company: 'Tanglewood Transit',
      url: 'https://ph.indeed.com/viewjob?jk=example-software-engineer-ii',
      geo: 'Makati City',
      level: 'Full-time',
      industry: null,
      excerpt: 'Routing, dispatch and the maps layer that ties them together.',
      salaryMin: 110000,
      salaryMax: 150000,
      salaryCurrency: 'PHP',
      days: 1,
      hour: 8,
    },
    {
      source: 'indeed',
      title: 'Platform Engineer',
      company: 'Solstice Bank',
      url: 'https://ph.indeed.com/viewjob?jk=example-platform-engineer',
      geo: 'Remote',
      level: 'Full-time',
      industry: null,
      excerpt: 'Kubernetes, Terraform, and an on-call rota that people volunteer for.',
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      days: 3,
      hour: 16,
    },
    {
      source: 'glassdoor',
      title: 'Frontend Engineer, Design Systems',
      company: 'Lumen Studio',
      url: 'https://www.glassdoor.com/job-listing/example-frontend-engineer-design-systems',
      geo: 'Remote · Worldwide',
      level: 'Mid level',
      industry: 'Computer Hardware & Software',
      excerpt: 'Tokens, primitives, and the documentation nobody else wants to write.',
      salaryMin: 95000,
      salaryMax: 125000,
      salaryCurrency: 'USD',
      days: 2,
      hour: 13,
    },
    {
      source: 'glassdoor',
      title: 'Staff Engineer, Data Platform',
      company: 'Northwind Pay',
      url: 'https://www.glassdoor.com/job-listing/example-staff-engineer-data-platform',
      geo: 'Hybrid · Manila',
      level: 'Senior level',
      industry: 'Financial Services',
      excerpt: 'The warehouse, the pipelines, and the numbers the board reads.',
      salaryMin: 150000,
      salaryMax: 200000,
      salaryCurrency: 'USD',
      days: 4,
      hour: 12,
    },
  ]

  return rows
    .map(({ days, hour, ...row }) => ({
      ...row,
      // THE SAME ID SHAPE THE EXTRACTOR MINTS, so `trackedFeedRoles` and the
      // rail's React keys behave here exactly as they do on the real screen.
      id: `${row.source}:${row.url}`,
      publishedAt: daysAgo(days, hour),
    }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

export function buildDemoFixture(now: Date): DemoFixture {
  const jobs = buildJobs(now)
  return {
    jobs,
    events: buildEvents(now),
    resumes: buildResumes(now),
    analytics: buildAnalytics(jobs),
    boardJobs: buildBoardJobs(now),
  }
}

/**
 * Built once at module load against the real clock, FLOORED TO MIDNIGHT.
 *
 * THE FLOOR IS A HYDRATION FIX, not tidiness. This module runs twice for every
 * demo page -- once on the server, once in the browser -- and each run called
 * `new Date()` for itself, so every `updated_at` and `created_at` differed by
 * however many milliseconds the response took. React compared the two and
 * logged a hydration mismatch on `<time dateTime>` for every row on the
 * screen; the visible text always agreed ("Sep 7" both times), which is why it
 * survived unnoticed until the demo grew from two CVs to twelve and the error
 * listed all of them.
 *
 * Local midnight rather than UTC midnight: every date the fixture derives is
 * read on a wall calendar (`dayOf`, the trend buckets, the month grid), and
 * flooring in UTC would put "today" on the wrong day for anyone far enough
 * east or west. Both runs are the same machine in the same zone, so both floor
 * to the same instant.
 *
 * The routes import this; tests that care about the date logic call
 * `buildDemoFixture` with their own `now` instead.
 */
function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export const DEMO: DemoFixture = buildDemoFixture(startOfToday())
