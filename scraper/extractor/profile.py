"""A person's public LinkedIn profile, read the same way a posting is.

WHY THIS EXISTS AGAIN. A profile-page scraper was built and removed on
2026-09-06: it recovered titles and dates and almost never the bullet text
under a role, and a plain HTTP fetch of a LinkedIn profile gets an
authentication wall rather than a page. Gabe's instruction on 2026-09-09 was to
bring it back and put Firecrawl behind it -- the same hosted fetcher the job
extractor already uses for the boards this service cannot read itself.

WHAT CHANGED THAT MAKES IT WORTH TRYING AGAIN. Firecrawl runs the page and
proxies it, so what arrives here is the logged-out profile as a browser sees
it, `<head>` included -- and the head is where LinkedIn puts a JSON-LD
`ProfilePage` graph with the `Person`, their positions and their schools as
structured data rather than as rendered text. That is a better source than the
DOM scraping the old version did.

WHAT IT STILL CANNOT GET, said plainly rather than discovered later: the
paragraph under each role. LinkedIn's logged-out profile does not render it and
its JSON-LD does not carry it, so `description` on an experience is usually
None. Warnings say so, and the fields the user can fill in by hand stay
editable.

Everything here is PURE: HTML in, a dict out. The fetch lives in `app.py`, so
this can be tested against a saved page with no network.
"""

from __future__ import annotations

from typing import Any

from .page import Page

#: The shape `src/services/profile.ts` calls `UserProfile`, with every field
#: at its empty value. Returned verbatim when a page yields nothing, so the
#: caller never has to distinguish "missing key" from "nothing found".
EMPTY_PROFILE: dict[str, Any] = {
    "name": None,
    "headline": None,
    "location": None,
    "pictureUrl": None,
    "email": None,
    "summary": None,
    #: Every source's own About, attributed. See `/profile`, which fills it --
    #: a parser only ever sees one source and cannot know who else had one.
    "about": [],
    "url": None,
    "industry": None,
    "address": None,
    "birthDate": None,
    "websites": [],
    "experiences": [],
    "education": [],
    "skills": [],
    "certifications": [],
    "languages": [],
    "projects": [],
    "fetchedAt": None,
}


def _clean(value: Any) -> str | None:
    """A trimmed string, or None. Collapses the whitespace a rendered page
    leaves behind; an empty result is None rather than an empty string, so the
    caller's `or` chains work."""
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    return text or None


def _listed(value: Any) -> list[Any]:
    """One node or many, always many. JSON-LD uses a bare object where a list
    would have one entry, and every consumer here wants to iterate."""
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _typed(node: Any, wanted: str) -> bool:
    """Whether a JSON-LD node claims `@type`. A list-typed node is common and
    was what the old extractor silently skipped."""
    if not isinstance(node, dict):
        return False
    raw = node.get("@type")
    return any(str(t).lower() == wanted.lower() for t in _listed(raw) if t is not None)


def _person(page: Page) -> dict[str, Any] | None:
    for node in page.json_ld():
        if _typed(node, "Person"):
            return node
    return None


def _address(node: Any) -> str | None:
    """`addressLocality, addressRegion, addressCountry`, in that order.

    Only the parts that are present, joined by commas: LinkedIn omits the
    region for a lot of the world, and "Bamban, , Philippines" is worse than
    no location at all.
    """
    if isinstance(node, str):
        return _clean(node)
    if not isinstance(node, dict):
        return None
    parts = [
        _clean(node.get("addressLocality")),
        _clean(node.get("addressRegion")),
        _clean(node.get("addressCountry")),
    ]
    joined = ", ".join(part for part in parts if part)
    return joined or None


def _period(member: Any) -> str | None:
    """`startDate` to `endDate` as free text.

    FREE TEXT, NOT A DATE PAIR, matching `ProfileExperience.period`: LinkedIn
    gives a year alone as often as a full date, and a current role has no end
    at all. The app never does arithmetic on this -- it prints it.
    """
    if not isinstance(member, dict):
        return None
    start = _clean(member.get("startDate"))
    end = _clean(member.get("endDate"))
    if start and end:
        return f"{start} – {end}"
    if start:
        return f"{start} – Present"
    return end


def _experiences(person: dict[str, Any]) -> list[dict[str, Any]]:
    """One entry per organisation the person `worksFor`.

    The TITLE is the hard part. LinkedIn hangs the role on the membership node
    (`member.description` or `member.roleName`), the organisation carries the
    name, and `jobTitle` on the Person is the headline role rather than a
    per-position field -- so a missing title falls back to the person's own
    `jobTitle` only for the FIRST entry, which is the current one, and is left
    empty rather than guessed for the rest.
    """
    out: list[dict[str, Any]] = []
    headline_titles = [t for t in (_clean(x) for x in _listed(person.get("jobTitle"))) if t]

    for index, org in enumerate(_listed(person.get("worksFor"))):
        if not isinstance(org, dict):
            continue
        member = org.get("member")
        member = member[0] if isinstance(member, list) and member else member
        title = (
            _clean(member.get("roleName") if isinstance(member, dict) else None)
            or _clean(member.get("description") if isinstance(member, dict) else None)
            or (headline_titles[0] if index == 0 and headline_titles else None)
        )
        company = _clean(org.get("name"))
        if not title and not company:
            continue
        out.append(
            {
                "title": title or "",
                "company": company,
                "period": _period(member),
                "location": _address(org.get("location") or org.get("address")),
                # See the module docblock: the logged-out page does not carry
                # the bullet text, and inventing a summary from the role name
                # would put words in the person's CV that they never wrote.
                "description": None,
            }
        )
    return out


