"""A LinkedIn profile from Apify's `crawlerbros/linkedin-profile-scraper`.

WHY A SECOND SOURCE. `profile.py` reads the JSON-LD `Person` graph out of a
Firecrawl fetch, and on the first real test that route did not get a page at
all. LinkedIn serves most guest profile requests an anti-bot challenge, and
Firecrawl is a fetcher rather than a challenge solver -- so the good parser had
nothing to parse.

This actor solves the challenge server-side and returns STRUCTURED JSON, so
there is no HTML to parse here at all: the work is mapping their field names
onto `UserProfile`. It also reaches sections the JSON-LD never carried --
certifications, projects, volunteer work, personal websites.

EVERY WARNING IT LEAVES NAMES THE BOOKMARKLET (2026-09-18). Three of them used
to end "or import a LinkedIn data export", and that button was removed the same
afternoon the bookmarklet shipped -- so the app was telling its owner to press
something that no longer exists, four times, in the one place he was looking
for a way out. A warning that names a fix has to name a fix that is there.

WHAT IT COSTS, because that is not a detail. The actor is pay-per-event:
$0.50 per gigabyte of memory at start (minimum one event) plus $0.01 per
result. One profile at 1GB is about $0.51. `app.py` pins the memory for
exactly this reason.

EVERY FIELD IS OPTIONAL AND THE KEY NAMES ARE READ DEFENSIVELY. The actor
omits a field entirely rather than returning null, so `.get()` everywhere is
the contract rather than caution -- and its README names the nested concepts
("issuer, issue date, credential ID") without pinning the exact keys, so the
few that matter are looked up under every plausible spelling. A wrong guess
here loses one field quietly; a crash loses the whole import.

Everything is PURE: a dataset row in, a `UserProfile` out. The run lives in
`app.py`, so this is testable against a saved row with no network and no spend.
"""

from __future__ import annotations

from typing import Any

from .profile import EMPTY_PROFILE, _clean, _listed


def _block(value: Any) -> str | None:
    """A trimmed multi-line string, or None.

    `_clean` COLLAPSES NEWLINES, which is right for a name and wrong for the
    bullet text under a role -- it turned four bullets into one run-on
    sentence, destroying the only structure the field has. Caught by
    `test_current_roles_come_before_past_ones` before it shipped.

    Each line is trimmed and runs of blank lines collapse to one, so a scraped
    block does not arrive with ragged indentation; the line breaks themselves
    survive, which is what `whitespace-pre-wrap` on the app side renders.
    """
    if not isinstance(value, str):
        return None
    lines = [" ".join(line.split()) for line in value.splitlines()]
    out: list[str] = []
    for line in lines:
        if not line and (not out or not out[-1]):
            continue
        out.append(line)
    text = "\n".join(out).strip()
    return text or None


def _pick_block(node: Any, *names: str) -> str | None:
    """`_pick`, for the fields whose line breaks are the point."""
    if not isinstance(node, dict):
        return None
    for name in names:
        value = _block(node.get(name))
        if value:
            return value
    return None


def _pick(node: Any, *names: str) -> str | None:
    """The first of `names` that holds a non-empty string."""
    if not isinstance(node, dict):
        return None
    for name in names:
        value = _clean(node.get(name))
        if value:
            return value
    return None


def _period(node: Any, *, start: str = "startDate", end: str = "endDate") -> str | None:
    """`start – end` as free text, matching `ProfileExperience.period`.

    FREE TEXT, NOT A DATE PAIR. The actor returns whatever LinkedIn displayed,
    which is a year alone as often as a month and a year, and a current role
    has no end at all. Nothing downstream does arithmetic on this -- it prints
    it. A single `dateRange` string, which some sections use instead, is taken
    as-is.
    """
    if not isinstance(node, dict):
        return None
    ready = _pick(node, "dateRange", "duration", "totalDuration", "date_range")
    if ready:
        return ready
    first = _clean(node.get(start))
    last = _clean(node.get(end))
    if first and last:
        return f"{first} – {last}"
    if first:
        return f"{first} – Present"
    return last


