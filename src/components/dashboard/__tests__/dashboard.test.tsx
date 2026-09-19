import { describe, it, expect } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dashboard } from '../Dashboard'
import { makeJob } from '@/test/fixtures'
import type { Job } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000

// A live application gone quiet for a month is well past the 14-day
// follow-up threshold, whatever day the suite happens to run.
const STALE_FIXTURE: Job[] = [
  makeJob({
    id: 'stale-1',
    status: 'applied',
    updated_at: new Date(Date.now() - 30 * DAY_MS).toISOString(),
  }),
]

const FRESH_FIXTURE: Job[] = [
  makeJob({ id: 'fresh-1', status: 'applied' }),
  makeJob({ id: 'fresh-2', status: 'interviewing', company: 'Globex', role: 'PM' }),
  makeJob({ id: 'fresh-3', status: 'wishlist', company: 'Initech', role: 'Analyst' }),
]

/**
 * Renders the Overview and waits for its code-split charts to arrive.
 *
 * The three recharts panels are `next/dynamic` with `ssr: false` (2026-09-11),
 * so a synchronous `render` returns placeholders. Waiting for every
 * `aria-busy` to clear is the general form -- it does not care which charts a
 * given fixture produces, which matters because an empty pipeline renders an
 * empty-state instead of a donut.
 */
async function renderDashboard(ui: React.ReactElement) {
  const result = render(ui)
  await waitFor(() =>
    expect(result.container.querySelector('[aria-busy]')).toBeNull()
  )
  return result
}

