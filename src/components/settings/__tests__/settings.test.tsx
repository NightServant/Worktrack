import * as React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPage } from '../SettingsPage'
import {
  ProfileSources,
  ProfileSourceSteps,
  ProfileImport,
  ProfileImportSteps,
} from '../ProfileImport'

afterEach(() => cleanup())

/** One profile, shared by both blocks below. */
const FILLED = {
  name: 'Elijah Gabe Cervantes',
  headline: 'Front-end developer',
  location: 'Baguio, Philippines',
  pictureUrl: null,
  email: 'egabe.cervantes@gmail.com',
  summary: 'Builds job-search tooling.',
  url: 'https://www.linkedin.com/in/example',
  experiences: [
    {
      title: 'Developer',
      company: 'Worktrack',
      period: '2025 – now',
      location: 'Remote',
      description: 'Built the tracker.\nShipped the editor.',
    },
  ],
  education: [{ school: 'University', degree: 'BSc', period: '2020 – 2024' }],
  skills: ['React', 'TypeScript'],
  industry: 'Software Development',
  address: 'Block 2, Lot 29, Bamban, Tarlac',
  birthDate: 'Mar 7',
  websites: ['https://example.dev'],
  certifications: [],
  languages: ['Filipino (Native)'],
  projects: [],
  sources: [
    { url: 'https://www.linkedin.com/in/example', site: 'LinkedIn', ok: true, note: null },
  ],
  fetchedAt: '2026-09-06T00:00:00.000Z',
}




/**
 * Renders the page and opens the `general` tab.
 *
 * IT IS NEEDED BECAUSE `TabsContent` UNMOUNTS THE HIDDEN PANEL. That is the
 * behaviour worth having -- a second copy of every settings control in the
 * accessibility tree is exactly what a `hidden` panel would give -- but it
 * means account, preferences and the danger zone are genuinely absent from
 * the DOM until somebody asks for them, and every test that used to reach
 * them by rendering alone has to click first.
 */
async function renderGeneral(props: React.ComponentProps<typeof SettingsPage>) {
  const user = userEvent.setup({ delay: null })
  const result = render(<SettingsPage {...props} />)
  await user.click(screen.getByRole('tab', { name: 'general' }))
  await screen.findByRole('heading', { name: 'account' })
  return result
}

