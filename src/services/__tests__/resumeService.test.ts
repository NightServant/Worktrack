import { describe, it, expect, vi } from 'vitest'
import { resumeService } from '../resumeService'

/**
 * A chainable stand-in for the PostgREST builder.
 *
 * Every method returns the same object and the object is thenable, so a chain
 * that ends in `await` (`list`, `remove`) and one that ends in `.single()`
 * (`create`, `update`) both resolve to the same canned result. `calls` records
 * the method name and arguments so a test can assert what was sent rather than
 * only what came back -- `user_id` on an insert is the RLS-critical one, and it
 * is invisible from the return value.
 */
function fakeClient(result: { data: unknown; error: unknown }, user: { id: string } | null = { id: 'user-1' }) {
  const calls: Array<[string, unknown[]]> = []
  const query: Record<string, unknown> = {}
  for (const name of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit']) {
    query[name] = vi.fn((...args: unknown[]) => {
      calls.push([name, args])
      return query
    })
  }
  query.single = vi.fn(() => Promise.resolve(result))
  query.maybeSingle = vi.fn(() => Promise.resolve(result))
  query.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected)

  const from = vi.fn(() => query)
  return {
    calls,
    from,
    client: {
      from,
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user }, error: null })) },
    } as never,
  }
}

const ROW = {
  id: 'cv-1',
  title: 'Backend CV',
  mode: 'word',
  content: { type: 'doc', content: [] },
  updated_at: '2026-08-20T10:00:00.000Z',
  sections: null,
}

describe('resumeService.list', () => {
  it('reduces the embedded snapshots to the highest version on the row', async () => {
    // resume_snapshots.version is monotonic per resume and stable across
    // deletes of other snapshots, so "which version is this CV on" is the max,
    // not the row count -- deleting v2 must not renumber v3 back to v2.
    const { client } = fakeClient({
      data: [{ ...ROW, resume_snapshots: [{ version: 1 }, { version: 3 }, { version: 2 }] }],
      error: null,
    })
    const [doc] = await resumeService.list(client)
    expect(doc.version).toBe(3)
  })

  it('reports no version at all rather than v0 when a CV has never been snapshotted', async () => {
    const { client } = fakeClient({ data: [{ ...ROW, resume_snapshots: [] }], error: null })
    const [doc] = await resumeService.list(client)
    expect(doc.version).toBeNull()
    expect(doc.hasVersions).toBe(false)
  })

  it('separates "no snapshots" from "snapshots with no number on them"', async () => {
    // A CV whose only snapshot predates the version backfill has history but
    // no number for it. Collapsing the two made the row say "No versions"
    // while expanding that same row listed one entry -- the two-surfaces-
    // disagree defect this milestone has now hit three times.
    const { client } = fakeClient({
      data: [{ ...ROW, resume_snapshots: [{ version: null }] }],
      error: null,
    })
    const [doc] = await resumeService.list(client)
    expect(doc.version).toBeNull()
    expect(doc.hasVersions).toBe(true)
  })

  it('settles every stored mode on word, including the retired latex one', async () => {
    const { client } = fakeClient({
      data: [
        { ...ROW, id: 'a', mode: 'word', resume_snapshots: [] },
        { ...ROW, id: 'b', mode: null, resume_snapshots: [] },
        { ...ROW, id: 'c', mode: 'structured', resume_snapshots: [] },
      ],
      error: null,
    })
    // One editor since 2026-09-13. A row written before that still says
    // `latex`; it opens in the only editor there is rather than nowhere.
    expect((await resumeService.list(client)).map((d) => d.mode)).toEqual(['word', 'word', 'word'])
  })

  it('names an untitled row without guessing which kind it is', async () => {
    // `Untitled CV` was wrong for half of them: this list holds cover letters
    // too (Gabe, 2026-09-21).
    const { client } = fakeClient({ data: [{ ...ROW, title: '', resume_snapshots: [] }], error: null })
    expect((await resumeService.list(client))[0].title).toBe('Untitled document')
  })

  it('returns an empty list when PostgREST returns null data', async () => {
    const { client } = fakeClient({ data: null, error: null })
    await expect(resumeService.list(client)).resolves.toEqual([])
  })

  it('throws a real Error, not the PostgREST object, so instanceof catches hold', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'permission denied for table resumes' } })
    await expect(resumeService.list(client)).rejects.toThrow(/permission denied/)
    await expect(resumeService.list(client)).rejects.toBeInstanceOf(Error)
  })

  it('orders by most recently updated so the CV you were just editing is first', async () => {
    const { client, calls } = fakeClient({ data: [], error: null })
    await resumeService.list(client)
    expect(calls).toContainEqual(['order', ['updated_at', { ascending: false }]])
  })
})

describe('resumeService.get', () => {
  it('returns null for an id that resolves to no row rather than throwing', async () => {
    // RLS makes "does not exist" and "belongs to someone else" the same read,
    // so the caller gets one not-found answer to render, not two.
    const { client } = fakeClient({ data: null, error: null })
    await expect(resumeService.get(client, 'missing')).resolves.toBeNull()
  })

  it('carries the stored content through untouched for the editor to normalize', async () => {
    // Content is passed through verbatim -- including the shape a retired
    // editor wrote -- because normalising it is the editor's job, not the
    // service's.
    const content = { type: 'latex', source: '\\documentclass{article}' }
    const { client } = fakeClient({ data: { ...ROW, mode: 'word', content }, error: null })
    const draft = await resumeService.get(client, 'cv-1')
    expect(draft?.content).toEqual(content)
    expect(draft?.mode).toBe('word')
  })
})

describe('resumeService.create', () => {
  it('stamps the signed-in user on the insert, which owner-only RLS requires', async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null })
    await resumeService.create(client, { mode: 'word', title: 'New CV', content: { type: 'doc' } })
    const insert = calls.find(([name]) => name === 'insert')!
    expect(insert[1][0]).toMatchObject({ user_id: 'user-1', mode: 'word', title: 'New CV' })
  })

  it('refuses to insert with no session instead of letting RLS reject it obscurely', async () => {
    const { client } = fakeClient({ data: ROW, error: null }, null)
    await expect(
      resumeService.create(client, { mode: 'word', title: 'New CV', content: {} })
    ).rejects.toThrow(/not authenticated/i)
  })
})

describe('resumeService.update', () => {
  it('sends only the fields it was given, so a title edit cannot blank the content', async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null })
    await resumeService.update(client, 'cv-1', { title: 'Renamed' })
    expect(calls.find(([name]) => name === 'update')![1][0]).toEqual({ title: 'Renamed' })
  })

  it('returns the row the database wrote, including its new updated_at', async () => {
    const { client } = fakeClient({ data: { ...ROW, updated_at: '2026-08-21T09:00:00.000Z' }, error: null })
    const draft = await resumeService.update(client, 'cv-1', { title: 'Renamed' })
    expect(draft.updated_at).toBe('2026-08-21T09:00:00.000Z')
  })
})

describe('resumeService.remove', () => {
  it('scopes the delete to the id', async () => {
    const { client, calls } = fakeClient({ data: null, error: null })
    await resumeService.remove(client, 'cv-1')
    expect(calls).toContainEqual(['eq', ['id', 'cv-1']])
  })

  it('surfaces a failed delete rather than resolving as if it worked', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'row level security' } })
    await expect(resumeService.remove(client, 'cv-1')).rejects.toThrow(/row level security/)
  })
})
