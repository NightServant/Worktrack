'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { NavItem } from '@/components/ui/nav-item'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { BrandLockup, BrandMark } from '@/components/ui/brand-mark'
import { SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/shadcn-sidebar'
import { activeNavHref, isUnder } from '@/lib/activeNav'
import type { IconName } from '@/components/icons'

/**
 * Logo, nav, divider, settings, spacer, theme toggle, footer -- in that
 * order. Read from Figma node 19:11 (M5.5 Task 3, 2026-08-29).
 *
 * The order matches Figma and is load-bearing rather than incidental. Settings
 * sits below the divider because it is chrome, not a destination alongside the
 * five sections. The spacer sits between settings and the theme control (19:11:
 * Nav 87-283, Divider 315, Settings 348, Spacer 416/h122, Theme Toggle 570,
 * Footer 634-688) and is what pins the toggle and the footer to the bottom on
 * a tall viewport; without it they float directly under Settings and the
 * sidebar reads as unfinished at 1440px.
 *
 * `NAV` labels are full lowercase words (`overview`, `applications`, ...),
 * read directly off node 19:20-19:36 -- not the title-cased M5 originals and
 * not the roadmap's abbreviated `apps`/`docs`/`stats` wording, which the
 * Figma frame disagrees with.
 */
// `/planner` IS LABELLED `planner` (Gabe, 2026-09-11: "rename the page
// properly"). The path does not move -- the Overview's "open the calendar"
// link, the follow-up nudge and every bookmark point at it -- but the word
// does. "Calendar" named a month grid; the screen now opens with roles posted
// in the last few days, carries public holidays, and closes with what is
// booked. A calendar is a thing you look at. This is a thing you act on.
export const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/overview', label: 'overview', icon: 'Overview' },
  { href: '/applications', label: 'applications', icon: 'Applications' },
  { href: '/planner', label: 'planner', icon: 'Calendar' },
  { href: '/documents', label: 'documents', icon: 'Documents' },
  { href: '/analytics', label: 'analytics', icon: 'Analytics' },
]

/**
 * Text, not icon -- `LogOut` is one of the four glyphs the icon set
 * deliberately eliminated (see the M5 icon-gap task). Disabled while the
 * sign-out promise is in flight so a slow network can't be clicked twice.
 *
 * A failed sign-out is not silent: it's logged and surfaced as a toast, the
 * same handling the deleted Layout.tsx had, so a network blip doesn't leave
 * someone still signed in with no idea why the click did nothing.
 *
 * There is no sign-out control here. Gabe removed the duplicate one in
 * eb9d784 -- sign-out lives in Settings, and that matches the Figma sidebar
 * (19:11), which has none either.
 */

/** One destination in the primary nav. */
export type NavEntry = { href: string; label: string; icon: IconName }

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  pathname?: string
  /**
   * The destinations to render. Defaults to the app's own NAV.
   *
   * Overridden by /demo/*, whose links must point inside /demo -- a demo
   * visitor clicking "applications" and landing on the real /applications is
   * bounced to /login, which reads as the demo being broken.
   */
  nav?: NavEntry[]
  /**
   * Where the settings row points, or null to omit it entirely. The demo has
   * no settings screen, and a row that navigates nowhere is worse than none.
   */
  settingsHref?: string | null
  /**
   * Which NAV destination is active, precomputed by activeNavHref.
   *
   * AppShell passes this explicitly so the desktop sidebar and the mobile
   * bottom nav read off the exact same value rather than each deriving it
   * from `pathname` on their own -- that duplication is what let a detail
   * route (e.g. /applications/abc) highlight the bottom nav and nothing in
   * the sidebar. Left undefined, Sidebar derives it the same way, so it stays
   * self-sufficient for standalone use (tests, the dev gallery).
   */
  activeHref?: string | null
  /**
   * An optional block rendered where settings sits, below the nav divider.
   * /demo/* puts its "this is a demo" notice here so a wide screen does not
   * spend a full horizontal band on a message the visitor has already read --
   * see AppShell's `sidebarNotice`. Only drawn while the nav is expanded: the
   * 64px rail has no room for a sentence, and a truncated warning is worse
   * than none.
   */
  notice?: React.ReactNode
}

/**
 * Every rail row -- the mark, the trigger, each nav icon, settings, the
 * theme toggle -- sits in one of these: a fixed 36px square (matching
 * NavItem's own w-9 rail box) that centres its single child. Rows built from
 * their own natural content width (an icon here, a button there) centre at
 * different points once the row itself is centred, because the OUTER boxes
 * differ in width even though `items-center` centres each one correctly --
 * the mismatch is between boxes, not within them. Giving every row the same
 * outer box removes the variable entirely: centring identical boxes always
 * lines their centres up on one axis.
 */
function RailSlot({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center', className)}>
      {children}
    </div>
  )
}

