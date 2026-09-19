import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ICON_MOTION,
  ICON_MOTION_GROUP,
  ICON_PRESS,
  ICON_STATE_MOTION,
  iconMotion,
  type IconMotion,
} from '../motion'
import { NavItem } from '@/components/ui/nav-item'
import { StatusMarker } from '@/components/ui/status-marker'

afterEach(() => cleanup())

const CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
const VARIANTS = Object.keys(ICON_MOTION) as IconMotion[]

/** The variant-specific class in a variant's string, if it has one. */
function variantClass(variant: IconMotion): string | undefined {
  return ICON_MOTION[variant].split(/\s+/).find((c) => c.startsWith('icon-motion-'))
}

interface Rule {
  selector: string
  body: string
  /** The condition of the at-rule this sits inside, or '' at the top level. */
  media: string
}

/**
 * A brace-aware scan of index.css.
 *
 * The first version of this was one regex over `([^{}]+)\{([^{}]*)\}`, which
 * is wrong the moment a rule is nested -- it read the closing half of a media
 * query as a selector and the reduced-motion overrides as top-level rules, so
 * three assertions here were quietly checking the wrong declarations. A
 * stylesheet has nested braces; a parser for one has to count them.
 */
function parseRules(source: string): Rule[] {
  // Comments FIRST. Without this every rule preceded by a comment block --
  // which in this stylesheet is most of them -- carries the whole comment in
  // its selector, so an exact-match lookup like `.icon-motion` silently finds
  // nothing and the assertion built on it passes by checking undefined.
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  const stack: string[] = []
  let buffer = ''
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]
    if (ch === '{') {
      const prelude = buffer.trim()
      buffer = ''
      if (prelude.startsWith('@')) {
        stack.push(prelude)
      } else {
        // A plain rule: take its body verbatim up to the matching brace.
        let depth = 1
        let body = ''
        while (++i < css.length && depth > 0) {
          if (css[i] === '{') depth += 1
          else if (css[i] === '}') {
            depth -= 1
            if (depth === 0) break
          }
          body += css[i]
        }
        rules.push({
          selector: prelude,
          body: body.trim(),
          media: stack.filter((a) => a.startsWith('@media')).join(' ').replace('@media', '').trim(),
        })
      }
    } else if (ch === '}') {
      stack.pop()
      buffer = ''
    } else {
      buffer += ch
    }
  }
  return rules
}

const RULES = parseRules(CSS)

/** Rules mentioning `.cls` in their selector, outside any media query. */
function rulesFor(cls: string): Rule[] {
  return RULES.filter((r) => r.media === '' && r.selector.includes(`.${cls}`))
}

/** Rules mentioning `.cls` inside the reduced-motion query. */
function reducedRulesFor(cls: string): Rule[] {
  return RULES.filter(
    (r) => r.media.includes('prefers-reduced-motion: reduce') && r.selector.includes(`.${cls}`)
  )
}

describe('the icon motion vocabulary', () => {
  it.each(VARIANTS)('declares `%s` in the stylesheet', (variant) => {
    // The class strings are only names; the stylesheet is where the gesture
    // actually lives. A variant nothing implements is a className that reads
    // as configured and does nothing at all -- which is the single easiest
    // way for this system to rot.
    const cls = variantClass(variant)
    if (!cls) {
      // `none` deliberately has no gesture; it exists for press-only icons.
      expect(ICON_MOTION[variant]).toBe('icon-motion')
      return
    }
    expect(rulesFor(cls).length, `nothing in index.css implements .${cls}`).toBeGreaterThan(0)
  })

  it.each(VARIANTS)('answers focus as well as hover for `%s`', (variant) => {
    // A hover-only affordance is invisible to the keyboard, which is the exact
    // failure the registry's own animations had: bound to onMouseEnter and
    // nothing else, so no amount of tabbing ever moved an icon.
    const cls = variantClass(variant)
    if (!cls) return
    const selectors = rulesFor(cls).map((r) => r.selector).join(' ')
    expect(selectors, `.${cls} reacts to hover but not to focus`).toMatch(
      /:focus-visible|:focus-within/
    )
    expect(selectors).toContain(':hover')
  })

  it.each(VARIANTS)('moves `%s` with transforms only, never layout', (variant) => {
    // The performance claim, made checkable. Transform is composited; width,
    // height, margin, padding and inset are not -- any one of them turns a
    // 160ms hover into a layout pass on every pointer move, and on a six-row
    // sidebar that is six of them.
    const cls = variantClass(variant)
    if (!cls) return
    for (const rule of rulesFor(cls)) {
      const properties = rule.body
        .split(';')
        .map((d) => d.split(':')[0].trim())
        .filter(Boolean)
      for (const property of properties) {
        expect(
          property,
          `.${cls} sets "${property}", which is not a composited property`
        ).toMatch(/^(transform|transition|transition-duration|opacity)$/)
      }
    }
  })

  it('is driven by the control, never by the glyph', () => {
    // THE DEFECT ALL OF THIS EXISTS TO FIX. Every rule must be a DESCENDANT
    // selector under the trigger, so hovering anywhere on a 200px row counts.
    // A rule that styled `.icon-motion-lift:hover` directly would reproduce
    // the original bug exactly -- motion only when the pointer crosses the
    // 20px glyph -- and would still look correct in a screenshot.
    for (const variant of VARIANTS) {
      const cls = variantClass(variant)
      if (!cls) continue
      for (const rule of rulesFor(cls)) {
        for (const selector of rule.selector.split(',')) {
          if (!selector.includes(`.${cls}`)) continue
          expect(
            selector,
            `${selector.trim()} styles the glyph's own state instead of the control's`
          ).toMatch(new RegExp(`\\.${ICON_MOTION_GROUP}[^ ]*\\s+`))
        }
      }
    }
  })

  it('acknowledges a press by default, and lets a non-pressable icon opt out', () => {
    // By reference, never by retyping a class name.
    expect(iconMotion('lift')).toBe(`${ICON_MOTION.lift} ${ICON_PRESS}`)
    expect(iconMotion('lift', { press: false })).toBe(ICON_MOTION.lift)
    expect(rulesFor(ICON_PRESS).length).toBeGreaterThan(0)
  })

  it('gives every variant a transition, so nothing snaps', () => {
    const base = RULES.find((r) => r.selector === '.icon-motion' && r.media === '')
    expect(base?.body).toContain('transition')
    expect(base?.body).toContain('--duration-fast')
    for (const variant of VARIANTS) {
      expect(ICON_MOTION[variant].split(/\s+/)).toContain('icon-motion')
    }
  })
})

