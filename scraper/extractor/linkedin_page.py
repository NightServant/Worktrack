"""A LinkedIn profile as the person who owns it sees it, handed over by hand.

WHY THIS EXISTS (Gabe, 2026-09-18: "build the bookmarklet for LinkedIn too").
Everything a signed-out visitor gets is thin by LinkedIn's design: no About, no
skills, no bullet text under a role, and on some profiles no job titles at
all. No fetcher fixes that, because the data is not behind weak protection --
it is not rendered to a stranger at all. The one client that CAN see it is the
profile's owner, already logged in, looking at their own page. The bookmarklet
hands that document over: not a scraper dressed as a person, but the person.

WHAT THAT COSTS, STATED UP FRONT. This parser reads LinkedIn's live markup,
and LinkedIn rewrites its markup whenever it likes. Two choices make that
survivable rather than fatal:

  IT KEYS ON THE PAGE'S OWN ANCHORS -- `id="about"`, `id="experience"`,
    `id="education"`, `id="licenses_and_certifications"`, `id="skills"`,
    `id="projects"` -- which are what LinkedIn's own in-page navigation scrolls
    to, not on `artdeco-*` class names, which are a design system's internals.
  IT NEVER FAILS CLOSED. Anything it cannot recognise returns None, and the
    caller falls through to the ordinary reader -- the JSON-LD graph, then the
    og tags, then the document title. A markup change costs the extra fields,
    never the import.

THE SECTIONS ARE SLICED OUT OF THE RAW HTML rather than found by walking up
from the anchor to its card. The anchor is a bare `<div id="...">` inside the
section, and every route from it to its siblings goes through ancestry that a
CSS selector cannot express (`:has()` is not supported by lxml's cssselect).
Cutting the string between one anchor and the next is blunt, has no opinion
about the markup in between, and is exactly as correct as the anchors are.

EVERY LINE IS PRINTED TWICE on this page -- once `aria-hidden="true"` for the
eye and once `visually-hidden` for a screen reader. Selecting the first of the
pair is what keeps a role from arriving as "Engineer Engineer".

Everything here is PURE: HTML in, a dict out. The capture lives in the
bookmarklet, the transport in `/api/profile`.
"""

from __future__ import annotations

import re
from typing import Any

from .page import Page
from .profile import EMPTY_PROFILE, _clean, graduation_year

#: The in-page anchors, in the order LinkedIn lays them out.
#:
#: ORDER MATTERS ONLY FOR SLICING: each section runs from its own anchor to
#: whichever other anchor comes next in the document, so the list has to hold
#: every anchor that exists even where nothing is read from it.
_ANCHORS = (
    "about",
    "experience",
    "education",
    "licenses_and_certifications",
    "projects",
    "skills",
    "volunteering",
    "honors_and_awards",
    "languages",
    "interests",
    "recommendations",
    "activity",
)

#: A line that is a date range rather than a name.
_PERIOD = re.compile(
    r"(present|\b(19|20)\d{2}\b)", re.I
)
_MONTHS = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b", re.I
)


def _looks_like_period(line: str) -> bool:
    """`Jan 2025 - Present · 9 mos`, and not `Frontend Engineer`.

    A YEAR OR THE WORD PRESENT, AND A SEPARATOR. `2026` alone appears in
    plenty of project names, so the test also wants the dash or the month name
    that a range carries.
    """
    if not _PERIOD.search(line):
        return False
    return bool(_MONTHS.search(line) or "-" in line or "–" in line)


def _sections(html: str) -> dict[str, str]:
    """The raw HTML between each anchor and the next. See the docblock."""
    found: list[tuple[int, str]] = []
    for anchor in _ANCHORS:
        match = re.search(rf'id=["\']{re.escape(anchor)}["\']', html)
        if match:
            found.append((match.start(), anchor))
    found.sort()

    slices: dict[str, str] = {}
    for index, (start, anchor) in enumerate(found):
        end = found[index + 1][0] if index + 1 < len(found) else len(html)
        slices[anchor] = html[start:end]
    return slices


def _lines(section: str) -> list[list[str]]:
    """Each list entry in a section, as its visible lines."""
    return Page(section).items("li", 'span[aria-hidden="true"]')


def _about(section: str) -> str | None:
    """The About paragraph.

    THE LONGEST LINE IN THE SECTION, which is a heuristic and the right one:
    the card holds the heading, sometimes a `…see more` control, and the prose.
    Prose is longer than either, and taking the longest avoids naming any of
    the elements around it.
    """
    candidates = Page(section).texts('span[aria-hidden="true"]')
    if not candidates:
        return None
    best = max(candidates, key=len)
    # A heading is not an About. `About` itself is 5 characters; a real one
    # runs to a sentence at least.
    return best if len(best) > 40 else None


