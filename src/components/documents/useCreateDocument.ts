'use client'

import { useRouter } from 'next/navigation'
import { useCreateResume } from '@/hooks/useResumes'
import { useUserProfile } from '@/hooks/useUserProfile'
import { personalizeTemplate } from '@/services/templatePersonalization'
import { EMPTY_PROFILE } from '@/services/profile'
import { DEFAULT_WORD_CONTENT } from '@/components/cv/content'
import type { NoticeKind } from './DocumentsNotice'
import type { TemplateChoice } from './TemplateGallery'
import type { ResumeContent, ResumeMode } from '@/services/resumeService'

/**
 * Every way a document gets created, in one place.
 *
 * WHY THE THREE ROUTES CONVERGED HERE. `/documents`, `/documents/templates`
 * and `/cv` each owned their own `useCreateResume()` call, their own title
 * strings and their own toast copy, and each file's docblock said so and
 * explained that the duplication was deliberate -- an earlier plan forbade
 * touching `src/hooks/` and `src/services/`, and there was nothing to share
 * beyond a dozen lines. They had already drifted once by the time this task
 * started.
 *
 * What changed is that creating a document is no longer a dozen lines. It now
 * has to pick a starter by kind, run the template through
 * `personalizeTemplate` against the stored LinkedIn profile, title the row
 * after the kind rather than after "CV", and say something different in the
 * toast depending on whether there was a profile to read. Four rules, each of
 * which is a silent wrong document if one route misses it: a template written
 * straight to the database ships raw `{{name|Your Name}}` to a person, and
 * that is the exact failure this milestone exists to prevent. Three copies of
 * four rules is not duplication worth keeping.
 *
 * IT IS A COMPONENT-LOCAL HOOK, not a new file under `src/hooks/`. The rules
 * it encodes are this screen's rules -- what a Documents draft is called, what
 * its toast says -- and the constraint that kept the routes apart was about
 * `src/hooks/` and `src/services/` being shared territory. `src/services/`
 * still owns the write; this only owns the decisions above it.
 *
 * NOTIFYING IS THE CALLER'S JOB, passed in. The two Documents routes report
 * through `useDocumentsNotice` (sonner on desktop, a persistent banner below
 * `lg` -- see DocumentsNotice for why), and `/cv` has no banner and uses the
 * toast context directly. A hook that picked one would put the wrong shape of
 * message on one of the two screens.
 */
export type Notify = (kind: NoticeKind, title: string, message?: string) => void

/**
 * What a document of each kind is called, in the row title.
 *
 * Lowercase for the letter and capitals for the CV because that is how each
 * is written in English, not because one is chrome and the other is prose:
 * these end up inside "Untitled CV" and "Standard cover letter".
 */
const KIND: Record<ResumeMode, string> = { word: 'CV', cover_letter: 'cover letter' }

/**
 * A blank cover letter is blank PROSE over the sender's own block.
 *
 * `DEFAULT_WORD_CONTENT` is a CV's outline -- Summary, Experience, Projects,
 * Skills, each with a prompt -- and it earns that, because a CV is a document
 * with a required shape most people cannot recall. A letter has no sections to
 * scaffold. Reusing the CV skeleton would hand somebody a "Skills" heading to
 * delete, and inventing a specimen letter here would duplicate the five in
 * `COVER_LETTER_TEMPLATES`, which is where a letter with a shape belongs. The
 * body is still empty, and the templates are one click away on the same
 * screen.
 *
 * WHAT CHANGED IS THE HEADER (Gabe, 2026-09-17: "creating new CV and cover
 * letter from scratch, required credentials fetched from LinkedIn is
 * missing"). Who the letter is from is not scaffolding and it is not prose --
 * it is the four fields this app already stores, and every letter needs them
 * at the top. The block is the one the five templates use, token for token, so
 * a blank letter and a template letter open with the same sender.
 *
 * The trailing empty paragraph is where the writing starts: tiptap normalises
 * an empty doc anyway, and an explicit paragraph is a document with a cursor
 * in it rather than one the editor has to repair on open.
 */
const BLANK_LETTER: ResumeContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '{{name|Your Name}}', marks: [{ type: 'bold' }] },
        { type: 'hardBreak' },
        {
          type: 'text',
          text: '{{email|email@example.com}} | {{phone|+63 900 000 0000}} | {{linkedin|linkedin.com/in/you}}',
        },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: '{{today}}' }] },
    { type: 'paragraph' },
  ],
}

/**
 * What the toast says about the profile, on every path that reads one.
 *
 * Somebody who just created a document and got specimen text has a reason to
 * hear that connecting a profile would have filled it in; somebody who has
 * connected one has a reason to know the document is already theirs before
 * they read it. Shared between the two paths that personalise, because the two
 * having drifted apart is how one of them ends up claiming the wrong thing.
 */