/**
 * Icon + a light/dark label, reflecting the live theme.
 *
 * Not in Figma: node 152:2442 / its main component 109:2402 is a bare
 * hairline 32px square with only the sun/moon icon inside -- no text node
 * anywhere in it. Gabe asked for an indicator so the icon is not an orphaned
 * glyph with no visible label, the way settings and every nav item have one.
 * Lowercase because it is chrome copy, not an acronym.
 *
 * Guards the same server/client mismatch ThemeToggle itself guards against:
 * the server cannot know the stored theme, so the first client render must
 * match the server's (empty label) rather than guessing and then swapping.
 */
function ThemeSection({ collapsed }: { collapsed: boolean }) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const label = mounted ? (resolvedTheme === 'dark' ? 'dark' : 'light') : ''

  if (collapsed) {
    return (
      <RailSlot>
        <ThemeToggle />
      </RailSlot>
    )
  }

  return (
    // Mirrors NavItem's expanded row exactly -- a 2px lead-in the width of the
    // active rule, then gap-3, then the icon -- so the sun/moon lands on the
    // same x as every nav icon. The toggle's own hit target is 32px against a
    // 20px icon column, so `-mx-1.5` lets the button overflow its slot: the
    // icon centres on the column while the target and its hover fill stay 32.
    <div className="flex h-9 items-center gap-3">
      <span aria-hidden className="h-full w-[2px] shrink-0" />
      <ThemeToggle className="-mx-1.5" />
      <span data-theme-label className="text-body-m text-text-secondary">
        {label}
      </span>
    </div>
  )
}

/**
 * The collapse control is NOT in the Figma sidebar (19:11) -- it has no
 * collapse affordance at either breakpoint. Gabe asked for one; this is
 * shadcn's SidebarTrigger/SidebarProvider, added deliberately on top of the
 * Figma layout rather than restoring anything the frame specifies.
 *
 * Collapsing turns the nav into an icon rail (shadcn's `collapsible="icon"`
 * idea, reimplemented directly rather than through shadcn's own Sidebar
 * container -- see the file-level note above `Sidebar` for why): every
 * destination stays mounted and clickable, only the index numbers and the
 * visible labels drop out, and a right-side tooltip carries the label for a
 * sighted user. The first pass hid the whole nav below the header on
 * collapse, which stranded every destination and left a blank column --
 * exactly the state a "collapse" control must not produce.
 */
function SidebarNav({
  pathname = '/overview',
  activeHref,
  nav = NAV,
  settingsHref = '/settings',
  notice,
  className,
  ...props
}: SidebarProps) {
  const { open } = useSidebar()
  const collapsed = !open
  const active =
    activeHref !== undefined ? activeHref : activeNavHref(pathname, nav.map((n) => n.href))
  const settingsActive = settingsHref ? isUnder(pathname, settingsHref) : false

  return (
    <nav
      aria-label="Main"
      data-state={open ? 'expanded' : 'collapsed'}
      className={cn(
        // AppShell's row is only min-h-screen, and its OTHER flex item is
        // the scrollable main -- on a page taller than one viewport
        // (/analytics, the kanban on /applications) the row's own resolved
        // height is the CONTENT height, not the viewport, and a stretched
        // sidebar stretches to match: 2000px+ tall, with the theme control
        // and footer a thousand pixels below the fold. Sizing to the
        // viewport directly (h-screen, h-dvh where supported, for mobile
        // browser chrome) and pinning with sticky decouples the nav from
        // the row's height entirely, on every page regardless of length.
        // shrink-0 keeps a wide main from squeezing it; overflow-y-auto is
        // the fallback for a viewport shorter than the nav's own content.
        'sticky top-0 flex h-screen shrink-0 flex-col gap-8 overflow-y-auto border-r border-border-subtle bg-bg-canvas py-8 transition-[width,padding] duration-(--duration-base) supports-[height:100dvh]:h-dvh',
        // The expanded state's pl-6 must not carry into the collapsed rail:
        // that 24px offset is what let the mark sit flush left while
        // centred rows (via items-center below) landed elsewhere. Collapsed
        // padding is symmetric instead, so RailSlot's fixed 36px boxes are
        // the only thing that decides where the glyphs line up.
        open ? 'w-60 items-stretch pl-6 pr-4' : 'w-16 items-center px-2',
        className
      )}
      {...props}
    >
      <div className={cn('flex items-center gap-2', open ? 'justify-between' : 'flex-col')}>
        {open ? (
          <div data-sidebar-logo>
            <BrandLockup />
          </div>
        ) : (
          <RailSlot>
            <div data-sidebar-logo>
              <BrandMark />
            </div>
          </RailSlot>
        )}
        {open ? <SidebarTrigger /> : <RailSlot><SidebarTrigger /></RailSlot>}
      </div>

      <div className={cn('flex flex-col gap-1', collapsed && 'items-center')}>
        {nav.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            active={active === item.href}
            collapsed={collapsed}
          />
        ))}
      </div>

      <hr data-sidebar-divider className="w-full border-border-subtle" />

      {settingsHref && (
        <NavItem
          href={settingsHref}
          label="settings"
          icon="Settings"
          active={settingsActive}
          collapsed={collapsed}
        />
      )}

      {notice && open && <div data-sidebar-notice>{notice}</div>}

      {/* Figma 19:11: the flexible Spacer (416, h122 in the 720-tall frame)
          sits between Settings and the Theme Toggle -- not after it. It
          absorbs all surplus column height so the theme control and footer
          note pin to the bottom at any viewport height, provided the column
          above it (this <nav>, and SidebarProvider's wrapper around it) is
          actually stretched to the real container height rather than sized
          to its own content -- see the comment on <Sidebar> below. */}
      <div data-sidebar-spacer className="flex-1" />

      {/* The same divider-and-section rhythm settings gets below the nav
          group, so the theme control reads as its own section rather than an
          orphaned icon floating above the footer. */}
      <hr className="w-full border-border-subtle" />

      <ThemeSection collapsed={collapsed} />

      {open && (
        <p data-sidebar-footer className="text-caption leading-[1.5] text-text-muted">
          stay focused.
          <br />
          your next opportunity is
          <br />
          closer than you think.
        </p>
      )}
    </nav>
  )
}