describe('Dashboard', () => {
  it('puts the KPI strip above the follow-up nudge, as the frame draws it', async () => {
    // REVERSED in M5.5 Item 5, deliberately. This asserted the opposite,
    // from roadmap 5.3's prose ("KPI strip, follow-up nudge first"). Figma
    // 20:64 puts the KPI Strip at y=129 and the Follow-up Nudge at y=287, so
    // the frame and the prose disagree -- and the roadmap names the Figma
    // file as the source of truth for design. Both are above the fold at
    // 1024px, so the nudge is not buried either way.
    const { container } = await renderDashboard(<Dashboard jobs={STALE_FIXTURE} />)
    const nudge = container.querySelector('[data-follow-up]')!
    const kpis = container.querySelector('[data-kpi-strip]')!
    expect(kpis.compareDocumentPosition(nudge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('reads the calendar rather than inventing an events sentence', async () => {
    // The old block printed the literal string "N interviews in progress",
    // derived from job statuses -- so it had no empty state and could never
    // show a real event. Item 5's first complaint.
    await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} events={[]} />)
    expect(screen.queryByText(/interviews in progress/i)).toBeNull()
    expect(screen.getByText(/nothing scheduled yet/i)).toBeTruthy()
  })

  it('distinguishes a failing calendar read from an empty calendar', async () => {
    await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} events={[]} eventsError />)
    expect(screen.getByText(/could not load your calendar/i)).toBeTruthy()
    expect(screen.queryByText(/nothing scheduled yet/i)).toBeNull()
  })

  it('renders the three charts Gabe asked for', async () => {
    // line/area over time, the status doughnut, and bars by source. recharts
    // has been a dependency since M5 and this screen imported none of it.
    const { container } = await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} />)
    expect(container.querySelector('[data-chart-over-time]')).toBeTruthy()
    expect(container.querySelector('[data-chart-donut]')).toBeTruthy()
    expect(container.querySelector('[data-chart-sources]')).toBeTruthy()
  })

  it('keeps all five statuses in the donut legend, including the zeros', async () => {
    // A legend that drops empty statuses changes length as data changes, and
    // the colour under a given segment starts meaning something else.
    const { container } = await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} />)
    expect(container.querySelectorAll('[data-donut-legend] li')).toHaveLength(5)
  })

  it('hides the nudge entirely when nothing is stale', async () => {
    // An empty "nothing to chase" card trains the eye to skip the slot.
    const { container } = await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} />)
    expect(container.querySelector('[data-follow-up]')).toBeNull()
  })

  it('renders the recent-applications table with real column labels', async () => {
    // Replaces "renders six blocks": the six generic text blocks are gone.
    // The old Recent applications block was loose text with no column labels,
    // so nothing lined up between rows and a screen reader got no row/column
    // relationship at all.
    await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} />)
    const table = screen.getByRole('table')
    for (const label of ['company', 'position', 'status', 'applied on']) {
      expect(within(table).getByRole('columnheader', { name: label })).toBeTruthy()
    }
  })

  it('leads with four stat cards whose hero is the number', async () => {
    // Gabe, 2026-09-10: four cards rather than five loose figures, with the
    // statistic as each card's hero. `text-data-xl` is the largest step in the
    // scale -- larger than the page title, deliberately, because a dashboard
    // is read number-first.
    const { container } = await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} />)
    const strip = container.querySelector('[data-kpi-strip]')!
    const cards = strip.querySelectorAll('[data-stat-card]')
    expect(cards).toHaveLength(4)
    for (const card of cards) {
      const value = card.querySelector('[data-kpi-value]')!
      expect(value.className).toContain('text-data-xl')
    }
  })

  it('stacks the stat cards on a phone and only widens above it', async () => {
    /*
      Gabe, 2026-09-15: "use single column layout for stat cards". This
      reverses the component's own earlier reasoning -- it argued for two
      columns on a phone because "these are four short cards" -- and the
      screenshot he sent is why: at 375px the half-column measure wrapped
      "SUCCESS RATE" mid-label and put both "6 more on the wishlist" and
      "10 of 27 heard back" onto two lines. Four cards that each wrap twice
      are taller than four that do not, so two columns were causing the
      scrolling they were meant to save.

      ASSERTED ON THE CLASSES, NOT ON MEASURED WIDTHS, because jsdom computes
      no layout -- every element here is 0x0 and a test that measured columns
      would be measuring nothing. The live behaviour was checked in a browser
      instead: 1 column at 375px, 2 at 700px, 4 at 1400px.

      The upper two are pinned as well as the phone one. "Single column" is
      right for a phone and would be wasteful on a desktop, and a later edit
      that dropped the responsive steps entirely would satisfy the headline
      request while making the widest screens worse.
    */
    const { container } = await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} />)
    const strip = container.querySelector('[data-kpi-strip]')!
    expect(strip.className).toContain('grid-cols-1')
    expect(strip.className).toContain('sm:grid-cols-2')
    expect(strip.className).toContain('xl:grid-cols-4')
    // The bare two-column default is the thing that must not come back: it is
    // what applied at phone width.
    expect(strip.className).not.toMatch(/(^|\s)grid-cols-2(\s|$)/)
  })

  it('puts two more stat cards between the charts and the recent-applications table', async () => {
    // "I highly recommend to add more two card components before recent
    // applications table" -- and BEFORE is the part worth pinning: inside the
    // grid, after the four panels, ahead of the full-width table.
    const { container } = await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} />)
    const grid = container.querySelector('.xl\\:grid-cols-2')!
    const inGrid = [...grid.children]
    const statCards = inGrid.filter((c) => c.hasAttribute('data-stat-card'))
    expect(statCards).toHaveLength(2)
    const table = inGrid.find((c) => c.querySelector('h2')?.textContent === 'recent applications')!
    for (const card of statCards) {
      expect(
        card.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
        'a stat card landed after the table'
      ).toBeTruthy()
    }
  })

  it('shows KPI values with tabular figures', async () => {
    const { container } = await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} />)
    for (const v of container.querySelectorAll('[data-kpi-value]')) {
      expect(v.className).toContain('tabular')
    }
  })

  it('draws the header rule the frame specifies and no card borders', async () => {
    // Figma 20:68 is a 2px full-width rule under the page title. Separation in
    // this system is hairline rules, never boxed cards -- the six bordered
    // blocks this replaced were themselves a fix round in M5.
    const { container } = await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} />)
    const rule = container.querySelector('[data-header-rule]') as HTMLElement
    expect(rule).toBeTruthy()
    expect(rule.className).toContain('border-t-2')
  })

  it('links each row in Recent applications to that job\'s own detail route', async () => {
    // Task 5 built /applications/[id] after this dashboard shipped; every
    // path off this page used to dead-end on the unfiltered list.
    await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} />)
    const link = screen.getByRole('link', { name: /Globex/i })
    expect(link.getAttribute('href')).toBe('/applications/fresh-2')
  })

  it('shows "Not applied" for a wishlist job rather than a fabricated or raw timestamp', async () => {
    // date_applied is null for a job nobody has applied to yet. Falling back
    // to created_at used to print that row's signup timestamp as if it were
    // an applied date, and it was a full TIMESTAMPTZ string besides. Alone in
    // the fixture so it is unambiguously the one "recent" row.
    const wishlist = makeJob({
      id: 'wishlist-1',
      status: 'wishlist',
      date_applied: null,
      created_at: '2026-08-20T14:23:01.123456+00:00',
    })
    await renderDashboard(<Dashboard jobs={[wishlist]} />)
    expect(screen.getByText('not applied')).toBeTruthy()
    expect(screen.queryByText(/2026-08-20T/)).toBeNull()
  })

  it('sends the follow-up nudge to the stale application\'s own detail route', async () => {
    // The nudge is a CTA now, not an inline list -- fifteen rows made it the
    // longest thing on the dashboard and pushed both charts below the fold.
    // The destination it guards is unchanged; it just lives one click away.
    const { container } = await renderDashboard(<Dashboard jobs={STALE_FIXTURE} />)
    const nudge = container.querySelector('[data-follow-up]') as HTMLElement
    expect(nudge).not.toBeNull()

    // Nothing is listed on the dashboard itself.
    expect(within(nudge).queryByRole('link', { name: /Acme/i })).toBeNull()

    await userEvent.click(within(nudge).getByRole('button', { name: /follow/i }))
    const dialog = await screen.findByRole('dialog')
    const link = within(dialog).getByRole('link', { name: /Acme/i })
    expect(link.getAttribute('href')).toBe('/applications/stale-1')
  })
})