const FILLED = 'Filled in from your LinkedIn profile.'
const UNFILLED = 'Connect a LinkedIn profile in settings and the next one fills itself in.'

export interface CreateDocumentOptions {
  notify: Notify
  /**
   * `replace` for `/cv?draft=new`, which is already standing on the URL it is
   * about to leave -- pushing there would put a dead `?draft=new` entry in the
   * history that re-opens the chooser on every Back press.
   */
  replace?: boolean
}

export function useCreateDocument({ notify, replace = false }: CreateDocumentOptions) {
  const router = useRouter()
  const createResume = useCreateResume()
  const { data: stored } = useUserProfile()
  const profile = stored?.profile ?? null

  const write = async (mode: ResumeMode, title: string, content: ResumeContent, message: string) => {
    try {
      const created = await createResume.mutateAsync({ mode, title, content })
      notify('info', 'Draft created', message)
      const href = `/cv?draft=${created.id}`
      if (replace) router.replace(href)
      else router.push(href)
    } catch (err) {
      notify(
        'error',
        'Create failed',
        err instanceof Error ? err.message : `Could not create the ${KIND[mode]}`
      )
    }
  }

  /*
   * NO MODEL ON THIS PATH (Gabe, 2026-09-19: "generating new CV files became
   * slower").
   *
   * Creating a document used to be one database write and a navigation. For
   * about an hour it also waited on a 120B model over a free tier before it
   * would write anything, because that is where the prose was being composed
   * -- and a person pressing "New CV" is not asking for prose, they are asking
   * for a document. The wait was real and it was on the critical path of the
   * one action this hook exists to make fast.
   *
   * THE PROSE IS NOT GONE, IT IS UNPLACED. `/api/cv-write`,
   * `writeCvProse` and `personalizeTemplate`'s `prose` argument are all intact
   * and tested; what they need is a trigger the user chooses, next to the AI
   * tailoring that already lives in the editor's rail, where a twenty-second
   * wait is the point rather than an ambush. Putting it back here would be
   * choosing the slow path again on somebody's behalf.
   */

  return {
    creating: createResume.isPending,

    /**
     * FROM SCRATCH IS PERSONALISED TOO, and it was not until 2026-09-17.
     *
     * The starter documents are templates like any other now -- they carry
     * `{{name}}`, `{{email}}`, `{{location}}` and the rest -- so the same call
     * that fills a chosen template fills these, and the Experience, Projects
     * and Skills headings in the CV skeleton get the profile's own entries.
     * Writing them raw would have shipped literal `{{` markers, which is why
     * this is not optional: `EMPTY_PROFILE` when nothing is stored, never a
     * skipped call.
     */
    createBlank: (mode: ResumeMode) =>
      write(
        mode,
        `Untitled ${KIND[mode]}`,
        personalizeTemplate(
          mode === 'cover_letter' ? BLANK_LETTER : DEFAULT_WORD_CONTENT,
          profile ?? EMPTY_PROFILE
        ),
        profile ? FILLED : UNFILLED
      ),

    /**
     * THE PERSONALISATION HAPPENS HERE AND NOWHERE ELSE, on the way into the
     * write, which is the only moment it is safe: `personalizeTemplate`'s own
     * docblock is explicit that running it over saved content would rewrite
     * work the user has done.
     *
     * IT IS CALLED UNCONDITIONALLY, with `EMPTY_PROFILE` when nothing is
     * stored. Every token carries its own readable fallback, so a profile-less
     * user gets exactly the document the template always was -- and skipping
     * the call to "save" that would instead ship the literal `{{name|Your
     * Name}}` markers, which is worse than any substitution could be.
     *
     * THE TOAST SAYS WHICH OF THE TWO HAPPENED, once, on the one path where it
     * is actionable. Somebody who just picked a template and got specimen text
     * has a reason to hear that connecting a profile would have filled it in;
     * somebody who has connected one has a reason to know the document is
     * already theirs before they read it. Neither line is a banner, a badge or
     * a second visit -- it is the message slot of a toast that was already
     * going to appear.
     */
    createFromTemplate: ({ mode, template }: TemplateChoice) =>
      write(
        mode,
        `${template.name} ${KIND[mode]}`,
        personalizeTemplate(template.content, profile ?? EMPTY_PROFILE),
        profile ? FILLED : UNFILLED
      ),

    /**
     * An imported file is already the user's own document, so it is written as
     * it was parsed. Running the token pass over it would be looking for `{{`
     * in a stranger's CV.
     */
    createImported: (title: string, content: ResumeContent) =>
      write('word', title, content, 'Your draft is ready.'),
  }
}