/**
 * Expanded from 1024, an icon rail below it -- and still manually togglable.
 *
 * SINCE 2026-09-06 THE RAIL TIER IS EFFECTIVELY MANUAL-ONLY. AppShell now
 * hides the sidebar entirely below lg (1024) and gives a tablet the Top Bar
 * and Bottom Nav a phone gets, so the 768-1023 band this query was written
 * for no longer renders a sidebar at all. The query is kept rather than
 * deleted because it still sets the correct default the moment the sidebar
 * appears, and because Sidebar is rendered standalone by tests and the dev
 * gallery, where no AppShell is deciding visibility.
 *
 * The listener re-reads the query only when the viewport CROSSES 1024, not on
 * every render, which is the whole point: someone who collapses the nav on a
 * 1440px monitor keeps it collapsed, and someone who expands the rail on a
 * tablet keeps it expanded. Only crossing the line resets it, because crossing
 * the line is the only event that means the previous answer was for a
 * different screen.
 *
 * `useState(true)` then correcting in the effect, rather than reading
 * matchMedia during render: this component server-renders on /demo, and a
 * first client render that disagreed with the server's markup is a hydration
 * mismatch. The correction lands in the same frame as mount and the nav
 * already animates `width`, so a tablet sees the rail arrive rather than a
 * jump. It matches how `useIsMobile` in this tree already behaves.
 */
const EXPANDED_FROM = '(min-width: 1024px)'

function useTierSidebarState() {
  const [open, setOpen] = React.useState(true)

  React.useEffect(() => {
    const mql = window.matchMedia(EXPANDED_FROM)
    const apply = () => setOpen(mql.matches)
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [])

  return [open, setOpen] as const
}

export function Sidebar(props: SidebarProps) {
  const [open, setOpen] = useTierSidebarState()

  return (
    // shadcn's SidebarProvider wrapper defaults to `min-h-svh w-full`, meant
    // for wrapping the whole app shell rather than just the nav mounted here
    // (per M5.5 Task 3's "AppShell mounts SidebarProvider around the desktop
    // tree only" -- TopBar/BottomNav handle mobile, so the nav IS the
    // desktop tree). `min-h-0` cancels the forced minimum height; `w-fit`
    // keeps the wrapper's own width to <nav>'s w-60/w-16 rather than
    // AppShell row's full width; `shrink-0` matches <nav>'s own shrink-0 so
    // a wide main cannot squeeze either.
    //
    // Earlier passes tried to make <nav> STRETCH to fill this wrapper (first
    // `h-full`, a percentage height that needs a *definite*-height ancestor,
    // which AppShell's `min-h-screen` row does not reliably give; then
    // relying on default flex `align-items: stretch` instead, which does
    // resolve, but stretches <nav> to the ROW's height -- and the row's
    // height is its content height, which on /analytics or the /applications
    // kanban is well over one viewport). Both put the nav's height at the
    // mercy of its sibling (the scrollable main). <nav> now sizes itself
    // directly off the viewport (h-screen/h-dvh, `sticky top-0`) instead, so
    // this wrapper no longer needs to pass a height through at all --
    // verified live: with a short main, dashboard-height nav; with a 3000px
    // main (the /analytics-length case), nav still measures exactly one
    // viewport tall, sticky-pinned, footer inside the fold both times.
    <SidebarProvider open={open} onOpenChange={setOpen} className="min-h-0 w-fit shrink-0">
      <SidebarNav {...props} />
    </SidebarProvider>
  )
}
