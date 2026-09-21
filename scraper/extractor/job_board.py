"""Job postings from four Apify board scrapers, mapped onto one shape.

WHY THESE AND WHY THROUGH APIFY (Gabe, 2026-09-21: add LinkedIn, JobStreet,
Indeed and Glassdoor to the fresh-roles rail; Glassdoor removed the same day,
its actor being in maintenance). Every one of them is
a board this service already knows it cannot read for itself: Indeed answers an
anonymous request with a Cloudflare 401, JobStreet and SEEK answer 403, and
LinkedIn serves a guest challenge. Those are the same walls the POSTING
extractor documents, so the
answer is the same one the profile reader already uses -- an actor that solves
the challenge and returns structured rows.

WHAT THIS FILE IS NOT. It is not the feed. Jobicy stays exactly where it was:
keyless, CORS-open, free and instant, fetched by the browser with no service in
the middle. These four cost money and take tens of seconds, so they are
additive and asked for by name. A rail that ran four paid actors on every visit
to the planner would be a bill and a spinner.

EVERY KEY IS READ UNDER EVERY PLAUSIBLE SPELLING, which is the lesson
`apify_profile` wrote down: an actor's README names the concepts -- title,
company, posted date -- without pinning the field names, and different actors
in the same category disagree about all of them. A wrong guess here loses one
field quietly; a crash loses the whole run. Nothing below raises on a shape it
does not recognise.

NOTHING IS STORED, and the shape says so. These rows are the same `FeedJob`
`services/jobFeed.ts` already draws from Jobicy, plus a `source` -- so the rail
renders them with the code it already has, and tracking one still goes through
the ordinary add flow rather than copying somebody else's posting into this
database.

Everything here is PURE: dataset rows in, a list of dicts out. The runs live in
`app.py`, so this is testable against saved rows with no network and no spend.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Iterable

#: The actor behind each source, and the input key it wants its search in.
#:
#: THE INPUT SHAPES DISAGREE and there is no way around naming each one. Some
#: take a list of search URLs, some take plain fields; `app.py` builds the
#: payload from this table rather than from a branch per board.
#:
#: GLASSDOOR IS NOT HERE (Gabe, 2026-09-21: "removed the glassdoor scraper
#: since the apify is now on maintenance"). `radeance~glassdoor-jobs-scraper`
#: is the actor it used, and putting it back is this entry plus its two lines
#: in `services/jobFeed.ts` -- nothing else in this file is board-specific.
#: It is removed rather than left failing because a board that answers every
#: search with an error is a control that wastes a press and a throttle tick.
ACTORS: dict[str, dict[str, Any]] = {
    "linkedin": {
        "actor": "bebity~linkedin-jobs-scraper",
        "label": "LinkedIn",
    },
    "jobstreet": {
        "actor": "easyapi~jobstreet-job-scraper",
        "label": "JobStreet",
    },
    "indeed": {
        "actor": "curious_coder~indeed-scraper",
        "label": "Indeed",
    },
}

#: Every source this module can return, for a caller validating a request.
SOURCES: tuple[str, ...] = tuple(ACTORS)


def _clean(value: Any) -> str | None:
    """A trimmed single-line string, or None.

    HTML IS STRIPPED RATHER THAN ESCAPED. Several of these actors return a
    description as markup, and the only thing downstream wants from it is a
    sentence. A half-open tag in the middle of prose is noise either way, and
    nothing in this app renders these strings as HTML.
    """
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = str(value)
    if not isinstance(value, str):
        return None
    text = re.sub(r"<[^>]*>", " ", value)
    text = " ".join(text.split())
    # A stripped tag leaves a space in front of whatever followed it, so
    # "<b>thing</b>." arrives as "thing .". Closing the gap here rather than at
    # each call site: every string this module returns goes through here.
    text = re.sub(r"\s+([.,;:!?%)])", r"\1", text)
    return text or None


def _pick(row: dict[str, Any], *keys: str) -> Any:
    """The first key that carries something, case-insensitively.

    Actors disagree about `jobUrl` / `url` / `link` and about `companyName` /
    `company` / `employerName`, and one of them nests the lot under `job`. This
    walks the spellings in the order given and looks one level into a nested
    dict, which is as deep as any of these four go.
    """
    lowered = {str(k).lower(): v for k, v in row.items()}
    for key in keys:
        value = lowered.get(key.lower())
        if value not in (None, "", [], {}):
            return value
    for nested_key in ("job", "jobPosting", "data"):
        nested = lowered.get(nested_key)
        if isinstance(nested, dict):
            found = _pick(nested, *keys)
            if found is not None:
                return found
    return None


def _text(row: dict[str, Any], *keys: str) -> str | None:
    """`_pick`, flattened to a string. A one-entry list is its entry."""
    value = _pick(row, *keys)
    if isinstance(value, list):
        value = value[0] if value else None
    if isinstance(value, dict):
        # A `{name: ...}` / `{label: ...}` node is how three of these four wrap
        # a company and a location.
        value = value.get("name") or value.get("label") or value.get("text")
    return _clean(value)


def _url(row: dict[str, Any], *keys: str) -> str | None:
    """A posting address, or None.

    SCHEME-CHECKED HERE AS WELL AS IN THE BROWSER. `services/jobFeed.ts`
    checks it again before it reaches an `href`, and both checks are worth
    having: this one keeps a `javascript:` string from ever being stored or
    logged, and that one is the last line before the DOM.
    """
    value = _text(row, *keys)
    if not value:
        return None
    if value.startswith("//"):
        value = f"https:{value}"
    if not re.match(r"^https?://", value, re.IGNORECASE):
        return None
    return value


def _iso(value: Any) -> str | None:
    """An ISO instant from whatever the actor called a date.

    THREE FORMS ARRIVE and all three are common: an ISO string, an epoch in
    seconds or milliseconds, and a relative English phrase ("3 days ago"),
    which is what a rendered board shows and what a scraper of one returns.
    The relative form is resolved against now, which is the only reading of it
    that exists -- the page itself has no other.
    """
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        seconds = float(value)
        # Milliseconds, if it is far too large to be seconds.
        if seconds > 10_000_000_000:
            seconds /= 1000
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return None

    text = _clean(value)
    if not text:
        return None

    relative = re.match(
        r"^(?:posted\s+)?(\d+)\+?\s*(minute|hour|day|week|month)s?\s*ago", text, re.IGNORECASE
    )
    if relative:
        amount = int(relative.group(1))
        unit = relative.group(2).lower()
        hours = {"minute": 1 / 60, "hour": 1, "day": 24, "week": 168, "month": 720}[unit]
        stamp = datetime.now(tz=timezone.utc).timestamp() - amount * hours * 3600
        return datetime.fromtimestamp(stamp, tz=timezone.utc).isoformat()

    if re.match(r"^(just posted|today|new)$", text, re.IGNORECASE):
        return datetime.now(tz=timezone.utc).isoformat()
    if re.match(r"^yesterday$", text, re.IGNORECASE):
        stamp = datetime.now(tz=timezone.utc).timestamp() - 86_400
        return datetime.fromtimestamp(stamp, tz=timezone.utc).isoformat()

    # An epoch that arrived as a string.
    if re.match(r"^\d{10,13}$", text):
        return _iso(int(text))

    candidate = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d %b %Y", "%b %d, %Y"):
            try:
                parsed = datetime.strptime(text, pattern)
                break
            except ValueError:
                continue
        else:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat()


#: The currency symbols and codes these boards print, and what they mean.
_CURRENCIES: dict[str, str] = {
    "$": "USD",
    "us$": "USD",
    "usd": "USD",
    "₱": "PHP",
    "php": "PHP",
    "£": "GBP",
    "gbp": "GBP",
    "€": "EUR",
    "eur": "EUR",
    "a$": "AUD",
    "aud": "AUD",
    "s$": "SGD",
    "sgd": "SGD",
    "rm": "MYR",
    "myr": "MYR",
    "₹": "INR",
    "inr": "INR",
}


#: The words a board uses to say what a number is per. Their presence is what
#: separates "2026" the year from "2026 per day" the rate.
_PERIOD = re.compile(
    r"\b(per|a|an|/)\s*(year|annum|yr|month|mo|week|wk|day|hour|hr)\b"
    r"|\b(annually|monthly|weekly|hourly|salary|pay|wage|compensation)\b",
    re.IGNORECASE,
)


def _salary(value: Any) -> tuple[int | None, int | None, str | None]:
    """`(min, max, currency)` out of whatever the board printed.

    A BOARD WRITES A BAND AS PROSE -- "₱30,000 - ₱45,000 per month", "$120K -
    $150K a year", "Up to £60,000" -- and two of these four actors pass that
    string through untouched. Reading it is the only way to get a number, and
    getting it wrong is worse than having none, so anything that does not parse
    cleanly returns nothing at all.

    A MONTHLY FIGURE IS LEFT MONTHLY. Annualising it would be this file
    inventing a number the posting never stated, and the rail shows the band
    beside a title rather than comparing bands to each other.
    """
    if isinstance(value, dict):
        low = value.get("min") or value.get("minValue") or value.get("from")
        high = value.get("max") or value.get("maxValue") or value.get("to")
        currency = _clean(value.get("currency") or value.get("currencyCode"))
        pair = (_int(low), _int(high))
        if pair[0] or pair[1]:
            return pair[0], pair[1], (currency.upper() if currency else None)
        value = value.get("text") or value.get("label")

    text = _clean(value)
    if not text:
        return None, None, None

    currency: str | None = None
    lowered = text.lower()
    # LONGEST TOKEN FIRST, or "a$120,000" reads as USD: "$" is a substring of
    # every one of "a$", "s$" and "us$", so insertion order would decide the
    # currency rather than the text.
    for token in sorted(_CURRENCIES, key=len, reverse=True):
        if token in lowered:
            currency = _CURRENCIES[token]
            break

    numbers: list[int] = []
    for raw, suffix in re.findall(r"(\d[\d,.]*)\s*([kKmM]?)", text):
        digits = raw.replace(",", "")
        try:
            amount = float(digits)
        except ValueError:
            continue
        if suffix.lower() == "k":
            amount *= 1_000
        elif suffix.lower() == "m":
            amount *= 1_000_000
        # A year, a headcount or a per-hour rate is not a salary band. Anything
        # under a thousand is dropped rather than shown as a wage.
        if amount >= 1_000:
            numbers.append(int(amount))

    if not numbers:
        return None, None, currency
    if len(numbers) == 1:
        # A LONE YEAR IS NOT A WAGE. "Posted 2026" and "Class of 2019" both
        # land in range and neither carries a currency or a period, so a single
        # unaccompanied number that reads as a year is dropped rather than
        # printed beside a job title as a salary.
        if not currency and 1900 <= numbers[0] <= 2100 and not _PERIOD.search(text):
            return None, None, None
        return numbers[0], None, currency
    return min(numbers[:2]), max(numbers[:2]), currency


def _int(value: Any) -> int | None:
    """A positive whole number, or None."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number > 0 else None


