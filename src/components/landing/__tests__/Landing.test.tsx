import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Landing } from '../Landing'
import { SCREENS } from '../screens'
import { FAQ, HERO, CLOSING_CTA, NAV_LINKS, RAIL_SECTIONS } from '../content'

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }),
}))

const reduced = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => reduced.value,
}))

beforeEach(() => {
  reduced.value = false
})

function renderLanding() {
  return render(<Landing screens={SCREENS} heroPosterSrc="/hero-poster.png" />)
}

describe('the landing page structure', () => {
  it('renders all six sections in the order Gabe specified', () => {
    // ORDER, not merely presence. A page that renders the FAQ above the
    // problem statement passes a presence check and fails the reader: the
    // whole argument is "here is your problem, here is what it costs, here is
    // the thing that fixes it, here is proof, here is how to try it".
    const { container } = renderLanding()
    const sections = Array.from(container.querySelectorAll('[data-landing-section]')).map(
      (el) => el.getAttribute('data-landing-section')
    )
    expect(sections).toEqual([
      'hero',
      'social-proof',
      'problem',
      'solution',
      'faq',
      'cta',
    ])
  })

  it('gives every in-page nav anchor a real target to jump to', () => {
    // An anchor pointing at an id nothing carries is a link that silently does
    // nothing. Driven from NAV_LINKS rather than hard-coded, because the
    // hard-coded version passed for a year while FIVE OF THE SIX RAIL DOTS
    // pointed at ids nothing carried -- it only ever checked the two links it
    // happened to name.
    const { container } = renderLanding()
    const internal = NAV_LINKS.filter((l) => !l.external)
    expect(internal.length).toBeGreaterThan(0)
    for (const link of internal) {
      expect(
        container.querySelector(link.href),
        `nav link "${link.label}" points at ${link.href}, which nothing carries`
      ).not.toBeNull()
    }
  })

  it('gives every rail dot a real target too', () => {
    // The reported bug, as a test. The rail linked to #hero, #social-proof,
    // #problem, #solution and #cta; only the FAQ carried a matching id, so
    // five of six dots did nothing when clicked.
    const { container } = renderLanding()
    expect(RAIL_SECTIONS.length).toBe(6)
    for (const section of RAIL_SECTIONS) {
      expect(
        container.querySelector(`#${section.id}`),
        `rail dot "${section.label}" points at #${section.id}, which nothing carries`
      ).not.toBeNull()
    }
  })

  it('keeps the rail id and the tracking attribute in one vocabulary', () => {
    // The click resolves through data-landing-section and the highlight is
    // computed from it. If a section's id and its data attribute drifted
    // apart, the dot you click and the dot that lights up would be different
    // sections -- the M5 sidebar/bottom-nav disagreement, again.
    const { container } = renderLanding()
    for (const section of RAIL_SECTIONS) {
      const byId = container.querySelector(`#${section.id}`)
      const byData = container.querySelector(`[data-landing-section="${section.id}"]`)
      expect(byData, `no section tracks as ${section.id}`).not.toBeNull()
      expect(byId).toBe(byData)
    }
  })
})

describe('the footer', () => {
  it('states a copyright year, and computes it rather than storing one', () => {
    // A typed year is wrong from the first of January and stays wrong until
    // somebody notices -- the most common way a portfolio page announces that
    // nobody has looked at it lately. Asserted against the CURRENT year, so a
    // literal that happens to be right today fails next January.
    renderLanding()
    const year = new Date().getFullYear()
    expect(screen.getByText(new RegExp(`©\\s*${year}\\s+Worktrack`))).toBeTruthy()
  })
})

