import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DEMO_NAV } from '../nav'
import { DEMO } from '@/lib/demoFixture'

/**
 * A Supabase module that throws on ANY property access.
 *
 * The point is not that these routes happen not to query today -- it is that a
 * stray query added later fails here rather than silently working in dev
 * because the developer happened to be signed in, and then returning nothing
 * for every stranger who opens the demo.
 */
vi.mock('@/lib/supabase', () => {
  const boom = new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(
          `A /demo route reached Supabase (property "${String(prop)}"). The demo renders a ` +
            `fixture and must not query: see src/lib/demoFixture.ts.`
        )
      },
    }
  )
  return { supabase: boom, default: boom }
})

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }),
}))

const pathname = vi.hoisted(() => ({ value: '/demo/overview' }))
// The calendar's two live panels -- holidays and the remote-roles feed -- are
// third-party reads behind react-query. Mocked so this suite neither stands up
// a QueryClient nor depends on somebody else's uptime; the fixture is what
// these tests are about.
vi.mock('@/hooks/useCalendarExtras', () => ({
  useCalendarExtras: () => ({
    calendar: { holidays: [], holidayCountry: null, holidayCountries: [] },
    feed: { jobs: [], loading: false, error: false, industries: [], industry: null },
  }),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // The demo list reads `?application=<id>`, which is how a wide viewport
  // landing on /demo/applications/<id> arrives with its intent intact.
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: '' }),
  redirect: vi.fn(),
}))

import DemoDashboard from '../overview/page'
import DemoApplications from '../applications/page'
import DemoAnalytics from '../analytics/page'
import DemoCalendar from '../planner/page'
import DemoDocuments from '../documents/page'
import DemoLayout from '../layout'

describe('every demo route renders its screen from the fixture', () => {
  it('renders the overview without touching Supabase', () => {
    render(<DemoDashboard />)
    // A company from the fixture, so this is about the data and not just that
    // a component mounted.
    expect(screen.getAllByText(/Northwind Pay/).length).toBeGreaterThan(0)
  })

  it('renders the applications list', () => {
    render(<DemoApplications />)
    expect(screen.getAllByText(/Meridian Labs/).length).toBeGreaterThan(0)
  })

  it('renders analytics with resolved metrics rather than skeletons', () => {
    const { container } = render(<DemoAnalytics />)
    // Nothing is loading, because there is no query to be loading.
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(container.textContent?.length).toBeGreaterThan(0)
  })

  it('renders the calendar', () => {
    const { container } = render(<DemoCalendar />)
    expect(container.textContent?.length).toBeGreaterThan(0)
  })

  it('renders the documents screen from the whole fixture, paged', () => {
    // The list pages at five on desktop (2026-09-13), so the twelfth CV is not
    // on screen and asserting a title from page three would be testing the
    // pager rather than the route. What this is for is that the ROUTE handed
    // the screen the fixture: the count says how many arrived, and the first
    // row proves they are the right ones.
    render(<DemoDocuments />)
    expect(screen.getByText('Software Engineer CV')).toBeInTheDocument()
    expect(screen.getByText(`1–5 of ${DEMO.resumes.length}`)).toBeInTheDocument()
  })
})