def _experiences(row: dict[str, Any]) -> list[dict[str, Any]]:
    """Current positions first, then past ones.

    ORDER IS THE POINT of doing it in two passes rather than concatenating
    whatever came back: a CV reads most-recent-first, and the actor returns
    these as two separate lists precisely because it knows which is which.

    THE TITLE FALLS BACK TO THE TOP-LEVEL FIELDS, and measured against two real
    profiles (2026-09-10) that is not a nicety -- it is the difference between
    a named role and a blank one. LinkedIn redacts the per-position job title
    for signed-out visitors far more often than the actor's README suggests:
    Bill Gates and Satya Nadella both came back with every `title` empty while
    company and dates mapped fine. `currentTitle` and `allTitles` exist at the
    top level precisely because of that, so they are used where the position's
    own title is missing.

    `allTitles` is indexed POSITIONALLY, which is a guess the actor does not
    document -- so it is only trusted when it has exactly as many entries as
    there are positions. A shorter or longer list means the correspondence is
    unknown, and a title on the wrong employer is worse than none.
    """
    positions: list[dict[str, Any]] = []
    for key in ("currentPositions", "pastPositions"):
        positions.extend(p for p in _listed(row.get(key)) if isinstance(p, dict))
    if not positions:
        # A FLAT LIST IS THE OTHER SHAPE (2026-09-18). `crawlerbros` splits
        # current from past; `supreme_coder` returns one `positions` array in
        # LinkedIn's own order, which is already most-recent-first. Read second
        # so the two-list actor keeps its ordering guarantee.
        for key in ("positions", "experiences", "experience", "workExperience"):
            positions.extend(p for p in _listed(row.get(key)) if isinstance(p, dict))
            if positions:
                break

    all_titles = [t for t in (_clean(x) for x in _listed(row.get("allTitles"))) if t]
    aligned = all_titles if len(all_titles) == len(positions) else []
    current_title = _pick(row, "currentTitle")
    current_count = sum(1 for p in _listed(row.get("currentPositions")) if isinstance(p, dict))

    out: list[dict[str, Any]] = []
    for index, position in enumerate(positions):
        title = _pick(position, "title", "role", "position")
        if not title and aligned:
            title = aligned[index]
        # `currentTitle` names the CURRENT role, so it may only fill a current
        # one -- and only when there is exactly one, or it would be put on an
        # employer it does not belong to.
        if not title and current_title and index == 0 and current_count == 1:
            title = current_title
        company = _pick(
            position, "company", "companyName", "organisation", "companyLinkedinName"
        )
        if not title and not company:
            continue
        out.append(
            {
                "title": title or "",
                "company": company,
                "period": _period(position),
                "location": _pick(position, "location", "locationName"),
                # The bullet text under a role is what a CV is written from.
                # LinkedIn does not serve it to a signed-out visitor, so this
                # is usually None and the warning says so -- the export
                # importer remains the only source that has it.
                "description": _pick_block(position, "description", "summary"),
            }
        )
    return out


