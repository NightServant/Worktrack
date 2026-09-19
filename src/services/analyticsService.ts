import { supabase } from '@/lib/supabase'
import type { JobStatus } from '@/types'
import * as Sentry from '@sentry/nextjs'

/**
 * The running totals the two grouping loops below accumulate before they are
 * turned into their public metric shapes. Named rather than `any` so a typo in
 * a key is a compile error where it used to be a silent zero.
 */
type SourceTrendBucket = {
  applied: number
  interviewing: number
  offer: number
  rejected: number
  total: number
}

type CohortBucket = {
  applied: number
  interviewing: number
  offered: number
  rejected: number
  timeToOffers: number[]
}

export interface TimeInStageMetric {
  status: JobStatus
  avgDays: number
  medianDays: number
  minDays: number
  maxDays: number
  count: number
}

export interface ConversionFunnelMetric {
  stage: string
  count: number
  percentage: number
  avgDaysToStage: number
  /**
   * `false` for every stage in the monotonically non-increasing pipeline
   * chain -- Wishlist -> Applied -> Interviewing -> Offer. `count` there
   * means "jobs that have EVER reached this stage or a later one" (see
   * `getConversionFunnel`), so a later chain stage's count can never exceed
   * an earlier one's.
   *
   * `true` only for the 'Rejected' entry. A rejection is an EXIT from the
   * funnel at whatever stage it happened -- it is NOT a fifth rung of the
   * chain, its count is not constrained to be <= 'Offer', and it must never
   * be treated as though it continues the chain's descent (e.g. appended to
   * a bar chart in pipeline-order as if it were the next stage down).
   * Consumers branch on this flag; they must not infer chain membership
   * from array position alone.
   */
  isExit: boolean
}

export interface ConversionMetrics {
  totalJobs: number
  timeToFirstInterview: number | null
  timeToOffer: number | null
  conversionRate: number
  conversionBySource: Record<string, number>
}

export interface SourceConversionTrend {
  source: string
  month: string
  applied: number
  interviewing: number
  offer: number
  rejected: number
  conversionRate: number
}

export interface CohortAnalysis {
  cohort: string // Month when job was first applied
  jobsApplied: number
  jobsInterviewing: number
  jobsOffered: number
  jobsRejected: number
  conversionRate: number
  avgTimeToOffer: number | null
}


export interface StatusTransition {
  from: JobStatus
  to: JobStatus
  count: number
}

/**
 * A row's place in time, for the range picker.
 *
 * `date_applied` FIRST, `created_at` as the fallback. The applied date is when
 * the application actually went out and is the date every screen in this app
 * shows; `created_at` is when the row was typed in, and it is the only date a
 * wishlist row has. Comparing `YYYY-MM-DD` strings rather than parsing: both
 * sides sort lexically the way they sort chronologically, and a parse here
 * would reintroduce every timezone question a bare DATE column exists to
 * avoid.
 */
function withinRange(
  job: { date_applied?: string | null; created_at?: string | null },
  since: string | null
): boolean {
  if (!since) return true
  const day = job.date_applied ?? job.created_at?.slice(0, 10)
  return !!day && day >= since
}

/**
 * The ids of the applications inside the window, or `null` for all time.
 *
 * WHY AN ID SET AND NOT A DATE FILTER ON EACH QUERY. Three of these metrics
 * are computed from `job_status_history`, whose rows are dated by when the
 * STATUS changed, not by when the application went out. Filtering those on
 * `changed_at` would answer a different question -- "what moved recently"
 * rather than "how did the applications from this window do" -- and the two
 * disagree for exactly the rows a job seeker cares about: an application sent
 * in June that got its offer in September.
 *
 * One definition of the window, applied to the applications, and the history
 * follows the applications it belongs to.
 */
async function inRangeJobIds(userId: string, since: string | null): Promise<Set<string> | null> {
  if (!since) return null
  const { data, error } = await supabase
    .from('jobs')
    .select('id, date_applied, created_at')
    .eq('user_id', userId)
  if (error) throw error
  return new Set((data ?? []).filter((job) => withinRange(job, since)).map((job) => job.id))
}