describe('the demo shell', () => {
  it('keeps every nav destination inside /demo', () => {
    // A demo visitor clicking "applications" and landing on the real
    // /applications is bounced to /login by the (app) guard, which reads as
    // the demo being broken rather than as a boundary working.
    for (const entry of DEMO_NAV) {
      expect(entry.href, `${entry.label} escapes the demo`).toMatch(/^\/demo\//)
    }
    expect(DEMO_NAV).toHaveLength(5)
  })

  it('keeps every link the SCREENS render inside the demo too', () => {
    // The nav was only half the escape. The demo renders the REAL screens, and
    // their rows link to absolute paths -- /applications/<id>, /planner,
    // /cv?draft=<id>. Unprefixed, a visitor clicking any application row
    // leaves the demo, hits the (app) auth guard and lands on /login, which
    // reads as the demo being broken rather than as a boundary working. This
    // is the assertion that would have caught it.
    const { container } = render(
      <DemoLayout>
        <DemoDashboard />
      </DemoLayout>
    )
    const hrefs = [...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!)
    const internal = hrefs.filter((h) => h.startsWith('/') && h !== '/signup')
    expect(internal.length).toBeGreaterThan(0) // positive companion
    for (const href of internal) {
      expect(href, `${href} leaves the demo`).toMatch(/^\/demo(\/|$)/)
    }
  })

  it('carries the demo notice in both places the shell has room for', () => {
    // Changed 2026-09-06. The notice used to be one band above the content at
    // every width; it is now a band (phone) or card (tablet) below lg, and a
    // block inside the sidebar from lg up -- where the band was spending a
    // full horizontal strip of a wide screen on a sentence already read.
    const { container } = render(
      <DemoLayout>
        <p>demo content</p>
      </DemoLayout>
    )

    const banner = container.querySelector('[data-demo-banner]')
    expect(banner).not.toBeNull()
    expect(banner!.className).toContain('lg:hidden')

    const notice = container.querySelector('[data-demo-sidebar-notice]')
    expect(notice).not.toBeNull()
    const sidebar = container.querySelector('nav[aria-label="Main"]')!
    expect(sidebar.contains(notice)).toBe(true)
    expect(sidebar.className).toContain('lg:flex')

    // BOTH ARE IN THE DOM AND THAT IS FINE. CSS picks one per viewport, and
    // the `display:none` that hides the other takes it out of the
    // accessibility tree too -- so nobody reads or hears the claim twice.
    // jsdom applies no CSS, which is exactly why this asserts the classes
    // above rather than counting what rendered.
    expect(screen.getAllByText(/invented/i)).toHaveLength(2)
    expect(screen.getByText('demo content')).toBeInTheDocument()
  })

  it('offers no settings link, because there is no account to configure', () => {
    const { container } = render(
      <DemoLayout>
        <p>demo content</p>
      </DemoLayout>
    )
    expect(container.querySelector('[data-settings-link]')).toBeNull()
    // Positive companion: the shell really did render its nav, so the absence
    // above is about settings and not about an empty layout.
    const nav = container.querySelector('nav[aria-label="Main"]')
    expect(nav).not.toBeNull()
    expect(within(nav as HTMLElement).getByText('overview')).toBeInTheDocument()
  })
})

describe('the demo shows a populated product, not an empty one', () => {
  // The fixture exists to make the app look like it works. A panel showing
  // "not enough data yet" is the worst possible first impression, so the
  // no-empty-state claim is asserted rather than assumed.
  it('puts every status on the overview', () => {
    render(<DemoDashboard />)
    for (const label of ['wishlist', 'applied', 'interviewing', 'offer', 'rejected']) {
      expect(screen.getAllByText(new RegExp(label, 'i')).length).toBeGreaterThan(0)
    }
  })

  it('renders no EmptyState anywhere on the overview or analytics', () => {
    // Asserted on the component's own [data-empty-state] hook rather than on
    // its prose. The copy ("no applications yet. add one and it shows up
    // here.") is a string a rewrite would change without changing the
    // behaviour, and this test needs to keep failing when a NEW panel is added
    // with no fixture data behind it -- which is exactly when someone needs
    // telling.
    const overview = render(<DemoDashboard />)
    expect(overview.container.querySelectorAll('[data-empty-state]')).toHaveLength(0)
    // Positive companion: the overview really rendered its panels, so the
    // absence above is meaningful rather than a blank page.
    expect(overview.getAllByText(/Northwind Pay/).length).toBeGreaterThan(0)
    overview.unmount()

    const analytics = render(<DemoAnalytics />)
    expect(analytics.container.querySelectorAll('[data-empty-state]')).toHaveLength(0)
    expect(analytics.container.textContent?.length).toBeGreaterThan(100)
  })
})

describe('the demo is honest about being read-only', () => {
  it('hands every write affordance a handler that explains itself', async () => {
    // The screens are the REAL screens and their write controls render
    // unconditionally, so they cannot be made to disappear without changing
    // the app to suit the demo. They therefore say what happened -- silence
    // would be indistinguishable from a broken button.
    const { demoReadOnlyAsync } = await import('../readOnly')
    await expect(demoReadOnlyAsync()).resolves.toBe(false)
  })

  it('ships no row that could be mistaken for a real person', () => {
    const emails = JSON.stringify(DEMO).match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? []
    expect(emails.length).toBeGreaterThan(0)
    for (const email of emails) expect(email).toMatch(/@example\.(com|org)$/)
  })
})
