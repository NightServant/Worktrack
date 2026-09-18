import type { SupabaseClient } from '@supabase/supabase-js'
import { requireUserId, toError } from './supabaseHelpers'
import type { CalendarEvent, EventKind } from './events'

export interface EventInput {
  job_id?: string | null
  kind: EventKind
  title: string
  starts_at: string
  duration_minutes?: number | null
  notes?: string | null
}

/**
 * CRUD for scheduled items.
 *
 * The client is passed in rather than imported so the same service works for
 * the app's shared client and for an integration test signed in as a specific
 * user. Reads never filter on user_id: RLS already scopes them, and adding a
 * redundant filter would hide a broken policy instead of surfacing it.
 */
export const eventService = {
  async create(client: SupabaseClient, input: EventInput): Promise<CalendarEvent> {
    const userId = await requireUserId(client)
    const { data, error } = await client
      .from('events')
      .insert({ ...input, user_id: userId })
      .select()
      .single()
    if (error) throw toError(error)
    return data as CalendarEvent
  },

  async update(
    client: SupabaseClient,
    id: string,
    patch: Partial<EventInput>
  ): Promise<CalendarEvent> {
    const { data, error } = await client
      .from('events')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (error) throw toError(error)
    return data as CalendarEvent
  },

  async remove(client: SupabaseClient, id: string): Promise<void> {
    const { error } = await client.from('events').delete().eq('id', id)
    if (error) throw toError(error)
  },

  async listForJob(client: SupabaseClient, jobId: string): Promise<CalendarEvent[]> {
    const { data, error } = await client
      .from('events')
      .select('*')
      .eq('job_id', jobId)
      .order('starts_at', { ascending: true })
    if (error) throw toError(error)
    return (data ?? []) as CalendarEvent[]
  },

  /**
   * Puts one interview on the calendar for an application, or takes it off.
   *
   * THIS OWNS EVERY `kind: 'interview'` EVENT ON THE JOB, and saying so is
   * what keeps the rule to one sentence. The record dialog offers a single
   * "interview" datetime, so the model behind it is one interview per
   * application: setting a date keeps the earliest existing interview event
   * and moves it, clearing the date removes them all, and any duplicates a
   * previous version of this left behind are cleaned up on the next write
   * rather than accumulating.
   *
   * A DATE CHANGE IS AN UPDATE, NOT A DELETE-AND-INSERT. The event id is
   * stable across a reschedule, which is what a future export or reminder
   * would key on.
   */
  async scheduleInterview(
    client: SupabaseClient,
    jobId: string,
    startsAt: string | null,
    title: string
  ): Promise<CalendarEvent | null> {
    const existing = (await this.listForJob(client, jobId)).filter(
      (event) => event.kind === 'interview'
    )
    const [earliest, ...duplicates] = existing

    if (startsAt === null) {
      for (const event of existing) await this.remove(client, event.id)
      return null
    }

    for (const event of duplicates) await this.remove(client, event.id)
    if (earliest) {
      return this.update(client, earliest.id, { starts_at: startsAt, title })
    }
    return this.create(client, {
      job_id: jobId,
      kind: 'interview',
      title,
      starts_at: startsAt,
    })
  },

  /** Everything at or after `fromIso`, soonest first — the calendar and dashboard rail. */
  /**
   * Every event from `fromIso` onward, oldest first.
   *
   * IT WAS `listUpcoming` AND THE ANCHOR WAS ALWAYS `now`, which is why the
   * month grid could not draw an interview that had already happened -- a
   * calendar that forgets last Tuesday. The query never cared: `fromIso` is
   * the caller's, and the caller now asks for a window that reaches back. The
   * name was the only thing claiming otherwise. See `useEvents`.
   */
  async listFrom(client: SupabaseClient, fromIso: string): Promise<CalendarEvent[]> {
    const { data, error } = await client
      .from('events')
      .select('*')
      .gte('starts_at', fromIso)
      .order('starts_at', { ascending: true })
    if (error) throw toError(error)
    return (data ?? []) as CalendarEvent[]
  },
}
