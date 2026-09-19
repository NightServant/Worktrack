import { describe, it, expect } from 'vitest'
import { groupSkills } from '../skillGroups'
import { EMPTY_PROFILE, professionalSummary } from '../profile'

/**
 * The two things the classifier must not do, and the one it must.
 *
 * MUST: put a skill under a heading a reader would look for it under.
 * MUST NOT: lose one, or answer differently for a career it was not written
 * with in mind -- the whole point of the table is that a nurse, a chef and an
 * engineer get the same treatment from it (Gabe, 2026-09-19).
 */
describe('groupSkills', () => {
  const labels = (skills: string[]) => groupSkills(skills).map((group) => group.label)
  const under = (skills: string[], label: string) =>
    groupSkills(skills).find((group) => group.label === label)?.skills ?? []

  it('never loses a skill, whatever it is', () => {
    const input = ['React', 'Phlebotomy', 'Cake decorating for weddings', 'Welding']
    const kept = groupSkills(input).flatMap((group) => group.skills)
    expect(kept.sort()).toEqual([...input].sort())
  })

  it('files what it does not recognise rather than dropping it', () => {
    expect(under(['Zither restoration'], 'Other Skills')).toEqual(['Zither restoration'])
  })

  it('reads the same skill list for careers that share no vocabulary', () => {
    expect(labels(['Patient Care', 'IV Therapy', 'Epic Systems'])).toContain(
      'Clinical & Healthcare'
    )
    expect(labels(['Legal Research', 'Litigation', 'Westlaw'])).toContain('Legal & Regulatory')
    expect(labels(['HACCP', 'Pastry', 'Menu Planning'])).toContain('Hospitality & Service')
    expect(labels(['Carpentry', 'Scaffolding', 'Masonry'])).toContain('Construction & Trades')
    expect(labels(['Payroll', 'QuickBooks', 'Reconciliation'])).toContain('Finance & Accounting')
    expect(labels(['Lesson Planning', 'Curriculum', 'Tutoring'])).toContain('Teaching & Training')
  })

  it('tells apart names that are prefixes of one another', () => {
    // First rule wins, so the table's ORDER is the correctness here: a
    // `Java` rule ahead of `JavaScript` would swallow it.
    expect(under(['JavaScript', 'Java'], 'Programming Languages')).toEqual(['JavaScript', 'Java'])
    expect(under(['SQL Server'], 'Databases & Storage')).toEqual(['SQL Server'])
  })

  it('reads LinkedIn spelling, parentheses and all', () => {
    expect(under(['Python (Programming Language)'], 'Programming Languages')).toEqual([
      'Python (Programming Language)',
    ])
  })

  it('collapses the same skill arriving from two sources', () => {
    expect(under(['Next.js', 'next.js'], 'Frontend & UI')).toEqual(['Next.js'])
  })

  it('keeps the profile’s own order inside a group', () => {
    // On LinkedIn that order is most-endorsed first, which is the person's own
    // ranking and not ours to re-sort.
    expect(under(['React', 'Vue', 'Angular'], 'Frontend & UI')).toEqual([
      'React',
      'Vue',
      'Angular',
    ])
  })
})

describe('professionalSummary', () => {
  it('leads with the longest thing the person wrote, never the code-host bio', () => {
    // The bug it exists for: a CV that opened "All will be well." because
    // GitHub was the only source with an About.
    const summary = professionalSummary({
      ...EMPTY_PROFILE,
      headline:
        'Detail-oriented Computer Science graduate seeking to start a career as a Front-End Developer.',
      summary: 'All will be well.',
      about: [{ site: 'GitHub', text: 'All will be well.' }],
    })
    expect(summary).toContain('Detail-oriented Computer Science graduate')
    expect(summary).not.toContain('All will be well.')
  })

  it('adds the role and the tools under it, without repeating the lead', () => {
    const summary =
      professionalSummary({
        ...EMPTY_PROFILE,
        headline: 'Frontend Engineer with six years in product teams, most of it in React.',
        experiences: [
          {
            title: 'Senior Engineer',
            company: 'Northwind',
            period: 'Jan 2024 - Present',
            location: null,
            description: null,
          },
        ],
        skills: ['TypeScript', 'React', 'PostgreSQL', 'Figma'],
      }) ?? ''
    expect(summary).toContain('Currently working as Senior Engineer at Northwind.')
    // `React` is already in the lead, so it is not listed again.
    expect(summary).toContain('Works with TypeScript, PostgreSQL and Figma.')
  })

  it('is null when the profile says nothing about the person', () => {
    expect(professionalSummary(EMPTY_PROFILE)).toBeNull()
  })
})

describe('normalizeProfile', () => {
  it('fills the record fields a row written before them is missing', async () => {
    const { normalizeProfile } = await import('../profile')
    // The crash it exists for: `project.tech.length` on a profile imported
    // before projects had a `tech` field.
    const out = normalizeProfile({
      projects: [{ title: 'Worktrack', description: 'A tracker.', url: null }],
      education: [{ school: 'University', degree: 'BSc', period: '2020 - 2024' }],
    } as never)!
    expect(out.projects[0].tech).toEqual([])
    expect(out.projects[0].highlights).toEqual([])
    expect(out.education[0].graduationYear).toBeNull()
  })

  it('drops a code host avatar the merge would never overwrite', async () => {
    const { normalizeProfile } = await import('../profile')
    expect(
      normalizeProfile({ pictureUrl: 'https://avatars.githubusercontent.com/u/1?v=4' })!.pictureUrl
    ).toBeNull()
    expect(
      normalizeProfile({ pictureUrl: 'https://media.licdn.com/dms/image/x.jpg' })!.pictureUrl
    ).toBe('https://media.licdn.com/dms/image/x.jpg')
  })
})