describe('SettingsPage', () => {
  it('splits into a profile tab and a general tab, profile first', async () => {
    // TABS ARE BACK (Gabe, Worktrack Revisions item 8), reversing the
    // 2026-09-06 collapse to one column. The argument then was that three of
    // the four groups are a handful of rows each; what settles it the other
    // way is the profile, which is now a fetch with its own address field and
    // several hundred pixels of work history under it -- a screen, not a
    // group. Profile leads because it is the one a settings link is most
    // often clicked to reach.
    render(<SettingsPage prefs={null} />)
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['profile', 'general'])
    // The panel's own heading is inside its card now (2026-09-10), and it is
    // an h3 rather than an h2: the tab is the h2-level thing on this screen,
    // and the card under it was repeating the tab's own word one level up.
    expect(screen.getByRole('heading', { level: 3, name: 'profile' })).toBeTruthy()
  })

  it('keeps the general groups out of the DOM until their tab is opened', async () => {
    // NOT `hidden`, UNMOUNTED. A display:none panel still puts a second copy
    // of every control in the tree for a screen reader to walk past and for a
    // `getByRole` to trip over.
    const user = userEvent.setup({ delay: null })
    render(<SettingsPage prefs={null} />)
    expect(screen.queryByRole('heading', { name: 'account' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'general' }))
    expect(await screen.findByRole('heading', { name: 'danger zone' })).toBeTruthy()
  })

  it('keeps the danger zone last among the general tab’s groups', async () => {
    const { container } = await renderGeneral({ prefs: null })
    const groups = container.querySelectorAll('[data-settings-group]')
    expect(groups).toHaveLength(3)
    expect(groups[groups.length - 1].getAttribute('data-settings-group')).toBe('danger')
  })

  it('has no appearance group -- the theme lives in the app shell', async () => {
    // A second control over the same next-themes state would be a second
    // source of truth for one value. Paired with a positive assertion: this
    // must not pass merely because the page rendered nothing at all.
    await renderGeneral({ prefs: null })
    expect(screen.queryByText(/appearance/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /theme/i })).toBeNull()
    expect(screen.getByRole('heading', { name: 'account' })).toBeTruthy()
  })

  it('has no export control -- /applications owns CSV', async () => {
    await renderGeneral({ prefs: null })
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull()
    expect(screen.getByRole('heading', { name: 'preferences' })).toBeTruthy()
  })

  it('offers the six currencies from the CHECK constraint, PHP selected when there is no stored preference', async () => {
    await renderGeneral({ prefs: null })
    const segments = screen.getAllByRole('radio')
    expect(segments.map((s) => s.getAttribute('value'))).toEqual([
      'PHP',
      'USD',
      'EUR',
      'GBP',
      'SGD',
      'AUD',
    ])
    expect(screen.getByRole('radio', { name: 'PHP' }).getAttribute('aria-checked')).toBe('true')
  })

  it('selects the stored preference instead of PHP once one exists', async () => {
    await renderGeneral({
      prefs: { user_id: 'u1', default_currency: 'USD', created_at: 'x', updated_at: 'x' },
    })
    expect(screen.getByRole('radio', { name: 'USD' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'PHP' }).getAttribute('aria-checked')).toBe('false')
  })

  it('calls onDefaultCurrencyChange when a different currency segment is picked', async () => {
    const onDefaultCurrencyChange = vi.fn()
    await renderGeneral({ prefs: null, onDefaultCurrencyChange })
    fireEvent.click(screen.getByRole('radio', { name: 'EUR' }))
    expect(onDefaultCurrencyChange).toHaveBeenCalledWith('EUR')
  })

  it('shows the signed-in email as a read-only value in the account group', async () => {
    await renderGeneral({ prefs: null, email: 'gabe@example.com' })
    expect(screen.getByDisplayValue('gabe@example.com')).toBeTruthy()
  })

  it('calls onSignOut from the account group', async () => {
    const onSignOut = vi.fn()
    await renderGeneral({ prefs: null, onSignOut })
    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('does not delete the account on a single click -- it asks for confirmation first', async () => {
    // Task 4 (M5.5): window.confirm is the same defect class as the dialogs
    // Gabe asked back for -- unstyled, unthemeable, untestable without
    // stubbing a global -- so this guard is now a ConfirmDialog instead.
    const onDeleteAccount = vi.fn()
    const user = userEvent.setup()
    await renderGeneral({ prefs: null, onDeleteAccount })
    await user.click(screen.getByRole('button', { name: /delete account/i }))
    expect(screen.getByRole('alertdialog', { name: /delete your account/i })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'cancel' }))
    expect(onDeleteAccount).not.toHaveBeenCalled()
  })

  it('calls onDeleteAccount once the confirmation is accepted', async () => {
    const onDeleteAccount = vi.fn()
    const user = userEvent.setup()
    await renderGeneral({ prefs: null, onDeleteAccount })
    await user.click(screen.getByRole('button', { name: /delete account/i }))
    await user.click(screen.getByRole('button', { name: 'delete account' }))
    expect(onDeleteAccount).toHaveBeenCalledTimes(1)
  })

  it('renders no shadow on any of the three groups', async () => {
    // THE GROUPS ARE CARDS NOW (Gabe, 2026-09-10) -- the "separation is a
    // hairline rule, never a card" half of this assertion is what he
    // overruled, for settings and the overview both. The rest of the grammar
    // is untouched and still worth pinning: no shadow anywhere, and the 4px
    // radius cap that `shadcnHouseRules` enforces on `ui/card` itself.
    const { container } = await renderGeneral({ prefs: null })
    for (const group of container.querySelectorAll('[data-settings-group]')) {
      expect(group.innerHTML).not.toMatch(/shadow/)
    }
  })

  // Regression for the concurrent-write bug the review round caught: a
  // CSS-only "disabled" look (pointer-events-none + aria-disabled) still let
  // a focused option fire onChange on an arrow key, because pointer-events
  // only blocks pointer hit-testing, not keyboard activation. This exercises
  // the guard through the composed screen, not just the SegmentedControl
  // primitive in isolation.
  it('does not fire a second currency change from the keyboard while a write is already in flight', async () => {
    const onDefaultCurrencyChange = vi.fn()
    await renderGeneral({ prefs: null, savingCurrency: true, onDefaultCurrencyChange })
    const selected = screen.getByRole('radio', { name: 'PHP' })
    fireEvent.keyDown(selected, { key: 'ArrowRight' })
    expect(onDefaultCurrencyChange).not.toHaveBeenCalled()
  })
})