def _education(row: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    schools = _listed(row.get("education")) or _listed(row.get("educations"))
    for school in schools:
        if not isinstance(school, dict):
            continue
        name = _pick(school, "school", "schoolName", "name", "title")
        if not name:
            continue
        # `degree` and `fieldOfStudy` are separate columns and both are
        # optional. "BSc, Computer Science" reads as one line on a CV.
        degree = _pick(school, "degree", "degreeName", "subtitle")
        field = _pick(school, "fieldOfStudy", "field")
        parts = [part for part in (degree, field) if part]
        out.append(
            {
                "school": name,
                "degree": ", ".join(parts) or None,
                "period": _period(school),
            }
        )
    return out


def _certifications(row: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    certs = (
        _listed(row.get("certifications"))
        or _listed(row.get("licenses"))
        or _listed(row.get("certificates"))
    )
    for cert in certs:
        if not isinstance(cert, dict):
            continue
        name = _pick(cert, "name", "title")
        if not name:
            continue
        out.append(
            {
                "name": name,
                "authority": _pick(
                    cert, "issuer", "authority", "organization", "subtitle", "company"
                ),
                "period": _pick(cert, "issueDate", "date", "issued") or _period(cert),
            }
        )
    return out


def _projects(row: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for project in _listed(row.get("projects")):
        if not isinstance(project, dict):
            continue
        title = _pick(project, "title", "name")
        if not title:
            continue
        out.append(
            {
                "title": title,
                "description": _pick_block(project, "description", "summary"),
                "url": _pick(project, "url", "link"),
            }
        )
    return out


def _named(row: dict[str, Any], *keys: str) -> list[str]:
    """A list of names, whether the source writes strings or objects.

    THE NEW ACTOR RETURNS THESE AND THE OLD ONE NEVER DID (2026-09-18), which
    is most of the reason for the swap: skills and languages are the two things
    every warning on this screen was about. `supreme_coder` publishes them;
    `crawlerbros` had nothing to publish, so this app had no reader for them
    at all.

    Strings or `{name}` or `{title}`, de-duplicated case-insensitively and in
    the order the profile lists them -- which on LinkedIn is the owner's own
    ordering, most-endorsed first.
    """
    out: list[str] = []
    seen: set[str] = set()
    for key in keys:
        for item in _listed(row.get(key)):
            value = item if isinstance(item, str) else _pick(item, "name", "title", "skill")
            cleaned = _clean(value)
            if not cleaned or cleaned.lower() in seen:
                continue
            seen.add(cleaned.lower())
            out.append(cleaned)
    return out


def _websites(row: dict[str, Any]) -> list[str]:
    """`websites` is a list of `{label, url}`; only the address is stored.

    A bare string is accepted too, because a source that omits empty fields is
    a source that will one day simplify a shape.
    """
    out: list[str] = []
    for site in _listed(row.get("websites")):
        url = site if isinstance(site, str) else _pick(site, "url", "link")
        cleaned = _clean(url)
        if cleaned and cleaned not in out:
            out.append(cleaned)
    return out


#: Phrases that only ever appear in LinkedIn's own SEO blurb, never in a
#: person's About.
#:
#: MEASURED ON GABE'S OWN PROFILE (2026-09-10). The actor returned, as
#: `summary`: "Experience: Dominican College of Tarlac · Education: Tarlac
#: State University · Location: Bamban · 44 connections on LinkedIn. View
#: Elijah Gabe Cervantes' profile on LinkedIn, a professional community of 1
#: billion members." That is the `og:description` meta tag -- what LinkedIn
#: shows a search engine when the About section is not public -- and storing it
#: as his summary would put LinkedIn's marketing copy at the top of his CV.
_SEO_BLURB_MARKERS = (
    "profile on linkedin",
    "connections on linkedin",
    "professional community of",
)


def _real_summary(value: Any) -> str | None:
    """The About section, or None if what came back is LinkedIn's own blurb.

    NONE RATHER THAN THE BLURB, deliberately. An empty About is a fact the
    panel can state; a paragraph of "View X's profile on LinkedIn" masquerading
    as one is a fact nobody can correct without noticing it first.
    """
    text = _block(value)
    if not text:
        return None
    lowered = text.lower()
    if any(marker in lowered for marker in _SEO_BLURB_MARKERS):
        return None
    return text


def profile_from_apify(row: dict[str, Any], requested_url: str) -> dict[str, Any]:
    """A `UserProfile`-shaped dict plus the warnings worth showing."""
    profile = dict(EMPTY_PROFILE)
    warnings: list[str] = []

    # TWO ACTORS, ONE MAPPER, and every lookup below carries both spellings --
    # `fullName` or `firstName`+`lastName`, `location` or `geoLocationName`.
    # A second module would be a second place to fix the next field LinkedIn
    # renames, and these rows are 80% the same shape.
    name = _pick(row, "name", "fullName")
    if not name:
        parts = [_pick(row, "firstName"), _pick(row, "lastName")]
        name = " ".join(part for part in parts if part) or None
    profile["name"] = name
    profile["headline"] = _pick(row, "headline", "occupation", "subtitle")
    profile["location"] = _pick(
        row, "location", "geoLocationName", "addressWithCountry", "locationName"
    )
    profile["summary"] = (
        _real_summary(row.get("summary"))
        or _real_summary(row.get("about"))
        or _real_summary(row.get("bio"))
    )
    profile["pictureUrl"] = _pick(
        row, "profilePicture", "profilePic", "photo", "pictureUrl", "profilePicHighQuality"
    )
    profile["url"] = _pick(row, "profileUrl", "linkedinUrl", "url", "inputUrl") or requested_url

    company = row.get("currentCompany")
    profile["industry"] = _pick(company, "industry") or _pick(row, "industry", "industryName")

    profile["experiences"] = _experiences(row)
    profile["education"] = _education(row)
    profile["certifications"] = _certifications(row)
    profile["projects"] = _projects(row)
    profile["websites"] = _websites(row)
    profile["skills"] = _named(row, "skills", "topSkills", "skillsList")
    profile["languages"] = _named(row, "languages", "languagesList")

    # WHAT THIS SOURCE CANNOT GIVE, said once rather than discovered later.
    # LinkedIn does not publish skills or languages to a signed-out visitor, so
    # no scraper of a guest profile can return them -- and a profile that
    # imports with an empty skills list looks like a broken import rather than
    # a limit of the source.
    # SAID ONLY WHEN IT IS TRUE, WHICH IT NO LONGER ALWAYS IS (2026-09-18).
    # This used to be unconditional, because the actor behind it could not
    # return skills at all. `supreme_coder` does; when it has, claiming
    # otherwise would be the app arguing with what is on screen beside it.
    if not profile["skills"] and not profile["languages"]:
        warnings.append(
            "Skills and languages did not come through from the public page. Open your own "
            "profile while signed in and use the Worktrack bookmarklet — it reads the page "
            "you are looking at."
        )
    if not profile["summary"]:
        warnings.append(
            "No About section came back — LinkedIn only shows one to signed-out visitors "
            "when the profile owner has made it public. The Worktrack bookmarklet reads it "
            "from your own logged-in profile."
        )

    roles = profile["experiences"]
    if not roles:
        warnings.append("No work history came back. Add your roles by hand.")
    else:
        # THREE SEPARATE FACTS, said separately. The first version of this
        # asserted "the titles and dates came through, the bullet text did
        # not" -- and on the first two real profiles the titles had NOT come
        # through, so the warning was confidently wrong about the very thing
        # the reader was looking at.
        if all(not item["title"] for item in roles):
            warnings.append(
                "LinkedIn does not show job titles to signed-out visitors on this profile — "
                "the employers and dates came through, the roles did not. The Worktrack "
                "bookmarklet reads them from your own logged-in profile."
            )
        if all(item["description"] is None for item in roles):
            warnings.append(
                "The bullet text under each role is not on a public profile page. The "
                "Worktrack bookmarklet reads it from your own logged-in profile."
            )

    return {"profile": profile, "warnings": warnings}
