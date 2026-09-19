"""Bot challenges, and what to say when one is served.

PORTED VERBATIM IN BEHAVIOUR from the Deno function, because the behaviour is
the considered part. JobStreet, JobsDB and SEEK answer a server-side fetch with
Cloudflare's interstitial -- measured 2026-09-05: 403 on every HTML path, from
a browser User-Agent with full Accept headers, with only `robots.txt` answering
200 because it is served outside the challenge.

Two rules come out of that and both survive the port:

A BOT CHALLENGE IS NOT A BROKEN LINK. Reporting one as "could not fetch this
URL" sends the reader to check a URL that is perfectly correct. It returns 200
with what the URL alone proves, names the site, and points at pasting -- which
works, because a browser that is already past the challenge is the only thing
on the user's side that can read the page.

A CHALLENGE CAN ARRIVE AS A 200. A page whose only job is to run JS and
redirect parses "successfully" and yields "Just a moment..." as the role, which
is worse than an error because nothing looks broken. So the body is checked as
well as the status.
"""

from __future__ import annotations

import html as _html
import re

import re
from urllib.parse import urlsplit

from .schema import Envelope

# RE-MEASURED 2026-09-06 (M7 Task 8), from a residential PH connection, with
# the browser headers below. The list is SHORTER than it was, and that is the
# result the task existed to produce:
#
#   JobStreet  /  and /jobs   -> 403, "Just a moment...", Cloudflare markers
#   JobsDB     /  and /jobs   -> 200, 950KB, <title>Jobs in Hong Kong ...
#   SEEK       /  and /jobs   -> 403, 50KB, SEEK's OWN page, no CF marker
#   Greenhouse (control)      -> 200        (proves the client, not the sites)
#
# JOBSDB CAME OFF THE LIST. It answered a plain server-side fetch with real
# HTML. Leaving it here would refuse a site we can read, which is the failure
# the parser's own test already guards in the other direction: "a site that
# does NOT block must not be labelled as one".
#
# SEEK STAYS, with its description corrected: it is a 403, not a Cloudflare
# interstitial. The status is a refusal either way, so the behaviour is the
# same, but calling it Cloudflare would send the next person hunting for a
# challenge that is not there.
#
# INDEED JOINED THE LIST 2026-09-17, and the whole point of the row is the
# MESSAGE: a 401 used to reach the reader as "Could not fetch page (status
# 401)", which reads as a broken link on a URL that is perfectly correct. See
# docs/BRIGHTDATA-EVALUATION.md §1 for the measurement -- 1,675 bytes titled
# "Authenticating...", whose only content redirects to
# /account/login?...&from=bot-detection-anonymous. `ph.indeed.com` answers
# identically and `robots.txt` answers 200, which is the same signature
# JobStreet and SEEK showed.
_CHALLENGED_HOSTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(^|\.)jobstreet\.com(\.[a-z]{2})?$", re.I), "JobStreet"),
    (re.compile(r"(^|\.)seek\.com(\.[a-z]{2})?$", re.I), "SEEK"),
    (re.compile(r"(^|\.)indeed\.com(\.[a-z]{2})?$", re.I), "Indeed"),
)

_CHALLENGE_MARKERS = (
    re.compile(r"Just a moment\.\.\.", re.I),
    re.compile(r"cf-browser-verification|cf_chl_opt|__cf_chl", re.I),
    re.compile(r"Checking your browser before accessing", re.I),
    # CLOUDFLARE'S OTHER BOOTSTRAP, and the three above genuinely miss it.
    # Indeed's interstitial says "Authenticating..." and carries `__CF$cv$params`
    # with a `/cdn-cgi/challenge-platform/` script -- no "Just a moment", no
    # `__cf_chl` (measured 2026-09-17).
    #
    # THE STATUS RULE BELOW DOES NOT COVER THIS. `/extract` re-asks
    # `looks_like_bot_challenge(200, rendered)` about whatever Firecrawl hands
    # back, where there is no status left to judge -- so without this marker an
    # escalation that returned the same challenge page would be parsed as a
    # posting and yield "Authenticating..." as the role. That is the docblock's
    # second rule, on the exact page that prompted it.
    re.compile(r"__cf\$cv\$params|/cdn-cgi/challenge-platform/", re.I),
)


def challenged_site_name(hostname: str) -> str | None:
    host = re.sub(r"^www\.", "", hostname.strip().lower())
    for pattern, name in _CHALLENGED_HOSTS:
        if pattern.search(host):
            return name
    return None