/**
 * The panel cards — the ones with a heading, a description and a link out.
 *
 * The Overview grew a second KIND of card on 2026-09-10: `StatCard`, which is
 * a number and a label and deliberately has none of those three. Every
 * assertion below is about panels, so they are selected rather than
 * "every card on the page", which is what they used to mean when panels were
 * the only cards there were.
 */
function panelCards(root: HTMLElement | Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-slot="card"]:not([data-stat-card])')]
}

describe('Overview layout and copy', () => {
  it('lays the panels out two-up in the order Gabe specified, table last and full width', async () => {
    const { container } = await renderDashboard(<Dashboard jobs={[makeJob({ id: '1', status: 'applied' })]} />)
    const grid = container.querySelector('.xl\\:grid-cols-2')!
    const titles = [...grid.querySelectorAll('[data-slot="card"] h2')].map((h) => h.textContent)
    expect(titles).toEqual([
      'applications over time',
      'by status',
      'upcoming events',
      'by source',
      'recent applications',
    ])
    // The table is the one panel that genuinely wants width -- four columns
    // read badly at half a screen -- and it closes the page rather than
    // pairing with anything.
    const table = [...grid.querySelectorAll('[data-slot="card"]')].find((c) =>
      c.querySelector('h2')?.textContent === 'recent applications'
    )!
    expect(table.className).toContain('xl:col-span-2')
  })

  it('gives every panel a way through to the screen it summarises', async () => {
    // Four of the five used to be dead ends. Every panel here is an
    // abridgement of a screen in the sidebar, and a reader who wanted more had
    // to work out for themselves which one -- which is the work an overview
    // exists to have already done.
    const { container } = await renderDashboard(<Dashboard jobs={[makeJob({ id: '1', status: 'applied' })]} />)
    const cards = panelCards(container)
    const routes = new Map<string, string>()
    for (const card of cards) {
      const title = card.querySelector('h2')!.textContent!
      const link = card.querySelector('[data-slot="card-action"] a')
      expect(link, `"${title}" is a dead end`).toBeTruthy()
      routes.set(title, link!.getAttribute('href')!)
    }
    expect(routes.get('applications over time')).toBe('/analytics')
    expect(routes.get('by status')).toBe('/applications')
    expect(routes.get('upcoming events')).toBe('/planner')
    expect(routes.get('by source')).toBe('/analytics')
    expect(routes.get('recent applications')).toBe('/applications')
  })

  it('names each panel with a glyph the heading does not have to repeat', async () => {
    // Gabe's 2026-09-05 ask. `aria-hidden` and inside the title slot, so the
    // heading's own name is unchanged -- which the assertion above relies on
    // to find these cards by their text at all.
    const { container } = await renderDashboard(<Dashboard jobs={[makeJob({ id: '1', status: 'applied' })]} />)
    for (const card of panelCards(container)) {
      const title = card.querySelector('[data-slot="card-title"]')!
      expect(title.querySelector('svg'), `${title.textContent} has no glyph`).toBeTruthy()
      expect(title.textContent).toBe(card.querySelector('h2')!.textContent)
    }
  })

  it('says what the page and each panel are for', async () => {
    const { container } = await renderDashboard(<Dashboard jobs={[makeJob({ id: '1', status: 'applied' })]} />)
    expect(container.querySelector('[data-page-description]')!.textContent).toMatch(/at a glance/i)
    // Every panel carries one line, so none of them is a bare title.
    const cards = panelCards(container)
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      expect(card.querySelector('[data-slot="card-description"]')).toBeTruthy()
    }
  })

  it('keeps the page description out of the heading name', async () => {
    // A heading's accessible name should be the page's name, not the name
    // plus a sentence of prose -- so the description is a sibling of the h1.
    await renderDashboard(<Dashboard jobs={[makeJob({ id: '1', status: 'applied' })]} />)
    expect(screen.getByRole('heading', { level: 1, name: 'overview' })).toBeTruthy()
  })

  it('bands the recent-applications table from the shared accent pair', async () => {
    const { container } = await renderDashboard(<Dashboard
        jobs={[
          makeJob({ id: '1', status: 'applied' }),
          makeJob({ id: '2', status: 'applied' }),
          makeJob({ id: '3', status: 'applied' }),
        ]}
      />)
    const head = container.querySelector('[data-recent-applications] thead')!
    expect(head.className).toMatch(/bg-accent-surface/)
    // accent-default is the TEXT weight (accent-400 in dark); a full-width
    // band of it is the over-bright header Gabe rejected on the calendar.
    expect(head.className).not.toMatch(/bg-accent-default/)
    const rows = [...container.querySelectorAll('[data-recent-applications] tbody tr')]
    expect(rows[0].className).not.toMatch(/\brow-zebra\b/)
    expect(rows[0].className).toMatch(/bg-bg-canvas/)
        // `row-zebra` rather than the literal `bg-accent-surface/30` this used to
    // assert. Same colour, now opaque (see the utility): a sticky first column
    // has the rest of its row sliding underneath it, and a translucent band
    // lets that show through.
    expect(rows[1].className).toMatch(/\brow-zebra\b/)
  })
})

