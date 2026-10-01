'use client'

import * as React from 'react'
import { icons } from '@/components/icons'
import { cn } from '@/lib/utils'
import type { ResumeMode } from '@/services/resumeService'
import { DOCUMENT_TABS, type DocumentTab, type DocumentTabId } from './documentTabs'
import { useRailLayout, type RailLayout } from './railLayout'

/**
 * The rail's tab strip: which pane the rail is showing.
 *
 * IT DRAWS TWO WAYS, AND THE CHROME PICKS (Gabe, 2026-09-13: horizontal "must
 * be applied to smaller laptop screens", then "restore the vertical tabs in
 * larger screens"). `useRailLayout` carries which; see railLayout.tsx for why
 * the answer cannot be a prop.
 *
 * A COLUMN where the rail has a column of its own: each row an icon, a label
 * and its own hint, selection a rule down the leading edge. That costs ~120px
 * of height, which a 380px rail beside its own pane can afford.
 *
 * A ROW where the rail is shared with the pane it selects: 45px, centred
 * icon-and-label, selection an underline on the strip's foot, and the hint
 * collapsed to ONE line for the selected tab. Height is the scarce thing in
 * that arrangement -- two stacked rows with hints sit directly above the panel
 * they open -- and the hint is worth keeping either way, because "needs an
 * application" is the reason a pane is empty and showing it only after you
 * open the pane is the wrong order.
 *
 * A LIST OF BUTTONS, NOT `ui/tabs`. The shadcn tab primitive puts its triggers
 * and its panels in one component and expects them adjacent; here the triggers
 * are in the left column and the panel is in the right one, with a whole sheet
 * of document between them. Driving that through `Tabs` would mean a context
 * spanning the page and a `TabsContent` rendered somewhere its `TabsList`
 * cannot see -- more machinery than a controlled `activeTab` string needs.
 *
 * THE ACCESSIBILITY IS DONE BY HAND FOR THE SAME REASON, and properly:
 * `role="tablist"`, each button `role="tab"` with `aria-selected`, and
 * `aria-controls` pointing at the pane. That last attribute matters most when
 * the pane is in the OTHER column, which it still is above 1700 -- it is what
 * tells a screen reader that a control on the left drives a region on the
 * right, which sighted users get from the arrangement itself.
 *
 * ARROW KEYS MOVE BETWEEN TABS, which is what `role="tablist"` promises. A
 * tablist whose only navigation is Tab is a set of buttons wearing a tablist's
 * clothes, and announcing "tab 2 of 4" while the arrow keys do nothing is
 * worse than not making the claim.
 *
 * ORANGE IS FOR THE SELECTED TAB AND NOTHING ELSE HERE. The design system
 * reserves the accent for "the current action", and in this rail the selected
 * pane is exactly that. Selection is carried by a 2px rule plus weight in both
 * arrangements -- never a filled block, because status is never a filled pill
 * in this app. The rule simply moves: the row's leading edge in a column, the
 * strip's foot in a row, which is the same underline `ApplicationRecordView`
 * and the compact dock draw.
 */

export interface DocumentRailTabsProps {
  /**
   * Which set of tabs this strip is (2026-09-14). A CV gets grammar and
   * tailoring, a cover letter gets grammar and `tailor & review`; see
   * `documentTabs` for why the two lists are data rather than a flag per tab.
   *
   * DEFAULTED TO `word`, unlike `asDocumentTab` next door, and the difference
   * is how loudly each one fails. Passing the wrong kind here puts visibly
   * wrong tabs on screen; forgetting a kind there silently restores a tab the
   * rail does not have. Only the second one needs the compiler's help.
   */
  kind?: ResumeMode
  active: DocumentTabId
  onSelect: (id: DocumentTabId) => void
  /** Per-tab counts, e.g. 3 spelling issues. `null` renders nothing. */
  badges?: Partial<Record<DocumentTabId, number | null>>
  /** Marks the application-dependent tabs when no application is chosen. */
  applicationSelected?: boolean
  id?: string
  className?: string
}

