'use client'

import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useToast } from '@/contexts/ToastContext'

/**
 * Getting the open CV out of the browser, as PDF, .docx and .tex.
 *
 * THREE FORMATS, NOT ONE, and the reason is in the domain rather than the
 * code: ATS parsers still handle .docx more reliably than PDF and many
 * application forms accept Word only, while a human reviewer opening the file
 * wants the PDF's fixed layout. Which one matters depends on who is on the
 * other end, and the author is the only one who knows that.
 *
 * `.tex` JOINED THEM ON 2026-09-15 (Gabe: "make sure these word documents are
 * able to be exported as LaTeX files without breaking formats"). It answers a
 * narrower audience than the other two and a real one: academic and research
 * applications routinely ask for a source file, and a CV that can only leave
 * this app as .docx or PDF is one a postdoc application cannot use. See
 * `services/integrations/latexExport` for what "without breaking formats"
 * turned out to mean.
 *
 * SPLIT OUT OF `WordResumeEditor` ON 2026-09-11 (509 lines). Two handlers and
 * two booleans that read the editor and talk to two endpoints, sharing nothing
 * else with the component -- not the revision counter, not the autosave
 * timers. The persistence logic next door touches all of those and stays.
 *
 * `saveDraft` IS A PARAMETER, AND THAT IS THE POINT OF THE SPLIT. A PDF built
 * from content the database refused is a PDF of something that does not exist
 * -- the editor once showed "Save failed" and "PDF ready" together and handed
 * over the second one. In a shared scope that dependency was invisible; here
 * it is in the signature, so the export cannot be reused somewhere that has
 * not thought about it.
 *
 * EACH EXPORT REVOKES ITS OBJECT URL. A blob URL created and never revoked
 * keeps the whole generated file in memory for the life of the tab.
 */

export interface ResumeExport {
  exportPdf: () => Promise<void>
  exportDocx: () => Promise<void>
  exportLatex: () => Promise<void>
  isExportingPdf: boolean
  isExportingDocx: boolean
  isExportingLatex: boolean
}

export interface ResumeExportOptions {
  editor: Editor | null
  title: string
  /** Must resolve true before anything is generated. See the docblock. */
  saveDraft: (notify?: boolean) => Promise<boolean>
  /** Adds the bearer token; `/api/cv/docx` and `/api/cv/latex` both authenticate. */
  authedFetch: (input: string, init?: RequestInit) => Promise<Response>
  /**
   * `line-height: normal` for the face on screen, measured by the editor.
   *
   * PDF ONLY, and only because that export has no browser. Word stores line
   * spacing as a multiple of SINGLE -- the font's own line box -- and that box
   * is 1.15 of the size for Times and 1.31 for Garamond, so converting it
   * without knowing the face puts the exported page at a different density
   * from the preview. .docx and .tex both carry the multiple itself and let
   * Word and TeX resolve it, which is why neither needs this.
   */
  naturalLineHeight?: number
}

/** `my CV (final)` -> `my-cv-final`, so the download has a sane filename. */
function safeFileName(title: string): string {
  return (
    (title.trim() || 'cv')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cv'
  )
}

export function useResumeExport({
  editor,
  title,
  saveDraft,
  authedFetch,
  naturalLineHeight,
}: ResumeExportOptions): ResumeExport {
  const { success, error: showError } = useToast()
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [isExportingDocx, setIsExportingDocx] = useState(false)
  const [isExportingLatex, setIsExportingLatex] = useState(false)

  const exportPdf = async () => {
    if (!editor) return
    setIsExportingPdf(true)
    try {
      // SAVED FIRST, unlike the other two. A PDF is the artefact people
      // actually send, so it must not be built from text that is still only in
      // the editor -- and a failed save means the document and the export
      // would disagree.
      if (!(await saveDraft(false))) return
      // `/api/cv/pdf`, not a Supabase edge function: the function this used to
      // call launched Chromium against a 256MB, 20MB-bundle runtime and was
      // therefore never deployed, so every press ended in "Failed to fetch"
      // with no status behind it. Same route shape as the other two exports.
      const response = await authedFetch('/api/cv/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || 'CV',
          content: editor.getJSON(),
          naturalLineHeight,
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `Export failed (${response.status})`)
      }
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeFileName(title)}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
      success('PDF ready', 'Your CV PDF has been downloaded.')
    } catch (err) {
      showError('Export failed', err instanceof Error ? err.message : 'Could not export PDF')
    } finally {
      setIsExportingPdf(false)
    }
  }

  const exportDocx = async () => {
    if (!editor) return
    setIsExportingDocx(true)
    try {
      const response = await authedFetch('/api/cv/docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || 'CV', content: editor.getJSON() }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `Export failed (${response.status})`)
      }
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${(title.trim() || 'cv').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cv'}.docx`
      anchor.click()
      // Revoked immediately: the click has already handed the blob to the
      // download, and holding it keeps the whole file in memory for the tab.
      URL.revokeObjectURL(url)
      success('Word file ready', 'Your CV has been downloaded as .docx.')
    } catch (err) {
      showError('Export failed', err instanceof Error ? err.message : 'Could not export Word file')
    } finally {
      setIsExportingDocx(false)
    }
  }

  /**
   * THE SAME SHAPE AS `exportDocx`, and the duplication is deliberate rather
   * than un-factored. The two differ in the endpoint, the extension, the
   * media handling and the toast, which is four of the six lines that would
   * be parameters -- a shared helper taking four arguments to save two lines
   * is a helper whose call sites are harder to read than the thing it
   * replaced.
   *
   * `response.text()`, NOT `.blob()`. A .tex IS text, and round-tripping it
   * through a blob would work while making the one thing worth asserting in a
   * test -- that the source says what it should -- reachable only by decoding
   * it back. The Blob is built here instead, with the type the download needs.
   */
  const exportLatex = async () => {
    if (!editor) return
    setIsExportingLatex(true)
    try {
      const response = await authedFetch('/api/cv/latex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || 'CV', content: editor.getJSON() }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `Export failed (${response.status})`)
      }
      const source = await response.text()
      const url = URL.createObjectURL(
        new Blob([source], { type: 'application/x-tex;charset=utf-8' })
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeFileName(title)}.tex`
      anchor.click()
      URL.revokeObjectURL(url)
      success('LaTeX file ready', 'Your CV has been downloaded as .tex.')
    } catch (err) {
      showError('Export failed', err instanceof Error ? err.message : 'Could not export LaTeX file')
    } finally {
      setIsExportingLatex(false)
    }
  }

  return {
    exportPdf,
    exportDocx,
    exportLatex,
    isExportingPdf,
    isExportingDocx,
    isExportingLatex,
  }
}