describe('by status and by source internals', () => {
  const jobs = [
    makeJob({ id: '1', status: 'applied', source: 'LinkedIn' }),
    makeJob({ id: '2', status: 'offer', source: 'Referral' }),
  ]

  it('puts the chart and its legend in two columns, not stacked', async () => {
    // Gabe's ask. Stacked, the ring plus five legend rows made by-status the
    // tallest panel on the Overview while the right half of a 668px card sat
    // empty. Measured side by side at 1440px: chart 816-992, legend from
    // 1074, same row.
    const { container } = await renderDashboard(<Dashboard jobs={jobs} />)
    for (const legend of ['[data-donut-legend]', '[data-source-legend]']) {
      const grid = container.querySelector(legend)!.parentElement!
      expect(grid.className, legend).toContain('sm:grid-cols-2')
      // One column below sm: two ~150px tracks would truncate every label.
      expect(grid.className, legend).not.toContain('grid-cols-2 ')
    }
  })

  it('truncates a long label inside its own column rather than widening it', async () => {
    // Without min-w-0 a flex child refuses to shrink below its content, so a
    // long source name would widen the legend track and squeeze the chart.
    const { container } = await renderDashboard(<Dashboard jobs={[makeJob({ id: '1', status: 'applied', source: 'A Very Long Job Board Name' })]} />)
    const legend = container.querySelector('[data-source-legend]')!
    expect(legend.className).toContain('min-w-0')
    const name = [...legend.querySelectorAll('span')].find((el) =>
      el.textContent?.includes('A Very Long Job Board Name')
    )!
    expect(name.className).toContain('truncate')
    expect(name.className).toContain('min-w-0')
  })
})