export const analyticsService = {
  /**
   * Compute time-in-stage metrics for a user's job applications
   * Shows how long jobs spend in each status stage
   */

  /**
   * Forward status transitions, for the pipeline-flow Sankey.
   *
   * Reads `job_status_history` rather than deriving anything from current
   * status. A flow built from end states would be a fabrication: it can say
   * how many jobs ARE at "offer" but not how any of them got there, and a
   * Sankey's whole claim is the path.
   *
   * BACKWARD TRANSITIONS ARE DROPPED, deliberately, and the panel says so.
   * Statuses here are user-set with no enforced state machine, so
   * interviewing -> applied happens (a correction, a re-application). A Sankey
   * is a directed acyclic diagram; feeding it a cycle either throws or renders
   * a loop nobody can read. Dropping them makes the chart show the forward
   * journey, which is the question being asked, and the footnote keeps that
   * honest rather than silent.
   */
  async getStatusTransitions(
    userId: string,
    since: string | null = null
  ): Promise<StatusTransition[]> {
    const ORDER: JobStatus[] = ['wishlist', 'applied', 'interviewing', 'offer', 'rejected']
    const rank = (s: string) => ORDER.indexOf(s as JobStatus)

    const allowed = await inRangeJobIds(userId, since)

    const { data, error } = await supabase
      .from('job_status_history')
      .select('job_id, from_status, to_status')
      .eq('user_id', userId)

    if (error) throw error
    if (!data) return []

    const counts = new Map<string, number>()
    for (const row of data) {
      if (allowed && !allowed.has(row.job_id)) continue
      const from = row.from_status as JobStatus
      const to = row.to_status as JobStatus
      if (from === to) continue
      const a = rank(from)
      const b = rank(to)
      if (a === -1 || b === -1) continue
      // 'rejected' is an exit reachable from any stage, so it is forward from
      // anywhere; everything else must move down the pipeline.
      const forward = to === 'rejected' ? true : b > a
      if (!forward) continue
      const key = `${from}>${to}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    return [...counts.entries()].map(([key, count]) => {
      const [from, to] = key.split('>') as [JobStatus, JobStatus]
      return { from, to, count }
    })
  },

  async getTimeInStageMetrics(
    userId: string,
    since: string | null = null
  ): Promise<TimeInStageMetric[]> {
    try {
      Sentry.addBreadcrumb({
        category: 'analytics.timeInStage',
        message: 'Computing time-in-stage metrics',
        level: 'info',
        data: { userId },
      })

      // Get all status changes for user's jobs
      const allowed = await inRangeJobIds(userId, since)
      const { data: allHistory, error: historyError } = await supabase
        .from('job_status_history')
        .select('*')
        .eq('user_id', userId)
        .order('changed_at', { ascending: true })

      if (historyError) throw historyError

      // Narrowed to the applications in the window, BEFORE the "find the next
      // change" scan below -- which searches this same array, so filtering
      // afterwards would leave durations measured against rows that are not
      // in the result.
      const statusHistory = allowed
        ? (allHistory ?? []).filter((row) => allowed.has(row.job_id))
        : (allHistory ?? [])

      // Compute duration in each status
      const stageMetrics = new Map<JobStatus, number[]>()

      for (const change of statusHistory ?? []) {
        const fromTime = new Date(change.changed_at)

        // Find next status change
        const nextChange = statusHistory?.find(
          (h) =>
            h.job_id === change.job_id &&
            h.from_status === change.to_status &&
            new Date(h.changed_at) > fromTime
        )

        const toTime = nextChange ? new Date(nextChange.changed_at) : new Date()
        const daysInStatus = (toTime.getTime() - fromTime.getTime()) / (1000 * 60 * 60 * 24)

        if (!stageMetrics.has(change.to_status)) {
          stageMetrics.set(change.to_status, [])
        }
        stageMetrics.get(change.to_status)!.push(daysInStatus)
      }

      // Compute statistics for each stage
      const metrics: TimeInStageMetric[] = []
      for (const [status, durations] of stageMetrics.entries()) {
        if (durations.length === 0) continue

        durations.sort((a, b) => a - b)
        const avgDays = durations.reduce((a, b) => a + b, 0) / durations.length
        const medianDays = durations[Math.floor(durations.length / 2)] ?? 0

        metrics.push({
          status: status as JobStatus,
          avgDays: Math.round(avgDays * 10) / 10,
          medianDays: Math.round(medianDays * 10) / 10,
          minDays: Math.round(Math.min(...durations) * 10) / 10,
          maxDays: Math.round(Math.max(...durations) * 10) / 10,
          count: durations.length,
        })
      }

      Sentry.addBreadcrumb({
        category: 'analytics.timeInStage',
        message: 'Time-in-stage metrics computed',
        level: 'info',
        data: { stageCount: metrics.length },
      })

      return metrics
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      Sentry.captureException(error, {
        tags: { function: 'getTimeInStageMetrics' },
        extra: { userId },
      })
      throw error
    }
  },

  /**
   * Compute the conversion funnel: Wishlist -> Applied -> Interviewing ->
   * Offer, a monotonically non-increasing chain, PLUS Rejected reported
   * separately as an exit from the chain rather than a fifth rung (see
   * `ConversionFunnelMetric.isExit`).
   *
   * Each chain stage's `count` is "jobs that have EVER reached this stage or
   * a later one" -- cumulative, not current-status-only. A job now at Offer
   * still counts at Applied and Interviewing, and a job rejected AFTER
   * reaching Interviewing still counts at Applied and Interviewing too.
   * Current status alone cannot answer "did this job ever reach stage X" --
   * only `job_status_history` can -- so history drives the chain and current
   * status is used only as a fallback for jobs with no history rows at all
   * (rows written before history capture existed).
   *
   * A currently-rejected job with no supporting history is credited with
   * Applied, not just Wishlist: Applied is a FLOOR for a rejection, not an
   * assumption -- a job cannot be rejected from a posting it was never
   * applied to. It is NOT credited with Interviewing, which is genuinely
   * unknowable without a history row and is left uncounted rather than
   * inferred. (Gabe's ruling, Task 8 fix round 2 -- supersedes the more
   * conservative Wishlist-only fallback fix round 1 shipped.)
   */
  async getConversionFunnel(
    userId: string,
    since: string | null = null
  ): Promise<ConversionFunnelMetric[]> {
    try {
      Sentry.addBreadcrumb({
        category: 'analytics.conversionFunnel',
        message: 'Computing conversion funnel',
        level: 'info',
        data: { userId },
      })

      const { data: jobs, error: jobsError } = await supabase
        .from('jobs')
        .select('id, status, date_applied, created_at')
        .eq('user_id', userId)

      if (jobsError) throw jobsError

      const jobList = (jobs ?? []).filter((job) => withinRange(job, since))
      const allowed = since ? new Set(jobList.map((job) => job.id)) : null
      const totalJobs = jobList.length

      // "Ever reached stage X" can only come from history -- current status
      // answers "is it at stage X right now", which is exactly the question
      // that let a job at Offer disappear from the Interviewing count.
      const { data: history, error: historyError } = await supabase
        .from('job_status_history')
        .select('job_id, to_status')
        .eq('user_id', userId)

      if (historyError) throw historyError

      const PIPELINE: JobStatus[] = ['wishlist', 'applied', 'interviewing', 'offer']
      const pipelineIndex = (status: string): number => PIPELINE.indexOf(status as JobStatus)

      // Highest pipeline stage each job's history shows it ever reached. A
      // 'rejected' to_status does not advance this -- rejection is an exit,
      // not progress along the chain.
      const maxIndexByJob = new Map<string, number>()
      for (const change of history ?? []) {
        if (allowed && !allowed.has(change.job_id)) continue
        const idx = pipelineIndex(change.to_status)
        if (idx < 0) continue
        const seen = maxIndexByJob.get(change.job_id)
        if (seen === undefined || idx > seen) maxIndexByJob.set(change.job_id, idx)
      }

      const stageCounts = { wishlist: 0, applied: 0, interviewing: 0, offer: 0, rejected: 0 }

      for (const job of jobList) {
        if (job.status === 'rejected') stageCounts.rejected += 1

        let maxIndex = maxIndexByJob.get(job.id)
        if (maxIndex === undefined) {
          // No history row put this job at a pipeline stage -- it predates
          // history capture, or was rejected directly with no intermediate
          // stage ever recorded. Fall back to current status.
          const currentIdx = pipelineIndex(job.status)
          if (currentIdx >= 0) {
            maxIndex = currentIdx
          } else {
            // job.status === 'rejected' with no history at all. Applied is
            // a FLOOR, not an assumption -- a job cannot be rejected from a
            // posting it was never applied to -- so it is credited there
            // even without a history row proving it. Interviewing is NOT
            // credited: that is genuinely unknowable without history, and
            // inferring it would fabricate progress the data cannot
            // support.
            maxIndex = pipelineIndex('applied')
          }
        }

        for (let i = 0; i <= maxIndex; i++) {
          const stage = PIPELINE[i] as 'wishlist' | 'applied' | 'interviewing' | 'offer'
          stageCounts[stage] += 1
        }
      }

      // Compute time to each stage independently -- these must NOT share a
      // value; Applied and Interviewing previously both read
      // timeToInterviewMs, so they always rendered the identical number.
      const timeToAppliedMs = await this._computeTimeToStatus(userId, 'applied', allowed)
      const timeToInterviewMs = await this._computeTimeToStatus(userId, 'interviewing', allowed)
      const timeToOfferMs = await this._computeTimeToStatus(userId, 'offer', allowed)
      const timeToRejectedMs = await this._computeTimeToStatus(userId, 'rejected', allowed)

      const toDays = (ms: number | null): number => (ms ? Math.round(ms / (1000 * 60 * 60 * 24)) : 0)
      const percentOf = (count: number): number => (totalJobs > 0 ? (count / totalJobs) * 100 : 0)

      const funnel: ConversionFunnelMetric[] = [
        {
          stage: 'Wishlist',
          count: stageCounts.wishlist,
          percentage: percentOf(stageCounts.wishlist),
          avgDaysToStage: 0, // the starting stage -- nothing is "time to reach" it
          isExit: false,
        },
        {
          stage: 'Applied',
          count: stageCounts.applied,
          percentage: percentOf(stageCounts.applied),
          avgDaysToStage: toDays(timeToAppliedMs),
          isExit: false,
        },
        {
          stage: 'Interviewing',
          count: stageCounts.interviewing,
          percentage: percentOf(stageCounts.interviewing),
          avgDaysToStage: toDays(timeToInterviewMs),
          isExit: false,
        },
        {
          stage: 'Offer',
          count: stageCounts.offer,
          percentage: percentOf(stageCounts.offer),
          avgDaysToStage: toDays(timeToOfferMs),
          isExit: false,
        },
        {
          stage: 'Rejected',
          count: stageCounts.rejected,
          percentage: percentOf(stageCounts.rejected),
          avgDaysToStage: toDays(timeToRejectedMs),
          isExit: true,
        },
      ]

      Sentry.addBreadcrumb({
        category: 'analytics.conversionFunnel',
        message: 'Conversion funnel computed',
        level: 'info',
        data: { stages: funnel.length, totalJobs },
      })

      return funnel
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      Sentry.captureException(error, {
        tags: { function: 'getConversionFunnel' },
        extra: { userId },
      })
      throw error
    }
  },

  /**
   * Get source-based conversion trends over time
   * Shows how many applications, interviews, and offers per source per month
   */
  async getSourceConversionTrends(
    userId: string,
    since: string | null = null
  ): Promise<SourceConversionTrend[]> {
    try {
      Sentry.addBreadcrumb({
        category: 'analytics.sourceConversionTrends',
        message: 'Computing source conversion trends',
        level: 'info',
        data: { userId },
      })

      const { data: jobs, error: jobsError } = await supabase
        .from('jobs')
        .select('id, source, status, created_at, date_applied')
        .eq('user_id', userId)

      if (jobsError) throw jobsError

      // Group by source and month
      const trendMap = new Map<string, Map<string, SourceTrendBucket>>()

      for (const job of (jobs ?? []).filter((row) => withinRange(row, since))) {
        const source = job.source || 'Direct'
        const month = new Date(job.created_at).toISOString().slice(0, 7) // YYYY-MM

        if (!trendMap.has(source)) {
          trendMap.set(source, new Map())
        }

        const sourceMap = trendMap.get(source)!
        if (!sourceMap.has(month)) {
          sourceMap.set(month, {
            applied: 0,
            interviewing: 0,
            offer: 0,
            rejected: 0,
            total: 0,
          })
        }

        const monthData = sourceMap.get(month)!
        monthData.total += 1

        if (job.status === 'applied') monthData.applied += 1
        else if (job.status === 'interviewing') monthData.interviewing += 1
        else if (job.status === 'offer') monthData.offer += 1
        else if (job.status === 'rejected') monthData.rejected += 1
      }

      // Convert map to array
      const trends: SourceConversionTrend[] = []
      for (const [source, monthMap] of trendMap.entries()) {
        for (const [month, data] of monthMap.entries()) {
          trends.push({
            source,
            month,
            applied: data.applied,
            interviewing: data.interviewing,
            offer: data.offer,
            rejected: data.rejected,
            conversionRate: data.total > 0 ? (data.offer / data.total) * 100 : 0,
          })
        }
      }

      trends.sort((a, b) => a.month.localeCompare(b.month))

      Sentry.addBreadcrumb({
        category: 'analytics.sourceConversionTrends',
        message: 'Source conversion trends computed',
        level: 'info',
        data: { sources: trendMap.size, months: trends.length },
      })

      return trends
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      Sentry.captureException(error, {
        tags: { function: 'getSourceConversionTrends' },
        extra: { userId },
      })
      throw error
    }
  },

  /**
   * Cohort analysis: group applications by month applied, track progression
   * Shows retention and conversion over time for each cohort
   */
  async getCohortAnalysis(
    userId: string,
    since: string | null = null
  ): Promise<CohortAnalysis[]> {
    try {
      Sentry.addBreadcrumb({
        category: 'analytics.cohortAnalysis',
        message: 'Computing cohort analysis',
        level: 'info',
        data: { userId },
      })

      const { data: jobs, error: jobsError } = await supabase
        .from('jobs')
        .select('id, status, created_at, date_applied')
        .eq('user_id', userId)

      if (jobsError) throw jobsError

      // Group by cohort (month of first application)
      const cohortMap = new Map<string, CohortBucket>()

      for (const job of (jobs ?? []).filter((row) => withinRange(row, since))) {
        // Use date_applied if available, otherwise created_at
        const appliedDate = job.date_applied ? new Date(job.date_applied) : new Date(job.created_at)
        const cohort = appliedDate.toISOString().slice(0, 7) // YYYY-MM

        if (!cohortMap.has(cohort)) {
          cohortMap.set(cohort, {
            applied: 0,
            interviewing: 0,
            offered: 0,
            rejected: 0,
            timeToOffers: [] as number[],
          })
        }

        const cohortData = cohortMap.get(cohort)!
        cohortData.applied += 1

        if (job.status === 'interviewing') cohortData.interviewing += 1
        else if (job.status === 'offer') {
          cohortData.offered += 1
          const daysToOffer = (new Date().getTime() - appliedDate.getTime()) / (1000 * 60 * 60 * 24)
          cohortData.timeToOffers.push(daysToOffer)
        } else if (job.status === 'rejected') cohortData.rejected += 1
      }

      // Convert to cohort analysis array
      const analysis: CohortAnalysis[] = []
      for (const [cohort, data] of cohortMap.entries()) {
        const avgTimeToOffer =
          data.timeToOffers.length > 0
            ? Math.round((data.timeToOffers.reduce((a: number, b: number) => a + b, 0) / data.timeToOffers.length) * 10) / 10
            : null

        analysis.push({
          cohort,
          jobsApplied: data.applied,
          jobsInterviewing: data.interviewing,
          jobsOffered: data.offered,
          jobsRejected: data.rejected,
          conversionRate: data.applied > 0 ? (data.offered / data.applied) * 100 : 0,
          avgTimeToOffer,
        })
      }

      analysis.sort((a, b) => b.cohort.localeCompare(a.cohort)) // Most recent first

      Sentry.addBreadcrumb({
        category: 'analytics.cohortAnalysis',
        message: 'Cohort analysis computed',
        level: 'info',
        data: { cohorts: analysis.length },
      })

      return analysis
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      Sentry.captureException(error, {
        tags: { function: 'getCohortAnalysis' },
        extra: { userId },
      })
      throw error
    }
  },

  /**
   * Get overall conversion metrics
   */
  async getConversionMetrics(
    userId: string,
    since: string | null = null
  ): Promise<ConversionMetrics> {
    try {
      const { data: jobs, error: jobsError } = await supabase
        .from('jobs')
        .select('id, status, source, date_applied, created_at')
        .eq('user_id', userId)

      if (jobsError) throw jobsError

      const jobList = (jobs ?? []).filter((job) => withinRange(job, since))
      const allowed = since ? new Set(jobList.map((job) => job.id)) : null
      const offeredJobs = jobList.filter((j) => j.status === 'offer')
      const timeToFirstInterview = await this._computeTimeToStatus(userId, 'interviewing', allowed)
      const timeToOffer = await this._computeTimeToStatus(userId, 'offer', allowed)

      // Count by source
      const conversionBySource: Record<string, number> = {}
      for (const job of jobList) {
        const source = job.source || 'Direct'
        if (!conversionBySource[source]) {
          conversionBySource[source] = 0
        }
        if (job.status === 'offer') {
          conversionBySource[source] += 1
        }
      }

      return {
        totalJobs: jobList.length,
        timeToFirstInterview: timeToFirstInterview ? Math.round(timeToFirstInterview / (1000 * 60 * 60 * 24)) : null,
        timeToOffer: timeToOffer ? Math.round(timeToOffer / (1000 * 60 * 60 * 24)) : null,
        conversionRate: jobList.length > 0 ? (offeredJobs.length / jobList.length) * 100 : 0,
        conversionBySource,
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      Sentry.captureException(error, {
        tags: { function: 'getConversionMetrics' },
        extra: { userId },
      })
      throw error
    }
  },

  /**
   * Helper: Compute average time from creation to reaching a specific status
   */
  async _computeTimeToStatus(
    userId: string,
    targetStatus: JobStatus,
    allowed: Set<string> | null = null
  ): Promise<number | null> {
    const { data: rows, error } = await supabase
      .from('job_status_history')
      .select('job_id, changed_at')
      .eq('user_id', userId)
      .eq('to_status', targetStatus)

    if (error || !rows || rows.length === 0) return null

    // The caller has already worked out which applications are in the window;
    // this only has to respect it.
    const statusHistory = allowed ? rows.filter((row) => allowed.has(row.job_id)) : rows
    if (statusHistory.length === 0) return null

    // Get job creation times
    const { data: jobs } = await supabase.from('jobs').select('id, created_at').eq('user_id', userId)

    if (!jobs) return null

    const jobCreationMap = new Map(jobs.map((j) => [j.id, new Date(j.created_at).getTime()]))

    // Compute average time to status
    const timesToStatus = statusHistory
      .map((change) => {
        const createdTime = jobCreationMap.get(change.job_id)
        if (!createdTime) return null
        return new Date(change.changed_at).getTime() - createdTime
      })
      .filter((t): t is number => t !== null)

    if (timesToStatus.length === 0) return null

    return timesToStatus.reduce((a, b) => a + b, 0) / timesToStatus.length
  },
}
