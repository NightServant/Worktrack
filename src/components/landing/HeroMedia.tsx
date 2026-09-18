'use client'

import * as React from 'react'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { MD_BREAKPOINT_PX } from '@/lib/breakpoints'
import { useViewportSize } from './useViewportSize'

/**
 * The hero's background: a video on desktop, a poster everywhere else.
 *
 * This implements the annotation on Figma 39:369 literally -- "muted, autoplay,
 * loop, playsinline · 1280px wide · poster image only below 768px · paused
 * under prefers-reduced-motion".
 *
 * THE POSTER-ONLY RULE BELOW 768px IS A WEIGHT DECISION, NOT A LAYOUT ONE. The
 * clip is 2.5 MB; the poster is 65 KB. Rendering the <video> element at all on
 * a phone starts that download over whatever connection the phone is on, for a
 * background behind a scrim. So the element is not rendered below the
 * breakpoint -- `poster` alone would still fetch the source.
 *
 * It is also not rendered under prefers-reduced-motion, for the obvious
 * reason: an autoplaying loop is the thing that setting asks not to happen.
 * That check is the shared hook, not a second matchMedia call.
 *
 * `paused` is separate from both, and is what 6.1a drives: the hero holds the
 * viewport and then releases, and once it has released the video is invisible
 * and decoding it costs battery for nothing. Playback resumes if the reader
 * scrolls back up -- a video that stays dead for the rest of the session is
 * the bug the resume path prevents.
 *
 * THE CLIP IS 15s, WHICH IS THE FRAME'S SPEC. It was 40s, recorded here as a
 * known deviation from Figma 39:369's "8-15s seamless loop" because trimming
 * was thought to need ffmpeg. macOS ships `avconvert`, which trims without
 * re-encoding the picture: same 1280x720, same encode, 6.8 MB down to 2.5 MB.
 *
 * The window was chosen by MEASUREMENT rather than taste. Nine candidate
 * windows were scored on the mean luminance difference between their first and
 * last frame -- the size of the jump a viewer sees when the loop restarts --
 * after the same grayscale the page applies. They all landed within about one
 * point of each other, so the footage drifts continuously and no cut is truly
 * seamless. What settled it is that the ORIGINAL 40s loop scored 11.97 and
 * 0-15s scores 10.08: the shorter clip's seam is not a compromise for the
 * smaller file, it is slightly less visible than the one being replaced.
 */
export interface HeroMediaProps {
  posterSrc: string
  /** Empty or absent ships the poster. A path ships a <video> at md and up. */
  videoSrc?: string
  /** True once the hero has unpinned, or while it is off screen. */
  paused?: boolean
}

