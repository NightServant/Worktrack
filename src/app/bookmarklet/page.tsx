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
function bookmarkletSource(origin: string): string {
  // Deliberately terse: this string ends up in a bookmark, where every byte is
  // visible in the browser's own editor. The retry loop exists because the
  // sender cannot know when the opened tab has finished loading; the ack is
  // its off-switch, and the 80-attempt ceiling is its backstop.
  return `javascript:(function(){var o=${JSON.stringify(origin)};var w=window.open(o+'/applications?import=bookmarklet&add='+encodeURIComponent(location.href),'_blank');if(!w){alert('Worktrack: allow pop-ups for this site, then click again.');return;}var p={type:'worktrack:posting',html:document.documentElement.outerHTML};var n=0,t=setInterval(function(){if(++n>80){clearInterval(t);return;}try{w.postMessage(p,o);}catch(e){}},250);window.addEventListener('message',function(e){if(e.origin===o&&e.data&&e.data.type==='worktrack:posting:received'){clearInterval(t);}});})()`
}

export default function BookmarkletPage() {
  const linkRef = React.useRef<HTMLAnchorElement>(null)
  const [source, setSource] = React.useState('')
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    const code = bookmarkletSource(window.location.origin)
    setSource(code)
    linkRef.current?.setAttribute('href', code)
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
                () => setCopied(true),
                () => setCopied(false)
              )
            }}
          >
            {copied ? 'copied' : 'copy the address'}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-heading-m font-bold text-text-primary">
          What it sends
        </h2>
        <p className="text-body-m font-normal text-text-secondary">
          The address of the page and its HTML, to Worktrack and nowhere else.
          It runs only when you click it, it reads nothing you have not opened,
          and it saves nothing on its own &mdash; the application opens in the
          usual form, for you to check and save. It is not a tracker and it does
          not run in the background.
        </p>
      </section>
    </main>
  )
}
