import { describe, it, expect, vi } from 'vitest'
import { digestPosting, groundFields, ungroundedNumbers } from '../postingDigest'
/* THE RECORD'S OWN PARSER, imported into a service test on purpose: the
   round-trip below is a contract BETWEEN the two, and proving it against a
   local copy of the heading rule would prove only that the copy agrees with
   itself. */
import { parsePosting, serializePosting } from '@/components/applications/record/postingSections'
import { formatPostingText } from '../../postingFormat'
import type { IntegrationConfig } from '../config'

function configWith(tailoring: Partial<IntegrationConfig['tailoring']> = {}): IntegrationConfig {
  return {
    tailoring: {
      baseUrl: 'https://llm.test/v1',
      apiKey: 'k',
      model: 'test-model',
      ...tailoring,
    },
    esco: { baseUrl: 'https://esco.test/api', enabled: true },
  }
}

const POSTING = `Senior Frontend Engineer at Acme Corp.
Location: Pasig City, Philippines. Hybrid setup.
Salary: PHP 50,000 - 70,000 per month.
You will build interfaces with React and TypeScript.`

function reply(payload: unknown) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  } as unknown as Response
}

describe('formatting a scraped posting', () => {
  it('normalises every bullet glyph to one', () => {
    const out = formatPostingText('• React\n▪ TypeScript\n‣ GraphQL')
    expect(out).toBe('- React\n- TypeScript\n- GraphQL')
  })

  it('drops a line a page rendered twice', () => {
    // Sites render a heading once for mobile and once for desktop, and a text
    // extraction picks up both.
    expect(formatPostingText('Requirements\nRequirements\nReact')).toBe('Requirements\nReact')
  })

  it('keeps a repeat that is not adjacent', () => {
    const out = formatPostingText('React\nTypeScript\nReact')
    expect(out).toBe('React\nTypeScript\nReact')
  })

  it('collapses runs of blank lines and stray whitespace', () => {
    expect(formatPostingText('A\n\n\n\nB   C')).toBe('A\n\nB C')
  })

  it('invents nothing -- every word survives', () => {
    const source = 'Build things with React. Ship them.'
    const out = formatPostingText(source)
    for (const word of ['Build', 'things', 'React', 'Ship']) expect(out).toContain(word)
  })

})

describe('grounding what the model returns', () => {
  it('keeps fields the posting actually contains', () => {
    const { fields, dropped } = groundFields(
      { role: 'Senior Frontend Engineer', company: 'Acme Corp', location: 'Pasig City' },
      POSTING
    )
    expect(fields.role).toBe('Senior Frontend Engineer')
    expect(fields.company).toBe('Acme Corp')
    expect(dropped).toEqual([])
  })

  it('drops a company the posting never names', () => {
    // THE POINT OF THE WHOLE FILE. A prompt asking a model not to invent is a
    // request; this is the check.
    const { fields, dropped } = groundFields({ company: 'Google' }, POSTING)
    expect(fields.company).toBeNull()
    expect(dropped).toEqual(['company: "Google"'])
  })

  it('drops a salary figure whose digits are not in the posting', () => {
    const { fields, dropped } = groundFields({ salary_min: 90000 }, POSTING)
    expect(fields.salary_min).toBeNull()
    expect(dropped[0]).toContain('90000')
  })

  it('accepts a figure the posting writes with a thousands separator', () => {
    const { fields } = groundFields({ salary_min: 50000, salary_max: 70000 }, POSTING)
    expect(fields.salary_min).toBe(50000)
    expect(fields.salary_max).toBe(70000)
  })

  it('will not take a currency with no figure beside it', () => {
    // A currency alone is a fact about the page's footer, not the salary.
    const { fields } = groundFields({ salary_currency: 'PHP' }, POSTING)
    expect(fields.salary_currency).toBeNull()
  })

  it('takes a currency that sits with a grounded figure', () => {
    const { fields } = groundFields({ salary_min: 50000, salary_currency: 'PHP' }, POSTING)
    expect(fields.salary_currency).toBe('PHP')
  })

  it('filters a tech stack item by item rather than all or nothing', () => {
    const { fields, dropped } = groundFields(
      { tech_stack: ['React', 'TypeScript', 'Kubernetes'] },
      POSTING
    )
    expect(fields.tech_stack).toEqual(['React', 'TypeScript'])
    expect(dropped).toEqual(['tech_stack: "Kubernetes"'])
  })

  it('rejects a work mode outside the three the form knows', () => {
    const { fields, dropped } = groundFields({ work_mode: 'from-the-moon' }, POSTING)
    expect(fields.work_mode).toBeNull()
    expect(dropped[0]).toContain('from-the-moon')
  })
})