def looks_like_bot_challenge(status: int, body: str) -> bool:
    # 401 IS A BOT CHALLENGE HERE, and it was the two-character gap that kept
    # Indeed unreadable (measured 2026-09-17, docs/BRIGHTDATA-EVALUATION.md).
    # Indeed answers an anonymous fetch with 401 and a Cloudflare page that
    # redirects to /account/login?...&from=bot-detection-anonymous, so `app.py`
    # fell past this branch into the generic `status >= 400` error and
    # `_fetch_rendered` -- Firecrawl, which we already pay for and whose `auto`
    # proxy escalates on exactly 401/403/429 -- was never asked.
    #
    # THE TRADE, STATED: 401 genuinely means "not authorised", so a page that
    # truly requires a login is now labelled a challenge rather than an error.
    # For this service that is the correct reading -- every target is a public
    # posting URL somebody pasted, and a 401 on one IS a refusal to serve bots.
    # Both outcomes of the relabel beat the old one: a render that works, or a
    # 200 from `autofill_from_url_alone` that names the site and asks for a
    # paste instead of blaming a valid link.
    if status in (401, 403, 503):
        return True
    head = body[:4000]
    return any(marker.search(head) for marker in _CHALLENGE_MARKERS)


def autofill_from_url_alone(url: str) -> Envelope:
    """What a URL alone establishes, for a page that could not be read.

    Worth returning rather than nothing: it saves a field, and -- more usefully
    -- it confirms the app understood the link, which a bare "could not fetch"
    does not. Confidence is deliberately below every parsed value's, and
    nothing here is guessed from the path: only the site's own name.
    """
    host = urlsplit(url).hostname or ""
    name = challenged_site_name(host)
    values: dict[str, object] = {"url": url}
    confidence: dict[str, float] = {}
    if name:
        values["source"] = name
        confidence["source"] = 1.0
    # IT NAMED A BUTTON THAT NO LONGER EXISTS. Both halves of this said "use
    # 'Tidy and summarise'", which was deleted on 2026-09-10 when the add
    # wizard started summarising every posting it FETCHES -- so the one reader
    # who ever sees this sentence is the one reader the digest never runs for.
    # Instructions to press something that is not on screen are worse than no
    # instructions: they read as the app being broken rather than the page.
    #
    # It says where the box is instead, because that is the only thing left to
    # do here.
    #
    # AND IT PROMISES THE TIDY-UP, which this comment used to deny. When the
    # sentence was written the digest ran only on a FETCHED posting, so the
    # honest thing to say was that the paste is kept verbatim. That stopped
    # being true on 2026-09-17: `AddApplicationDialog.submitWithDigest`
    # restructures a pasted description on its way to being saved, which is
    # exactly the reader this message is written for. The string was updated
    # and this paragraph was not -- so it is corrected here rather than left to
    # argue the string back to the wrong version. Copy describing a capability
    # is changed by whoever changes the capability.
    # IT SENDS THEM TO THE EMPLOYER FIRST, and that is not a consolation
    # prize -- it is the best outcome available anywhere in this system.
    # Measured 2026-09-17 (docs/EXTRACTION-FREE-OPTIONS.md): an aggregator
    # mirror yields roughly 0.40-0.70 confidence per field even when it CAN be
    # read, because the posting has been reformatted into the aggregator's own
    # template. The employer's own page -- which for most listings is a
    # Greenhouse, Lever, Ashby or Workable posting that `registry.py` already
    # parses natively and for free -- yields 0.90-0.95 on every field.
    #
    # So the unreadable aggregator is a prompt to go one step upstream, where
    # the answer was always better. A paid unlocker pointed at the mirror buys
    # a worse extraction than this sentence does.
    warning = (
        f"{name} blocks automated reads, so the posting could not be fetched. "
        f"Most {name} listings are copies: if the same job is on the employer's "
        "own careers page, paste THAT link instead -- it reads better than any "
        "aggregator. Otherwise paste the description into the column beside the "
        "fields and it will be tidied and summarised when you save."
        if name
        else "That page could not be read automatically. If the job is also on "
        "the employer's own careers page, that link reads best. Otherwise paste "
        "the description into the column beside the fields and it will be tidied "
        "and summarised when you save."
    )
    return {"values": values, "confidence": confidence, "warnings": [warning]}


#: Below this much visible text, a page has no posting on it to read.
#:
#: MEASURED, not guessed. Cloudstaff's careers site returns 110KB of HTML
#: containing FIFTEEN visible characters -- "Cloudstaff Jobs" -- because every
#: posting is rendered client-side. The extractor reported three separate
#: vague warnings about that page ("could not confidently detect role title",
#: "salary was not found in page metadata") when the single true statement was
#: that the page it was handed contained nothing at all.
_MIN_VISIBLE_CHARS = 200

_TAG = re.compile(r"(?s)<(script|style|noscript|template)[^>]*>.*?</\1>", re.I)
_ANY_TAG = re.compile(r"(?s)<[^>]+>")
_SPACES = re.compile(r"\s+")


def visible_text_length(html: str) -> int:
    """Roughly how much a reader would see. Scripts and styles are bytes, not
    words, and an app shell is almost entirely both."""
    stripped = _TAG.sub(" ", html or "")
    text = _html.unescape(_ANY_TAG.sub(" ", stripped))
    return len(_SPACES.sub(" ", text).strip())


def looks_like_javascript_shell(html: str) -> bool:
    """Whether this document is an application shell rather than a page.

    Deliberately narrow: a SHORT page is not the same as an empty one, so this
    asks whether there is essentially no text at all. A real posting that is
    merely terse still clears 200 characters comfortably.
    """
    return visible_text_length(html) < _MIN_VISIBLE_CHARS
