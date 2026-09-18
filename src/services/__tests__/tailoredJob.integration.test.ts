import { it, expect, afterAll } from 'vitest'
import { describeIntegration, signInTestUser } from '@/test/integration/client'
import { documentLinkService } from '@/services/documentLinkService'
import {
  tailoredJobIdFor,
  tailoredTitle,
  isRetailorOfSameApplication,
} from '@/components/cv/applyTailoring'

/**
 * Two roles at one employer, against the real project.
 *
 * WHY THIS IS NOT COVERED BY THE UNIT TESTS. Those prove the predicate given a
 * shape I wrote down. This proves the shape: that `listForResume` really does
 * hand back a `company` that is identical across two links to one employer,
 * which is the precondition the whole bug rests on. A fixture cannot be wrong
 * about the database in the direction that matters.
 *
 * It creates its own rows under a unique company name and deletes them, so it
 * neither reads nor disturbs anything already in the account.
 */
const TAG = `ZZ-VERIFY-${Date.now()}`
const cleanup: (() => Promise<void>)[] = []

afterAll(async () => {
  for (const undo of cleanup.reverse()) await undo()
})

describeIntegration('a tailored CV and two roles at one employer', () => {
  it('names the role it was made for, and refuses to guess when it cannot', async () => {
    const { client, userId } = await signInTestUser()
    const company = `Initech ${TAG}`

    const { data: jobs, error: jobErr } = await client
      .from('jobs')
      .insert([
        { user_id: userId, company, role: 'Frontend Engineer', status: 'wishlist' },
        { user_id: userId, company, role: 'Backend Engineer', status: 'wishlist' },
      ])
      .select('id, company, role')
    expect(jobErr, JSON.stringify(jobErr)).toBeNull()
    const [frontend, backend] = jobs!
    cleanup.push(async () => {
      await client.from('jobs').delete().in('id', [frontend.id, backend.id])
    })

    // The title carries the EMPLOYER and nothing else, which is precisely why
    // it cannot identify a job.
    const title = tailoredTitle('Verify CV', company)
    expect(title).toBe(`Verify CV — ${company}`)

    const { data: resume, error: resErr } = await client
      .from('resumes')
      .insert({ user_id: userId, title, mode: 'word', content: { type: 'doc', content: [] } })
      .select('id, title')
      .single()
    expect(resErr, JSON.stringify(resErr)).toBeNull()
    cleanup.push(async () => {
      await client.from('resumes').delete().eq('id', resume!.id)
    })

    const link = async (jobId: string) => {
      const { error } = await client
        .from('application_documents')
        .insert({ user_id: userId, job_id: jobId, resume_id: resume!.id })
      expect(error, JSON.stringify(error)).toBeNull()
    }

    // TAILORED FOR THE FRONTEND ROLE, linked only there. The ordinary case.
    await link(frontend.id)
    const one = await documentLinkService.listForResume(client, resume!.id)
    expect(one).toHaveLength(1)
    expect(tailoredJobIdFor({ draftTitle: resume!.title, links: one })).toBe(frontend.id)

    // THE SAME CV LATER SENT TO THE BACKEND ROLE TOO. Two links, and the
    // database confirms the company on both is the identical string -- which
    // is the fact the old lookup foundered on.
    await link(backend.id)
    const two = await documentLinkService.listForResume(client, resume!.id)
    expect(two).toHaveLength(2)
    expect(new Set(two.map((l) => l.company)).size).toBe(1)
    expect(new Set(two.map((l) => l.role))).toEqual(
      new Set(['Frontend Engineer', 'Backend Engineer'])
    )

    // The lookup that shipped: first match wins, and on real rows it names a
    // role this CV was never written for.
    const oldLookup = two.find((l) => tailoredTitle(resume!.title, l.company) === resume!.title)
    expect(oldLookup, 'the old lookup always resolved to something').toBeDefined()

    // What it does now: nothing, because nothing here CAN say which of the two
    // it was made for. The caller shows the picker instead.
    expect(tailoredJobIdFor({ draftTitle: resume!.title, links: two })).toBeNull()

    // Reported rather than fixed here: with a link to the backend role now in
    // place, the re-tailor predicate treats a run against THAT role as a
    // rewrite of this document -- the CV written for the frontend role.
    const wouldOverwrite = isRetailorOfSameApplication({
      draftId: resume!.id,
      draftTitle: resume!.title,
      tailoredName: tailoredTitle('Verify CV', company),
      jobId: backend.id,
      links: two,
    })
    console.log(`[two-roles] retailor-against-backend would overwrite the frontend CV: ${wouldOverwrite}`)
  })
})
