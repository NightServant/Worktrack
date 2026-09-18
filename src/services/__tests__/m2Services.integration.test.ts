import { beforeAll, afterAll, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describeIntegration, signInTestUser, cleanup } from '@/test/integration/client'
import { eventService } from '../eventService'
import { activityService } from '../activityService'
import { contactService } from '../contactService'
import { documentLinkService } from '../documentLinkService'

describeIntegration('M2 services against real Supabase rows', () => {
  let client: SupabaseClient
  let userId: string
  let jobId: string
  let resumeId: string

  beforeAll(async () => {
    const session = await signInTestUser()
    client = session.client
    userId = session.userId

    const { data, error } = await client
      .from('jobs')
      .insert({ user_id: userId, company: 'Integration Co', role: 'Integration Engineer' })
      .select()
      .single()
    if (error) throw new Error(`fixture job failed: ${error.message}`)
    jobId = data.id

    const { data: resume, error: resumeErr } = await client
      .from('resumes')
      .insert({ user_id: userId, title: 'Integration CV', mode: 'structured' })
      .select()
      .single()
    if (resumeErr) throw new Error(`fixture resume failed: ${resumeErr.message}`)
    resumeId = resume.id
  })

  afterAll(async () => {
    if (!client) return
    await cleanup(client, [
      { table: 'jobs', column: 'id', value: jobId },
      { table: 'resumes', column: 'id', value: resumeId },
    ])
    await client.auth.signOut()
  })

  it('eventService round-trips an event and scopes it to the owner', async () => {
    const created = await eventService.create(client, {
      job_id: jobId,
      kind: 'interview',
      title: 'Technical interview',
      starts_at: '2026-09-01T10:00:00Z',
      duration_minutes: 60,
    })
    expect(created.id).toBeTruthy()
    expect(created.user_id).toBe(userId)

    const listed = await eventService.listFrom(client, '2026-01-01T00:00:00Z')
    expect(listed.some((e) => e.id === created.id)).toBe(true)

    await eventService.remove(client, created.id)
    const after = await eventService.listForJob(client, jobId)
    expect(after.some((e) => e.id === created.id)).toBe(false)
  })

  it('activityService writes a note and returns it newest first', async () => {
    const older = await activityService.create(client, {
      job_id: jobId, note: 'applied through referral', occurred_at: '2026-08-21T00:00:00Z',
    })
    const newer = await activityService.create(client, {
      job_id: jobId, note: 'recruiter call', occurred_at: '2026-08-26T00:00:00Z',
    })

    const entries = await activityService.listForJob(client, jobId)
    expect(entries[0].id).toBe(newer.id)
    expect(entries.map((e) => e.id)).toContain(older.id)

    await activityService.remove(client, older.id)
    await activityService.remove(client, newer.id)
  })

  it('contactService links a contact to an application and unlinks it', async () => {
    const contact = await contactService.create(client, {
      name: 'Dana Recruiter', email: 'dana@example.com',
    })
    expect(contact.user_id).toBe(userId)

    await contactService.linkToJob(client, jobId, contact.id)
    const linked = await contactService.listForJob(client, jobId)
    expect(linked.some((c) => c.id === contact.id)).toBe(true)

    await contactService.unlinkFromJob(client, jobId, contact.id)
    const afterUnlink = await contactService.listForJob(client, jobId)
    expect(afterUnlink.some((c) => c.id === contact.id)).toBe(false)

    await contactService.remove(client, contact.id)
  })
  it('documentLinkService pins a CV to an application and replaces it on re-pin', async () => {
    const pinned = await documentLinkService.pin(client, {
      job_id: jobId, resume_id: resumeId, snapshot_id: null, sent_at: '2026-08-21',
    })
    expect(pinned.user_id).toBe(userId)

    // (job_id, resume_id) is unique, so pinning again must update rather than throw
    const repinned = await documentLinkService.pin(client, {
      job_id: jobId, resume_id: resumeId, snapshot_id: null, sent_at: '2026-08-22',
    })
    expect(repinned.sent_at).toBe('2026-08-22')

    const links = await documentLinkService.listForJob(client, jobId)
    expect(links).toHaveLength(1)
    expect(links[0].title).toBe('Integration CV')
    expect(links[0].version).toBeNull()

    await documentLinkService.unpin(client, jobId, resumeId)
    expect(await documentLinkService.listForJob(client, jobId)).toHaveLength(0)
  })
})