describe('the profile panel', () => {

  it('explains itself when there is no profile, in the caller\'s own words', () => {
    // The reason is always source-specific, so it is a message rather than a
    // fixed string -- a generic "unavailable" tells nobody what to do next.
    render(<SettingsPage prefs={null} profile={{ status: 'empty', message: 'Nothing imported yet.' }} />)
    expect(screen.getByText('Nothing imported yet.')).toBeTruthy()
  })

  it('renders every part of a filled-in profile', () => {
    render(<SettingsPage prefs={null} profile={{ status: 'ready', profile: FILLED }} />)
    expect(screen.getByText('Elijah Gabe Cervantes')).toBeTruthy()
    expect(screen.getByText('Front-end developer')).toBeTruthy()
    // Location leads the line under the headline, industry follows. That
    // order is LinkedIn's -- a profile shows where you are and never shows an
    // industry at all -- and this panel mimics it deliberately (2026-09-10).
    expect(screen.getByText(/Baguio, Philippines · Software Development/)).toBeTruthy()
    expect(screen.getByText('Developer')).toBeTruthy()
    expect(screen.getByText('University')).toBeTruthy()
    expect(screen.getByText('React, TypeScript')).toBeTruthy()
  })

  it('renders a partial profile rather than blanking on missing fields', () => {
    // Every source is partial. A profile with only a name is still a profile.
    render(
      <SettingsPage
        prefs={null}
        profile={{
          status: 'ready',
          profile: { ...FILLED, headline: null, summary: null, experiences: [], skills: [] },
        }}
      />
    )
    expect(screen.getByText('Elijah Gabe Cervantes')).toBeTruthy()
    expect(screen.queryByText('experience')).toBeNull()
    expect(screen.getByText('University')).toBeTruthy()
  })

  it('shows a skeleton while it is loading, and no profile copy', () => {
    const { container } = render(<SettingsPage prefs={null} profile={{ status: 'loading' }} />)
    expect(container.querySelector('[data-profile-state="loading"]')).toBeTruthy()
    expect(screen.queryByText('Elijah Gabe Cervantes')).toBeNull()
  })

  it('defaults to the empty state rather than a spinner that never resolves', () => {
    const { container } = render(<SettingsPage prefs={null} />)
    expect(container.querySelector('[data-profile-state="empty"]')).toBeTruthy()
  })
})

/**
 * THE CONTROL THE SETTINGS ROUTE ACTUALLY RENDERS since 2026-09-09. The CSV
 * import below it is kept and covered on Gabe's instruction not to remove what
 * this supersedes -- it is still the only source that has ever carried the
 * bullet text under a role -- but nothing wires it into a screen any more.
 */
/**
 * THE PANEL MIMICS LINKEDIN'S OWN PROFILE (Gabe, 2026-09-10, with his profile
 * open beside it). The data came from a LinkedIn profile and the person
 * reading this screen is checking whether the import got it right -- every
 * difference in shape between the two is one they have to hold in their head.
 */