def _experiences(section: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Roles, and any skills LinkedIn listed under them."""
    roles: list[dict[str, Any]] = []
    skills: list[str] = []
    for lines in _lines(section):
        if not lines:
            continue
        title = lines[0]
        company = None
        period = None
        location = None
        body: list[str] = []
        for line in lines[1:]:
            if line.lower().startswith("skills:"):
                skills.extend(
                    part.strip()
                    for part in line.split(":", 1)[1].replace(" and ", ", ").split(",")
                    if part.strip()
                )
                continue
            if company is None and not _looks_like_period(line):
                # `Acme · Full-time` -- the employment type is not the employer.
                company = line.split(" · ")[0].strip()
                continue
            if period is None and _looks_like_period(line):
                period = line
                continue
            if location is None and "·" in line and not _looks_like_period(line):
                location = line.split(" · ")[0].strip()
                continue
            body.append(line)
        roles.append(
            {
                "title": title,
                "company": company,
                "period": period,
                "location": location,
                # THE FIELD THE WHOLE BOOKMARKLET EXISTS FOR. A public profile
                # never carries it; this page does.
                "description": "\n".join(body) or None,
            }
        )
    return roles, skills


def _education(section: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for lines in _lines(section):
        if not lines:
            continue
        school = lines[0]
        # THE DEGREE IS NEVER THE SCHOOL SAID AGAIN (Gabe, 2026-09-19: "remove
        # repeating information"). LinkedIn prints the school name in the
        # entry's heading and again in its link text on some layouts, and the
        # first non-period line after the heading was then the school over
        # itself.
        degree = next(
            (
                line
                for line in lines[1:]
                if not _looks_like_period(line) and line.casefold() != school.casefold()
            ),
            None,
        )
        period = next((line for line in lines[1:] if _looks_like_period(line)), None)
        out.append(
            {
                "school": school,
                "degree": degree,
                "period": period,
                "graduationYear": graduation_year(period),
            }
        )
    return out


#: `Issued Jun 2024`, `Expires Jun 2027`, `Credential ID ABC-123`.
#:
#: LinkedIn prints these three as their own lines under a certificate, each
#: with the label in front of the value. The label is what tells them apart --
#: two dates in the same entry are otherwise indistinguishable.
_ISSUED = re.compile(r"issued\s*:?\s*(.+)", re.I)
_EXPIRES = re.compile(r"(?:expires|expiry|valid until)\s*:?\s*(.+)", re.I)
_CREDENTIAL_ID = re.compile(r"credential\s*id\s*:?\s*(.+)", re.I)

#: Lines that are a control rather than a fact.
_CERT_CHROME = re.compile(r"^(show credential|see credential|show more|…?see more)$", re.I)


def _certifications(section: str) -> list[dict[str, Any]]:
    """Every certificate, with the four things LinkedIn prints under its name.

    WHAT THIS USED TO READ (Gabe, 2026-09-19: "scrape more information about
    the certifications and licenses such as Date Issued"): the name, the first
    line that was not a date, and the first line that was. So `Issued Jun 2024
    · Expires Jun 2027` arrived as one opaque string, the credential number was
    thrown away, and `Show credential` -- the only link that proves the thing
    exists -- was never looked at.

    THE LABELS ARE THE PARSER. Splitting on the `·` between them would work on
    one locale's punctuation and the entry order is not fixed, whereas
    `Issued`, `Expires` and `Credential ID` are the words LinkedIn writes in
    front of each value.

    THE LINK COMES FROM THE SAME WALK as the lines -- see
    `Page.items_with_links` -- because a certificate with no credential link is
    ordinary, and two separate queries would slide every later URL onto the
    wrong certificate.
    """
    out: list[dict[str, Any]] = []
    for lines, links in Page(section).items_with_links(
        "li", 'span[aria-hidden="true"]', "a::attr(href)"
    ):
        if not lines:
            continue
        name = lines[0]
        authority = None
        issued = None
        expires = None
        credential_id = None
        leftover: list[str] = []
        for line in lines[1:]:
            if _CERT_CHROME.match(line):
                continue
            found = _ISSUED.match(line)
            if found:
                issued = _clean(found.group(1))
                continue
            found = _EXPIRES.match(line)
            if found:
                expires = _clean(found.group(1))
                continue
            found = _CREDENTIAL_ID.match(line)
            if found:
                credential_id = _clean(found.group(1))
                continue
            # `Issued Jun 2024 · Expires Jun 2027` on one line, which some
            # layouts do: split it and read each half by its own label.
            if "·" in line and (_ISSUED.search(line) or _EXPIRES.search(line)):
                for part in line.split("·"):
                    part = part.strip()
                    found = _ISSUED.match(part)
                    if found:
                        issued = _clean(found.group(1))
                    found = _EXPIRES.match(part)
                    if found:
                        expires = _clean(found.group(1))
                continue
            if _looks_like_period(line):
                issued = issued or line
                continue
            if authority is None and line.casefold() != name.casefold():
                authority = line
                continue
            leftover.append(line)
        parts = [
            f"Issued {issued}" if issued else None,
            f"Expires {expires}" if expires else None,
        ]
        out.append(
            {
                "name": name,
                "authority": authority,
                "period": " · ".join(part for part in parts if part) or None,
                "issued": issued,
                "expires": expires,
                "credentialId": credential_id,
                # THE FIRST OUTBOUND LINK. Everything inside the entry that is
                # not the credential points back at LinkedIn -- the issuing
                # company's page, the entry's own anchor -- and a certificate's
                # proof is by definition somewhere else.
                "url": next(
                    (
                        href
                        for href in links
                        if href.startswith("http") and "linkedin.com" not in href
                    ),
                    None,
                ),
            }
        )
    return out


def _projects(section: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for lines in _lines(section):
        if not lines:
            continue
        body = [
            line
            for line in lines[1:]
            if not _looks_like_period(line) and line.casefold() != lines[0].casefold()
        ]
        out.append(
            {
                "title": lines[0],
                "description": "\n".join(body) or None,
                "url": None,
                # A PROFILE'S PROJECT SECTION IS PROSE. The structured half --
                # languages, stars, a live address -- only exists where the
                # project has a repository, so it is left empty here rather
                # than guessed at from a paragraph.
                "highlights": [line for line in body if len(line) > 24],
                "tech": [],
                "language": None,
                "stars": None,
                "homepage": None,
                "updatedAt": None,
            }
        )
    return out


def _skills(section: str) -> list[str]:
    """One skill per entry, ignoring the `N endorsements` line under it."""
    out: list[str] = []
    for lines in _lines(section):
        if lines and not re.search(r"endorsement", lines[0], re.I):
            out.append(lines[0])
    return out


def profile_from_linkedin_page(url: str, html: str) -> dict[str, Any] | None:
    """A `UserProfile`-shaped dict plus warnings, or None if this is not one.

    NONE WHEN NOTHING IS RECOGNISED, so the caller falls through to the
    ordinary reader rather than storing a blank over a good profile. The test
    is deliberately weak -- one usable section -- because a partial read of a
    page only the owner can see still beats everything a fetch can get.
    """
    sections = _sections(html)
    if not sections:
        return None

    page = Page(html, url=url)
    profile = dict(EMPTY_PROFILE)
    warnings: list[str] = []
    profile["url"] = url

    # The name is the page's one `h1`. Its title is "(3) Name | LinkedIn",
    # notification count and all, so the heading is the better source.
    profile["name"] = _clean(page.text_block("h1"))

    if "about" in sections:
        profile["summary"] = _about(sections["about"])

    skills: list[str] = []
    if "experience" in sections:
        roles, role_skills = _experiences(sections["experience"])
        profile["experiences"] = roles
        skills.extend(role_skills)
    if "education" in sections:
        profile["education"] = _education(sections["education"])
    if "licenses_and_certifications" in sections:
        profile["certifications"] = _certifications(sections["licenses_and_certifications"])
    if "projects" in sections:
        profile["projects"] = _projects(sections["projects"])
    if "skills" in sections:
        skills.extend(_skills(sections["skills"]))

    # De-duplicated across the two places LinkedIn lists them -- the skills
    # card and the `Skills:` line under each role.
    seen: set[str] = set()
    profile["skills"] = [
        skill
        for skill in skills
        if skill.lower() not in seen and not seen.add(skill.lower())
    ]

    if not any(
        (
            profile["name"],
            profile["summary"],
            profile["experiences"],
            profile["education"],
            profile["skills"],
        )
    ):
        return None

    # WHAT A CAPTURE CANNOT BE SURE OF. The sections are read by their
    # anchors; if LinkedIn renames one, the fields under it go quiet rather
    # than wrong, and this is the sentence that says so before somebody
    # concludes their profile is empty.
    missing = [
        name
        for name, value in (
            ("About", profile["summary"]),
            ("experience", profile["experiences"]),
            ("skills", profile["skills"]),
        )
        if not value
    ]
    if missing:
        warnings.append(
            "The captured page had no " + ", ".join(missing) + " section this reader "
            "recognised. LinkedIn changes its markup often — the rest of the profile is "
            "unaffected."
        )

    return {"profile": profile, "warnings": warnings}
