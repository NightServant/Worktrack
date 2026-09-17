'use client'

import * as React from 'react'
import { Sankey, Tooltip, ResponsiveContainer, Layer, Rectangle } from 'recharts'
import { EmptyState } from '@/components/ui/empty-state'
import { STATUSES, type Status } from '@/components/ui/status-marker'
import type { StatusTransition } from '@/services/analyticsService'

const STAGE_FILL: Record<Status, string> = {
  wishlist: 'var(--color-status-wishlist-mark)',
  applied: 'var(--color-status-applied-mark)',
  interviewing: 'var(--color-status-interviewing-mark)',
  offer: 'var(--color-status-offer-mark)',
  rejected: 'var(--color-status-rejected-mark)',
}

export interface PipelineFlowProps {
  transitions: StatusTransition[]
}

/**
 * Pipeline flow — where applications actually went, stage to stage.
 *
 * This panel was deliberately NOT shipped in the first pass of Task 9, and the
 * reason is worth keeping: no service returned stage transitions, and a Sankey
 * built from current status alone is a lie. It can say how many jobs ARE at
 * "offer"; it cannot say how any of them got there, which is the diagram's
 * entire claim. Rather than fabricate flows, it was reported as a finding.
 * `analyticsService.getStatusTransitions` now reads `job_status_history`, so
 * the diagram has real paths behind it.
 *
 * Statuses in this app are user-set with no enforced state machine, so
 * backward moves happen — interviewing back to applied, a correction, a
 * re-application. A Sankey is directed and acyclic; a cycle either throws or
 * draws a loop nobody can read. The service drops backward transitions and
 * this panel says so beneath the diagram, because a chart that quietly
 * discards a third of its input is worse than one that explains itself.
 *
 * Nodes carry the status palette. These genuinely ARE application statuses —
 * the same exception the Overview doughnut earns and the source chart does not.
 */
export function PipelineFlow({ transitions }: PipelineFlowProps) {
  const graph = React.useMemo(() => {
    const used = new Set<string>()
    for (const t of transitions) {
      used.add(t.from)
      used.add(t.to)
    }
    // STATUSES order, so the diagram reads left-to-right down the pipeline
    // rather than in whatever order the rows came back.
    const nodes = STATUSES.filter((s) => used.has(s)).map((s) => ({ name: s }))
    const index = new Map(nodes.map((n, i) => [n.name, i]))
    const links = transitions
      .filter((t) => index.has(t.from) && index.has(t.to))
      .map((t) => ({
        source: index.get(t.from)!,
        target: index.get(t.to)!,
        value: t.count,
      }))
    return { nodes, links }
  }, [transitions])

  if (graph.links.length === 0) {
    return (
      <EmptyState icon="Analytics">
        no status changes recorded yet. this fills in as applications move between stages.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      {/* flex-1 with a LOW floor, so the diagram follows the card it is in
          rather than setting the card's height. A 256px floor meant this panel
          could force its row taller than its neighbour needed, which is the one
          way these charts stopped matching the cards beside them. 192px is
          still a legible plot; below that flex-1 has nothing left to give. */}
      <div className="min-h-48 w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={graph}
            nodePadding={24}
            nodeWidth={10}
            margin={{ top: 20, right: 64, bottom: 8, left: 8 }}
            link={{ stroke: 'var(--color-border-default)', strokeOpacity: 0.25 }}
            node={<FlowNode />}
          >
            <Tooltip
              contentStyle={{
                background: 'var(--color-popover)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--color-popover-foreground)',
              }}
              /*
                `itemStyle` IS THE ONE THAT MATTERS, and it is not decoration
                (Gabe, 2026-09-17: "dark mode hover tags are not readable").
                recharts styles each tooltip ROW as `color: entry.color ||
                '#000'` -- the series colour, which a bar chart has and a
                Sankey link does not. So "wishlist - applied : 10" was drawn in
                literal black on the popover: fine on the light canvas this was
                written against, invisible on the dark one.
              */
              itemStyle={{ color: 'var(--color-popover-foreground)' }}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>
      <p className="text-body-s text-text-muted">
        forward status changes only. backward moves (interviewing back to applied) are left out so
        the flow stays readable.
      </p>
    </div>
  )
}

/**
 * recharts hands node renderers loose props, so this is typed structurally
 * rather than with recharts' own internal node type, which is not exported.
 */
function FlowNode(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: { name?: string; value?: number }
}) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props
  const name = (payload?.name ?? '') as Status
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={STAGE_FILL[name] ?? 'var(--color-border-default)'} />
      {/*
        Above the node, not beside it. Beside puts every interior label on top
        of the ribbon leaving that node, which is the widest, darkest thing on
        the diagram -- the label was legible only because the ribbons are
        translucent. Above the bar it sits on the panel background at full
        contrast in both themes, and the top margin reserves the room.
      */}
      <text x={x} y={y - 7} className="fill-text-secondary" fontSize={12}>
        {name} {payload?.value ?? ''}
      </text>
    </Layer>
  )
}