describe('the profile panel’s layout', () => {
  it('opens with a cover band and an overlapping avatar, as a profile does', () => {
    const { container } = render(
      <SettingsPage prefs={null} profile={{ status: 'ready', profile: FILLED }} />
    )
    const banner = container.querySelector('[data-profile-banner]')!
    expect(banner).toBeTruthy()
    // A FLAT FIELD, NOT A PICTURE. No source this app has carries a cover
    // image, and generating one would be decoration pretending to be data.
    expect(banner.innerHTML).toContain('bg-accent-surface')
    // The overlap is the gesture that makes it read as a profile rather than
    // a row with a picture beside it.
    expect(banner.innerHTML).toMatch(/-mt-10/)
  })

  it('falls back to initials when the source carries no photo', () => {
    // ONLY THE FALLBACK IS ASSERTABLE HERE, and that is a jsdom limit rather
    // than a gap in the component: Base UI's Avatar mounts the <img> only once
    // it has LOADED, and jsdom never loads one -- rendering an AvatarImage in
    // this environment produces the fallback span and nothing else. The photo
    // path was verified in a real browser instead (2026-09-10).
    //
    // The docblock here used to say "NO PHOTO -- the export is CSVs and
    // carries no image", which stopped being true when the Apify route landed
    // and started returning `profilePicture`.
    render(<SettingsPage prefs={null} profile={{ status: 'ready', profile: FILLED }} />)
    expect(screen.getByText('EG')).toBeTruthy()
  })

  it('leads each record with a tile for the ORGANISATION, not for the line above it', () => {
    // Inferring the organisation from whichever of lead/detail was present put
    // a "BC" tile beside Tarlac State University -- initials of "BS, Computer
    // Science". On an experience the organisation is the subtitle; on an
    // education it is the lead.
    const { container } = render(
      <SettingsPage prefs={null} profile={{ status: 'ready', profile: FILLED }} />
    )
    const tiles = [...container.querySelectorAll('[data-org-tile]')].map((t) => t.textContent)
    expect(tiles).toEqual(['W', 'U'])
  })

  it('sets certifications and projects as real bulleted lists', () => {
    // Gabe asked for bullets on exactly these two, and they earn it while the
    // other two do not: a role and a degree are dated records with bodies; a
    // certificate is one line. A real `list-disc` list, not a stack of rows
    // with a glyph in front -- a screen reader announces "list, N items",
    // which a div wearing a bullet character does not.
    const withBoth = {
      ...FILLED,
      certifications: [{ name: 'Introduction to Networks', authority: 'Cisco', period: 'Jan 2024' }],
      projects: [{ title: 'Worktrack', description: 'A tracker.', url: 'https://example.dev' }],
    }
    const { container } = render(
      <SettingsPage prefs={null} profile={{ status: 'ready', profile: withBoth }} />
    )
    const bullets = [...container.querySelectorAll('[data-profile-bullet]')]
    expect(bullets).toHaveLength(2)
    for (const bullet of bullets) {
      expect(bullet.tagName).toBe('LI')
      expect(bullet.closest('ul')!.className).toContain('list-disc')
    }
    expect(screen.getByText(/Introduction to Networks/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Worktrack' })).toBeTruthy()
  })

  it('names every section it renders, and renders none it has nothing for', () => {
    const { container } = render(
      <SettingsPage prefs={null} profile={{ status: 'ready', profile: FILLED }} />
    )
    const sections = [...container.querySelectorAll('[data-profile-section]')].map((s) =>
      s.getAttribute('data-profile-section')
    )
    expect(sections).toContain('about')
    expect(sections).toContain('experience')
    expect(sections).toContain('education')
    // FILLED carries no projects, so there is no projects section to find.
    expect(sections).not.toContain('projects')
  })
})

describe('building a profile from several addresses', () => {
  it('asks for addresses and nothing else -- no file, no credential', () => {
    const { container } = render(<ProfileSources onFetch={vi.fn()} />)
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(screen.getByLabelText(/linkedin profile/i)).toBeTruthy()
    expect(screen.getByLabelText(/github/i)).toBeTruthy()
    expect(screen.getByLabelText(/jobstreet/i)).toBeTruthy()
    expect(screen.getByLabelText(/glassdoor/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /build my profile/i })).toBeTruthy()
  })

  it('refuses a bare word rather than sending it to be fetched', async () => {
    // The route SSRF-checks this again and the extractor checks where the
    // redirect landed, so this is a courtesy rather than the boundary -- but
    // spending a Firecrawl credit on "linkedin" is a round trip nobody wanted.
    const onFetch = vi.fn()
    const user = userEvent.setup({ delay: null })
    render(<ProfileSources onFetch={onFetch} />)
    await user.type(screen.getByLabelText(/linkedin profile/i), 'linkedin')
    await user.click(screen.getByRole('button', { name: /build my profile/i }))
    expect(onFetch).not.toHaveBeenCalled()
    // It says WHICH address, because there are four of them.
    expect(screen.getByText(/LinkedIn profile address must start with https/i)).toBeTruthy()
  })

  it('will not fetch with every row empty', () => {
    const onFetch = vi.fn()
    render(<ProfileSources onFetch={onFetch} />)
    fireEvent.click(screen.getByRole('button', { name: /build my profile/i }))
    expect(onFetch).not.toHaveBeenCalled()
    expect(screen.getByText(/add at least one address/i)).toBeTruthy()
  })

  it('sends only the rows that were filled, in order of authority', async () => {
    // THE ORDER IS THE MERGE'S AUTHORITY: the extractor takes the first
    // non-empty value for every single field, so LinkedIn leading is what
    // decides whose name and headline win.
    const onFetch = vi.fn()
    const user = userEvent.setup({ delay: null })
    render(<ProfileSources onFetch={onFetch} />)
    await user.type(screen.getByLabelText(/github/i), 'https://github.com/octocat')
    await user.type(
      screen.getByLabelText(/linkedin profile/i),
      'https://www.linkedin.com/in/example  '
    )
    await user.click(screen.getByRole('button', { name: /build my profile/i }))
    expect(onFetch).toHaveBeenCalledWith([
      'https://www.linkedin.com/in/example',
      'https://github.com/octocat',
    ])
  })

  it('offers a re-fetch and a removal once a profile exists, and pre-fills each row', () => {
    // The stored addresses come back so a re-fetch is one click rather than a
    // trip to four sites to copy the same links again. BY HOST, not by
    // position: the stored list holds only the addresses that were sent.
    render(
      <ProfileSources
        onFetch={vi.fn()}
        onClear={vi.fn()}
        hasProfile
        sources={[
          { url: 'https://github.com/octocat', site: 'GitHub', ok: true, note: null },
          { url: 'https://www.linkedin.com/in/example', site: 'LinkedIn', ok: true, note: null },
        ]}
      />
    )
    expect(screen.getByRole('button', { name: /fetch again/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /remove profile/i })).toBeTruthy()
    expect(screen.getByLabelText(/linkedin profile/i)).toHaveValue(
      'https://www.linkedin.com/in/example'
    )
    expect(screen.getByLabelText(/github/i)).toHaveValue('https://github.com/octocat')
  })

  it('says on the row itself which address could not be read', () => {
    // With four addresses in one request, one sentence under the button cannot
    // say which link failed -- and the fix is always to a particular link.
    const { container } = render(
      <ProfileSources
        onFetch={vi.fn()}
        hasProfile
        sources={[
          { url: 'https://www.linkedin.com/in/example', site: 'LinkedIn', ok: true, note: null },
          {
            url: 'https://www.glassdoor.com/member/home',
            site: 'Glassdoor',
            ok: false,
            note: 'Glassdoor showed nothing to a signed-out visitor.',
          },
        ]}
      />
    )
    expect(container.querySelectorAll('[data-profile-source-state="read"]')).toHaveLength(1)
    expect(screen.getByText(/Glassdoor showed nothing/i)).toBeTruthy()
  })

  it('has nothing to remove before the first fetch', () => {
    render(<ProfileSources onFetch={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /remove profile/i })).toBeNull()
  })

  it('passes the fetch note through -- including what the page could not carry', () => {
    // A public profile does not render the paragraph under each role, and an
    // import that quietly returns titles without them reads as a bug rather
    // than a limit. See scraper/extractor/profile.py.
    render(
      <ProfileSources
        onFetch={vi.fn()}
        note="The bullet text under each role is not on a public profile page."
      />
    )
    expect(screen.getByText(/bullet text under each role/i)).toBeTruthy()
  })

  it('explains the fetch in its own steps, for the empty state', () => {
    render(<ProfileSourceSteps />)
    expect(screen.getByText(/combines them into one profile/i)).toBeTruthy()
  })
})

