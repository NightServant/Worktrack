'use client'

import * as React from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { STATUSES, type Status } from '@/components/ui/status-marker'
import { STAGE_FILL } from './FunnelChart'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { CHART_TOOLTIP } from '@/lib/chartTooltip'
import type { TimeInStageMetric } from '@/services/analyticsService'

const LABELS: Record<Status, string> = {
  wishlist: 'Wishlist',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
}

export interface TimeInStageProps {
  data: TimeInStageMetric[]
}

/**
 * Average days spent in each status, one bar per stage present in `data`,
 * in pipeline order. Has no date field -- see `Analytics.tsx` -- so it
 * always reads "All time" and never responds to the range picker.
 *
 * Bar colour comes from `STAGE_FILL`, the same token map `FunnelChart` uses
 * and documents in full: every fill handed to Recharts is a `var(--color-
 * status-*-mark)` reference, never a colour resolved in JS, so it carries
 * the same theme-change guarantee without a second colour system.
 */
export function TimeInStage({ data }: TimeInStageProps) {
  const reducedMotion = usePrefersReducedMotion()

  if (data.length === 0) {
    return <p className="text-body-s text-text-muted">not enough data yet.</p>
  }

  const chartData = STATUSES.filter((status) => data.some((d) => d.status === status)).map((status) => {
    const metric = data.find((d) => d.status === status)!
    return { status, label: LABELS[status], avgDays: metric.avgDays, fill: STAGE_FILL[status] }
  })

  return (
    // flex-1 with a LOW floor, so the chart follows the card it is in rather
    // than setting the card's height. A 256px floor meant this panel could
    // force its row taller than its neighbour needed, which is the one way
    // these charts stopped matching the cards beside them. 192px is still a
    // legible plot; below that flex-1 has nothing left to give.
    <div className="min-h-48 w-full flex-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border-subtle)" />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
            stroke="var(--color-border-default)"
          />
          <YAxis
            tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
            stroke="var(--color-border-default)"
            allowDecimals={false}
          />
          <Tooltip
            {...CHART_TOOLTIP}
            cursor={{ fill: 'var(--color-bg-inset)' }}
            // recharts 3 types a Tooltip formatter's first argument as
            // `ValueType | undefined`, so the `(value: number) =>` signature
            // this had under recharts 2 no longer typechecks. The narrowing is
            // done here rather than by widening the tuple's element types.
            formatter={(value) => [`${Number(value)} days`, 'Avg. time in stage']}
          />
          <Bar
            dataKey="avgDays"
            isAnimationActive={!reducedMotion}
            radius={[2, 2, 0, 0]}
            // Uncapped, recharts divides the full panel width by the number of
            // stages, so an account with two stages draws two slabs half the
            // panel wide. Same cap the salary histogram uses.
            maxBarSize={72}
          >
            {chartData.map((d) => (
              <Cell key={d.status} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