def _excerpt(row: dict[str, Any]) -> str | None:
    """One or two sentences of the description, never the whole thing.

    A FULL DESCRIPTION IS 3-6KB OF THIRD-PARTY MARKUP PER ROW and the rail
    shows two lines of it. `jobFeed.ts` drops Jobicy's for exactly this reason
    -- keeping it would put untrusted markup one careless render away from the
    DOM -- and the same rule applies to a row that cost money to fetch.
    """
    text = _text(row, "descriptionText", "jobDescription", "description", "snippet", "summary")
    if not text:
        return None
    return text[:280].rstrip() + ("…" if len(text) > 280 else "")


def to_feed_job(raw: Any, source: str) -> dict[str, Any] | None:
    """One dataset row as a `FeedJob`, or None when it cannot be shown.

    THE THREE FIELDS THAT ARE NOT OPTIONAL are a title, a link and a date: the
    rail groups by day, links the title, and has nothing to say about a posting
    missing any of them. A row without them is dropped rather than rendered as
    "undefined", which is the same rule `toFeedJob` applies to Jobicy.
    """
    if not isinstance(raw, dict):
        return None

    title = _text(raw, "title", "jobTitle", "positionName", "position", "name")
    url = _url(raw, "jobUrl", "url", "link", "jobLink", "applyUrl", "detailsUrl", "externalUrl")
    published = _iso(
        _pick(
            raw,
            "publishedAt",
            "postedAt",
            "postedDate",
            "listingDate",
            "postingDateParsed",
            "datePosted",
            "date",
            "createdAt",
        )
    )
    if not title or not url or not published:
        return None

    salary_min, salary_max, currency = _salary(
        _pick(raw, "salary", "salaryEstimate", "salarySnippet", "salaryRange", "compensation")
    )

    return {
        # THE ADDRESS IS THE IDENTITY, prefixed by its source. An actor's own
        # id is not stable between runs and two boards can mint the same one,
        # and the rail keys React rows and the tracked map on this.
        "id": f"{source}:{_text(raw, 'id', 'jobId', 'jobKey') or url}",
        "title": title,
        "company": _text(
            raw, "companyName", "company", "employerName", "advertiser", "organization"
        )
        or "unnamed company",
        "url": url,
        "geo": _text(raw, "location", "jobLocation", "formattedLocation", "place", "city"),
        "level": _text(raw, "experienceLevel", "seniority", "jobLevel", "workType", "jobType"),
        "industry": _text(raw, "sector", "industry", "classification", "category"),
        "publishedAt": published,
        "excerpt": _excerpt(raw),
        "salaryMin": salary_min,
        "salaryMax": salary_max,
        "salaryCurrency": currency,
        "source": source,
    }


def to_feed_jobs(rows: Iterable[Any], source: str) -> list[dict[str, Any]]:
    """Every readable row from one actor, newest first, without duplicates.

    DE-DUPLICATED ON THE ADDRESS because a board lists the same posting under
    several searches, and an actor asked for two pages returns the overlap.
    """
    seen: set[str] = set()
    jobs: list[dict[str, Any]] = []
    for row in rows or []:
        job = to_feed_job(row, source)
        if not job or job["url"] in seen:
            continue
        seen.add(job["url"])
        jobs.append(job)
    jobs.sort(key=lambda job: job["publishedAt"], reverse=True)
    return jobs