describe('over-time statistics and source ranking on the Overview', () => {
  it('states the total, the busiest month and the change the curve only implies', async () => {
    // A curve answers "what shape" and is poor at "how many": reading a total
    // off six stacked areas means adding them up by eye.
    const { container } = await renderDashboard(<Dashboard
        jobs={[
          makeJob({ id: '1', status: 'applied', created_at: '2026-08-01T00:00:00Z' }),
          makeJob({ id: '2', status: 'applied', created_at: '2026-08-02T00:00:00Z' }),
          makeJob({ id: '3', status: 'applied', created_at: '2026-07-02T00:00:00Z' }),
        ]}
      />)
    const stats = container.querySelector('[data-over-time-stats]')!
    expect(stats.textContent).toMatch(/total/i)
    expect(stats.textContent).toMatch(/busiest month/i)
    // "month on month", not "vs last month": the figure skips the month in
    // progress, which has had less time to accumulate than anything it would
    // be compared against. -100% on the first of every month is true and
    // tells the reader nothing except what day it is.
    expect(stats.textContent).toMatch(/month on month/i)
    // Rules between the figures, drawn by divide-x on the row so there is no
    // trailing rule after the last one.
    expect(stats.className).toContain('divide-x')
  })

  it('writes a dash rather than a percentage against zero', async () => {
    // +100% "against" a month with nothing in it is not a percentage, and
    // Infinity is worse.
    const { container } = await renderDashboard(<Dashboard jobs={[makeJob({ id: '1', status: 'applied' })]} />)
    const stats = container.querySelector('[data-over-time-stats]')!
    expect(stats.textContent).not.toMatch(/Infinity|NaN/)
  })

  it('labels the source rows primary, secondary and others', async () => {
    const { container } = await renderDashboard(<Dashboard
        jobs={[
          // Counts are 3 / 2 / 1, deliberately unambiguous: on a tie the
          // ranking breaks alphabetically, so equal counts would make which
          // source is "secondary" a property of its name.
          makeJob({ id: '1', status: 'applied', source: 'Jobstreet' }),
          makeJob({ id: '2', status: 'applied', source: 'Jobstreet' }),
          makeJob({ id: '3', status: 'applied', source: 'Jobstreet' }),
          makeJob({ id: '4', status: 'applied', source: 'LinkedIn' }),
          makeJob({ id: '5', status: 'applied', source: 'LinkedIn' }),
          makeJob({ id: '6', status: 'applied', source: 'Indeed' }),
        ]}
      />)
    const rows = [...container.querySelectorAll('[data-source-rank]')]
    expect(rows.map((r) => (r as HTMLElement).dataset.sourceRank)).toEqual([
      'primary',
      'secondary',
      'tertiary',
    ])
    expect(rows[0].textContent).toContain('Jobstreet')
    expect(rows[1].textContent).toContain('LinkedIn')
    // The tail is named `others` and says how many sources it stands for, so
    // it reads as a tail rather than as a source called "others".
    expect(rows[2].textContent).toContain('others')
    expect(rows[2].textContent).toMatch(/1 source\b/)
  })

  it('draws no others row when every source is already named', async () => {
    const { container } = await renderDashboard(<Dashboard
        jobs={[
          makeJob({ id: '1', status: 'applied', source: 'Jobstreet' }),
          makeJob({ id: '2', status: 'applied', source: 'LinkedIn' }),
        ]}
      />)
    const rows = [...container.querySelectorAll('[data-source-rank]')]
    expect(rows.map((r) => (r as HTMLElement).dataset.sourceRank)).toEqual([
      'primary',
      'secondary',
    ])
  })
})

