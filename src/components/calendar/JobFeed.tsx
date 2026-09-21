'use client'

import * as React from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  CarouselRow,
} from '@/components/ui/carousel'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterBar } from '@/components/ui/filter-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckIcon, ExternalIcon, PlusIcon } from '@/components/icons'
import { ICON_MOTION_GROUP, iconMotion } from '@/components/icons/motion'
import { localDayKey } from '@/services/date'
import { parseDayKey } from '@/lib/calendar'
import { useAppHref } from '@/components/shell/routeBase'
import { matchesTerms, searchTerms } from '@/lib/search'
import {
  SCRAPED_SOURCES,
  SOURCE_LABELS,
  type FeedFacet,
  type FeedJob,
  type FeedNote,
  type FeedSource,
} from '@/services/jobFeed'

/**
 * Newly posted remote roles, grouped by the day they went up.
 *
 * WHY IT IS ON THE CALENDAR and not on /applications, which is where a job
 * board would normally live. Gabe asked for "an API for aggregating job posts"
 * as a calendar enhancement, and the fit is better than it first looks: this
 * screen is the app's only view of TIME, and a posting's most perishable
 * property is its age. Grouped by `pubDate` under a month grid, the panel
 * answers "what appeared while I was not looking" — which is the same question
 * the grid above answers about interviews. On /applications it would have been
 * a second list competing with the user's own.
 *
 * GROUPED BY DAY, USING THE SAME LOCAL-DAY KEY as the events above it. A
 * `pubDate` is a real instant, so bucketing it by its UTC date would file an
 * evening posting under the previous day for anybody ahead of UTC — the
 * defect `localDayKey` exists to prevent, applied to a third source now.
 *
 * EVERY ROW LINKS TO THE ORIGINAL POSTING, and that is a condition of use
 * rather than a design choice: Jobicy's own response asks that it be "clearly
 * credited with a direct link to the source, and all application buttons
 * redirect to the original job URL provided in this feed". The credit is in
 * the footer and the title is the link.
 *
 * `track it` DOES NOT COPY THE POSTING INTO THE DATABASE. It hands the URL to
 * the ordinary add flow, which reads the page with this app's own extractor —
 * so a tracked application is built from the employer's posting, not from a
 * third party's summary of it, and nothing here is stored on their behalf.
 */
export interface JobFeedProps {
  jobs?: FeedJob[]
  loading?: boolean
  error?: boolean
  /** The feed's own industry taxonomy. Empty means no filter is drawn. */
  industries?: FeedFacet[]
  industry?: string | null
  onIndustryChange?: (slug: string) => void
  /** The feed's geo taxonomy. Empty means no region filter is drawn. */
  locations?: FeedFacet[]
  geo?: string | null
  onGeoChange?: (slug: string) => void
  /**
   * Which roles here are already applications, as `feed id -> record id`.
   *
   * Computed by the route from the applications it has already loaded -- see
   * `trackedFeedRoles`. Absent means "nobody asked", which is the demo and
   * every test that does not care; the rail then offers `track it` on
   * everything, which is what it did before this existed.
   */
  trackedIds?: Record<string, string>
  /**
   * Which paid boards are switched on, and how to change that.
   *
   * SEPARATE FROM THE TWO DROPDOWNS because they are a different kind of
   * control. Region and field narrow a free feed that is already loaded; these
   * four each start a crawl that costs money and takes tens of seconds. A
   * reader should be able to tell those apart without reading the source, so
   * they get their own row and their own wording.
   */
  boards?: readonly FeedSource[]
  onBoardsChange?: (next: FeedSource[]) => void
  /** Whether a board run is in flight. The rail stays; the row says so. */
  boardsLoading?: boolean
  /** Per-board failures, from the extractor. See `FeedNote`. */
  boardNotes?: FeedNote[]
  /**
   * What pressing a board actually does here, when that is not the usual.
   *
   * IT EXISTS BECAUSE THE DEMO IS NOT LYING-SHAPED. On the real planner each
   * press starts a paid crawl and the line says so; on `/demo/planner` the
   * rows are a fixture and the toggles filter them in memory, so the same
   * sentence would promise a search that never happens on the one screen whose
   * whole premise is that it is honest about being invented.
   */
  boardsHint?: string
  className?: string
}

/** `all` is a sentinel, not a slug: the API means "no industry filter". */
const ANY_INDUSTRY = 'all'

