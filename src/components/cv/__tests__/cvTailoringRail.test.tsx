import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import * as React from 'react'
import { useCvTailoring, TailoringAnalysisRail } from '../CvTailoring'
import { matchKeywords } from '@/services/atsMatch'
import { makeJob } from '@/test/fixtures'

/**
 * The three revisions of 2026-09-17: the score arrives instead of snapping, a
 * tailored CV is not asked where it should go, and the last run survives the
 * document being closed.
 *
 * SEPARATE FROM `cvTailoring.test.tsx` because that file drives the section
 * through the picker -- click the combobox, take an option -- and every case
 * here is about a section that either has no picker or is being watched frame
 * by frame. Its harness cannot start with an application selected, and giving
 * it one would change what its own assertions mean.
 *
 * FAKE TIMERS IN EVERY CASE, INCLUDING THE ONES THAT ARE NOT ABOUT MOTION. The
 * sweep schedules `requestAnimationFrame`, and jsdom runs those on a real 16ms
 * timer -- so under a real clock a frame lands in the middle of an assertion,
 * sets state outside `act`, and a case about localStorage fails on a warning
 * about animation. Frozen, nothing moves until a case asks it to.
 */

/**
 * THE RING IS STUBBED, AND ONLY THE RING.
 *
 * `AtsDonut` reaches this rail through `next/dynamic`, and that import does
 * not resolve while the clock is frozen -- the chunk needs real time to load,
 * so a case that stops the clock to watch the sweep would wait forever for the
 * component it is watching. It is also recharts, which jsdom cannot lay out
 * and which draws its number as an SVG tspan.
 *
 * What the sweep is about is the NUMBERS the rail hands it, not the drawing,
 * so the stub records them and nothing else. The real component's own
 * behaviour -- the arc, the centred label, the sr-only sentence -- is its
 * file's business and is covered where it lives.
 */
vi.mock('@/components/ui/ats-donut', () => ({
  AtsDonut: ({
    score,
    matched,
    missing,
  }: {
    score: number
    matched: number
    missing: number
  }) => <div data-donut data-score={score} data-matched={matched} data-missing={missing} />,
}))

const POSTING =
  'We need React, TypeScript, Postgres, Kubernetes, GraphQL, Docker, Terraform and Redis.'

/** Matches four of the posting's terms and misses four, so a sweep has room to travel. */
const CV = 'React developer who has shipped TypeScript, Postgres and GraphQL.'

const JOBS = [
  makeJob({
    id: 'w1',
    status: 'wishlist',
    company: 'Initech',
    role: 'Frontend Engineer',
    description: POSTING,
  }),
  makeJob({
    id: 'w2',
    status: 'wishlist',
    company: 'Globex',
    role: 'Backend Engineer',
    description: 'We need Go and Postgres experience.',
  }),
  // ALREADY APPLIED, AND THAT IS THE POINT OF IT. `useCvTailoring` narrows the
  // picker's list to the wishlist, so a tailored CV whose posting has moved on
  // -- which is what applying to it means -- is exactly the case where
  // resolving the target out of that narrowed list blanks the whole section.
  makeJob({
    id: 'a1',
    status: 'applied',
    company: 'Hooli',
    role: 'Platform Engineer',
    description: POSTING,
  }),
]

const FINAL = matchKeywords(CV, POSTING)

function Harness({
  cvText = CV,
  initialJobId = '',
  documentId,
  tailoredForJobId,
  fetchImpl,
}: {
  cvText?: string
  initialJobId?: string
  documentId?: string
  tailoredForJobId?: string
  fetchImpl?: typeof fetch
}) {
  // The selection lives in the editor, not in the hook -- see
  // `CvTailoringOptions`. `data-job-id` is that one string made visible, so a
  // case can prove the hook writes THROUGH it rather than keeping a private
  // second copy of the target beside it.
  const [jobId, setJobId] = React.useState(initialJobId)
  const state = useCvTailoring({
    cvText,
    jobs: JOBS,
    jobId,
    onJobId: setJobId,
    documentId,
    tailoredForJobId,
    fetchImpl,
  })
  return (
    <>
      <span data-job-id>{jobId}</span>
      <TailoringAnalysisRail state={state} />
    </>
  )
}

