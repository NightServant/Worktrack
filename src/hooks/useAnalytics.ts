/**
 * EVERY METRIC IS COMPUTED LIVE, and each of these queries used to ask an edge
 * cache first.
 *
 * `analytics-cache-proxy` WAS NEVER DEPLOYED. `list_edge_functions` returns an
 * empty list for this project, so the hit never happened: the invoke failed,
 * the `catch` swallowed it, and the only thing the branch achieved was a
 * doomed round trip in front of five dashboard queries. It reported nothing,
 * because a cache that misses is indistinguishable from a cache that is not
 * there.
 *
 * IT WAS REMOVED RATHER THAN DEPLOYED (2026-09-17), and the reason is in the
 * function rather than in its deployment. It computed each metric a second
 * time, in Deno, against a shape the app has since moved past -- its funnel
 * returned three stages with `avgDaysToStage: 0` and no `isExit` flag, which
 * is not the `ConversionFunnelMetric` these charts read. Its read path also
 * had no expiry, so the first payload it stored would have been served
 * forever. Deploying it would have replaced correct numbers with frozen,
 * coarser ones: worse than the empty request it was making.
 *
 * `analytics_cache` and `upsert_analytics_cache` were dropped on 2026-09-19
 * (Gabe: "Remove the dead table"). They held nothing, because nothing ever
 * wrote to them -- and an empty table with RLS on and no policies is a
 * database-linter finding and a line on the public privacy page, which is a
 * high price for a cache the app does not want.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { analyticsService } from '@/services/analyticsService'

import type {
  TimeInStageMetric,
  ConversionFunnelMetric,
  SourceConversionTrend,
  CohortAnalysis,
  ConversionMetrics,
} from '@/services/analyticsService'

export function useTimeInStage(userId?: string, since: string | null = null) {
  return useQuery<TimeInStageMetric[]>({
    queryKey: ['analytics', 'timeInStage', userId, since],
    queryFn: () => analyticsService.getTimeInStageMetrics(userId!, since),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

export function useConversionFunnel(userId?: string, since: string | null = null) {
  return useQuery<ConversionFunnelMetric[]>({
    queryKey: ['analytics', 'conversionFunnel', userId, since],
    queryFn: () => analyticsService.getConversionFunnel(userId!, since),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

export function useSourceConversionTrends(userId?: string, since: string | null = null) {
  return useQuery<SourceConversionTrend[]>({
    queryKey: ['analytics', 'sourceConversionTrends', userId, since],
    queryFn: () => analyticsService.getSourceConversionTrends(userId!, since),
    enabled: !!userId,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

export function useCohortAnalysis(userId?: string, since: string | null = null) {
  return useQuery<CohortAnalysis[]>({
    queryKey: ['analytics', 'cohortAnalysis', userId, since],
    queryFn: () => analyticsService.getCohortAnalysis(userId!, since),
    enabled: !!userId,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

export function useConversionMetrics(userId?: string, since: string | null = null) {
  return useQuery<ConversionMetrics>({
    queryKey: ['analytics', 'conversionMetrics', userId, since],
    queryFn: () => analyticsService.getConversionMetrics(userId!, since),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

export function useStatusTransitions(userId?: string, since: string | null = null) {
  return useQuery({
    queryKey: ['analytics', 'statusTransitions', userId, since],
    queryFn: () => analyticsService.getStatusTransitions(userId!, since),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

export function useAnalytics() {
  const { session } = useAuth()
  const userId = session?.user?.id

  const timeInStage = useTimeInStage(userId)
  const conversionFunnel = useConversionFunnel(userId)
  const sourceConversionTrends = useSourceConversionTrends(userId)
  const cohortAnalysis = useCohortAnalysis(userId)
  const conversionMetrics = useConversionMetrics(userId)

  const loading = useMemo(() => {
    return [timeInStage, conversionFunnel, sourceConversionTrends, cohortAnalysis, conversionMetrics].some((q) => q.isLoading)
  }, [timeInStage.isLoading, conversionFunnel.isLoading, sourceConversionTrends.isLoading, cohortAnalysis.isLoading, conversionMetrics.isLoading])

  const error = useMemo(() => {
    return timeInStage.error || conversionFunnel.error || sourceConversionTrends.error || cohortAnalysis.error || conversionMetrics.error || null
  }, [timeInStage.error, conversionFunnel.error, sourceConversionTrends.error, cohortAnalysis.error, conversionMetrics.error])

  return {
    timeInStage: timeInStage.data ?? null,
    conversionFunnel: conversionFunnel.data ?? null,
    sourceConversionTrends: sourceConversionTrends.data ?? null,
    cohortAnalysis: cohortAnalysis.data ?? null,
    conversionMetrics: conversionMetrics.data ?? null,
    loading,
    error,
  }
}