function formatPostedDay(key: string, today: string): string {
  if (key === today) return 'today'
  const date = parseDayKey(key)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (key === localDayKey(yesterday.toISOString())) return 'yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/**
 * `₱120,000 – ₱160,000`, or null.
 *
 * `Intl.NumberFormat` rather than a hand-rolled prefix: the feed reports a
 * currency per posting and most of them are USD, so a hardcoded peso sign
 * would misstate every one of them by a factor of about fifty-five.
 */
function formatBand(job: FeedJob): string | null {
  if (!job.salaryMin && !job.salaryMax) return null
  const money = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: job.salaryCurrency ?? 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  if (job.salaryMin && job.salaryMax) return `${money(job.salaryMin)} – ${money(job.salaryMax)}`
  return money((job.salaryMin ?? job.salaryMax) as number)
}

export function JobFeed({
  jobs = [],
  loading = false,
  error = false,
  industries = [],
  industry = null,
  onIndustryChange,
  locations = [],
  geo = null,
  onGeoChange,
  trackedIds = {},
  boards = [],
  onBoardsChange,
  boardsLoading = false,
  boardNotes = [],
  boardsHint,
  className,
}: JobFeedProps) {
  const appHref = useAppHref()
  const today = React.useMemo(() => localDayKey(new Date().toISOString()), [])

  /**
   * THE SEARCH IS LOCAL, AND THE TWO DROPDOWNS ARE NOT (2026-09-15).
   *
   * That asymmetry is the honest one rather than an inconsistency. Region and
   * field are Jobicy's own taxonomy and are sent to the API, so changing
   * either fetches a different list -- they are the only way to reach roles
   * that are not on this page. A title search is not: the feed offers no
   * keyword parameter, so the only thing this box can honestly do is narrow
   * what has already arrived. Sending it upstream is not an option, and
   * pretending otherwise would mean a search that silently misses every role
   * past the fetch limit.
   *
   * The title AND the company are searched, joined by `matchesTerms` -- see
   * lib/search. Somebody scanning this rail is looking for one or the other
   * and does not think of them as two fields.
   */
  const [query, setQuery] = React.useState('')
  const terms = React.useMemo(() => searchTerms(query), [query])
  const visible = React.useMemo(
    () => jobs.filter((job) => matchesTerms(terms, job.title, job.company)),
    [jobs, terms]
  )

  return (
    // `@container/feed` is declared HERE, on the card, and queried by the cards
    // inside it. An element cannot query its own container, so the declaration
    // has to sit above the `@2xl/feed:` rules rather than beside them.
    // NO FRAME ON THE PANEL ITSELF (Gabe, 2026-09-10: "remove the background
    // color and border for that card only"). The rail is already a row of
    // bordered cards; boxing them inside a second box drew two borders 16px
    // apart and made the roles look nested inside something. The horizontal
    // padding goes with it, so the first role sits on the same left edge as
    // the month grid below rather than 16px inside it. The card's VERTICAL
    // rhythm is kept -- that is what still separates title, rail and credit.
    <Card
      className={cn('@container/feed border-0 bg-transparent py-0', className)}
      data-job-feed
    >
      {/* THE CAROUSEL WRAPS THE HEADER TOO. It no longer has to -- the arrows
          moved down beside the rail on 2026-09-15 -- but the provider still
          has to sit above everything that reads it, and the header's filter
          row is inside the same vertical rhythm. The card's own `--card-spacing`
          is restated on it, since a wrapper between `Card` and its children
          would otherwise swallow the gap. */}
      <Carousel
        opts={{ align: 'start', dragFree: true, containScroll: 'trimSnaps' }}
        // `gap-6` (24px), not `--card-spacing` (16px). This is the distance
        // from the card's HEADER GROUP to the rail, and 16px was the value for
        // a header with its controls tucked into its own trailing column --
        // with the controls on their own row beneath, it read as a flat stack.
        // See FilterBar for the three steps.
        className="flex flex-col gap-6"
      >
        {/* THE HEADER GROUP: the panel's title, its sentence, and the controls
            that narrow it -- 12px apart because they are one thing, and 24px
            clear of the rail below.

            NO `CardAction` ANY MORE. The three controls used to sit in that
            slot, which is the header grid's trailing column -- so on a card
            whose description is a full sentence they were squeezed into
            whatever the sentence left, and wrapped inside their own corner at
            widths where the row had space going spare. They are their own row
            below the header now (Gabe, 2026-09-15). */}
        <div className="flex flex-col gap-3">
          <CardHeader className="px-0">
            <CardTitle icon="Applications">
              <h2>fresh remote roles</h2>
            </CardTitle>
            <CardDescription>
              what went up recently, newest first — track one and Worktrack reads the posting for
              you.
            </CardDescription>
          </CardHeader>

          {/* SEARCH, THEN WHERE, THEN WHAT -- the order `FilterBar` sets for
              every narrowing row in the app, applied to a rail that until
              2026-09-15 had the two dropdowns and no search at all.

              WHERE BEFORE WHAT among the dropdowns, and that ordering is older
              than this row: region is the filter that decides whether the rail
              is usable at all, because unfiltered this feed is overwhelmingly
              US-eligible and somebody outside the US was reading a list of
              roles they cannot take (Gabe, 2026-09-11). It opens on the
              reader's own country when the feed lists one -- see
              `geoSlugForCountry`.

              THE ROW IS DRAWN EVEN WHILE THE FEED IS LOADING OR FAILED, and
              that is deliberate: the two dropdowns are what RE-FETCH, so
              hiding them on a failed read would take away the control most
              likely to fix it. The search box is the exception the other way --
              it narrows what arrived, so with nothing arrived there is nothing
              for it to do, and a box that cannot affect anything is a control
              that lies. */}
          <FilterBar
            search={
              jobs.length > 0
                ? {
                    id: 'job-feed-search',
                    label: 'Search these roles by title or company',
                    placeholder: 'search roles',
                    value: query,
                    onChange: setQuery,
                  }
                : undefined
            }
            selects={[
              ...(locations.length > 0
                ? [
                    {
                      id: 'job-feed-geo',
                      label: 'Filter roles by region',
                      icon: 'Globe' as const,
                      value: geo ?? ANY_INDUSTRY,
                      onValueChange: (next: string) => onGeoChange?.(next),
                      items: [
                        { value: ANY_INDUSTRY, label: 'anywhere' },
                        ...locations
                          .filter((facet) => facet.slug !== 'anywhere')
                          .map((facet) => ({ value: facet.slug, label: facet.name })),
                      ],
                    },
                  ]
                : []),
              ...(industries.length > 0
                ? [
                    {
                      id: 'job-feed-industry',
                      label: 'Filter roles by field',
                      icon: 'Tag' as const,
                      width: 'l' as const,
                      value: industry ?? ANY_INDUSTRY,
                      onValueChange: (next: string) => onIndustryChange?.(next),
                      items: [
                        { value: ANY_INDUSTRY, label: 'every field' },
                        ...industries.map((facet) => ({
                          value: facet.slug,
                          label: facet.name,
                        })),
                      ],
                    },
                  ]
                : []),
            ]}
          />

          {/* THE BOARDS, AND WHY THEY ARE NOT A THIRD DROPDOWN.
              (Gabe, 2026-09-21: add LinkedIn, JobStreet, Indeed and Glassdoor.)

              Jobicy is always on and is not in this row. It is keyless and
              CORS-open, so the browser fetches it directly and it costs
              nothing -- switching it off would save nobody anything. Each of
              these four is an Apify actor that crawls a result page: it costs
              money per posting and takes tens of seconds. Putting them behind
              the same instant-looking dropdown as `every field` would promise
              a speed they cannot deliver and spend a balance nobody chose to
              spend.

              SO THEY ARE OFF UNTIL ASKED FOR, one press each, and the row says
              what pressing one does. Multi-select rather than single: the
              whole point is a rail with more than one board in it, and the
              runs happen concurrently. */}
          {onBoardsChange && (
            <div className="flex flex-col gap-2" data-feed-boards>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-label-caps uppercase text-text-muted">boards</span>
                {SCRAPED_SOURCES.map((source) => {
                  const on = boards.includes(source)
                  return (
                    <Button
                      key={source}
                      type="button"
                      size="s"
                      variant={on ? 'primary' : 'secondary'}
                      aria-pressed={on}
                      data-feed-board={source}
                      disabled={boardsLoading}
                      onClick={() =>
                        onBoardsChange(
                          on
                            ? boards.filter((value) => value !== source)
                            : [...boards, source]
                        )
                      }
                    >
                      {SOURCE_LABELS[source]}
                    </Button>
                  )
                })}
              </div>
              {/* THE COST IS SAID BEFORE IT IS INCURRED, not after. A control
                  that quietly spends is the one thing this app has refused to
                  ship anywhere else. */}
              <p className="text-caption text-text-muted">
                {boardsLoading
                  ? 'searching those boards — they crawl a results page, so this takes a moment.'
                  : (boardsHint ??
                    (boards.length === 0
                      ? 'jobicy is always on and free. add a board to search it too.'
                      : 'these boards are searched on demand and take a moment.'))}
              </p>
              {/* A BOARD THAT GAVE NOTHING SAYS SO, ON ITS OWN LINE. Four run
                  concurrently and each fails on its own, so one being down
                  must not empty the other three -- and silence would be
                  indistinguishable from a board with no new roles. */}
              {boardNotes.map((note) => (
                <p
                  key={note.source}
                  data-feed-board-note={note.source}
                  className="text-caption text-text-muted"
                >
                  {note.message}
                </p>
              ))}
            </div>
          )}
        </div>


        <CardContent className="flex flex-col gap-4 px-0">
          {loading && (
            <div className="flex gap-4 overflow-hidden" data-job-feed-state="loading">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-36 w-72 shrink-0" />
              ))}
            </div>
          )}

          {/* A FAILED THIRD-PARTY READ IS NOT AN EMPTY BOARD. Saying "nothing
              posted" when the request never landed would be a claim about the
              job market made on the strength of a network error. */}
          {!loading && error && (
            <p className="text-body-s text-text-muted" data-job-feed-state="error">
              could not reach the job feed just now. the calendar below is unaffected.
            </p>
          )}

          {/* THE SAME EMPTY STATE THE BAND ABOVE GETS (Gabe, 2026-09-13). A
              loose muted sentence is the shape this panel's ERROR takes too --
              and the error is three lines up, in the same type, in the same
              place. A glyph over centred copy is what tells the two apart at a
              glance, and `EmptyState`'s docblock is explicit that it must
              never be used for the failed read: that one keeps its own
              wording, because "nothing posted" over a request that never
              landed is a claim about the job market made out of a network
              error. `py-10`, half its default: this is one band, not a
              screen. */}
          {!loading && !error && jobs.length === 0 && (
            <EmptyState icon="Applications" className="py-10" data-job-feed-state="empty">
              nothing posted here right now. try another region or field.
            </EmptyState>
          )}

          {/* A SEARCH THAT MATCHES NOTHING IS NOT AN EMPTY FEED, which is the
              same rule the documents list and the template gallery follow: say
              which control emptied the list, and there are three here. The
              feed DID return roles -- `jobs.length > 0` is in the condition --
              so "nothing posted" would be a false statement about the job
              market, and the region and field dropdowns are innocent. Only the
              word that was typed can have done this, so that is what is named,
              and clearing it is offered as the action rather than described. */}
          {!loading && !error && jobs.length > 0 && visible.length === 0 && (
            <EmptyState
              icon="Search"
              className="py-10"
              data-job-feed-state="no-results"
              action={
                <Button variant="secondary" size="s" onClick={() => setQuery('')}>
                  clear the search
                </Button>
              }
            >
              none of the {jobs.length} roles here match “{query.trim()}”.
            </EmptyState>
          )}

          {/* ARROWS ONLY WHEN THERE IS A RAIL TO PAGE, which is how the band
              above already behaves -- two disabled chevrons beside an empty
              state are controls for a list that is not there. That rule is
              unchanged; what moved on 2026-09-15 is WHERE they sit. They were
              on the card's header row beside the two filters, and they now
              flank the rail itself, which is the one arrangement every
              carousel in this app uses -- see `CarouselRow` in ui/carousel.

              Rendering the row only in the populated branch is what keeps the
              rule true: the loading, error and empty branches above are not
              wrapped in it, so there is nothing to disable. */}
          {!loading && !error && visible.length > 0 && (
            <CarouselRow>
              <CarouselPrevious />
              {/* -ml-4 / pl-4 is the carousel's own gutter idiom: the track
                  shifts left by one gap so the first card sits flush with the
                  row's left edge while every later one keeps its spacing. */}
              <CarouselContent className="-ml-4">
              {visible.map((job) => {
                const band = formatBand(job)
                const facts = [job.geo, job.level].filter(Boolean).join(' · ')
                const tracked = trackedIds[job.id]
                return (
                  <CarouselItem key={job.id} className="basis-auto pl-4">
                    {/* THE ROLE CARD KEEPS ITS FILL (Gabe, 2026-09-10:
                        "background color for the job card must not be removed
                        since it highlights everything"). Unframing the PANEL
                        took the fill out from under these too, because they had
                        been inheriting `bg-card` from it -- so the rail went
                        from a row of cards to a row of outlines on the page
                        ground. `bg-card` is stated on the card itself now,
                        which is where it should always have been: it is what
                        makes one role read as one object. */}
                    <article
                      data-feed-role
                      className="flex h-full w-72 flex-col justify-between gap-3 rounded-md border border-border-subtle bg-card p-4"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        {/* THE DAY AND THE BOARD SHARE A ROW, because a
                            posting from a paid board and one from Jobicy are
                            otherwise indistinguishable -- and which site it
                            came from is the first thing a reader needs in
                            order to judge the rest of the card.

                            NOT A PILL AND NOT A COLOUR. This system separates
                            with type and hairlines; a tinted chip per board
                            would introduce four hues that mean nothing next to
                            the five reserved for status. It is the same
                            `label-caps` as the day opposite it, which reads as
                            the pair of facts it is. */}
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-label-caps uppercase text-text-muted">
                            {formatPostedDay(localDayKey(job.publishedAt), today)}
                          </p>
                          <p
                            data-feed-source={job.source}
                            className="shrink-0 text-label-caps uppercase text-text-muted"
                          >
                            {SOURCE_LABELS[job.source]}
                          </p>
                        </div>
                        {/* `rel="noreferrer"` and a new tab: this is somebody
                            else's site, reached from a list somebody else
                            wrote. `line-clamp-2` because a board title runs to
                            "Freelance Product and Brand Designers – Join Our
                            Network" and every card in a rail is one height. */}
                        {/* THE GLYPH IS A SIBLING OF THE CLAMP, not inside it.
                            Inline after the text it was pushed onto a second
                            line whenever the title did not leave room for it on
                            the first -- so a one-line title rendered as a line
                            of words and a line holding one 14px icon. */}
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            ICON_MOTION_GROUP,
                            'flex items-start gap-1.5 text-body-m text-text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default'
                          )}
                        >
                          <span className="line-clamp-2 min-w-0">{job.title}</span>
                          <ExternalIcon
                            size={14}
                            aria-hidden
                            className={cn('mt-1 shrink-0 text-text-muted', iconMotion('forward'))}
                          />
                        </a>
                        <p className="truncate text-body-s text-text-secondary">{job.company}</p>
                        {facts && <p className="truncate text-caption text-text-muted">{facts}</p>}
                      </div>

                      <div className="flex flex-col gap-2">
                        {band && <p className="tabular text-caption text-text-muted">{band}</p>}
                        {/* TRACKED, OR TRACK IT -- one control, two states, and
                            the difference is whether this posting already has a
                            record (Gabe, 2026-09-18).

                            `track it` IS THE URL, NOT THE ROW. `?add=` opens the
                            ordinary add wizard on its first step with the
                            address filled in; the app then reads the employer's
                            own page. Nothing from this feed is written to the
                            database.

                            `tracked` IS THE RECORD. `?application=<id>` is the
                            same parameter /applications already opens its record
                            dialog from, so the link lands on the application
                            overview for this posting rather than on a wizard
                            that would create a second copy of it.

                            IT IS NOT THE ACCENT. Orange is reserved for "the
                            current action", and this one reports a state -- the
                            work is done, and the link is a way back to it. The
                            tick and the muted ink are the same pairing the rest
                            of the app uses for a settled fact. */}
                        {tracked ? (
                          <Link
                            href={appHref(`/applications?application=${tracked}`)}
                            data-feed-tracked
                            className={cn(
                              ICON_MOTION_GROUP,
                              'inline-flex items-center gap-1.5 self-start whitespace-nowrap text-body-s text-text-secondary hover:text-text-primary hover:underline'
                            )}
                          >
                            <CheckIcon size={14} aria-hidden className={iconMotion('none')} />
                            tracked
                          </Link>
                        ) : (
                          <Link
                            href={appHref(`/applications?add=${encodeURIComponent(job.url)}`)}
                            className={cn(
                              ICON_MOTION_GROUP,
                              'inline-flex items-center gap-1.5 self-start whitespace-nowrap text-body-s text-accent-default hover:underline'
                            )}
                          >
                            <PlusIcon size={14} aria-hidden className={iconMotion('open')} />
                            track it
                          </Link>
                        )}
                      </div>
                    </article>
                  </CarouselItem>
                )
              })}
              </CarouselContent>
              <CarouselNext />
            </CarouselRow>
          )}

          {/* ATTRIBUTION, AS THE FEED ASKS FOR IT. Not a footnote this app is
              free to drop: every response repeats the request in a
              `friendlyNotice` field. */}
          <p className="border-t border-border-subtle pt-3 text-caption text-text-muted">
            Remote roles from{' '}
            <a
              href="https://jobicy.com"
              target="_blank"
              rel="noreferrer"
              className="text-accent-default underline-offset-4 hover:underline"
            >
              Jobicy
            </a>
            . Worktrack shows them; it does not store them.
          </p>
        </CardContent>
      </Carousel>
    </Card>
  )
}
