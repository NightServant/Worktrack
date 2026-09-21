import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CalendarEvent } from '@/services/events'
import type { FeedJob } from '@/services/jobFeed'

import { Calendar } from '../Calendar'
import { Agenda } from '../Agenda'
import { MonthGrid } from '../MonthGrid'
import { JobFeed } from '../JobFeed'
import { UpNext } from '../UpNext'
import { buildMonthGrid } from '@/lib/calendar'

afterEach(() => cleanup())

const ev = (id: string, starts_at: string, job_id: string | null = 'job-1'): CalendarEvent => ({
  id,
  job_id,
  user_id: 'user-1',
  kind: 'interview',
  title: 'Technical interview',
  starts_at,
  duration_minutes: 60,
  notes: null,
})

const EVENTS: CalendarEvent[] = [ev('a', new Date().toISOString())]

describe('MonthGrid accent theming', () => {
  const grid = buildMonthGrid(2026, 7)

  it('carries the accent across the whole grid, not just today', () => {
    // Gabe asked for an orange calendar and said explicitly that he did not
    // mean highlighting today -- that already existed. The frame, the rules
    // between cells and the weekday header all have to carry it.
    const { container } = render(<MonthGrid grid={grid} month={7} events={[]} />)
    const root = container.querySelector('[data-month-grid]')!
    expect(root.className).toMatch(/border-accent-surface/)
    // gap-px over a tinted background is what draws the rules between cells.
    expect(root.className).toMatch(/bg-accent-default\/25/)
    expect(root.className).toMatch(/gap-px/)

    const heading = screen.getByText('Sun')
    // accent-surface, never accent-default: the latter is picked for text
    // contrast (accent-400 in dark) and a full-width band of it is the
    // over-bright header Gabe rejected.
    expect(heading.className).toMatch(/bg-accent-surface/)
    expect(heading.className).toMatch(/text-accent-on-surface/)
    expect(heading.className).not.toMatch(/bg-accent-default/)
  })

  it('tints today\u2019s own cell rather than decorating its number alone', () => {
    const today = new Date(2026, 7, 12)
    const { container } = render(
      <MonthGrid grid={grid} month={7} events={[]} today={today} />
    )
    const cell = container.querySelector('[data-today-cell]')!
    expect(cell.className).toMatch(/bg-accent-default/)
    // The 2px rule survives: it is the system's "this one" mark and the tint
    // is additional, not a replacement.
    expect(cell.querySelector('[data-today]')).toBeTruthy()
    expect(container.querySelectorAll('[data-today-cell]')).toHaveLength(1)
  })

  it('sets neighbouring months back so the current month is the subject', () => {
    const { container } = render(<MonthGrid grid={grid} month={7} events={[]} />)
    const cells = [...container.querySelectorAll('[data-month-grid] > div')].slice(7)
    const outside = cells.filter((c) => c.className.includes('bg-bg-inset'))
    // August 2026 starts on a Saturday and the six-week grid runs to 5 Sept,
    // so there are genuinely padded days on both ends.
    expect(outside.length).toBeGreaterThan(0)
    expect(outside.length).toBeLessThan(cells.length)
  })
})