describe('reduced motion', () => {
  it('returns every gesture to none, rather than merely shortening it', () => {
    // Somebody who asked not to be animated wants the icon to HOLD STILL, not
    // to move quickly. This is the one guarantee in the whole system that its
    // beneficiaries will never see working and can never report broken, which
    // is exactly why it gets a test rather than a comment.
    const reduced = reducedRulesFor('icon-motion')
    expect(reduced.length, 'no reduced-motion rule covers the icon vocabulary').toBeGreaterThan(0)
    const bodies = reduced.map((r) => r.body).join(' ')
    expect(bodies).toContain('transform: none')
    expect(bodies).toContain('transition: none')
  })

  it('covers hover, focus and press, not just hover', () => {
    const selectors = reducedRulesFor('icon-motion').map((r) => r.selector).join(' ')
    for (const state of [':hover', ':focus-visible', ':focus-within', ':active']) {
      expect(selectors, `reduced motion leaves ${state} animating`).toContain(state)
    }
  })

  it('turns the one-shot state animations off too', () => {
    // `motion-safe` cannot gate these -- they are started by an element
    // mounting, not by a utility. A media query is the only thing that can
    // refuse them.
    for (const className of Object.values(ICON_STATE_MOTION)) {
      const off = reducedRulesFor(className)
      expect(off.length, `${className} is never switched off`).toBeGreaterThan(0)
      expect(off.map((r) => r.body).join(' ')).toContain('animation: none')
    }
  })
})

describe('the one-shot state animations', () => {
  it.each(Object.entries(ICON_STATE_MOTION))(
    'declares `%s` with keyframes',
    (_name, className) => {
      expect(CSS).toContain(`.${className} {`)
      expect(CSS).toContain(`@keyframes ${className}`)
    }
  )

  it('runs each of them exactly once', () => {
    // "Avoid continuous or distracting animations" is the brief's rule and
    // this is where it would be broken -- one `infinite` here and an error
    // icon shakes forever.
    for (const className of Object.values(ICON_STATE_MOTION)) {
      const rule = RULES.find((r) => r.selector === `.${className}` && r.media === '')
      expect(rule?.body).toMatch(/\s1;?$/)
      expect(rule?.body).not.toContain('infinite')
    }
  })
})

describe('where the vocabulary is applied', () => {
  it('drives a nav icon from the whole row, not from the glyph', () => {
    const { container } = render(<NavItem href="/overview" label="overview" icon="Overview" />)
    const row = container.querySelector('a') as HTMLElement
    expect(row.className).toContain(ICON_MOTION_GROUP)
    expect(row.querySelector('.icon-motion')).toBeTruthy()
  })

  it('gives settings the one gesture that is not a lift', () => {
    // Five destinations share `lift` on purpose -- one kind of thing looks
    // like one kind of thing. Settings turns because the gear is the only nav
    // glyph whose own form describes a motion. Asserted as a DIFFERENCE, so it
    // fails both if settings stops turning and if a destination starts.
    const { container: nav } = render(
      <NavItem href="/overview" label="overview" icon="Overview" />
    )
    const { container: settings } = render(
      <NavItem href="/settings" label="settings" icon="Settings" />
    )
    expect(nav.querySelector('.icon-motion-lift')).toBeTruthy()
    expect(settings.querySelector('.icon-motion-turn')).toBeTruthy()
    expect(settings.querySelector('.icon-motion-lift')).toBeNull()
  })

  it('replays the status animation on every change, not just the first mount', () => {
    // A one-shot keyframe only runs when the node enters the DOM. Without a
    // key on the status the same element persists across a change, so the
    // animation plays once on first render and never again -- precisely
    // backwards for something whose whole job is to announce a CHANGE.
    const { rerender } = render(<StatusMarker status="applied" />)
    const first = document.querySelector('[data-status-rule]')
    expect(first?.className).toContain(ICON_STATE_MOTION.settle)

    rerender(<StatusMarker status="offer" />)
    const second = document.querySelector('[data-status-rule]')
    expect(second?.className).toContain(ICON_STATE_MOTION.settle)
    expect(second).not.toBe(first)
  })

  it('leaves the status marker itself a rule, never a pill', () => {
    // The animation must not have smuggled in a shape.
    render(<StatusMarker status="offer" />)
    const rule = document.querySelector('[data-status-rule]') as HTMLElement
    expect(rule.className).toContain('h-[2px]')
    expect(rule.className).toContain('rounded-none')
    expect(screen.getByText('Offer')).toBeTruthy()
  })
})