describe('the screen carousel', () => {
  it('ships both theme captures for every screen, and hides one with CSS', () => {
    // A landing page that follows the reader's theme and then shows five dark
    // screenshots on a white page is worse than one that never adapted: the
    // mismatch reads as stock imagery borrowed from somewhere else.
    //
    // Asserted as BOTH images present with a `dark:` class, not as one `src`
    // being correct, because the tempting alternative -- reading
    // resolvedTheme and choosing a single src -- flashes the wrong capture at
    // every dark-theme visitor before it mounts.
    const { container } = renderLanding()
    const carousel = container.querySelector('[data-landing-section="solution"]')!
    const imgs = [...carousel.querySelectorAll('img')]

    expect(imgs.length).toBe(SCREENS.length * 2)

    const light = imgs.filter((i) => i.className.includes('dark:hidden'))
    const dark = imgs.filter((i) => i.className.includes('dark:block'))
    expect(light).toHaveLength(SCREENS.length)
    expect(dark).toHaveLength(SCREENS.length)

    for (const img of light) expect(img.getAttribute('src')).toContain('/screens/light/')
    for (const img of dark) expect(img.getAttribute('src')).toContain('/screens/dark/')
  })

  it('names the screen once, so a reader does not hear it twice', () => {
    // Both captures are the same picture. The light one carries the alt text
    // and the dark one is aria-hidden -- otherwise every screen is announced
    // twice, once for a copy that is not even displayed.
    const { container } = renderLanding()
    const carousel = container.querySelector('[data-landing-section="solution"]')!
    const described = [...carousel.querySelectorAll('img')].filter(
      (i) => (i.getAttribute('alt') ?? '') !== ''
    )
    expect(described).toHaveLength(SCREENS.length)
    for (const img of described) expect(img.getAttribute('aria-hidden')).toBeNull()
  })
})

describe('the hero', () => {
  it('carries exactly one call to action, and it goes to the source', () => {
    // Gabe removed the demo and create-account buttons on 2026-09-02. Asserted
    // as a COUNT, not just as the presence of the survivor: "we deliberately
    // took two buttons out" is a claim that rots the moment someone helpfully
    // adds a demo button back, and presence alone would not notice.
    const { container } = renderLanding()
    const hero = container.querySelector(
      '[data-landing-section="hero"]'
    ) as HTMLElement
    const ctas = within(hero).getAllByRole('link')
    expect(ctas).toHaveLength(1)
    expect(ctas[0]).toHaveAttribute('href', HERO.sourceCta.href)
    expect(ctas[0]).toHaveTextContent(HERO.sourceCta.label)
    // PRIMARY, not the hairline treatment it had while it was the third of
    // three buttons. With nothing to be secondary to, a lone outlined button
    // reads as one somebody forgot to finish.
    expect(ctas[0]).toHaveAttribute('data-variant', 'primary')
  })

  it('leaves the demo and the signup reachable elsewhere on the page', () => {
    // The point of removing these from the hero -- and later from the navbar
    // -- was to stop them competing with the closing CTA, not to make either
    // route unreachable. With the bar now carrying no auth at all, this is the
    // test that would catch the removals having gone one step too far.
    //
    // `sign in` used to be satisfied by the footer. It is satisfied by the
    // closing CTA since 2026-09-03, and `getByRole` (singular) is doing real
    // work in that move: it throws on TWO matches as well as on none, so it
    // also asserts the link was MOVED rather than duplicated.
    renderLanding()
    expect(
      screen.getByRole('link', { name: CLOSING_CTA.secondary.label })
    ).toHaveAttribute('href', '/signup')
    expect(
      screen.getByRole('link', { name: CLOSING_CTA.tertiary.label })
    ).toHaveAttribute('href', '/login')
    expect(screen.getAllByRole('link', { name: /demo/i }).length).toBeGreaterThan(0)
  })

  it('is the one display-size heading on the page', () => {
    renderLanding()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent(HERO.headline)
  })
})

