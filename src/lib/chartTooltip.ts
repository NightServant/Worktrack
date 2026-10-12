import type { CSSProperties } from 'react'

/**
 * The one look every recharts `<Tooltip>` takes: spread it, then add the
 * chart's own `formatter` and `cursor`.
 *
 * `itemStyle` IS THE ONE THAT MATTERS. recharts colours each tooltip ROW
 * `entry.color || '#000'`, the series colour. A Sankey link has none, and nor
 * does a bar coloured per `<Cell>` with no `fill` on the `<Bar>` itself, so
 * the row fell back to a dark default on the dark popover (Gabe, 2026-09-17 on
 * the pipeline flow, and again 2026-10-12 on time in stage). `contentStyle`
 * does not reach the rows; it styles the wrapper and the label.
 *
 * `--color-popover-foreground` is `--color-text-primary` in both themes, so
 * one value covers light and dark.
 */
export const CHART_TOOLTIP = {
  contentStyle: {
    background: 'var(--color-popover)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: 4,
    fontSize: 12,
    color: 'var(--color-popover-foreground)',
  },
  itemStyle: { color: 'var(--color-popover-foreground)' },
} satisfies { contentStyle: CSSProperties; itemStyle: CSSProperties }