describe('the digest end to end', () => {
  it('formats and summarises with no model configured', () => {
    // The state of CI, a fresh clone, and any deployment with no provider --
    // and still most of the value.
    return digestPosting(POSTING, {
      config: configWith({ apiKey: undefined }),
      fetchImpl: vi.fn() as unknown as typeof fetch,
    }).then((digest) => {
      expect(digest.usedModel).toBe(false)
      expect(digest.formatted).toContain('Senior Frontend Engineer')
      // The description IS the tidied posting when nothing restructured it.
      expect(digest.description).toBe(digest.formatted)
    })
  })

  it('keeps a grounded reply', async () => {
    const digest = await digestPosting(POSTING, {
      config: configWith(),
      fetchImpl: vi.fn().mockResolvedValue(
        reply({
          role: 'Senior Frontend Engineer',
          company: 'Acme Corp',
          salary_min: 50000,
          tech_stack: ['React'],
        })
      ) as unknown as typeof fetch,
    })
    expect(digest.usedModel).toBe(true)
    expect(digest.fields.role).toBe('Senior Frontend Engineer')
    // None of the fields was dropped. The reply carries no restructured
    // description, which is a drop of its own -- see "restructuring the
    // posting" below.
    expect(digest.dropped).toEqual(['description (missing)'])
  })

  it('survives a code fence the model added anyway', async () => {
    const digest = await digestPosting(POSTING, {
      config: configWith(),
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: '```json\n{"role":"Senior Frontend Engineer"}\n```' } },
          ],
        }),
      } as unknown as Response) as unknown as typeof fetch,
    })
    expect(digest.fields.role).toBe('Senior Frontend Engineer')
  })

  it('reads the posting with the extract model, not the tailoring one', async () => {
    // Restructuring a posting is the mechanical, schema-shaped job
    // `MODEL_EXTRACT` is configured for. It ran on the tailoring model by
    // inheritance rather than by choice.
    const fetchImpl = vi.fn().mockResolvedValue(reply({ role: 'Senior Frontend Engineer' }))
    await digestPosting(POSTING, {
      config: configWith({ models: { extract: 'extract/model', tailor: 'tailor/model' } }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string).model).toBe('extract/model')
  })

  it('runs on a deployment that set only the per-task variables', async () => {
    // THE BUG THIS TEST IS FOR, and it was silent: the gate asked whether
    // TAILORING could run while the request posted `TAILORING_MODEL`. Drop the
    // legacy variable -- which a deployment configuring the three new ones
    // reasonably would -- and the digest passed its own gate, sent an empty
    // model id, failed at the provider and fell back to the tidied text with
    // nothing said. The gate and the model must read the same variable.
    const fetchImpl = vi.fn().mockResolvedValue(reply({ role: 'Senior Frontend Engineer' }))
    const digest = await digestPosting(POSTING, {
      config: configWith({ model: '', models: { extract: 'extract/model' } }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(digest.usedModel).toBe(true)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string).model).toBe('extract/model')
  })

  it('still skips the call entirely when no model is configured', async () => {
    // The companion that stops the gate being loosened instead of corrected:
    // CI, a fresh clone and anyone without a key must spend nothing.
    const fetchImpl = vi.fn()
    const digest = await digestPosting(POSTING, {
      config: configWith({ model: '' }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(digest.usedModel).toBe(false)
  })

  it('sends the ceilings that make the shorter wait safe', async () => {
    // Gabe, 2026-09-19: "apply the shorter model budget for CV tailoring and
    // application wizard". This call runs on the wizard's SAVE with the button
    // disabled behind it, and its wait went 30s -> 25s. The cut is only safe
    // because of these two: a copying task spends reasoning tokens before the
    // first character of the answer, and an unbounded reply is what a 25s
    // window cannot afford.
    const fetchImpl = vi.fn().mockResolvedValue(reply({ role: 'Senior Frontend Engineer' }))
    await digestPosting(POSTING, {
      config: configWith(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string)
    expect(body.max_tokens).toBe(2000)
    expect(body.reasoning).toEqual({ effort: 'low' })
    // And temperature stays where it was: this is a reading task.
    expect(body.temperature).toBe(0)
  })

  it('falls back rather than throwing when the provider fails', async () => {
    const digest = await digestPosting(POSTING, {
      config: configWith(),
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
    })
    expect(digest.usedModel).toBe(false)
    expect(digest.formatted).toBeTruthy()
  })
})

describe('formatting text a page shouted', () => {
  it('stops a heading shouting, without renaming a technology', () => {
    // `QUALIFICATIONS:` is a raised voice. `PHP`, `AWS` and `CSS` are not.
    expect(formatPostingText('QUALIFICATIONS AND REQUIREMENTS:')).toBe(
      'Qualifications And Requirements:'
    )
    expect(formatPostingText('PHP AWS CSS SQL')).toBe('PHP AWS CSS SQL')
  })

  it('leaves a single shouted word alone', () => {
    // One word is a label or an acronym, not a sentence being yelled.
    expect(formatPostingText('URGENT')).toBe('URGENT')
  })

  it('removes a decorative rule between sections', () => {
    expect(formatPostingText('About us\n=======\nWe build things.')).toBe(
      'About us\nWe build things.'
    )
  })

  it('strips leading emoji from a line', () => {
    expect(formatPostingText('🔥 Hiring now')).toBe('Hiring now')
  })

  it('calms repeated punctuation', () => {
    expect(formatPostingText('Apply now!!! Ready???')).toBe('Apply now! Ready?')
  })

  it('closes the gap a markup extraction leaves before punctuation', () => {
    expect(formatPostingText('React , TypeScript and Node .')).toBe('React, TypeScript and Node.')
  })

  it('leaves a label and its value on one line', () => {
    // `Salary: PHP 50,000` is a label and its value, not a heading welded to a
    // paragraph. Breaking it in two made it harder to read, not easier.
    expect(formatPostingText('Salary: PHP 50,000 per month')).toBe(
      'Salary: PHP 50,000 per month'
    )
  })

  it('still splits a heading welded to the end of a sentence', () => {
    expect(formatPostingText('Issues as they arise. Qualifications: Enrolled in a degree'))
      .toBe('Issues as they arise.\n\nQualifications:\nEnrolled in a degree')
  })

  it('strips decoration from either end of a line', () => {
    expect(formatPostingText('🔥 Hiring now 🔥')).toBe('Hiring now')
  })

  it('changes no word while doing any of it', () => {
    const out = formatPostingText('🔥 URGENT HIRING FOR REACT DEVELOPERS!!!')
    for (const word of ['Urgent', 'Hiring', 'For', 'React', 'Developers']) {
      expect(out.toLowerCase()).toContain(word.toLowerCase())
    }
  })
})

/**
 * THE POSTING READ, NOT REPRODUCED (Gabe, 2026-09-14: "modify the
 * job-description extraction system so it does not simply scrape and reproduce
 * the source page ... read and understand the job posting first, then generate
 * a structured job description").
 *
 * The check the whole feature rests on is the same one the rest of this file
 * describes -- the model proposes and the code verifies -- but the rule had to
 * change shape for this output, and these are the cases that say how. A
 * restructure introduces words legitimately; it never introduces a figure, a
 * company or a technology.
 */
describe('restructuring the posting', () => {
  /*
    THE DESCRIPTION IS DUTIES AND QUALIFICATIONS NOW, and this fixture changed
    shape with it on 2026-09-15 (Gabe: "role overview information must be used
    to fill-up the application form and duties and responsibilities and
    qualifications must be used for job description section. Do not include
    benefits since it affects the ATS scoring and matching").

    It used to open with `Role overview:` and close with `Compensation:`, and
    both are now EXCLUDED headings -- their content belongs to the form's own
    fields. Leaving them in the fixture would have meant these tests asserting
    the behaviour the instruction reversed.
  */
  const STRUCTURED = [
    'Responsibilities:',
    '- Build interfaces with React and TypeScript.',
    '',
    'Technical skills:',
    '- React',
    '- TypeScript',
  ].join('\n')

  const structuredDigest = (description: string, source = POSTING) =>
    digestPosting(source, {
      config: configWith(),
      fetchImpl: vi.fn().mockResolvedValue(reply({ description })) as unknown as typeof fetch,
    })

  it('keeps a structured description the posting can back up', async () => {
    const digest = await structuredDigest(STRUCTURED)
    expect(digest.dropped).toEqual([])
    expect(digest.description).toContain('Responsibilities:')
    expect(digest.description).toContain('- React')
    // `formatted` is untouched: it is the evidence everything above was
    // checked against, and overwriting it would mean checking the model's
    // restructure against the model's restructure.
    expect(digest.formatted).toContain('Senior Frontend Engineer at Acme Corp.')
  })

  it("round-trips through the record's own section parser", async () => {
    // THE PROPERTY THE EDIT CTAs DEPEND ON. Each section is addressable only
    // if the parser reads the description back exactly as it was written; a
    // description that reshapes on the way through would make `edit` on one
    // heading rewrite its neighbours.
    const digest = await structuredDigest(STRUCTURED)
    const sections = parsePosting(digest.description)
    expect(serializePosting(sections)).toBe(digest.description)
    expect(sections.map((section) => section.heading)).toEqual([
      'Responsibilities:',
      'Technical skills:',
    ])
  })

  it('gives every section a heading that ends in a colon and fits in 80 characters', async () => {
    const digest = await structuredDigest(STRUCTURED)
    for (const section of parsePosting(digest.description)) {
      expect(section.heading).not.toBeNull()
      expect(section.heading!.endsWith(':')).toBe(true)
      expect(section.heading!.length).toBeLessThanOrEqual(80)
      expect(section.body.trim()).not.toBe('')
    }
  })

  it('rejects a salary the posting does not state, and falls back', async () => {
    // THE SHARPEST CASE. Every word here is the posting's; only the figure is
    // invented, and a figure is the one thing reorganising can never produce.
    // Under `Qualifications:` rather than the `Compensation:` this used to
    // use. Compensation is an EXCLUDED heading since 2026-09-15 -- the section
    // is dropped before grounding ever sees it, so the old fixture would have
    // tested the exclusion rather than the figure check it is named for.
    const digest = await structuredDigest(
      'Qualifications:\n- Five years at PHP 90,000 - 120,000 per month.'
    )
    expect(digest.description).toBe(digest.formatted)
    expect(digest.description).not.toContain('90,000')
    expect(digest.dropped.join(' ')).toContain('invented figures')
  })

  it('rejects an invented company or technology', async () => {
    const digest = await structuredDigest(
      'Technical skills:\n- Kubernetes and Docker\n\nQualifications:\n- Engineer at Google.'
    )
    expect(digest.description).toBe(digest.formatted)
    expect(digest.dropped.join(' ')).toContain('description (invented')
  })

  it('will not let an invented name in through a heading', async () => {
    // Heading vocabulary is exempt from grounding -- a posting that never says
    // "qualifications" must still be organisable under it. That exemption is a
    // fixed list of words, not a licence for the whole line.
    const digest = await structuredDigest('Working at Google:\n- React and TypeScript.')
    expect(digest.description).toBe(digest.formatted)
    expect(digest.dropped.join(' ')).toContain('google')
  })

  it('allows the connective words reorganising actually needs', async () => {
    // The summary's rule would reject all of these, and rejecting all of them
    // is how a restructure never ships: "including", "based" and "monthly"
    // are how scattered facts get joined, not things being made up.
    const digest = await structuredDigest(
      [
        'Qualifications:',
        '- Senior Frontend Engineer at Acme Corp, based in Pasig City.',
        '',
        'Technical skills:',
        '- Building interfaces, including React and TypeScript.',
      ].join('\n')
    )
    expect(digest.dropped).toEqual([])
    expect(digest.description).toContain('including React and TypeScript')
  })

  it('rejects a description that is mostly its own words', async () => {
    // Grounded on every name and figure, and still not this posting: the
    // model stopped reorganising and started writing.
    // Under `Responsibilities:`, because a `Benefits:` heading no longer
    // reaches this check at all -- it is dropped first, which is a different
    // (and also tested) behaviour. The point of THIS test is the ratio.
    const digest = await structuredDigest(
      [
        'Responsibilities:',
        '- Acme offers free catered lunches, gym membership and unlimited holiday.',
        '- React engineers also get quarterly wellness retreats, learning budget and commuter allowance.',
      ].join('\n')
    )
    expect(digest.description).toBe(digest.formatted)
    expect(digest.dropped.join(' ')).toContain('description (rewritten')
  })

  it('rejects prose the record could not render as sections', async () => {
    // No heading means one orphan block where a document was asked for, and
    // the per-section editor has nothing to address.
    const digest = await structuredDigest('A tidy paragraph about the role at Acme Corp.')
    expect(digest.description).toBe(digest.formatted)
    expect(digest.dropped.join(' ')).toContain('not headings and bullets')
  })

  it('rejects a heading with nothing under it', async () => {
    const digest = await structuredDigest('Responsibilities:\n- React.\n\nQualifications:')
    expect(digest.description).toBe(digest.formatted)
    expect(digest.dropped.join(' ')).toContain('not headings and bullets')
  })

  /**
   * THE SPLIT (Gabe, 2026-09-15): role-overview facts fill the FORM, duties and
   * qualifications fill the DESCRIPTION, and benefits appear in neither.
   *
   * The reason benefits are singled out is measurable rather than aesthetic.
   * `services/atsMatch.ts` mines the description for the terms a CV is scored
   * against and cannot tell a requirement from a perk -- so "free catered
   * lunches, gym membership and unlimited holiday" becomes half a dozen
   * requirements no CV will ever contain, and every one of them counts as a
   * miss. That is the same failure mode that grew the stopword list, arriving
   * through a heading instead of a sentence.
   */
  describe('the split between the form and the description', () => {
    it('drops a benefits section and keeps the rest of the description', async () => {
      // DROPPED, NOT REJECTED, and this is the assertion that pins the
      // difference. Rejecting would fall back to `formatted` -- the raw advert
      // -- which contains the benefits in full, so refusing the description for
      // mentioning them would put MORE of them in front of the reader.
      const digest = await structuredDigest(
        [
          'Responsibilities:',
          '- Build interfaces with React and TypeScript.',
          '',
          'Benefits:',
          '- Free lunches and gym membership.',
        ].join('\n')
      )
      expect(digest.description).toContain('Responsibilities:')
      expect(digest.description).not.toContain('Benefits')
      expect(digest.description).not.toContain('gym')
      expect(digest.dropped.join(' ')).toContain('Benefits')
    })

    it('drops the sections whose facts are form fields instead', async () => {
      // Role overview and compensation are not noise -- they are DUPLICATES.
      // The title, the company and the money are mined as fields from the same
      // reply, so repeating them here states them twice and adds digits to the
      // keyword pool the CV is scored against.
      const digest = await structuredDigest(
        [
          'Role overview:',
          '- Senior Frontend Engineer at Acme Corp.',
          '',
          'Qualifications:',
          '- React and TypeScript.',
          '',
          'Compensation:',
          '- PHP 50,000 - 70,000 per month.',
        ].join('\n')
      )
      const headings = parsePosting(digest.description).map((section) => section.heading)
      expect(headings).toEqual(['Qualifications:'])
    })

    it('falls back when every section was excluded', async () => {
      // Nothing left is a genuine fallback rather than a filtered result. The
      // tidied advert at least contains the duties somewhere, unlabelled,
      // which is more than an empty description.
      const digest = await structuredDigest('Benefits:\n- Free lunches.')
      expect(digest.description).toBe(digest.formatted)
    })

    it('mines the arrangement terms the form has no column for', async () => {
      // Employment type, shift and office pattern used to ride in the
      // description's `Role overview:` block, whose own comment said they
      // would otherwise be "lost". That block is gone, so they became `tags` --
      // grounded verbatim like tech_stack, because a tag the posting does not
      // contain is invention wearing a shorter word.
      const digest = await digestPosting('Full-time, hybrid in Pasig City. React required.', {
        config: configWith(),
        fetchImpl: vi.fn().mockResolvedValue(
          reply({ tags: ['Full-time', 'hybrid'], tech_stack: ['React'] })
        ) as unknown as typeof fetch,
      })
      expect(digest.fields.tags).toEqual(['Full-time', 'hybrid'])
    })

    it('refuses a tag the posting never states', async () => {
      const digest = await digestPosting('Full-time in Pasig City.', {
        config: configWith(),
        fetchImpl: vi.fn().mockResolvedValue(
          reply({ tags: ['Full-time', 'four-day week'] })
        ) as unknown as typeof fetch,
      })
      expect(digest.fields.tags).toEqual(['Full-time'])
      expect(digest.dropped.join(' ')).toContain('four-day week')
    })
  })

  it('says so when the model answered without one', async () => {
    const digest = await digestPosting(POSTING, {
      config: configWith(),
      fetchImpl: vi.fn().mockResolvedValue(
        reply({ role: 'Senior Frontend Engineer' })
      ) as unknown as typeof fetch,
    })
    expect(digest.description).toBe(digest.formatted)
    expect(digest.dropped).toContain('description (missing)')
  })

  it('still returns a usable description with no model configured', async () => {
    // THE LOAD-BEARING CASE: CI, a fresh clone, and any deployment that has
    // not bought a provider key. No restructure, no empty box either.
    const digest = await digestPosting(POSTING, {
      config: configWith({ apiKey: undefined }),
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })
    expect(digest.usedModel).toBe(false)
    expect(digest.description).toBe(digest.formatted)
    expect(digest.description).toContain('Senior Frontend Engineer')
    expect(digest.dropped).toEqual([])
  })
})

describe('grounding a number rather than a word', () => {
  it('reads a thousands separator as one figure, not two', () => {
    // Without closing the separator up, `50,000` is `50` and `000` -- and a
    // check that passes anything built out of small numbers is no check.
    expect(ungroundedNumbers('PHP 50,000 - 70,000', POSTING)).toEqual([])
    expect(ungroundedNumbers('PHP 90,000', POSTING)).toEqual(['90000'])
  })

  it('finds a figure nothing in the posting supports', () => {
    expect(ungroundedNumbers('- 15 days leave', POSTING)).toEqual(['15'])
  })
})
