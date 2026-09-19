import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

/**
 * The focus ring stops at the edge of the paper.
 *
 * WHAT SHIPPED (Gabe, 2026-09-19: "there is a weird surrounding box when the
 * cursor is placed at the document page"). `*:focus-visible` carries
 * `ring-offset-2`, and a Tailwind ring is TWO shadows: the offset one is a
 * solid box in `--tw-ring-offset-color`, which under the dark theme is
 * near-black. The document page is white in BOTH themes, so focusing the
 * editor drew a black rectangle around it. Measured in the browser against
 * the compiled stylesheet: the offset shadow was `rgb(2, 8, 23) 0 0 0 2px`.
 *
 * WHY `ring-0` WAS NOT THE FIX, and why this test is worth its lines: the
 * editor already carried `[&_.ProseMirror:focus-visible]:ring-0`, which zeroes
 * only the INNER shadow. The bug was invisible in light mode -- a white box on
 * white paper -- so it survived every review until somebody used dark mode.
 */
describe('focus rings on the document page', () => {
  const css = readFileSync('src/index.css', 'utf8')

  it('zeroes the ring OFFSET on the document surface, not just the ring', () => {
    const rule = css.match(/\.ProseMirror:focus-visible[^}]*}/)?.[0]
    expect(rule, 'the .ProseMirror focus rule is gone').toBeTruthy()
    // `ring-0` alone is what shipped and what did not work.
    expect(rule).toContain('ring-offset-0')
  })

  it('still rings everything that is not the document', () => {
    // The companion that runs the other way: deleting the global rule would
    // also make the test above pass, and would take the focus indicator off
    // every button in the app.
    expect(css).toMatch(/\*:focus-visible\s*{[^}]*ring-2/)
  })
})