describe('importing a LinkedIn export', () => {
  it('offers the import, and the steps, when there is no profile', () => {
    render(
      <SettingsPage
        prefs={null}
        profileSource={<ProfileImport onImport={vi.fn()} />}
        profileSteps={<ProfileImportSteps />}
      />
    )
    expect(screen.getByRole('button', { name: /import linkedin export/i })).toBeTruthy()
    expect(screen.getByText(/Get a copy of your data/i)).toBeTruthy()
  })

  it('never asks for a credential -- only a file', () => {
    // The two versions this replaced asked for an org-wide API key and a
    // profile URL to scrape. This asks for a file the user already owns.
    const { container } = render(<ProfileImport onImport={vi.fn()} />)
    const inputs = [...container.querySelectorAll('input')]
    expect(inputs.map((i) => i.getAttribute('type'))).toEqual(['file'])
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })

  it('takes several files at once, because the export is an archive of them', () => {
    const { container } = render(<ProfileImport onImport={vi.fn()} />)
    expect(container.querySelector('input[type="file"]')).toHaveAttribute('multiple')
  })

  it('has nothing to remove before anything is imported', () => {
    render(<ProfileImport onImport={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /remove profile/i })).toBeNull()
  })

  it('offers a re-import and a removal once a profile exists', () => {
    render(<ProfileImport onImport={vi.fn()} onClear={vi.fn()} hasProfile />)
    expect(screen.getByRole('button', { name: /import again/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /remove profile/i })).toBeTruthy()
  })

  it('says which files it could not read', () => {
    render(<ProfileImport onImport={vi.fn()} note="Could not recognise Connections.csv." />)
    expect(screen.getByText(/Could not recognise Connections.csv/)).toBeTruthy()
  })

  it('shows the imported bullet text, keeping its line breaks', () => {
    // The field the whole import exists for: a scrape gives up titles and
    // dates, and this is what a CV is actually written from.
    render(<SettingsPage prefs={null} profile={{ status: 'ready', profile: FILLED }} />)
    const body = screen.getByText(/Built the tracker/)
    expect(body.className).toContain('whitespace-pre-line')
  })

  it('renders the fields the export carries beyond a scrape', () => {
    render(<SettingsPage prefs={null} profile={{ status: 'ready', profile: FILLED }} />)
    expect(screen.getByText(/Software Development/)).toBeTruthy()
    expect(screen.getByText('Filipino (Native)')).toBeTruthy()
    expect(screen.getByText('https://example.dev')).toBeTruthy()
  })

  it('shows the address and birth date plainly, under their own heading', () => {
    // A home address is a different category of fact from a job title. Shown
    // rather than tucked away, so somebody who does not want it stored knows
    // to clear the profile.
    render(<SettingsPage prefs={null} profile={{ status: 'ready', profile: FILLED }} />)
    expect(screen.getByText('personal details')).toBeTruthy()
    expect(screen.getByText(/Bamban, Tarlac/)).toBeTruthy()
    expect(screen.getByText(/Born Mar 7/)).toBeTruthy()
  })
})

