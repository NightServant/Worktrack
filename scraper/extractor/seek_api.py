"""JobStreet and SEEK, read through the endpoint their own pages call.

WHY THIS EXISTS (Gabe, 2026-09-19: "I want the autofill to work properly").
The HTML route to these boards is shut and cannot be opened by us. Measured
that day on `ph.jobstreet.com/job/94730110`: a plain request answers 403 with a
Cloudflare challenge -- from a residential address as readily as from a data
centre, so it is the CLIENT being refused, not the network -- and Firecrawl,
which exists to solve exactly this and which we pay for, answered `http-500:
All scraping engines failed`, having tried its own stealth Chrome twice.

THE SAME POSTING IS PUBLISHED AT `/graphql` ON THE SAME HOST, unauthenticated,
and a bare `curl` with one header gets 200 and the whole record. That endpoint
is what the site's own pages call to draw the posting; this asks it the same
question for the same public advert the reader is looking at. There is no
challenge to solve, no session to borrow, no header to forge and no disguise to
wear -- which is the difference between this and every route the service has
deliberately refused to take. `_render` is still a plain browser and
`StealthyFetcher` is still not imported.

IT IS ONE PLATFORM UNDER SEVERAL NAMES. SEEK owns JobStreet, and
`jobstreet.com.ph`, `ph.jobstreet.com`, `seek.com.au` and their siblings all
serve the same schema from the same path, so the host pattern carries the whole
family rather than one country's domain.

PURE, LIKE `core.py`. The query text and the mapping live here; the request
lives in `app.py`, which owns every fetch, every timeout and the SSRF re-check.
That is what keeps the fixture tests on the same code path the service runs
with no network in the suite.
"""

from __future__ import annotations
#: WHAT IS KNOWN ABOUT JOBSTREET'S *SEARCH* ENDPOINT, AND WHAT IS NOT.
#:
#: This file reads ONE posting. The rail wants a SEARCH, and on 2026-09-21 that
#: was investigated and left unfinished -- written down here so the next attempt
#: starts from what was learned rather than from nothing.
#:
#: FOUND, by reading the search page's own Apollo cache (`SEEK_APOLLO_DATA`)
#: and hooking its `fetch`:
#:
#:   operation   jobSearchV7(params: JobSearchV7QueryInput!)
#:   endpoint    the same https://<host>/graphql this file already uses
#:   params      { sessionId, responseConfig { page, pageSize, representations:
#:               ["uiV1"], results: ["jobs"], enrichment {...} },
#:               searchContext { brand: "jobstreet", channel: "web",
#:               intent: "SEARCH", source: "FE_SERP", solVisitorId },
#:               searchIntent { country, locale, sort, text, distanceKms } }
#:   headers     X-Seek-EC-SessionId, X-Seek-EC-VisitorId, X-Seek-Site:
#:               "chalice", seek-request-brand, seek-request-country
#:   response    results { jobs { id title abstract url listedAt { dateTimeUtc }
#:               advertiser { name } location { displayName { text } }
#:               salary { min max currency period } } pagination { resultCount } }
#:
#: The salary is STRUCTURED there -- `{min, max, currency, period}` -- which is
#: better than every other board on the rail, all of which print a band as prose
#: that `job_board._salary` has to read back.
#:
#: NOT FOUND: why a replay fails. With those params and those headers, and with
#: freshly generated UUIDs rather than the page's, the endpoint answers 200 and
#: `{"errors":[{"message":"An error occurred"}]}` -- a resolver throwing, with
#: nothing said about what. Every field selection fails the same way, including
#: `{ id title }`, so it is not the selection. Something the page has and a bare
#: request does not is still missing.
#:
#: THE UUIDS ARE NOT THE PROBLEM TO SOLVE BY COPYING THEM. `sessionId` and
#: `solVisitorId` are minted by the page for itself; generating our own is what
#: any first-time visitor does, and reusing a captured one would be borrowing
#: somebody's session, which is the line this service does not cross.
#:
#: SO JOBSTREET STAYS ON ITS PAID ACTOR for the rail. The single-posting route
#: below is unaffected and still free.


import re
from typing import Any
from urllib.parse import urlsplit

from .normalise import (
    clean_text,
    infer_work_mode,
    salary_range_from_text,
    source_from_host,
)
from .schema import Envelope
from .sites.generic import _html_to_text, _tech_from_prose

#: The SEEK family, by the hosts they actually serve postings on.
_HOSTS = re.compile(
    r"(^|\.)(jobstreet\.com(\.[a-z]{2})?|jobstreet\.co\.[a-z]{2}|seek\.com(\.[a-z]{2})?)$",
    re.I,
)

#: `/job/<digits>`, which every posting on the platform uses. The query string
#: carries tracking (`?ref=saved`, `?type=standard`) and never the identity.
_JOB_ID = re.compile(r"/job/(\d+)")

