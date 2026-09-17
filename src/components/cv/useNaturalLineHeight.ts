'use client'

import * as React from 'react'
import { FALLBACK_NATURAL_LINE_HEIGHT } from '@/lib/pageGeometry'

/**
 * What `line-height: normal` actually resolves to, for one font family.
 *
 * WHY THIS HAS TO BE MEASURED. Word stores line spacing as a multiple of
 * SINGLE, and single is the font's own line box -- ascent plus descent plus
 * line gap, which is exactly what CSS calls `line-height: normal`. There is no
 * way to write "0.98 times normal" in CSS: `line-height` takes a number, and a
 * number multiplies the FONT SIZE, not the font's line box. So the ratio
 * between the two has to be known before the document's spacing can be
 * expressed at all.
 *
 * AND IT CANNOT BE A CONSTANT, because it is a property of whichever face the
 * browser actually resolved. An imported CV asks for Garamond; a machine with
 * Word installed has it, one without falls through to Georgia, and the two do
 * not agree. Guessing 1.15 would be right to within a few percent for most
 * serif faces and wrong by a line or two down a page -- which is the whole
 * difference between a page break in Word's place and one a paragraph early.
 *
 * A HIDDEN PROBE, ONCE PER FAMILY. One offscreen div at a round 100px, read
 * back and removed in the same effect. Nothing here waits for a webfont: the
 * faces a .docx names are system faces, and the editor loads no font of its
 * own.
 */

/** Re-exported from where the conversion lives; see `lib/pageGeometry`. */
export { FALLBACK_NATURAL_LINE_HEIGHT }

/** The probe's font-size, chosen so the division is exact and readable. */
const PROBE_PX = 100

export function useNaturalLineHeight(fontFamily: string | null): number {
  const [ratio, setRatio] = React.useState(FALLBACK_NATURAL_LINE_HEIGHT)

  React.useEffect(() => {
    if (!fontFamily || typeof document === 'undefined') {
      setRatio(FALLBACK_NATURAL_LINE_HEIGHT)
      return
    }

    const probe = document.createElement('div')
    probe.textContent = 'Hxg'
    probe.setAttribute('aria-hidden', 'true')
    Object.assign(probe.style, {
      position: 'absolute',
      visibility: 'hidden',
      left: '-9999px',
      top: '0',
      whiteSpace: 'nowrap',
      fontFamily,
      fontSize: `${PROBE_PX}px`,
      lineHeight: 'normal',
    })

    document.body.appendChild(probe)
    const measured = probe.getBoundingClientRect().height / PROBE_PX
    probe.remove()

    // A zero comes back from a browser that never laid the probe out -- a
    // hidden tab, a print preview -- and must not become the line height.
    setRatio(
      Number.isFinite(measured) && measured > 0.5 && measured < 4
        ? measured
        : FALLBACK_NATURAL_LINE_HEIGHT
    )
  }, [fontFamily])

  return ratio
}
