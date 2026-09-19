'use client'

import * as React from 'react'

import { bookmarkletSource, profileBookmarkletSource } from './source'

export default function BookmarkletPage() {
  const linkRef = React.useRef<HTMLAnchorElement>(null)
  const profileRef = React.useRef<HTMLAnchorElement>(null)
  const [source, setSource] = React.useState('')
  const [profileSource, setProfileSource] = React.useState('')
  const [copied, setCopied] = React.useState<'posting' | 'profile' | null>(null)

  React.useEffect(() => {
    const code = bookmarkletSource(window.location.origin)
    setSource(code)
    linkRef.current?.setAttribute('href', code)

    const profileCode = profileBookmarkletSource(window.location.origin)
    setProfileSource(profileCode)
    profileRef.current?.setAttribute('href', profileCode)
  }, [])

  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-8 px-gutter py-16">
      <header className="flex flex-col gap-3">
        <p className="text-label-caps uppercase tracking-[0.18em] text-accent-default">
          send a posting to worktrack
        </p>
        <h1 className="text-display-m font-bold text-text-primary">
          The posting button
        </h1>
        <p className="text-body-m font-normal text-text-secondary">
          Some job boards refuse to be read by anything that is not a browser.
          Indeed is one of them. This hands Worktrack the page you are already
          looking at, so those postings fill in like any other.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-heading-m font-bold text-text-primary">Install it</h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-body-m font-normal text-text-secondary">
          <li>Show your browser&rsquo;s bookmarks bar.</li>
          <li>Drag the orange button below onto it.</li>
          <li>
            On any job posting, click the bookmark. Worktrack opens with the
            application already filled in.
          </li>
        </ol>

        <div className="flex flex-wrap items-center gap-4 rounded-md border border-border-subtle p-6">
          {/* No `href` in the markup: it is a `javascript:` bookmarklet, set
              on the node after mount because React will not render that
              scheme. See the docblock. The click handler cancels the default
              so pressing it here does nothing -- this control is for dragging,
              and it says so beside itself. */}
          <a
            ref={linkRef}
            draggable
            onClick={(event) => event.preventDefault()}
            className="inline-flex h-10 cursor-grab items-center rounded-md bg-accent-default px-4 text-body-s font-medium text-ink-950"
          >
            send to worktrack
          </a>
          <span className="text-body-s font-normal text-text-muted">
            Drag this &mdash; clicking it here does nothing.
          </span>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-heading-m font-bold text-text-primary">
          If you cannot drag it
        </h2>
        <p className="text-body-m font-normal text-text-secondary">
          Make a new bookmark by hand and paste this as its address. On a phone
          this is the only way, and it is worth saying that a phone browser
          makes a poor job of bookmarklets in general.
        </p>
        <pre className="max-h-40 overflow-auto rounded-md border border-border-subtle bg-bg-subtle p-4 text-body-s text-text-secondary">
          <code className="break-all whitespace-pre-wrap">{source}</code>
        </pre>
        <div>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md border border-border-subtle px-3 text-body-s text-text-primary"
            onClick={() => {
              void navigator.clipboard?.writeText(source).then(
                () => setCopied('posting'),
                () => setCopied(null)
              )
            }}
          >
            {copied === 'posting' ? 'copied' : 'copy the address'}
          </button>
        </div>
      </section>

      {/* THE SECOND BOOKMARKLET, on the same page and not a second one of its
          own: they install the same way, send the same way and answer the same
          objection, and a reader who wants one will want the other. */}
      <section className="flex flex-col gap-4 border-t border-border-subtle pt-8">
        <h2 className="text-heading-m font-bold text-text-primary">
          The profile button
        </h2>
        <p className="text-body-m font-normal text-text-secondary">
          LinkedIn shows a signed-out visitor almost nothing: no About, no
          skills, no detail under a role, and on some profiles not even the job
          titles. Nothing Worktrack fetches can change that &mdash; the page is
          not written for a stranger. Open your own profile while logged in and
          press this instead; Worktrack reads the page you are looking at and
          fills all of it in.
        </p>

        {/* THE LONG SECTIONS ARE FETCHED, NOT ASKED FOR (Gabe, 2026-09-19:
            "why credentials is 2? I told you its eight"). Telling somebody to
            press `Show all` five times and click the bookmarklet on each was
            the honest instruction while the bookmarklet could only send the
            page it ran on. It can fetch them itself, so it does. */}
        <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-subtle p-4">
          <p className="text-body-m font-medium text-text-primary">
            It picks up the long lists for you
          </p>
          <p className="text-body-s font-normal text-text-secondary">
            Your profile page only shows the first two or three certificates,
            roles or schools before a{' '}
            <span className="text-text-primary">Show all</span> link. You do not
            have to press it: the bookmarklet reads those pages from the session
            you are already signed in to and sends them along with the profile.
            That covers certifications &mdash; with each one&rsquo;s issue date,
            expiry and credential ID &mdash; education with its academic years,
            and your full experience, projects and skills.
          </p>
          <p className="text-body-s font-normal text-text-muted">
            It works on any of those pages directly too, if you would rather
            capture just one.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-md border border-border-subtle p-6">
          <a
            ref={profileRef}
            draggable
            onClick={(event) => event.preventDefault()}
            className="inline-flex h-10 cursor-grab items-center rounded-md bg-accent-default px-4 text-body-s font-medium text-ink-950"
          >
            send my profile to worktrack
          </a>
          <span className="text-body-s font-normal text-text-muted">
            Drag this to your bookmarks bar, then click it on your LinkedIn
            profile.
          </span>
        </div>

        <pre className="max-h-40 overflow-auto rounded-md border border-border-subtle bg-bg-subtle p-4 text-body-s text-text-secondary">
          <code className="break-all whitespace-pre-wrap">{profileSource}</code>
        </pre>
        <div>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md border border-border-subtle px-3 text-body-s text-text-primary"
            onClick={() => {
              void navigator.clipboard?.writeText(profileSource).then(
                () => setCopied('profile'),
                () => setCopied(null)
              )
            }}
          >
            {copied === 'profile' ? 'copied' : 'copy the address'}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-heading-m font-bold text-text-primary">
          What it sends
        </h2>
        <p className="text-body-m font-normal text-text-secondary">
          The address of the page and its HTML, to Worktrack and nowhere else.
          Either button runs only when you click it, reads nothing you have not
          opened, and is not a tracker &mdash; neither runs in the background.
          The posting one opens the usual form for you to check and save. The
          profile one updates your Worktrack profile, which you can clear from
          Settings at any time. The profile button also strips the page&rsquo;s
          scripts, styles and images before sending it: what travels is the
          text, not the machinery around it.
        </p>
      </section>
    </main>
  )
}