/**
 * Mount, and let the dynamic import commit -- WITHOUT MOVING THE CLOCK.
 *
 * The ring arrives a microtask after the first commit even when it is the stub
 * above. `findBy*` cannot be used for this: it polls on a timer that vitest's
 * fake clock does not advance, so it hangs rather than waiting.
 */
async function mount(ui: React.ReactElement) {
  const utils = render(ui)
  await act(async () => {})
  return utils
}

/** What the rail is currently telling the ring to draw. */
function ringValue(name: 'score' | 'matched' | 'missing'): number {
  const attr = document.querySelector('[data-donut]')?.getAttribute(`data-${name}`)
  return attr === null || attr === undefined ? Number.NaN : Number(attr)
}

const shownScore = () => ringValue('score')

/** How many terms a chip list is printing, read off its own heading count. */
function chipCount(tone: 'matched' | 'missing'): number {
  const block = document.querySelector(`[data-ats-terms="${tone}"]`)
  const heading = /\((\d+)\)/.exec(block?.textContent ?? '')
  return heading ? Number(heading[1]) : 0
}

const originalMatchMedia = window.matchMedia

/** The same motion stub `motion.test.tsx` and `analyzing-document.test.tsx` use. */
function setReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  vi.useFakeTimers()
  setReducedMotion(false)
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.matchMedia = originalMatchMedia
  vi.restoreAllMocks()
  window.localStorage.clear()
})

/** Run the sweep forward. 400ms is `--duration-slow`, its whole length. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** Press the rewrite button and let the request settle. */
async function tailor() {
  fireEvent.click(screen.getByRole('button', { name: /tailor this cv/i }))
  await act(async () => {})
}

describe('the ATS score arrives rather than snapping', () => {
  it('starts at zero and sweeps the ring, the number and both lists to the score', async () => {
    await mount(<Harness initialJobId="w1" />)

    // BEFORE ANY FRAME: a real score is available and the panel draws none of
    // it -- an empty ring at 0%, which is what "sweep from 0 to its value"
    // means at the moment it starts. One chip in each list rather than none,
    // because zero terms is the empty-state sentence (see the case below).
    expect(FINAL.score).toBeGreaterThan(0)
    expect(FINAL.matched.length).toBeGreaterThan(1)
    expect(shownScore()).toBe(0)
    expect(chipCount('matched')).toBe(1)

    advance(200)
    // Travelling: past the start, short of the answer, in every quantity.
    expect(shownScore()).toBeGreaterThan(0)
    expect(shownScore()).toBeLessThan(FINAL.score)
    expect(chipCount('matched')).toBeLessThan(FINAL.matched.length)
    // Mid-flight, and the posting is still its own size: the arc is sweeping
    // rather than the whole chart growing.
    expect(ringValue('matched') + ringValue('missing')).toBe(
      FINAL.matched.length + FINAL.missing.length
    )

    advance(400)
    // Landed, exactly. An animation that arrives NEAR the number would be
    // worse than none, because the number is the product.
    expect(shownScore()).toBe(FINAL.score)
    expect(chipCount('matched')).toBe(FINAL.matched.length)
    expect(chipCount('missing')).toBe(FINAL.missing.length)
    // THE WHOLE DID NOT MOVE WHILE THE ARC SWEPT. The ring is a proportion of
    // the terms in the posting, so matched climbs into a full-size track and
    // missing resolves down to meet it -- the two always sum to the posting.
    // Growing both from zero would hold the ratio constant, which is a ring
    // that fades in rather than one that fills.
    expect(ringValue('matched')).toBe(FINAL.matched.length)
    expect(ringValue('matched') + ringValue('missing')).toBe(
      FINAL.matched.length + FINAL.missing.length
    )
  })

  it('never prints the empty-list sentence on the way to a list that has terms', async () => {
    // `AtsTermChips` says "none of the posting's terms appear in this CV yet"
    // at zero terms. A first frame of nothing would flash that sentence under
    // a ring about to contradict it, and shift the block when it does.
    await mount(<Harness initialJobId="w1" />)
    expect(document.body.textContent).not.toMatch(/none of the posting’s terms/i)
    advance(600)
    expect(document.body.textContent).not.toMatch(/none of the posting’s terms/i)
  })

  it('travels again when the score changes, rather than only on mount', async () => {
    // A re-tailored document stays on this page and has its text replaced
    // under the panel. The score has to move for that, not wait for a remount.
    const { rerender } = await mount(<Harness initialJobId="w1" />)
    advance(600)
    expect(shownScore()).toBe(FINAL.score)

    const better = `${CV} Kubernetes and Docker too.`
    const improved = matchKeywords(better, POSTING)
    expect(improved.score).toBeGreaterThan(FINAL.score)

    rerender(<Harness cvText={better} initialJobId="w1" />)
    // Still the old number on the commit the new one arrived in: it is about
    // to travel there rather than jump.
    expect(shownScore()).toBe(FINAL.score)
    advance(600)
    expect(shownScore()).toBe(improved.score)
  })

  it('lands on the final value with no travel under prefers-reduced-motion', async () => {
    // The preference asks for things to stop moving, not to move briskly --
    // so there is no clock at all, the same way HeroScrollCue drops its
    // animation class rather than pausing it.
    setReducedMotion(true)
    await mount(<Harness initialJobId="w1" />)

    expect(shownScore()).toBe(FINAL.score)
    expect(chipCount('matched')).toBe(FINAL.matched.length)
    expect(chipCount('missing')).toBe(FINAL.missing.length)
  })
})