describe('source chart colours', () => {
  const jobs = [
    makeJob({ id: '1', status: 'applied', source: 'Jobstreet' }),
    makeJob({ id: '2', status: 'applied', source: 'Jobstreet' }),
    makeJob({ id: '3', status: 'applied', source: 'LinkedIn' }),
    makeJob({ id: '4', status: 'applied', source: 'Indeed' }),
  ]

  it('gives each rank its own colour rather than one accent at three opacities', async () => {
    const { container } = await renderDashboard(<Dashboard jobs={jobs} />)
    const swatches = [...container.querySelectorAll('[data-source-rank] span[aria-hidden]')].map(
      (el) => (el as HTMLElement).style.background
    )
    expect(new Set(swatches).size).toBe(swatches.length)
    // A single colour at three alphas is one colour, which is what Gabe
    // rejected -- and against a tinted track the faintest step was nearly the
    // track itself.
    for (const swatch of swatches) {
      expect(swatch).not.toMatch(/color-mix/)
    }
  })

  it('never bakes a resolved colour in, and never borrows a status hue', async () => {
    // Always the token reference, so the browser resolves it live at paint --
    // that is what lets the ramp invert on a theme change. And a source is
    // not a status: the five status hues mean one specific thing everywhere
    // else in this app.
    const { container } = await renderDashboard(<Dashboard jobs={jobs} />)
    const swatches = [...container.querySelectorAll('[data-source-rank] span[aria-hidden]')].map(
      (el) => (el as HTMLElement).style.background
    )
    expect(swatches.length).toBe(3)
    for (const swatch of swatches) {
      expect(swatch).toMatch(/^var\(--color-chart-[123]\)$/)
      expect(swatch).not.toMatch(/status/)
    }
  })
})

/**
 * One way out of a panel, not two.
 *
 * WHAT WENT WRONG. `UpcomingEvents` carried its own "open calendar" link at
 * the foot of its body, from before every panel got a `CardAction`. Once the
 * actions landed, the events card had two links to /planner -- one top-right
 * and one bottom-left -- and the footer one rendered even in the empty state,
 * where `EmptyState` already points at the calendar. Gabe spotted it on the
 * overview 2026-09-06.
 *
 * The test is written over ALL panels rather than over the events one, because
 * the defect is not specific to events: it is what happens whenever a panel
 * body keeps a link the header now owns. Written narrowly it would pass again
 * the next time one of the other four grows a footer.
 */
describe('panel links', () => {
  it('gives each panel exactly one link to its own destination', async () => {
    const { container } = await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} events={[]} />)
    for (const card of panelCards(container)) {
      const title = card.querySelector('h2')!.textContent!
      const action = card.querySelector('[data-slot="card-action"] a')!
      const destination = action.getAttribute('href')!
      const all = [...card.querySelectorAll(`a[href="${destination}"]`)]
      expect(all, `"${title}" links to ${destination} ${all.length} times`).toHaveLength(1)
    }
  })

  it('keeps the empty calendar panel down to the card action alone', async () => {
    // The empty state is where the duplicate was worst: two invitations to
    // open the calendar around one sentence already saying to.
    const { container } = await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} events={[]} />)
    const card = panelCards(container).find(
      (c) => c.querySelector('h2')!.textContent === 'upcoming events'
    )!
    expect(card.querySelector('[data-events-empty]')).not.toBeNull()
    expect(card.querySelectorAll('a[href="/planner"]')).toHaveLength(1)
  })
})

describe('the upcoming events panel', () => {
  const at = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString()
  const EVENTS = [1, 2, 3, 4, 5, 6].map((n) => ({
    id: `e${n}`,
    job_id: null,
    user_id: 'u1',
    kind: 'interview' as const,
    title: `Event ${n}`,
    starts_at: at(n),
    duration_minutes: 60,
    notes: null,
  }))

  it('shows four events, not three', async () => {
    // Four because the panel shares a row height with `by source`, and three
    // rows left it visibly short of its neighbour once the footer link came
    // out. The fourth row is information in that space rather than air.
    const { container } = await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} events={EVENTS} />)
    expect(container.querySelectorAll('[data-event-row]')).toHaveLength(4)
    expect(screen.getByText('Event 4')).toBeInTheDocument()
    // Positive companion for the cut-off: the fifth really is withheld rather
    // than the list having simply run out.
    expect(screen.queryByText('Event 5')).toBeNull()
  })

  it('lets its rows share the panel height instead of one row taking it', async () => {
    // jsdom has no layout, so this pins the contract: rows grow between a
    // floor and a ceiling. Unbounded `flex-1` turned four events into four
    // slabs with the dividers a screen apart.
    const { container } = await renderDashboard(<Dashboard jobs={FRESH_FIXTURE} events={EVENTS} />)
    const row = container.querySelector('[data-event-row]')!
    expect(row.className).toContain('flex-1')
    expect(row.className).toContain('min-h-16')
    expect(row.className).toContain('max-h-24')
  })
})
