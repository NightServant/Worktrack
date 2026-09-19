'use client'

import * as React from 'react'

/**
 * How to install the "send this posting to Worktrack" bookmarklet.
 *
 * WHY THE APP SHIPS ONE. Indeed answers an anonymous fetch with a Cloudflare
 * 401 and a redirect carrying `from=bot-detection-anonymous`. Nothing we can
 * buy is measured to open that, and the alternatives were priced and declined
 * (docs/EXTRACTION-FREE-OPTIONS.md). The reader's own browser has already
 * loaded the page, so the cheapest route to the posting is to let them hand it
 * over: not a scraper pretending to be a person, but the person.
 *
 * IT IS A BOOKMARKLET RATHER THAN AN EXTENSION because an extension is a store
 * listing, a review queue and an update channel for what is, in the end, forty
 * characters of `outerHTML`. A bookmarklet installs by dragging a link and is
 * removed by deleting a bookmark.
 *
 * THE HREF IS SET THROUGH A REF, and that is not a style choice: React refuses
 * to render a `javascript:` URL into `href` and warns about it, which is the
 * right default everywhere except the one place the scheme is the entire
 * point. `setAttribute` after mount is the usual escape hatch. The source is
 * also printed below, because a link that cannot be dragged on a phone is not
 * an install path.
 *
 * THE ORIGIN IS READ AT RUNTIME rather than baked in at build time, so the
 * same page hands out a working bookmarklet on localhost, on a preview
 * deployment and in production without three builds or a hardcoded domain
 * that goes stale the next time the project is renamed.
 */
/**
 * The PROFILE bookmarklet: the same handshake, a different destination.
 *
 * WHY THE PROFILE NEEDS ONE (Gabe, 2026-09-18: "build the bookmarklet for
 * LinkedIn too"). Everything a signed-out visitor gets from LinkedIn is thin
 * by design -- no About, no skills, no bullet text under a role, and on some
 * profiles no job titles. That is not weak protection to be defeated; the data
 * is simply not rendered to a stranger. The one client that can see it is the
 * owner, logged in, on their own page.
 *
 * IT STRIPS THE PAGE BEFORE SENDING IT, which the posting one does not need
 * to. A LinkedIn profile is megabytes of scripts and inline styles around a
 * few kilobytes of person; the reader is parsed from the markup, so everything
 * executable goes before the copy is made. Smaller to send, smaller to hold,
 * and nothing this app parses is lost with it.
 *
 * `/settings?import=bookmarklet&profile=<url>` rather than `/applications`:
 * the profile lives on the settings screen, and the address rides the query
 * string exactly as `?add=` does for a posting.
 */
function profileBookmarkletSource(origin: string): string {
  return `javascript:(function(){var o=${JSON.stringify(origin)};if(location.hostname.indexOf('linkedin.com')<0){alert('Worktrack: open your LinkedIn profile first, then click this.');return;}var w=window.open(o+'/settings?import=bookmarklet&profile='+encodeURIComponent(location.href),'_blank');if(!w){alert('Worktrack: allow pop-ups for this site, then click again.');return;}var d=document.documentElement.cloneNode(true);Array.prototype.forEach.call(d.querySelectorAll('script,style,noscript,link,svg,img'),function(n){n.parentNode&&n.parentNode.removeChild(n);});var p={type:'worktrack:profile',html:d.outerHTML};var n=0,t=setInterval(function(){if(++n>80){clearInterval(t);return;}try{w.postMessage(p,o);}catch(e){}},250);window.addEventListener('message',function(e){if(e.origin===o&&e.data&&e.data.type==='worktrack:profile:received'){clearInterval(t);}});})()`
}

function bookmarkletSource(origin: string): string {
  // Deliberately terse: this string ends up in a bookmark, where every byte is
  // visible in the browser's own editor. The retry loop exists because the
  // sender cannot know when the opened tab has finished loading; the ack is
  // its off-switch, and the 80-attempt ceiling is its backstop.
  return `javascript:(function(){var o=${JSON.stringify(origin)};var w=window.open(o+'/applications?import=bookmarklet&add='+encodeURIComponent(location.href),'_blank');if(!w){alert('Worktrack: allow pop-ups for this site, then click again.');return;}var p={type:'worktrack:posting',html:document.documentElement.outerHTML};var n=0,t=setInterval(function(){if(++n>80){clearInterval(t);return;}try{w.postMessage(p,o);}catch(e){}},250);window.addEventListener('message',function(e){if(e.origin===o&&e.data&&e.data.type==='worktrack:posting:received'){clearInterval(t);}});})()`
}

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

        {/* THE LONG SECTIONS NEED THEIR OWN PAGE (Gabe, 2026-09-19:
            "credentials fetch two only, I have EIGHT from my LinkedIn
            account"). LinkedIn renders the first two or three of a long
            section and a `Show all N` link -- on the OWNER's own profile as
            well as to a stranger -- so capturing the profile page cannot
            recover the rest however you are signed in. Each `Show all` goes to
            a page that holds the whole list, and the reader understands those
            pages too. */}
        <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-subtle p-4">
          <p className="text-body-m font-medium text-text-primary">
            Long lists live on their own page
          </p>
          <p className="text-body-s font-normal text-text-secondary">
            Your profile shows only the first few certificates, roles or
            schools and then a <span className="text-text-primary">Show all</span>{' '}
            link. Press that first, then click the bookmarklet on the page it
            opens &mdash; Worktrack reads the whole list from there and leaves
            the rest of your profile alone. It works on any of these:
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-body-s font-normal text-text-muted">
            <li>
              <code className="text-text-secondary">/details/certifications/</code> &mdash;
              with each one&rsquo;s issue date, expiry and credential ID
            </li>
            <li>
              <code className="text-text-secondary">/details/education/</code> &mdash; with
              the academic years
            </li>
            <li>
              <code className="text-text-secondary">/details/experience/</code>,{' '}
              <code className="text-text-secondary">/details/projects/</code>,{' '}
              <code className="text-text-secondary">/details/skills/</code>
            </li>
          </ul>
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