describe('actually reading the export files', () => {
  /**
   * THE PATH NOTHING EXERCISED. Both upload controls called `File.text()`,
   * which every current browser has and this project's jsdom does not -- so an
   * `async` change handler rejected silently and the button did nothing. No
   * test caught it because no test had ever read a file. `readFileText` falls
   * back to FileReader; this is what proves the handler runs.
   */
  it('hands the file contents to the caller', async () => {
    const onImport = vi.fn()
    const { container } = render(<ProfileImport onImport={onImport} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, {
      target: { files: [new File(['First Name,Last Name\nGabe,Cervantes\n'], 'Profile.csv')] },
    })

    await waitFor(() => expect(onImport).toHaveBeenCalled())
    const files = onImport.mock.calls[0][0]
    expect(files[0].name).toBe('Profile.csv')
    expect(files[0].text).toContain('Gabe,Cervantes')
  })

  it('reads every file when several are chosen at once', async () => {
    const onImport = vi.fn()
    const { container } = render(<ProfileImport onImport={onImport} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, {
      target: {
        files: [
          new File(['First Name,Last Name\nGabe,Cervantes\n'], 'Profile.csv'),
          new File(['Name\nReact\n'], 'Skills.csv'),
        ],
      },
    })

    await waitFor(() => expect(onImport).toHaveBeenCalled())
    expect(onImport.mock.calls[0][0]).toHaveLength(2)
  })
})