describe('a tailored CV is not asked where it should go', () => {
  it('shows the company and role it was written for instead of the picker', async () => {
    // Tailoring writes a new file keyed to an application, so this file's
    // target was settled before it existed. A combobox in front of that offers
    // a choice that changes nothing about the document.
    await mount(<Harness tailoredForJobId="a1" />)

    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('Platform Engineer')).toBeTruthy()
    expect(screen.getByText('Hooli')).toBeTruthy()

    // AND IT SCORES WITHOUT BEING TOLD TO. The posting is the one the file was
    // tailored against -- an `applied` application, which the picker's list
    // does not contain -- so a target resolved out of that list would leave
    // the section telling you to pick something it is not offering.
    advance(600)
    expect(shownScore()).toBe(FINAL.score)
    expect(screen.queryByText(/pick an application above/i)).toBeNull()

    // THROUGH THE LIFTED ID, NOT BESIDE IT. `jobId` lives in the editor
    // because the tab strip in another slot reads it; a private copy in the
    // hook would leave that strip badging this tab "needs an application" over
    // a document whose target was decided before it existed.
    expect(document.querySelector('[data-job-id]')?.textContent).toBe('a1')
  })

  it('leaves the picker exactly as it is on a CV that was never tailored', async () => {
    await mount(<Harness />)
    expect(screen.getByRole('combobox', { name: /application/i })).toBeTruthy()
    expect(document.querySelector('[data-tailored-for]')).toBeNull()
  })
})

