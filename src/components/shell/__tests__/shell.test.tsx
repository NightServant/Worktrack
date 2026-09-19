import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { usePathname } from 'next/navigation'
import { AppShell } from '../AppShell'

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }) }))
vi.mock('next/navigation', () => ({ usePathname: vi.fn(() => '/overview') }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, signOut: vi.fn(), signIn: vi.fn(), signUp: vi.fn() }),
}))
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

describe('AppShell', () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue('/overview')
  })

  it('gives the mobile top bar 44px controls in a 64px bar', () => {
    const { container } = render(
      <AppShell>
        <p>body</p>
      </AppShell>
    )
    const bar = container.querySelector('[data-top-bar]')!
    expect(bar.className).toContain('h-16') // 64px
    for (const b of bar.querySelectorAll('button, a')) {
      expect(b.className).toMatch(/h-11/) // 44px
    }
  })

  it('carries theme toggle then settings, in that order', () => {
    const { container } = render(
      <AppShell>
        <p>body</p>
      </AppShell>
    )
    const bar = container.querySelector('[data-top-bar]')!
    const controls = [...bar.querySelectorAll('[data-theme-toggle], [data-settings-link]')]
    expect(controls[0].hasAttribute('data-theme-toggle')).toBe(true)
    expect(controls[1].hasAttribute('data-settings-link')).toBe(true)
  })

  it('renders exactly five bottom-nav destinations, numbered 01-05 on desktop only', () => {
    const { container } = render(
      <AppShell>
        <p>body</p>
      </AppShell>
    )
    const nav = container.querySelector('[data-bottom-nav]')!
    const items = nav.querySelectorAll('[data-nav-item]')
    expect(items).toHaveLength(5)
    // The mobile bar drops the number; five-up at 375px has no room for both.
    expect(nav.querySelector('[data-nav-index]')).toBeNull()
  })

  it('has no active bottom-nav item on settings, which is chrome not a destination', () => {
    vi.mocked(usePathname).mockReturnValue('/settings')
    const { container } = render(
      <AppShell>
        <p>body</p>
      </AppShell>
    )
    const active = container.querySelectorAll('[data-bottom-nav] [data-active]')
    expect(active).toHaveLength(0)
    expect(container.querySelector('[data-settings-link][data-active]')).toBeTruthy()
  })

  it('highlights apps for a child route of applications', () => {
    vi.mocked(usePathname).mockReturnValue('/applications/abc-123')
    const { container } = render(
      <AppShell>
        <p>body</p>
      </AppShell>
    )
    const active = container.querySelectorAll('[data-bottom-nav] [data-active]')
    expect(active).toHaveLength(1)
    expect(active[0].getAttribute('href')).toBe('/applications')
  })
})

/**
 * The tier switch, pinned as classes rather than as behaviour.
 *
 * These are CSS media queries -- jsdom has no layout, so there is no viewport
 * to resize and no computed style to read. What can be asserted is the
 * contract: which element carries which breakpoint. That is exactly the thing
 * that regressed here (three components each naming `md` independently), so a
 * class assertion catches the real failure mode -- one of them being changed
 * and the other two left behind.
 */
describe('the mobile/desktop tier switch', () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue('/overview')
  })

  it('hands tablets the same chrome as phones: sidebar from lg, bars below it', () => {
    // 2026-09-06, Gabe's instruction. Before this the switch was md (768), so a
    // tablet got a 64px icon rail whose labels lived only in tooltips -- a
    // hover affordance on a device with no hover.
    const { container } = render(
      <AppShell>
        <p>body</p>
      </AppShell>
    )

    const sidebar = container.querySelector('nav[aria-label="Main"]')!
    expect(sidebar.className).toContain('hidden')
    expect(sidebar.className).toContain('lg:flex')
    expect(sidebar.className).not.toContain('md:flex')

    const bottom = container.querySelector('[data-bottom-nav]')!
    expect(bottom.className).toContain('lg:hidden')
    expect(bottom.className).not.toContain('md:hidden')

    const top = container.querySelector('[data-top-bar]')!
    expect(top.className).toContain('lg:hidden')
    expect(top.className).not.toContain('md:hidden')
  })

  it('clears the fixed bottom nav for as long as that nav is on screen', () => {
    // The clearance and the nav must drop out at the SAME width. Left at md,
    // a tablet would lose the padding while still carrying the bar, and the
    // last row of every list would sit under it.
    const { container } = render(
      <AppShell>
        <p>body</p>
      </AppShell>
    )
    const main = container.querySelector('main')!
    expect(main.className).toContain('pb-nav')
    expect(main.className).toContain('lg:pb-gutter')
    expect(main.className).not.toContain('md:pb-gutter')
  })

  it('only locks itself to the viewport when a screen asks, and only where it fits', () => {
    // The lock is opt-in through context (see shell/viewportFit) and gated on
    // the `shell-fits` variant, because a locked frame on a short tablet left
    // the applications list 92px -- two rows, measured 2026-09-06, worse than
    // the page scroll it replaced. An unasked shell carries none of it.
    const { container } = render(
      <AppShell>
        <p>body</p>
      </AppShell>
    )
    const frame = container.firstElementChild as HTMLElement
    expect(frame.className).toContain('min-h-screen')
    expect(frame.className).not.toContain('shell-fits:h-dvh')
  })

  it('renders a sidebar notice only when one is given', () => {
    const { container: without } = render(
      <AppShell>
        <p>body</p>
      </AppShell>
    )
    expect(without.querySelector('[data-sidebar-notice]')).toBeNull()

    const { container: with_ } = render(
      <AppShell sidebarNotice={<p>demo notice</p>}>
        <p>body</p>
      </AppShell>
    )
    expect(with_.querySelector('[data-sidebar-notice]')).not.toBeNull()
  })
})

describe('the bottom nav on a phone', () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue('/overview')
  })

  it('hides the labels visually but keeps them as the link names', () => {
    // Gabe, 2026-09-06. Measured at 320px: five items get 62px each while the
    // labels are 51-72px wide, so "applications" overflowed its cell by 10px
    // and the bar read as one run of touching words.
    //
    // `sr-only`, NOT `hidden`. The label is the link's accessible name, and
    // removing it would leave five destinations announced only by an
    // `aria-hidden` glyph. Verified in the browser: at 375 the labels compute
    // to 1x1 with `clip-path: inset(50%)`; at 640 and 780 they are 52-72px
    // wide inside 126px and 154px items.
    const { container } = render(
      <AppShell>
        <p>body</p>
      </AppShell>
    )
    const nav = container.querySelector('[data-bottom-nav]')!
    const labels = [...nav.querySelectorAll('span')].filter((s) =>
      // `planner` was `calendar` until 2026-09-11; the route is still
      // /planner, only the label moved. See the note on NAV.
      /^(overview|applications|planner|documents|analytics)$/.test(s.textContent ?? '')
    )
    expect(labels).toHaveLength(5)
    for (const label of labels) {
      expect(label.className, 'the label must survive as the accessible name').toContain(
        'max-sm:sr-only'
      )
      expect(label.className, 'display:none would take the name with it').not.toMatch(
        /(^|\s)hidden(\s|$)/
      )
    }
    // Positive companion: the links really do still carry those names.
    expect(nav.querySelector('a[aria-current="page"]')?.textContent).toContain('overview')
  })
})