#: What the page itself asks for, trimmed to the fields this app has a column
#: for.
#:
#: TWO `label` FIELDS TAKE DIFFERENT ARGUMENTS, which is not a typo and cost a
#: round trip to find: `classifications.label` REQUIRES `languageCode` and
#: `workTypes.label` REFUSES it. Asking both the same way fails the whole query
#: with a validation error rather than dropping one field.
QUERY = (
    "query jobDetails($jobId: ID!) { jobDetails(id: $jobId) { job { "
    "title "
    "advertiser { name } "
    "location { label } "
    "salary { label } "
    "workTypes { label } "
    'classifications { label(languageCode: "en") } '
    "content(platform: WEB) "
    "} } }"
)


def api_request(url: str) -> tuple[str, dict[str, Any]] | None:
    """`(endpoint, body)` for a posting on this platform, or None.

    Returns None for a host that is not SEEK's and for a URL with no job id in
    it, so the caller can ask this about anything and act on the answer.
    """
    parts = urlsplit(url)
    host = parts.hostname or ""
    if not _HOSTS.search(host):
        return None
    found = _JOB_ID.search(parts.path)
    if not found:
        return None
    return (
        f"https://{host}/graphql",
        {
            "operationName": "jobDetails",
            "variables": {"jobId": found.group(1)},
            "query": QUERY,
        },
    )


def job_from_reply(payload: object) -> dict[str, Any] | None:
    """The job record out of a GraphQL reply, or None for anything else.

    GraphQL ANSWERS 200 WITH ERRORS, which is the shape that bites: a failed
    query is a successful HTTP request carrying an `errors` array and a null
    `data`, so a status check alone would hand the mapper below a None and call
    it a posting.
    """
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    details = data.get("jobDetails")
    if not isinstance(details, dict):
        return None
    job = details.get("job")
    return job if isinstance(job, dict) else None


def _label(value: object) -> str:
    """`{"label": "..."}`, which is how this schema says almost everything."""
    if isinstance(value, dict):
        return clean_text(str(value.get("label") or ""))
    return ""


def envelope_from_job(url: str, job: dict[str, Any]) -> Envelope:
    """The platform's own record of a posting, as this app's fields.

    CONFIDENCE SITS WITH JSON-LD'S, deliberately. This is not a guess off a
    page title: it is the row the board renders the advert from, which is the
    same class of source as a `JobPosting` block and better than anything the
    DOM heuristics can offer.
    """
    host = urlsplit(url).hostname or ""
    values: dict[str, Any] = {"url": url, "source": source_from_host(host)}
    confidence: dict[str, float] = {"url": 1.0, "source": 0.9}

    title = clean_text(str(job.get("title") or ""))
    if title:
        values["role"] = title
        confidence["role"] = 0.95

    company = _label({"label": (job.get("advertiser") or {}).get("name")})
    if company:
        values["company"] = company
        confidence["company"] = 0.95

    location = _label(job.get("location"))
    if location:
        values["location"] = location
        confidence["location"] = 0.9

    description = _html_to_text(str(job.get("content") or ""))
    if description:
        values["description"] = description
        confidence["description"] = 0.95

    # THE ADVERTISER'S OWN STRING, parsed by the same reader that handles a
    # salary written into prose -- "₱70,000 – ₱100,000 per month" carries the
    # currency in a glyph, and guessing it from the country would be right
    # until the first posting that quotes USD.
    salary_label = _label(job.get("salary"))
    if salary_label:
        low, high, currency = salary_range_from_text(salary_label)
        if low is not None:
            values["salary_min"] = low
            confidence["salary_min"] = 0.9
        if high is not None:
            values["salary_max"] = high
            confidence["salary_max"] = 0.9
        # A CODE ONLY BESIDE A FIGURE. On its own it relabels nothing and
        # outlives the posting it came from.
        if currency and (low is not None or high is not None):
            values["salary_currency"] = currency
            confidence["salary_currency"] = 0.9

    # WORK TYPE AND CATEGORY ARE TAGS, NOT SKILLS. "Full time" and
    # "Developers/Programmers" are facets to filter a pipeline by; they are not
    # things the reader can claim on a CV, which is what `tech_stack` is for.
    tags: list[str] = []
    work_type = _label(job.get("workTypes"))
    if work_type:
        tags.append(work_type)
    classifications = job.get("classifications")
    if isinstance(classifications, list):
        for entry in classifications:
            label = _label(entry)
            if label and label not in tags:
                tags.append(label)
    if tags:
        values["tags"] = tags
        confidence["tags"] = 0.9

    tech = _tech_from_prose(f"{title}\n{description}")
    if tech:
        values["tech_stack"] = tech
        confidence["tech_stack"] = 0.4

    # THE TITLE IS READ FOR IT TOO, and on this platform that is where it
    # usually is: "Front-End Web Developer (HTML5, CSS3) | WFH". The schema has
    # no work-mode column of its own.
    mode = infer_work_mode(f"{title}\n{work_type}\n{description}")
    if mode:
        values["work_mode"] = mode
        confidence["work_mode"] = 0.5

    return {"values": values, "confidence": confidence, "warnings": []}