describe('the last run survives the document being closed', () => {
  const cachedRun = (count: number) =>
    JSON.stringify({
      ok: true,
      summary: null,
      suggestions: Array.from({ length: count }, (_, i) => ({
        section: 'summary',
        before: `line ${i}`,
        after: `better line ${i}`,
        rationale: 'closer to the posting',
      })),
    })

  it('shows the stored analysis for this pair instead of spending another model call', async () => {
    window.localStorage.setItem('worktrack:tailoring:doc-1:w1', cachedRun(2))
    const fetchImpl = vi.fn() as unknown as typeof fetch

    await mount(<Harness documentId="doc-1" initialJobId="w1" fetchImpl={fetchImpl} />)

    expect(screen.getByText(/already tailored for this application/i).textContent).toContain(
      '2 rewrites'
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('restores on a tailored CV, which is the document that has one to restore', async () => {
    // The two halves meeting: the file knows its own application, so reopening
    // it needs no picking and no re-running -- the pair is complete before the
    // first paint. This is the case Gabe described; the ones above are its
    // parts tested separately.
    window.localStorage.setItem('worktrack:tailoring:doc-1:a1', cachedRun(4))
    const fetchImpl = vi.fn() as unknown as typeof fetch

    await mount(<Harness documentId="doc-1" tailoredForJobId="a1" fetchImpl={fetchImpl} />)

    expect(screen.getByText(/already tailored for this application/i).textContent).toContain(
      '4 rewrites'
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never shows one pair’s analysis under another', async () => {
    // The whole correctness argument for this cache: an analysis is about one
    // document against one posting. Shown over either of the other two it is
    // not stale, it is wrong.
    window.localStorage.setItem('worktrack:tailoring:doc-1:w1', cachedRun(3))

    const { unmount } = await mount(<Harness documentId="doc-1" initialJobId="w2" />)
    expect(document.querySelector('[data-tailoring-restored]')).toBeNull()
    unmount()

    await mount(<Harness documentId="doc-2" initialJobId="w1" />)
    expect(document.querySelector('[data-tailoring-restored]')).toBeNull()
  })

  it('writes a successful run, so the next mount reads it back for free', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        summary: null,
        suggestions: [
          {
            section: 'summary',
            before: 'React developer',
            after: 'React engineer',
            rationale: 'closer',
          },
        ],
      }),
    }) as unknown as typeof fetch

    const first = await mount(<Harness documentId="doc-1" initialJobId="w1" fetchImpl={fetchImpl} />)
    await tailor()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    // This session's own run, so it is not announced as a remembered one.
    expect(document.querySelector('[data-tailoring-restored]')).toBeNull()
    first.unmount()

    const second = vi.fn() as unknown as typeof fetch
    await mount(<Harness documentId="doc-1" initialJobId="w1" fetchImpl={second} />)
    expect(screen.getByText(/already tailored for this application/i).textContent).toContain(
      '1 rewrite'
    )
    expect(second).not.toHaveBeenCalled()
  })

  it('remembers nothing for a run that failed', async () => {
    // A rate limit is a fact about a minute ago, not about the document, and
    // re-running after one is exactly what should happen.
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ ok: false, reason: 'rate-limit', message: 'Too many requests.' }),
    }) as unknown as typeof fetch

    await mount(<Harness documentId="doc-1" initialJobId="w1" fetchImpl={fetchImpl} />)
    await tailor()

    expect(screen.getByRole('alert').textContent).toMatch(/too many requests/i)
    expect(window.localStorage.getItem('worktrack:tailoring:doc-1:w1')).toBeNull()
  })

  it('renders when the store throws, and when it holds something else entirely', async () => {
    // Private windows and blocked site data throw on access; a cleared store
    // and a half-written value are the same class of problem. None of them may
    // take the section down with it.
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('the site data for this origin is blocked')
    })
    const { unmount } = await mount(<Harness documentId="doc-1" initialJobId="w1" />)
    advance(600)
    expect(shownScore()).toBe(FINAL.score)
    expect(document.querySelector('[data-tailoring-restored]')).toBeNull()
    unmount()
    blocked.mockRestore()

    window.localStorage.setItem('worktrack:tailoring:doc-1:w1', '{"ok":true,"suggestions":')
    await mount(<Harness documentId="doc-1" initialJobId="w1" />)
    advance(600)
    expect(shownScore()).toBe(FINAL.score)
    expect(document.querySelector('[data-tailoring-restored]')).toBeNull()
  })
})