def _education(person: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for school in _listed(person.get("alumniOf")):
        if not isinstance(school, dict):
            continue
        name = _clean(school.get("name"))
        if not name:
            continue
        member = school.get("member")
        member = member[0] if isinstance(member, list) and member else member
        out.append(
            {
                "school": name,
                "degree": _clean(school.get("description"))
                or _clean(member.get("description") if isinstance(member, dict) else None),
                "period": _period(member),
            }
        )
    return out


def _websites(person: dict[str, Any]) -> list[str]:
    """`sameAs`, minus the profile's own address.

    A profile that lists itself is not a website the person wants on their CV,
    and it is already stored as `url`.
    """
    own = _clean(person.get("url")) or ""
    seen: list[str] = []
    for value in _listed(person.get("sameAs")):
        cleaned = _clean(value)
        if not cleaned or cleaned == own or cleaned in seen:
            continue
        seen.append(cleaned)
    return seen


def extract_profile(url: str, html: str, site: str = "LinkedIn") -> dict[str, Any]:
    """A `UserProfile`-shaped dict plus the warnings worth showing.

    THE JSON-LD IS THE SOURCE and the meta tags are the fallback. A profile
    behind a sign-in wall still renders an `og:title` and `og:description` --
    the name and the headline -- so a partial answer is possible even when the
    graph is missing, and it is honestly labelled as partial rather than
    returned as a success.

    `site` NAMES THE SITE IN THE WARNINGS, and it is there because this parser
    stopped being LinkedIn's on 2026-09-18: schema.org `Person` is the same
    graph wherever it is published, so the same code reads a JobStreet or
    Glassdoor page, and only the sentences explaining what did NOT come back
    were LinkedIn-specific. A warning that says "LinkedIn" about a Glassdoor
    page sends the reader to fix the wrong link.
    """
    page = Page(html, url=url)
    person = _person(page)
    warnings: list[str] = []

    profile = dict(EMPTY_PROFILE)
    profile["url"] = url

    if person is None:
        # `og:title` on a LinkedIn profile is "Name - Headline | LinkedIn".
        #
        # THE DOCUMENT TITLE IS THE THIRD TIER, and it is there because a page
        # with neither a graph nor an `og:title` is not rare: measured on a
        # real JobStreet profile, zero `ld+json` blocks and an `og:` set that
        # is site branding alone. Its `<title>` was
        # "Elijah Gabe Cervantes, Frontend Developer and UI/UX Designer at
        # Dominican College of Tarlac | Jobstreet" -- a name and a headline,
        # free, on a page that would otherwise have parsed to nothing at all.
        #
        # The site suffix goes with the last `|`, and the name is separated
        # from the headline by whichever of ` - ` or `, ` the page used.
        # `text_block`, not `first`: the latter hands back the node's OUTER
        # HTML, so the name would arrive as "<title>Elijah Gabe Cervantes".
        title = _clean(page.meta("og:title")) or _clean(page.text_block("title")) or ""
        name = title.rsplit(" | ", 1)[0] if " | " in title else title
        separator = " - " if " - " in name else (", " if ", " in name else None)
        if separator:
            first, _, rest = name.partition(separator)
            profile["name"] = _clean(first)
            profile["headline"] = _clean(rest)
        else:
            profile["name"] = _clean(name)
        profile["summary"] = _clean(page.meta("og:description"))
        profile["pictureUrl"] = _clean(page.meta("og:image"))
        if profile["name"] or profile["summary"]:
            warnings.append(
                f"{site} did not return the structured half of this profile — only the name "
                "and headline could be read. Fill in the rest by hand."
            )
        else:
            # NOTHING AT ALL, said as its own fact. A page that carries neither
            # a graph nor an `og:title` is not a partial profile, it is a sign-
            # in wall or a search page -- and "fill in the rest by hand" over an
            # empty panel reads as an app that lost the data it fetched.
            warnings.append(
                f"{site} showed no profile to a signed-out visitor, so nothing could be read "
                "from that link."
            )
        return {"profile": profile, "warnings": warnings}

    profile["name"] = _clean(person.get("name"))
    titles = [t for t in (_clean(x) for x in _listed(person.get("jobTitle"))) if t]
    profile["headline"] = titles[0] if titles else None
    profile["summary"] = _clean(person.get("description"))
    profile["location"] = _address(person.get("address"))
    image = person.get("image")
    profile["pictureUrl"] = _clean(
        image.get("contentUrl") if isinstance(image, dict) else image
    ) or _clean(page.meta("og:image"))
    profile["url"] = _clean(person.get("url")) or url
    profile["websites"] = _websites(person)
    profile["experiences"] = _experiences(person)
    profile["education"] = _education(person)
    profile["languages"] = [
        name
        for name in (_clean(lang.get("name") if isinstance(lang, dict) else lang)
                     for lang in _listed(person.get("knowsLanguage")))
        if name
    ]
    profile["skills"] = [
        name
        for name in (_clean(skill.get("name") if isinstance(skill, dict) else skill)
                     for skill in _listed(person.get("knowsAbout")))
        if name
    ]

    # WHAT IS MISSING IS SAID OUT LOUD. A profile that imports with no roles
    # looks like a broken import; a profile that imports with no roles AND
    # says the page did not carry any is a fact the reader can act on.
    if not profile["experiences"]:
        warnings.append("No work history was on the page. Add your roles by hand.")
    if not profile["skills"]:
        warnings.append(f"{site} does not publish skills on a logged-out profile.")
    if profile["experiences"] and all(e["description"] is None for e in profile["experiences"]):
        warnings.append(
            "The bullet text under each role is not on a public profile page — "
            "the titles and dates came through, the detail did not."
        )

    return {"profile": profile, "warnings": warnings}