describe('Calendar', () => {
  // Fix round 2: Calendar no longer calls useJobs() itself (ruling R3 --
  // a props-taking component, matching Dashboard/DetailPage). It takes
  // companyByJobId as a plain prop built by the route, so no hook mock is
  // needed here at all; that mock now lives in
  // src/app/(app)/planner/__tests__/page.test.tsx.
  it('is a month grid on desktop and a week strip plus agenda on mobile', () => {
    // 47px cells can show a dot but never an event, so mobile is a different
    // layout rather than a squeezed one.
    const { container } = render(<Calendar events={EVENTS} />)
    expect(container.querySelector('[data-month-grid]')!.className).toContain('hidden md:grid')
    expect(container.querySelector('[data-week-strip]')!.className).toContain('md:hidden')
  })

  it('marks today with an accent rule, not a filled chip', () => {
    const { container } = render(<Calendar events={EVENTS} />)
    const today = container.querySelector('[data-today]')!
    // R4: the plan's original assertion only proved the absence of a
    // radius. Strengthened to assert the presence of the actual 2px accent
    // rule the Status Marker vocabulary requires -- the same class the nav
    // item's active rule and the status tabs' active rule use.
    expect(today.className).toContain('rounded-none')
    expect(today.className).toContain('bg-accent-default')
    expect(today.className).toContain('h-[2px]')
  })

  it('renders a page header titled planner', () => {
    // `calendar` until 2026-09-11. The route is still /planner; the word
    // changed because the screen stopped being a month grid -- see NAV.
    render(<Calendar events={EVENTS} />)
    expect(screen.getByRole('heading', { name: 'planner' })).toBeTruthy()
  })

  it('threads a companyByJobId prop through into the agenda, unmodified', () => {
    // ONE agenda again. A vertical desktop copy was added on 2026-09-11 and
    // removed the same day: Gabe called it underwhelming, and the horizontal
    // `UpNext` rail replaced it. `Agenda` is a phone component once more.
    render(<Calendar events={EVENTS} companyByJobId={{ 'job-1': 'Acme Corp' }} />)
    expect(screen.getAllByText('Acme Corp')).toHaveLength(1)
  })

  it('opens with the up-next rail, above both the feed and the month', () => {
    const { container } = render(
      <Calendar events={EVENTS} feed={<div data-test-feed />} />
    )
    const rail = container.querySelector('[data-up-next]')!
    const feed = container.querySelector('[data-test-feed]')!
    const block = container.querySelector('[data-calendar-block]')!
    // Things to DO before things to look at.
    expect(rail.compareDocumentPosition(feed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(feed.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('Agenda', () => {
  it('uses a neutral rule for events, never the status palette', () => {
    // An event kind is not an application status, and the five status hues
    // mean one specific thing everywhere else in the app.
    const { container } = render(<Agenda events={EVENTS} />)
    const rules = container.querySelectorAll('[data-event-rule]')
    expect(rules.length).toBeGreaterThan(0)
    for (const row of rules) {
      expect(row.className).not.toMatch(/status-(wishlist|applied|interviewing|offer|rejected)/)
    }
  })

  it('says there is nothing scheduled rather than rendering an empty list', () => {
    render(<Agenda events={[]} />)
    expect(screen.getByText(/nothing scheduled/i)).toBeTruthy()
  })

  it('distinguishes two identically-titled events on the same day by company', () => {
    // Concrete failure this closes: two interview events both titled
    // "Technical interview" for different companies used to render as
    // identical rows.
    const same = new Date().toISOString()
    const events = [ev('a', same, 'job-1'), ev('b', same, 'job-2')]
    render(
      <Agenda
        events={events}
        companyByJobId={{ 'job-1': 'Acme Corp', 'job-2': 'Globex' }}
      />
    )
    expect(screen.getByText('Acme Corp')).toBeTruthy()
    expect(screen.getByText('Globex')).toBeTruthy()
  })

  it('renders a standalone event (no job_id) without a company line, never "null" or a bare separator', () => {
    const { container } = render(
      <Agenda events={[ev('a', new Date().toISOString(), null)]} companyByJobId={{}} />
    )
    expect(container.textContent).not.toContain('null')
    // The row's own text, specifically -- not just "the word null is absent
    // somewhere on the page" -- must not contain a stray leading separator
    // where a company would otherwise have gone.
    const row = container.querySelector('[data-event-rule]')!
    expect(row.textContent).not.toMatch(/^\s*·/)
    expect(row.textContent).not.toContain('undefined')
  })

  it('gives the time/kind line tabular numerals, matching MonthGrid and WeekStrip', () => {
    const { container } = render(<Agenda events={EVENTS} />)
    const row = container.querySelector('[data-event-rule]')!
    const timeLine = row.querySelector('.tabular')
    expect(timeLine).toBeTruthy()
  })
})

describe('public holidays', () => {
  const HOLIDAY = {
    date: '2026-08-21',
    localName: 'Ninoy Aquino Day',
    name: 'Ninoy Aquino Day',
    countryCode: 'PH',
    global: true,
  }

  it('names the holiday in the cell it falls on, and only that cell', () => {
    // The date is a bare YYYY-MM-DD and the cell key comes from a local Date.
    // They meet as strings on purpose -- parsing the holiday as an instant is
    // what would move it a day for anyone behind UTC.
    const { container } = render(
      <MonthGrid grid={buildMonthGrid(2026, 7)} month={7} events={[]} holidays={[HOLIDAY]} />
    )
    const marks = container.querySelectorAll('[data-holiday]')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('Ninoy Aquino Day')
  })

  it('draws no holiday at all when none was supplied', () => {
    // A failed or unconfigured holiday fetch must leave a working calendar
    // behind, not an empty row where the names would go.
    const { container } = render(
      <MonthGrid grid={buildMonthGrid(2026, 7)} month={7} events={[]} />
    )
    expect(container.querySelector('[data-holiday]')).toBeNull()
    expect(container.querySelector('[data-month-grid]')).toBeTruthy()
  })

  it('offers no country picker at all — the clock decides', () => {
    // Gabe, 2026-09-11: "local aware is the reason to remove the dropdown for
    // country holidays." `resolveHolidayCountry` reads the time zone, which is
    // about where the machine IS; the dropdown only ever restated that.
    const { container } = render(<Calendar events={[]} />)
    expect(container.querySelector('#holiday-country')).toBeNull()
    expect(screen.queryByLabelText('Public holidays for')).toBeNull()
  })

  it('reports the years its grid covers so the caller fetches exactly those', () => {
    // A December grid pads into January of the next year. Reporting the years
    // rather than assuming one is what keeps New Year's Day on the grid.
    const seen: number[][] = []
    render(<Calendar events={[]} onVisibleYearsChange={(years) => seen.push(years)} />)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toContain(new Date().getFullYear())
  })
})

describe('the fresh-roles feed', () => {
  const role = (id: string, title: string, publishedAt: string) => ({
    id,
    title,
    company: 'Vercel',
    url: `https://jobicy.com/jobs/${id}`,
    geo: 'APAC',
    level: 'Any',
    industry: 'Software Engineering',
    publishedAt,
    source: 'jobicy' as const,
    excerpt: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
  })

  it('links every row to the original posting, and credits the source', () => {
    // Both are conditions of use, not decoration: the feed's own response asks
    // that Jobicy be credited with a direct link and that application buttons
    // redirect to the job URL it provided.
    render(<JobFeed jobs={[role('1', 'Backend Engineer', new Date().toISOString())]} />)
    const posting = screen.getByRole('link', { name: /Backend Engineer/ })
    expect(posting.getAttribute('href')).toBe('https://jobicy.com/jobs/1')
    expect(posting.getAttribute('rel')).toBe('noreferrer')
    expect(screen.getByRole('link', { name: 'Jobicy' })).toBeTruthy()
  })

  it('hands the posting URL to the add flow rather than copying the row', () => {
    render(<JobFeed jobs={[role('1', 'Backend Engineer', new Date().toISOString())]} />)
    const track = screen.getByRole('link', { name: /track it/i })
    expect(track.getAttribute('href')).toBe(
      `/applications?add=${encodeURIComponent('https://jobicy.com/jobs/1')}`
    )
  })

  it('offers the record, not the wizard, for a role already tracked', () => {
    // The panel's one fact about a posting is whether it is already in the
    // pipeline; before this it offered `track it` on everything and pressing
    // it opened an add wizard for an application that exists.
    render(
      <JobFeed
        jobs={[role('1', 'Backend Engineer', new Date().toISOString())]}
        trackedIds={{ '1': 'job-9' }}
      />
    )
    expect(screen.queryByRole('link', { name: /track it/i })).toBeNull()
    expect(screen.getByRole('link', { name: /tracked/i }).getAttribute('href')).toBe(
      '/applications?application=job-9'
    )
  })

  it('dates every card by the day it went up', () => {
    // The rail replaced a stack of day-grouped lists (Gabe, 2026-09-10), so
    // the day label moved onto the card. It is still the local day: reading a
    // `pubDate` as its UTC date would file an evening posting under yesterday
    // for anyone ahead of UTC.
    const today = new Date()
    const earlier = new Date(today)
    earlier.setDate(earlier.getDate() - 3)
    const { container } = render(
      <JobFeed
        jobs={[role('2', 'New role', today.toISOString()), role('1', 'Older role', earlier.toISOString())]}
      />
    )
    const cards = [...container.querySelectorAll('[data-feed-role]')]
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('today')
    expect(cards[1].textContent).not.toContain('today')
  })

  it('keeps the whole panel to one card tall, however many roles came back', () => {
    // Twenty-four roles stacked vertically pushed the month grid two screens
    // down the page the grid is the subject of. A rail is why this is on top.
    const now = new Date().toISOString()
    const { container } = render(
      <JobFeed jobs={Array.from({ length: 24 }, (_, i) => role(String(i), `Role ${i}`, now))} />
    )
    expect(container.querySelectorAll('[data-feed-role]')).toHaveLength(24)
    // One track, not twenty-four rows.
    expect(container.querySelectorAll('[data-slot="carousel-content"]')).toHaveLength(1)
  })

  it('says a failed fetch failed rather than claiming nothing was posted', () => {
    // "nothing posted" is a claim about the job market. A network error has no
    // basis for making it.
    const { container } = render(<JobFeed error />)
    expect(container.querySelector('[data-job-feed-state="error"]')).toBeTruthy()
    expect(container.querySelector('[data-job-feed-state="empty"]')).toBeNull()
  })

  it('gives both rails a real empty state, and keeps the failed read out of it', () => {
    // Gabe, 2026-09-13: "implement a proper empty state to the two carousel
    // sections". Both were a loose muted sentence -- which is also the shape
    // the FAILED read takes, three lines up in the same type. `EmptyState` is
    // the glyph-over-copy component the rest of the app uses, and its own
    // docblock forbids using it for an error, so this pins both halves: the
    // empty rails get one, the error does not.
    const { container: empty } = render(<JobFeed jobs={[]} />)
    expect(empty.querySelector('[data-job-feed-state="empty"][data-empty-state]')).toBeTruthy()
    // No arrows either: two chevrons over nothing are controls for a list that
    // is not there.
    expect(empty.querySelector('[data-slot="carousel-previous"]')).toBeNull()

    cleanup()
    const { container: failed } = render(<JobFeed error />)
    expect(failed.querySelector('[data-empty-state]')).toBeNull()

    cleanup()
    const { container: quiet } = render(<UpNext items={[]} />)
    expect(quiet.querySelector('[data-up-next-empty][data-empty-state]')).toBeTruthy()
  })

  it('renders the calendar without a feed at all', () => {
    // The feed is a third-party read and must never gate this screen.
    const { container } = render(<Calendar events={[]} />)
    expect(container.querySelector('[data-job-feed]')).toBeNull()
    expect(container.querySelector('[data-month-grid]')).toBeTruthy()
  })
})

const SENT = [
  { id: 'j1', company: 'Acme', role: 'Frontend Engineer' },
  { id: 'j2', company: 'Globex', role: 'Backend Engineer' },
  { id: 'j3', company: 'Umbrella', role: 'Product Engineer' },
]

describe('applications on the month grid', () => {
  it('counts what was sent on each day', () => {
    // The grid was forty-two empty cells for anyone with no interviews booked,
    // while the account behind it was busy. `date_applied` is already there.
    const { container } = render(
      <MonthGrid
        grid={buildMonthGrid(2026, 7)}
        month={7}
        events={[]}
        applicationsByDay={{ '2026-08-12': SENT }}
      />
    )
    const marks = container.querySelectorAll('[data-applications-sent]')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toContain('3 sent')
  })

  it('names the roles for a reader who cannot hover', () => {
    // The tooltip is a POINTER affordance, and it is the only place the roles
    // are drawn. Every other mark in a cell carries its own words already --
    // this one was a bare number.
    const { container } = render(
      <MonthGrid
        grid={buildMonthGrid(2026, 7)}
        month={7}
        events={[]}
        applicationsByDay={{ '2026-08-12': SENT }}
      />
    )
    const mark = container.querySelector('[data-applications-sent]')!
    expect(mark.textContent).toContain('Frontend Engineer at Acme')
    expect(mark.textContent).toContain('Product Engineer at Umbrella')
  })

  /**
   * THE DAY'S STACK (Gabe, 2026-09-18). A cell is ~190px wide: an interview
   * shows a title with no time and no company, a holiday shows whichever half
   * of its name fits, and five applications show as the words `5 sent`. The
   * tooltip is where the day is actually legible.
   */
  it('opens the day’s stack on hover, naming every role, company and time', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MonthGrid
        grid={buildMonthGrid(2026, 7)}
        month={7}
        events={[ev('a', '2026-08-12T02:00:00.000Z')]}
        companyByJobId={{ 'job-1': 'Initech' }}
        applicationsByDay={{ '2026-08-12': SENT }}
      />
    )

    await user.hover(container.querySelector('[data-day-cell="2026-08-12"]')!)

    const stack = await waitFor(() => {
      const found = document.querySelector('[data-day-stack]')
      if (!found) throw new Error('no day stack')
      return found as HTMLElement
    })

    // One line per thing on the day: the interview, then the three sent.
    expect(stack.querySelectorAll('[data-day-item]')).toHaveLength(4)
    // What the cell could not say: the company an interview is with, and which
    // applications those three were.
    expect(within(stack).getByText('Technical interview')).toBeTruthy()
    expect(within(stack).getByText('Initech')).toBeTruthy()
    expect(within(stack).getByText('Frontend Engineer')).toBeTruthy()
    expect(within(stack).getByText('Acme')).toBeTruthy()
    // And the kind of each, which is what tells one card from the next.
    expect(within(stack).getAllByText('applied')).toHaveLength(3)
    expect(within(stack).getByText('interview')).toBeTruthy()
  })

  it('leaves an empty day without a tooltip at all', async () => {
    // Twenty-eight of these cells are usually blank, and a tooltip that opens
    // to say nothing teaches the reader that hovering is not worth doing.
    const user = userEvent.setup()
    const { container } = render(
      <MonthGrid grid={buildMonthGrid(2026, 7)} month={7} events={[]} />
    )
    await user.hover(container.querySelector('[data-day-cell="2026-08-12"]')!)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(document.querySelector('[data-day-stack]')).toBeNull()
  })

  it('draws nothing on a day with none', () => {
    const { container } = render(
      <MonthGrid grid={buildMonthGrid(2026, 7)} month={7} events={[]} />
    )
    expect(container.querySelector('[data-applications-sent]')).toBeNull()
  })
})

describe('where the calendar puts its own controls', () => {
  it('keeps the month nav and the holiday picker out of the page header', () => {
    // Gabe called the old arrangement a regression (2026-09-10): these steer
    // one component further down the page, so beside the page title they read
    // as the app's own navigation. `PageHeader`'s action slot is for
    // page-level actions -- /applications' add, /documents' new CV.
    const { container } = render(<Calendar events={[]} />)
    const header = container.querySelector('[data-body-header]')!
    expect(within(header as HTMLElement).queryByRole('button', { name: /previous/i })).toBeNull()

    // Present, just somewhere that makes sense: the block that holds the grid.
    const block = container.querySelector('[data-calendar-block]')! as HTMLElement
    expect(within(block).getByRole('button', { name: /previous/i })).toBeTruthy()
    expect(block.querySelector('[data-month-grid]')).toBeTruthy()
  })

  it('puts the fresh-roles panel above the month, not below it', () => {
    const { container } = render(<Calendar events={[]} feed={<div data-test-feed />} />)
    const feed = container.querySelector('[data-test-feed]')!
    const block = container.querySelector('[data-calendar-block]')!
    expect(feed.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('JobFeed — the paid boards', () => {
  const paid = (over: Partial<FeedJob> = {}): FeedJob => ({
    source: 'linkedin',
    id: 'linkedin:1',
    title: 'Staff Engineer',
    company: 'Chainguard',
    url: 'https://www.linkedin.com/jobs/view/1',
    geo: 'APAC',
    level: 'Senior',
    industry: null,
    publishedAt: new Date().toISOString(),
    excerpt: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    ...over,
  })

  it('names the board every card came from', () => {
    render(<JobFeed jobs={[paid(), paid({ id: 'x', source: 'indeed', title: 'Analyst' })]} />)
    const labels = [...document.querySelectorAll('[data-feed-source]')].map(
      (node) => node.textContent
    )
    expect(labels).toEqual(['LinkedIn', 'Indeed'])
  })

  it('draws no board row at all without a handler', () => {
    // This is what keeps the paid controls off `/demo/planner`, which has no
    // session to authenticate with and no account to bill.
    render(<JobFeed jobs={[paid()]} />)
    expect(document.querySelector('[data-feed-boards]')).toBeNull()
  })

  it('offers the four boards and reports which are on', () => {
    render(<JobFeed jobs={[]} boards={['indeed']} onBoardsChange={() => {}} />)
    const buttons = [...document.querySelectorAll('[data-feed-board]')]
    expect(buttons.map((node) => node.getAttribute('data-feed-board'))).toEqual([
      'linkedin',
      'jobstreet',
      'indeed',
    ])
    expect(
      buttons.find((node) => node.getAttribute('data-feed-board') === 'indeed')
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      buttons.find((node) => node.getAttribute('data-feed-board') === 'linkedin')
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('adds and removes a board rather than replacing the selection', async () => {
    // Multi-select is the point: the runs are concurrent and the rail is one
    // list. A picker that replaced would make four boards four visits.
    const user = userEvent.setup()
    const onBoardsChange = vi.fn()
    const { rerender } = render(
      <JobFeed jobs={[]} boards={['linkedin']} onBoardsChange={onBoardsChange} />
    )
    await user.click(document.querySelector('[data-feed-board="indeed"]') as HTMLElement)
    expect(onBoardsChange).toHaveBeenLastCalledWith(['linkedin', 'indeed'])

    rerender(<JobFeed jobs={[]} boards={['linkedin', 'indeed']} onBoardsChange={onBoardsChange} />)
    await user.click(document.querySelector('[data-feed-board="linkedin"]') as HTMLElement)
    expect(onBoardsChange).toHaveBeenLastCalledWith(['indeed'])
  })

  it('says a board gave nothing rather than going quiet', () => {
    // Four boards run concurrently and fail on their own. Silence would be
    // indistinguishable from a board with no new roles.
    render(
      <JobFeed
        jobs={[paid()]}
        boards={['indeed']}
        onBoardsChange={() => {}}
        boardNotes={[{ source: 'indeed', message: 'Indeed returned nothing for that search.' }]}
      />
    )
    expect(
      document.querySelector('[data-feed-board-note="indeed"]')?.textContent
    ).toContain('Indeed returned nothing')
  })

  it('still marks a board posting as tracked', () => {
    // The reader tracked the job, not the board -- so the indicator has to work
    // for a LinkedIn row exactly as it does for a Jobicy one.
    render(<JobFeed jobs={[paid()]} trackedIds={{ 'linkedin:1': 'a1' }} />)
    expect(screen.getByRole('link', { name: /tracked/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /track it/i })).toBeNull()
  })
})

describe('JobFeed — choosing boards is free, searching is not', () => {
  it('does not search when a board is merely picked', async () => {
    /*
      THE DEFECT THIS EXISTS FOR (Gabe, 2026-09-21: "Too many requests"). Each
      toggle used to change the query key, so choosing all four boards was four
      crawls against a throttle of two a minute -- the reader was rate-limited
      before they had finished choosing.
    */
    const user = userEvent.setup()
    const onSearchBoards = vi.fn()
    const onBoardsChange = vi.fn()
    render(
      <JobFeed
        jobs={[]}
        boards={[]}
        onBoardsChange={onBoardsChange}
        onSearchBoards={onSearchBoards}
      />
    )
    await user.click(document.querySelector('[data-feed-board="linkedin"]') as HTMLElement)
    expect(onBoardsChange).toHaveBeenCalledWith(['linkedin'])
    expect(onSearchBoards).not.toHaveBeenCalled()
  })

  it('searches once, when asked', async () => {
    const user = userEvent.setup()
    const onSearchBoards = vi.fn()
    render(
      <JobFeed
        jobs={[]}
        boards={['linkedin', 'indeed']}
        onBoardsChange={() => {}}
        onSearchBoards={onSearchBoards}
      />
    )
    await user.click(document.querySelector('[data-feed-board-search]') as HTMLElement)
    expect(onSearchBoards).toHaveBeenCalledTimes(1)
  })

  it('will not buy the same answer twice at full price', () => {
    // A selection that has already been searched has nothing new to fetch.
    render(
      <JobFeed
        jobs={[]}
        boards={['linkedin']}
        boardsSearched
        onBoardsChange={() => {}}
        onSearchBoards={() => {}}
      />
    )
    expect(document.querySelector('[data-feed-board-search]')).toBeDisabled()
  })

  it('offers nothing to search when nothing is picked', () => {
    // The sentence beside it already says what to do; a disabled button would
    // be a second, worse way of saying it.
    render(<JobFeed jobs={[]} boards={[]} onBoardsChange={() => {}} onSearchBoards={() => {}} />)
    expect(document.querySelector('[data-feed-board-search]')).toBeNull()
  })

  it('applies the toggles itself where a search costs nothing', () => {
    // `/demo/planner` filters a fixture in memory. A search button in front of
    // that would be ceremony over nothing.
    render(<JobFeed jobs={[]} boards={['linkedin']} onBoardsChange={() => {}} />)
    expect(document.querySelector('[data-feed-boards]')).toBeTruthy()
    expect(document.querySelector('[data-feed-board-search]')).toBeNull()
  })
})
