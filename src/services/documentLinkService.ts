import type { SupabaseClient } from '@supabase/supabase-js'
import { requireUserId, toError } from './supabaseHelpers'
import type { ApplicationDocument } from '@/types'
import type { DocumentLinkSummary, ResumeLinkSummary } from './applicationDocuments'

export interface DocumentLinkInput {
  job_id: string
  resume_id: string
  /** null means the link tracks the CV as it evolves; an id pins one exact version. */
  snapshot_id?: string | null
  sent_at?: string
}

/**
 * Records which CV went to which application.
 *
 * snapshot_id is the point of the table. Without it a link says "this CV",
 * which keeps changing; with it the link says "this CV as it was when I sent
 * it", which is the thing you actually want to reread before an interview.
 */
export const documentLinkService = {
  /**
   * Attach a CV to an application.
   *
   * REPLACES A RE-PIN OF THE SAME CV, AND ONLY THAT. `application_documents`
   * is UNIQUE (job_id, resume_id) -- on the PAIR -- so pinning the same CV
   * again is a conflict and the upsert turns it into "change which snapshot I
   * sent", which is what that UI action is. Pinning a DIFFERENT CV is a new
   * row, because the table is deliberately many-to-many: `listForResume`
   * answers "where did this CV go?" and needs every row.
   *
   * So this does NOT make an application single-CV, and a caller driving a
   * single-select field has to clear the others itself -- see `linksToUnpin`,
   * which is where that was missing.
   */
  async pin(client: SupabaseClient, input: DocumentLinkInput): Promise<ApplicationDocument> {
    const userId = await requireUserId(client)
    const { data, error } = await client
      .from('application_documents')
      .upsert({ ...input, user_id: userId }, { onConflict: 'job_id,resume_id' })
      .select()
      .single()
    if (error) throw toError(error)
    return data as ApplicationDocument
  },

  /**
   * Every application that already has a document attached to it.
   *
   * WHY IDS AND NOT ROWS (Gabe, 2026-09-19: "wishlisted jobs with tailored CVs
   * must not appear in the component itself"). The tailoring picker needs to
   * answer one yes/no question per job -- has this one been tailored for
   * already -- and the titles, versions and snapshots the other two readers
   * embed are three joins it would throw away. This is one column.
   *
   * NO `user_id` FILTER, matching every other read in this app: the table is
   * behind owner-only RLS, and a redundant filter hides a broken policy rather
   * than surfacing it.
   */
  async listLinkedJobIds(client: SupabaseClient): Promise<string[]> {
    const { data, error } = await client.from('application_documents').select('job_id')
    if (error) throw toError(error)
    const ids = new Set((data ?? []).map((row) => (row as { job_id: string }).job_id))
    return [...ids]
  },

  async unpin(client: SupabaseClient, jobId: string, resumeId: string): Promise<void> {
    const { error } = await client
      .from('application_documents')
      .delete()
      .eq('job_id', jobId)
      .eq('resume_id', resumeId)
    if (error) throw toError(error)
  },

  /**
   * Links for one application, flattened into what describeLink renders.
   *
   * The resume title and snapshot version live on other tables, so they are
   * embedded in the query rather than fetched per row. A null version means no
   * snapshot was pinned, which describeLink renders as "latest".
   */
  async listForJob(client: SupabaseClient, jobId: string): Promise<DocumentLinkSummary[]> {
    const { data, error } = await client
      .from('application_documents')
      .select('resume_id, sent_at, resumes(title), resume_snapshots(version)')
      .eq('job_id', jobId)
      // NEWEST FIRST, because callers read `[0]` as "the CV that was sent".
      // Without an order Postgres is free to return these in any order, so
      // which CV the record dialog showed was not actually decided anywhere.
      .order('sent_at', { ascending: false })
    if (error) throw toError(error)

    return (data ?? []).map((row) => {
      const resume = row.resumes as unknown as { title: string } | null
      const snapshot = row.resume_snapshots as unknown as { version: number | null } | null
      return {
        resume_id: row.resume_id as string,
        title: resume?.title ?? 'untitled cv',
        version: snapshot?.version ?? null,
        sent_at: row.sent_at as string,
      }
    })
  },

  /**
   * The REVERSE lookup: which applications a given CV was submitted to.
   *
   * `listForJob` answers "which CV did I send to Stripe?"; this answers "where
   * did this CV go?", which is the question the document editor asks -- a CV
   * open on screen is most useful when you can see the roles it was actually
   * sent for, and tailor the next edit against them.
   *
   * The company and role live on `jobs`, so they are embedded in the query
   * rather than fetched per row. Ordered newest first: the last place a CV
   * went is the one you are most likely to be thinking about.
   */
  async listForResume(client: SupabaseClient, resumeId: string): Promise<ResumeLinkSummary[]> {
    const { data, error } = await client
      .from('application_documents')
      .select('job_id, sent_at, jobs(company, role, status)')
      .eq('resume_id', resumeId)
      .order('sent_at', { ascending: false })
    if (error) throw toError(error)

    return (data ?? []).map((row) => {
      const job = row.jobs as unknown as {
        company: string
        role: string
        status: string
      } | null
      return {
        job_id: row.job_id as string,
        company: job?.company ?? 'unknown company',
        role: job?.role ?? 'unknown role',
        status: job?.status ?? null,
        sent_at: row.sent_at as string,
      }
    })
  },
}