export function HeroMedia({ posterSrc, videoSrc, paused = false }: HeroMediaProps) {
  const reduced = usePrefersReducedMotion()
  const { widthPx } = useViewportSize()
  const videoRef = React.useRef<HTMLVideoElement>(null)

  // widthPx is 0 until the measuring effect runs, so the first paint is the
  // poster on every device. Starting with the video and swapping down would
  // begin the 6.8 MB fetch on a phone before we know it is a phone.
  const wantsVideo = Boolean(videoSrc) && !reduced && widthPx >= MD_BREAKPOINT_PX

  React.useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (paused) {
      el.pause()
      return
    }
    // Two hazards in one line. play() REJECTS when the browser blocks
    // autoplay -- not an error we can act on, and an unhandled rejection is a
    // console error on every load. And it does not always RETURN a promise:
    // the spec added that in 2016 and older Safari still returns undefined,
    // as does jsdom. `Promise.resolve(...)` normalises both.
    void Promise.resolve(el.play()).catch(() => {})
  }, [paused, wantsVideo])

  return (
    // `grayscale` on the media, not on this wrapper: the scrim below is a
    // token-coloured gradient and must not be desaturated with it.
    //
    // The clip is teal. This design system is Swiss with a single orange
    // accent, and status colour is reserved and semantic -- so a second
    // saturated hue behind the headline introduces a third colour language and
    // makes the accent eyebrow read as one of several colours rather than as
    // THE colour. Desaturating leaves the footage doing what footage should do
    // here (texture and depth) and leaves orange as the only chroma on the
    // page. It is also why the eyebrow reads at all against it.
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden bg-ink-950">
      {/*
        THE FOOTAGE WEARS THE UI'S OWN DARK, NOT A NEUTRAL GREY (Gabe,
        2026-09-17: "Hero background video must have the same color of the top
        navigation bar").

        `grayscale` alone takes the hue OUT and puts nothing back, so the hero
        rendered as colourless grey while every dark surface around it --
        LandingNavbar over the hero is `bg-ink-950/30`, and the page's dark
        canvas is the same family -- is a slightly blue near-black. Measured on
        the current clip: the raw frame is sky at rgb(82,124,158), which
        desaturates to a neutral the eye reads as a DIFFERENT dark from the bar
        sitting on top of it.

        THIS ADDS NO COLOUR, IT REMOVES ONE. The design system is Swiss with a
        single orange accent, and the original argument for `grayscale` was that
        the clip's teal introduced a second colour language. Neutral grey is
        itself a third dark, so tinting the footage to `ink-950` leaves the page
        with ONE dark and one accent rather than two darks.

        `mix-blend-color` rather than a filter chain: it takes hue and
        saturation from this layer and luminosity from what is beneath, which is
        the definition of "the footage's picture in the UI's colour". A
        `sepia`/`hue-rotate` stack approximates the same thing by arithmetic
        nobody can read.

        `grayscale` STAYS on the media as the floor. Anything without blend-mode
        support gets the colourless hero it had yesterday rather than the raw
        teal-and-sky clip, which is the failure worth defaulting to.

        The tint is isolated with the media so it cannot reach the scrim below
        it -- the scrim is token-coloured and must not be blended.
      */}
      <div className="relative isolate h-full w-full">
      {wantsVideo ? (
        <video
          ref={videoRef}
          data-testid="hero-video"
          className="h-full w-full object-cover grayscale"
          poster={posterSrc}
          src={videoSrc}
          muted
          loop
          playsInline
          autoPlay
        />
      ) : (
        <img
          data-testid="hero-poster"
          className="h-full w-full object-cover grayscale"
          src={posterSrc}
          /*
            The poster is the LCP image on every phone -- the video is gated off
            below 768 (see above), so this is the hero. It was one 1280x720
            file at 66KB regardless of screen; the 768 variant is 51KB and is
            the one a phone should get, since the element is full-bleed and a
            375px screen cannot resolve 1280 of anything.

            `sizes="100vw"` because that is literally true here: `absolute
            inset-0` on a full-width hero. Derived from `posterSrc` rather than
            passed in, so the two stay one decision -- and falls back to the
            single source if the caller ever points at a non-jpg.
          */
          srcSet={
            posterSrc.endsWith('.jpg')
              ? `${posterSrc.replace(/\.jpg$/, '-768.jpg')} 768w, ${posterSrc} 1280w`
              : undefined
          }
          sizes="100vw"
          alt=""
        />
      )}
        <div className="absolute inset-0 bg-ink-950 mix-blend-color" />
        {/*
          A SOFT FOCUS ON THE FOOTAGE, NOT A FROSTED PANE (Gabe, 2026-09-18:
          "implement a backdrop-blur within the background video without
          blurring the video excessively").

          FOUR PIXELS. It is the smallest radius that does anything at all at
          this size, and that is the point: the clip is a 1280px frame of glass
          and branches behind 96px type, and its fine detail -- window mullions,
          leaves -- is what competes with the headline. Four pixels takes the
          edge off that detail and leaves the shapes; at 12 (the navbar's
          `blur-md`, over a 60px band) the building becomes a grey wash and the
          hero stops being footage at all.

          IT SITS INSIDE THE MEDIA'S OWN `isolate`, which is what keeps it
          honest: `backdrop-filter` samples the backdrop of its stacking
          context, so this blurs the video and the tint above it and reaches
          NOTHING else -- not the scrim below, which is a token-coloured
          gradient, and not the headline, which is painted by the section
          above this whole layer.

          SUPPORTS-GUARDED for the same reason every other blur in this app is:
          without `backdrop-filter` this element renders as nothing, which is
          exactly the hero as it was yesterday. There is no translucency being
          bought here, so there is nothing to fall back from.
        */}
        <div
          aria-hidden
          data-hero-blur
          className="absolute inset-0 supports-[backdrop-filter]:backdrop-blur-xs"
        />
      </div>
      {/*
        The scrim, transcribed from the frame: a left-to-right gradient from
        ink-950/90 through 0.72 at 45% to 0.3. It is what makes the hero
        dark in BOTH themes, and therefore what forces the navbar's two
        treatments -- see LandingNavbar.

        The second, vertical gradient is not in the frame. It settles the foot
        of the hero onto its own base colour so the last band of footage does
        not end on a hard horizontal cut.

        IT FADES TO `ink-950`, NOT TO `bg-canvas`, AND THAT IS THE LIGHT-MODE
        FIX (Gabe, 2026-09-18: "in light mode there is a color mismatch
        problem"). `bg-canvas` is a SEMANTIC token: in the dark theme it
        resolves to #0d1522, which IS `ink-950`, so this band has always been
        "fade to ink-950" there and nobody could see it. In the light theme it
        resolves to #ffffff -- so the same line drew a 96px white haze across
        the bottom of a hero that is dark in BOTH themes, which is the one
        thing this section's docblock says must never happen: the colours here
        name primitives precisely because a semantic token flips and this
        section does not.

        DARK MODE IS UNCHANGED BY THIS, to the byte -- the two tokens are the
        same colour there. Light mode loses the haze and ends on the hero's own
        near-black, which is also what the navbar, the eyebrow and the scrim are
        made of.

        `h-24` (96px), DOWN FROM `h-32` ON 2026-09-15. The band used to eat
        anything drawn in the hero's near-white ink -- that is how the scroll
        cue vanished in light mode the day it was added -- so the cue moved up
        and the band came down to leave clearance. Fading to ink-950 removes
        that hazard at its source, and the clearance stays: 96px of the
        footage's own dark under the cue is what it was always for.
      */}
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950/90 via-ink-950/70 via-[45%] to-ink-950/30" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-ink-950" />
    </div>
  )
}