describe('social proof, which must stay true', () => {
  // This project has one author and no users. The section that most tempts a
  // builder into inventing traction is the one with the hardest guard on it.
  function proofSection() {
    const { container } = renderLanding()
    const section = container.querySelector('[data-landing-section="social-proof"]')
    expect(section).not.toBeNull()
    return section as HTMLElement
  }

  it('shows four tiles that a visitor can actually verify', () => {
    // Positive companion to the two guards below: without it they would both
    // hold for a section that rendered nothing at all.
    const section = proofSection()
    expect(within(section).getAllByRole('link').length).toBe(4)
  })

  it('contains no testimonial: no avatar and no quoted text', () => {
    // Fails the moment someone adds a testimonial, which is the point.
    const section = proofSection()
    expect(section.querySelector('img')).toBeNull()
    expect(section.querySelector('blockquote')).toBeNull()
    expect(section.textContent ?? '').not.toMatch(/["“”]/)
  })

  it('presents the claims as a description list, not as cards or an accordion', () => {
    // Gabe ruled out both on 2026-09-03. Asserted on the RENDERED OUTPUT
    // rather than on the imports, so a hand-rolled bordered box or a
    // hand-rolled disclosure fails it just as a re-imported Card would.
    const section = proofSection()

    // The shape that replaced them: one <dl>, four term/definition pairs.
    const list = section.querySelector('dl')
    expect(list).not.toBeNull()
    expect(list!.querySelectorAll('dt')).toHaveLength(4)
    expect(list!.querySelectorAll('dd')).toHaveLength(4)

    // No accordion: nothing here toggles, so nothing carries the state a
    // disclosure has to expose.
    expect(section.querySelector('[aria-expanded]')).toBeNull()
    expect(section.querySelector('details')).toBeNull()

    // No cards: the entries are separated by rules, so no entry is a box.
    // A Card draws a border on all four sides; a row draws one below.
    for (const entry of section.querySelectorAll('[data-proof-entry]')) {
      const cls = entry.className
      expect(cls, 'a proof entry is boxed like a card').not.toMatch(
        /\bborder\b(?!-)|\brounded-/
      )
      expect(cls).toContain('border-b')
    }
  })

  it('gives every claim the full measure rather than a quarter of it', () => {
    // The reason the section looked empty was the four-across grid: each
    // claim got ~290px, so each body had to be one short line. This asserts
    // the entries stack instead of sitting side by side -- the change that
    // fills the height.
    const section = proofSection()
    const list = section.querySelector('dl')!
    expect(list.className).not.toMatch(/grid-cols-|sm:grid-cols-|lg:grid-cols-/)
  })

  it('quotes no figure that could go stale', () => {
    // The locked decision chose the qualitative claim over a generated test
    // count. A "931 tests" line that says 931 forever is the same lie as a
    // fabricated testimonial, only slower.
    const section = proofSection()
    expect(section.textContent ?? '').not.toMatch(/\d/)
  })
})

describe('the FAQ', () => {
  it('asks exactly five questions', () => {
    // Five is a requirement, so it is a test. A sixth means one of the five
    // was not worth asking.
    renderLanding()
    expect(FAQ.entries).toHaveLength(5)
    const triggers = screen.getAllByRole('button', { name: /\?$/ })
    expect(triggers).toHaveLength(5)
  })

  it('opens an answer and closes the previous one', async () => {
    // type="single" collapsible. Asserted by behaviour rather than by reading
    // the prop off the component, which would pass whatever it rendered.
    renderLanding()
    const [first, second] = screen.getAllByRole('button', { name: /\?$/ })

    await userEvent.click(first)
    expect(await screen.findByText(FAQ.entries[0].answer)).toBeVisible()

    await userEvent.click(second)
    expect(await screen.findByText(FAQ.entries[1].answer)).toBeVisible()
    expect(screen.queryByText(FAQ.entries[0].answer)).toBeNull()
  })
})

describe('the closing call to action', () => {
  it('offers the demo and the signup, and says what the demo is', () => {
    // Scoped to the section rather than queried page-wide. The navbar no
    // longer carries a demo button (removed 2026-09-02), so this label is
    // currently unique -- but the hero's "try the live demo" points at the
    // same route, and scoping keeps the assertion about THIS section's link
    // rather than about whichever one the query happens to find first.
    const { container } = renderLanding()
    const section = container.querySelector(
      '[data-landing-section="cta"]'
    ) as HTMLElement
    expect(section).not.toBeNull()

    expect(
      within(section).getByRole('link', { name: CLOSING_CTA.primary.label })
    ).toHaveAttribute('href', '/demo/overview')
    expect(
      within(section).getByRole('link', { name: CLOSING_CTA.secondary.label })
    ).toHaveAttribute('href', '/signup')
    expect(within(section).getByText(CLOSING_CTA.demoNote)).toBeInTheDocument()
  })

  it('carries sign-in as its third route, since the footer no longer does', () => {
    // Gabe, 2026-09-03. Scoped to the section for the same reason as above,
    // and asserted by href rather than by label alone -- "sign in" is a phrase
    // that could plausibly appear as prose.
    const { container } = renderLanding()
    const section = container.querySelector(
      '[data-landing-section="cta"]'
    ) as HTMLElement
    expect(
      within(section).getByRole('link', { name: CLOSING_CTA.tertiary.label })
    ).toHaveAttribute('href', '/login')
  })

  it('keeps all three routes together in one row', () => {
    // ASSERTED STRUCTURALLY rather than by classname, so it describes the
    // grouping and not my spelling of it.
    //
    // This was two rows when it was written -- the two ways in for a new
    // visitor above, the way back for a returning one below -- and Gabe
    // flattened it to one on 2026-09-04 (`0038a8b`), which turned the test
    // red. Updated to what he shipped rather than reverted: the layout is his
    // call, and a guard that argues with the code is worse than no guard.
    //
    // What it still catches is a route going missing or drifting out of the
    // group, which is the part nobody chose.
    const { container } = renderLanding()
    const section = container.querySelector(
      '[data-landing-section="cta"]'
    ) as HTMLElement

    const primary = within(section).getByRole('link', { name: CLOSING_CTA.primary.label })
    const secondary = within(section).getByRole('link', { name: CLOSING_CTA.secondary.label })
    const tertiary = within(section).getByRole('link', { name: CLOSING_CTA.tertiary.label })

    const row = primary.parentElement as HTMLElement
    expect(secondary.parentElement).toBe(row)
    expect(tertiary.parentElement).toBe(row)
    expect(row.childElementCount).toBe(3)
  })

  it('keeps exactly one filled button among the three', () => {
    // The section asks for ONE thing first. Two filled buttons is the same as
    // none, and "open the demo" is the one that should win -- it is the only
    // route that costs the visitor nothing.
    //
    // The other two are both `secondary`. Ghost was tried for the third and
    // rejected: with no fill and no border, alone on its row, it rendered as a
    // text link rather than a button. See the note in ClosingCta.tsx.
    const { container } = renderLanding()
    const section = container.querySelector(
      '[data-landing-section="cta"]'
    ) as HTMLElement
    const variants = Array.from(section.querySelectorAll('a[data-variant]')).map((el) =>
      el.getAttribute('data-variant')
    )
    expect(variants).toEqual(['primary', 'secondary', 'secondary'])
    expect(variants.filter((v) => v === 'primary')).toHaveLength(1)
  })
})

describe('the section rail', () => {
  it('offers a jump to every section on the page, in the same order', () => {
    // The rail's ids ARE the sections' data-landing-section values and the
    // nav's anchors -- one vocabulary. A rail pointing at an id nothing
    // carries is a link that silently does nothing.
    const { container } = renderLanding()
    const rail = container.querySelector('[data-section-rail]') as HTMLElement
    expect(rail).not.toBeNull()

    const railIds = [...rail.querySelectorAll('[data-rail-item]')].map((el) =>
      el.getAttribute('data-rail-item')
    )
    const sectionIds = [...container.querySelectorAll('[data-landing-section]')].map((el) =>
      el.getAttribute('data-landing-section')
    )
    expect(railIds).toEqual(sectionIds)
  })
})

describe('the landing page under prefers-reduced-motion', () => {
  it('still renders every section, in flow', () => {
    // The path that rots, because nobody with motion enabled ever sees it.
    reduced.value = true
    const { container } = renderLanding()
    const sections = Array.from(container.querySelectorAll('[data-landing-section]'))
    expect(sections).toHaveLength(6)
    // Positive companion: the carousel is still there and still reachable,
    // it is simply conventional rather than scroll-driven.
    expect(screen.getByTestId('screen-carousel')).toBeInTheDocument()
  })

  it('leaves the carousel touchable, because nothing is driving it', () => {
    reduced.value = true
    renderLanding()
    expect(screen.getByTestId('screen-carousel')).toHaveAttribute(
      'data-scroll-driven',
      'false'
    )
  })
})