export function DocumentRailTabs({
  active,
  onSelect,
  badges = {},
  applicationSelected = false,
  id = 'document-rail',
  className,
  kind = 'word',
}: DocumentRailTabsProps) {
  const tabs = DOCUMENT_TABS[kind]
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({})

  function move(from: DocumentTabId, delta: number) {
    const order = tabs.map((tab) => tab.id)
    const index = order.indexOf(from)
    // Wraps, because a tablist that stops at the ends makes the last tab feel
    // unreachable when arrowing down from the first.
    const next = order[(index + delta + order.length) % order.length]
    onSelect(next)
    refs.current[next]?.focus()
  }

  const layout = useRailLayout()
  const row = layout === 'row'

  const current = tabs.find((tab) => tab.id === active)
  const hintFor = (tab: DocumentTab) =>
    tab.needsApplication && !applicationSelected ? 'needs an application' : tab.hint

  return (
    <div className={cn('flex flex-col', className)} data-document-rail data-rail-layout={layout}>
      <div
        role="tablist"
        aria-orientation={row ? 'horizontal' : 'vertical'}
        aria-label="document tools"
        className={cn(
          'flex',
          // A HAIRLINE UNDER THE WHOLE STRIP in a row, which is what the active
          // tab's 2px rule sits on top of: without it the marker is a floating
          // dash, with it a selection along a track. A column needs none -- each
          // row carries its own leading rule.
          row ? 'items-stretch border-b border-border-subtle' : 'flex-col'
        )}
      >
        {tabs.map((tab) => (
          <RailTab
            key={tab.id}
            tab={tab}
            layout={layout}
            active={tab.id === active}
            badge={badges[tab.id] ?? null}
            hint={hintFor(tab)}
            paneId={`${id}-pane`}
            ref={(node) => {
              refs.current[tab.id] = node
            }}
            onSelect={() => onSelect(tab.id)}
            onMove={(delta) => move(tab.id, delta)}
          />
        ))}
      </div>

      {/* The current tab's hint, for the arrangement whose tabs have no room
          for one of their own. `min-h` rather than a bare conditional, so
          switching tabs does not move everything below it by a line. */}
      {row && current && (
        <p className="min-h-9 px-1 pt-2 text-body-s text-text-muted">{hintFor(current)}</p>
      )}
    </div>
  )
}

interface RailTabProps {
  tab: DocumentTab
  layout: RailLayout
  active: boolean
  badge: number | null
  /** Shown under the label in a column; the strip shows it once in a row. */
  hint: string
  paneId: string
  onSelect: () => void
  onMove: (delta: number) => void
}

const RailTab = React.forwardRef<HTMLButtonElement, RailTabProps>(function RailTab(
  { tab, layout, active, badge, hint, paneId, onSelect, onMove },
  ref
) {
  const Icon = icons[tab.icon]
  const row = layout === 'row'

  return (
    <button
      ref={ref}
      role="tab"
      type="button"
      id={`${paneId}-tab-${tab.id}`}
      aria-selected={active}
      aria-controls={paneId}
      // Roving tabindex: the tablist is one Tab stop and the arrows move
      // within it, which is what a tablist is supposed to feel like.
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault()
          onMove(1)
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault()
          onMove(-1)
        }
      }}
      className={cn(
        'group transition-colors duration-(--duration-fast)',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default/30',
        'active:scale-[0.99]',
        row
          ? cn(
              'relative flex flex-1 items-center justify-center gap-2 px-2 py-2.5',
              // The marker sits ON the strip's own hairline rather than above
              // it, so the two read as one track with a selected span.
              active
                ? 'after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:bg-accent-default'
                : 'hover:bg-bg-surface/60'
            )
          : cn(
              'flex w-full items-start gap-3 border-l-2 py-3 pl-3 pr-2 text-left',
              active
                ? 'border-l-accent-default bg-bg-surface'
                : 'border-l-transparent hover:bg-bg-surface/60'
            )
      )}
    >
      <span
        aria-hidden
        className={cn(
          'shrink-0 transition-colors',
          !row && 'mt-0.5',
          active ? 'text-accent-default' : 'text-text-muted group-hover:text-text-secondary'
        )}
      >
        <Icon size={16} />
      </span>

      {row ? (
        <>
          <span
            className={cn(
              'truncate text-body-s',
              active ? 'font-medium text-text-primary' : 'text-text-secondary'
            )}
          >
            {tab.label}
          </span>
          {badge !== null && badge > 0 && <Badge count={badge} />}
        </>
      ) : (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'text-body-m',
                active ? 'font-medium text-text-primary' : 'text-text-secondary'
              )}
            >
              {tab.label}
            </span>
            {badge !== null && badge > 0 && <Badge count={badge} />}
          </span>
          <span className="text-body-s text-text-muted">{hint}</span>
        </span>
      )}
    </button>
  )
})

/**
 * A count, not a dot: "3" answers how much work is left and a dot only says
 * "some". A bare numeral against a rule rather than a filled pill.
 */
function Badge({ count }: { count: number }) {
  return (
    <span className="shrink-0 border-b border-border-default px-1 text-label-caps tabular-nums text-text-secondary">
      {count}
    </span>
  )
}
