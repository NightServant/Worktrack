'use client'

import * as React from 'react'
import { authedFetch } from '@/lib/authedFetch'
import { useUserProfile } from '@/hooks/useUserProfile'
import { personalizeTemplate, type CvWriting } from '@/services/templatePersonalization'
import { BLANK_LETTER } from '@/components/documents/useCreateDocument'
import { DEFAULT_WORD_CONTENT } from '@/components/cv/content'
import { COVER_LETTER_TEMPLATES, WORD_TEMPLATES } from '@/services/resumeTemplateService'
import type { ResumeContent, ResumeMode } from '@/services/resumeService'

/**
 * The model pass that runs AFTER a document exists, behind a skeleton.
 *
 * GABE'S DESIGN, 2026-09-19: "how about instant creation, then model runs
 * after generation? Skeleton loader for the document then boom, generated
 * template with ai polish". It is better than either of the two arrangements
 * before it. Waiting on the model BEFORE the write made creating a document
 * slow, which was the complaint. Writing it in the background AFTER the editor
 * opened would race whatever the person had started typing -- the hazard
 * `personalizeTemplate`'s docblock has warned about since it was written.
 *
 * A SKELETON RESOLVES BOTH. The row is written immediately, so nothing is
 * waited on; and while this runs there is no editor on screen, so there is
 * nothing to type into and nothing to race. The document that appears is
 * already the finished one.
 *
 * IT RUNS EXACTLY ONCE PER DRAFT. A ref, not state: a re-render must not start
 * a second request, and on a free tier a duplicate is a wasted call out of a
 * daily allowance.
 *
 * EVERY FAILURE ENDS THE SKELETON AND KEEPS THE DOCUMENT. Not configured,
 * rate limited, timed out, a reply that parses to nothing -- all of them call
 * `onDone` and the editor opens on the deterministic version, which is a
 * complete, correct CV that was already saved before this started. Nothing
 * here can cost somebody their document.
 */

/** Only what this needs off a draft, so it fits every shape the route holds. */
export interface PolishableDraft {
  id: string
  mode: ResumeMode
}

export interface PolishOptions {
  draft: PolishableDraft | null
  /** The template id from `?polish=`, or `blank`, or null for no polish. */
  templateId: string | null
  /** Persist the rewritten document. */
  save: (content: ResumeContent) => Promise<unknown>
  /** Drop `?polish=` from the URL, which is what reveals the editor. */
  onDone: () => void
}

/** The template a draft was made from, so it can be personalised again. */
export function templateContentFor(
  templateId: string,
  mode: ResumeMode
): ResumeContent | null {
  if (templateId === 'blank') {
    return (mode === 'cover_letter' ? BLANK_LETTER : DEFAULT_WORD_CONTENT) as ResumeContent
  }
  const found = [...WORD_TEMPLATES, ...COVER_LETTER_TEMPLATES].find(
    (template) => template.id === templateId
  )
  return (found?.content as ResumeContent) ?? null
}

export function usePolishDraft({ draft, templateId, save, onDone }: PolishOptions): boolean {
  const { data: stored } = useUserProfile()
  const profile = stored?.profile ?? null
  const ran = React.useRef<string | null>(null)

  // THE TEMPLATE IS RESOLVED BEFORE ANYTHING IS SHOWN. A `?polish=` naming a
  // template this build does not have is not a reason to hold a skeleton over
  // somebody's document -- it is a reason to open it.
  const template = templateId && draft ? templateContentFor(templateId, draft.mode) : null
  const active = !!templateId && !!draft && !!template && !!profile

  React.useEffect(() => {
    if (!active || !draft || !template || !profile) {
      // A polish that cannot run still has to clear the flag, or the URL keeps
      // a `?polish=` that would try again on every visit.
      if (templateId && draft) onDone()
      return
    }
    if (ran.current === draft.id) return
    ran.current = draft.id

    let cancelled = false
    void (async () => {
      let prose: CvWriting = null
      try {
        const response = await authedFetch('/api/cv-write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile }),
        })
        if (response.ok) {
          const body = (await response.json()) as { ok?: boolean; prose?: CvWriting }
          if (body.ok && body.prose) prose = body.prose
        }
      } catch {
        // Handled by `prose` staying null: the document below is still the
        // deterministic one, which is already saved and already correct.
      }

      if (cancelled) return
      if (prose) {
        try {
          await save(personalizeTemplate(template, profile, prose) as ResumeContent)
        } catch {
          // The saved document is the one that was written at creation. A
          // failed rewrite loses the polish and nothing else.
        }
      }
      if (!cancelled) onDone()
    })()

    return () => {
      cancelled = true
    }
    // `onDone` and `save` are recreated every render by the caller; the ref
    // above is what makes this run once, so they are deliberately not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, draft?.id, template, profile, templateId])

  return active
}
