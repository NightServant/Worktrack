import * as React from 'react'
import { cn } from '@/lib/utils'
import { icons } from '@/components/icons'
import type { DayCard } from '@/lib/dayCards'

/**
 * The stack itself: a date, then one line per thing on the day.
 *
 * LINES, NOT CARDS (Gabe, 2026-09-18: "in the tooltip, apply lines instead of
 * cards -- I do not want nested cards in tooltip"). The first version boxed
 * every row in its own hairline border over `bg-bg-surface`, which put a card
 * inside a card: the tooltip panel IS the card, and a second frame 8px inside
 * it draws two parallel borders round the same content and makes a three-item
 * day look like three separate objects that happen to be stacked.
 *
 * WHAT THE BORDERS WERE FOR IS KEPT, and it was a real problem: three items of
 * two lines each run together into six lines of grey type, and the reader has
 * to count in pairs to find where one interview ends. A hairline BETWEEN rows
 * does that job -- it separates without enclosing -- and it is the same
 * vocabulary the rest of this system uses for a list (`divide-y`, never a box
 * per row). The panel's own padding is what keeps the rules clear of its edge.
 *
 * THE LABEL IS THE KIND, in the caps-label style the rest of the app uses for
 * a field name -- `interview`, `holiday`, `applied`. It is what tells one line
 * from the one under it without reading either.
 */
export function DayStack({
  date,
  cards,
  className,
}: {
  date: Date
  cards: DayCard[]
  className?: string
}) {
  return (
    <div className={cn('flex w-72 max-w-full flex-col gap-2 p-3', className)} data-day-stack>
      <p className="text-label-caps uppercase text-text-muted">
        {date.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })}
      </p>
      {/* `divide-y` rather than a border on each row: one hairline between two
          rows, none above the first and none below the last, so the list ends
          where the panel does instead of drawing a rule against its padding. */}
      <ul className="flex flex-col divide-y divide-border-subtle">
        {cards.map((card) => {
          const Icon = icons[card.icon]
          return (
            <li
              key={card.key}
              data-day-item
              className="flex items-start gap-2 py-2 first:pt-0 last:pb-0"
            >
              <Icon size={14} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-label-caps uppercase text-text-muted">{card.label}</span>
                  {card.meta && (
                    <span className="tabular text-caption text-text-muted">{card.meta}</span>
                  )}
                </div>
                {/* NOT TRUNCATED. The whole reason to open this is that the
                    cell truncated it; a tooltip that clips the same title is a
                    tooltip with nothing to say. Two lines is the cap, because
                    a board title can run to fifteen words. */}
                <span className="line-clamp-2 text-body-s text-text-primary">{card.title}</span>
                {card.detail && (
                  <span className="truncate text-caption text-text-secondary">{card.detail}</span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
