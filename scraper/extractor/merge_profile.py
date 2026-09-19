"""Several profiles, one person.

WHY THIS EXISTS (Gabe, 2026-09-18: "I need the profile section to fetch more
information from other websites such as glassdoor, linkedin, and jobstreet --
kindly also consider github ... aggregate data sources and combine them into
one large single profile"). Each source knows a different half: LinkedIn has
the roles and the dates, GitHub has what was actually built and in which
languages, a job board carries the headline and location it shows recruiters.
One of them alone is a partial CV.

THE RULES ARE THE WHOLE FILE, and all three are about not destroying something
true:

  A SINGLE VALUE IS FIRST-WINS, IN THE ORDER GIVEN. The caller orders the
    sources, and the order is a claim about authority rather than about time --
    a name from LinkedIn outranks a GitHub login. `None` and empty strings are
    not values and never win.
  A LIST IS THE UNION, DE-DUPLICATED. Two sources listing the same skill is one
    skill; two sources listing different skills is a longer list, which is the
    point of aggregating at all.
  A RECORD LIST -- roles, schools, projects -- IS MATCHED BEFORE IT IS JOINED.
    The same role from two sources is one role, and the fuller copy of it wins
    field by field, so a LinkedIn title with no bullet text and an export with
    bullet text under the same employer become one complete entry rather than
    two half ones.

NOTHING IS INVENTED AND NOTHING IS OVERWRITTEN WITH EMPTINESS. A source that
came back with nothing contributes nothing; it cannot blank a field another
source filled. That is what makes adding a source safe.
"""

from __future__ import annotations

import re
from typing import Any

from .profile import EMPTY_PROFILE

#: Fields that hold one value. Everything else in `UserProfile` is a list.
_SCALARS = (
    "name",
    "headline",
    "location",
    "pictureUrl",
    "email",
    "summary",
    "url",
    "industry",
    "address",
    "birthDate",
)

#: Plain string lists.
_STRING_LISTS = ("websites", "skills", "languages")

#: Every key a record of each kind carries, at its empty value.
#:
#: THE WIRE CONTRACT, FILLED IN ONE PLACE. Five parsers build these records and
#: each knows about the fields its own source has -- JobStreet has no
#: certifications, a LinkedIn capture has no repository stars -- so a record
#: arriving here is missing whatever its parser had nothing to say about. The
#: app destructures `UserProfile` directly, and a missing key reads to a user
#: as a field that did not import rather than as a shape that never existed.
#:
#: APPLIED AFTER THE MERGE, not before: `_merge_records` fills a field only
#: when the copy it holds is empty, and seeding every record with explicit
#: nulls first would make every record look complete and stop the fill.
_RECORD_DEFAULTS: dict[str, dict[str, Any]] = {
    "experiences": {
        "title": "",
        "company": None,
        "period": None,
        "location": None,
        "description": None,
    },
    "education": {"school": "", "degree": None, "period": None, "graduationYear": None},
    "certifications": {
        "name": "",
        "authority": None,
        "period": None,
        "issued": None,
        "expires": None,
        "credentialId": None,
        "url": None,
    },
    "projects": {
        "title": "",
        "description": None,
        "url": None,
        "highlights": [],
        "tech": [],
        "language": None,
        "stars": None,
        "homepage": None,
        "updatedAt": None,
    },
}

#: Record lists, and the fields that identify one record as the same as another.
_RECORD_LISTS = {
    "experiences": ("title", "company"),
    "education": ("school", "degree"),
    "certifications": ("name", "authority"),
    "projects": ("title",),
}

#: Words that carry no identity in a project name.
#:
#: A repository is named `online-resume-builder` and the same project is
#: written `The Online Resume Builder` on a profile. The article is the whole
#: difference, and it is not one.
_NOISE = {"the", "a", "an", "of", "for", "and", "my", "app", "application", "project"}

#: Record lists where one record can be an incomplete copy of another.
#:
#: A HALF-NAMED RECORD IS NOT A SECOND ONE (Gabe, 2026-09-18, twice -- once in
#: each direction). LinkedIn hides job titles from signed-out visitors on some
#: profiles, so the public read returns an employer with an empty title;
#: JobStreet returns the same job WITH its title. Then the CAPTURED page came
#: back with the title, the dates and the bullet text and no employer at all,
#: and the panel listed the same job twice again -- the other way round.
#:
#: SO IT MATCHES ON WHATEVER BOTH RECORDS ACTUALLY NAME, rather than on one
#: anchor field: same title and one of them has no company, or same company and
#: one of them has no title. Two records that both name both are compared
#: normally, so two real roles at one employer stay two roles.
_PARTIAL_LISTS = {"experiences", "education", "certifications"}

#: Lists where two records may be the same thing under two names.
#:
#: PROJECTS ONLY, and the restriction is the safety (Gabe, 2026-09-18: "there
#: are repeating information about projects -- one from LinkedIn and one from
#: GitHub"). A person writes a project one way on a profile and names its
#: repository another -- `FIFO page replacement algorithm` against
#: `FIFO_Algorithm`, `Java Arithmetic Calculator` against `Java-Calculator` --
#: so exact matching listed every one of them twice. Roles and schools are NOT
#: matched this way on purpose: two different jobs at one employer share most
#: of their words, and merging them would silently delete a job.
_FUZZY_LISTS = {"projects"}


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _tokens(record: dict[str, Any], fields: tuple[str, ...]) -> set[str]:
    """The words that identify a record, with the punctuation of a slug gone.

    `I-Love-Music-1.0` and `I Love Music 1.0` are the same project written by a
    repository and by a person, so the separators a slug uses -- hyphen,
    underscore, dot -- are word breaks here, not characters.
    """
    words: set[str] = set()
    for field in fields:
        value = _text(record.get(field))
        if not value:
            continue
        for word in re.split(r"[^a-z0-9]+", value.lower()):
            if word and word not in _NOISE:
                words.add(word)
    return words


def _same_thing(a: set[str], b: set[str]) -> bool:
    """Whether two token sets name one project.

    A SUBSET, NOT AN OVERLAP. `{fifo, algorithm}` inside
    `{fifo, page, replacement, algorithm}` is a repository named after the
    project beside it; two sets that merely share a word are two projects that
    happen to both mention Java.

    AND NEVER ON ONE WORD. `{java}` is inside every Java project anybody has
    ever written, so a single-token name matches only its exact twin -- which
    the caller has already tried by key.
    """
    if not a or not b:
        return False
    smaller, larger = (a, b) if len(a) <= len(b) else (b, a)
    return len(smaller) >= 2 and smaller <= larger


def _key(record: dict[str, Any], fields: tuple[str, ...]) -> str:
    """What makes two records the same record.

    CASE AND SPACING CARRY NO MEANING here -- `Luxury Presence` and
    `luxury presence` are one employer -- and a field that is missing from one
    copy is simply absent from its key, so a record identified by title alone
    still matches the fuller copy that also names the company.
    """
    parts = []
    for field in fields:
        value = _text(record.get(field))
        if value:
            parts.append(" ".join(value.split()).lower())
    return "|".join(parts)


def _merge_records(
    into: list[dict[str, Any]],
    incoming: Any,
    fields: tuple[str, ...],
    *,
    fuzzy: bool = False,
    partial: bool = False,
) -> list[dict[str, Any]]:
    """One list of records, with duplicates filled in rather than repeated."""
    if not isinstance(incoming, list):
        return into
    index = {_key(record, fields): record for record in into}
    for record in incoming:
        if not isinstance(record, dict):
            continue
        key = _key(record, fields)
        if not key:
            continue
        existing = index.get(key)
        if existing is None and partial:
            existing = _partial_match(into, record, fields)
        if existing is None and fuzzy:
            # THE SAME PROJECT UNDER TWO NAMES. Scanned rather than looked up,
            # because "is one name a slug of the other" is not a question a
            # dictionary key can answer. The list is a handful of records.
            words = _tokens(record, fields)
            existing = next(
                (item for item in into if _same_thing(words, _tokens(item, fields))),
                None,
            )
        if existing is None:
            copy = dict(record)
            into.append(copy)
            index[key] = copy
            continue
        # THE FULLER COPY WINS FIELD BY FIELD. This is where a role that came
        # back as a title and a date from one source gains its bullet text from
        # another -- the single most valuable thing this merge does.
        for field, value in record.items():
            if existing.get(field) in (None, "", []) and value not in (None, "", []):
                existing[field] = value
        # RE-KEYED, because filling a blank title CHANGES a record's identity:
        # `|acme` becomes `engineer|acme`. Left stale, a third source naming
        # the same job would miss it and add a duplicate -- the very thing this
        # pass exists to stop.
        index[_key(existing, fields)] = existing
    return into


def _norm(record: dict[str, Any], field: str) -> str | None:
    value = _text(record.get(field))
    return " ".join(value.split()).lower() if value else None


def _partial_match(
    into: list[dict[str, Any]],
    record: dict[str, Any],
    fields: tuple[str, ...],
) -> dict[str, Any] | None:
    """A record already held that this one is a fuller or thinner copy of.

    THE RULE IN ONE SENTENCE: every field they BOTH name has to agree, at least
    one has to be named by both, and at least one has to be missing from one of
    them. The last clause is what keeps two complete records apart -- if both
    name a title and a company, they were already compared by key, and reaching
    here means they differ.

    IT HAS TO WORK IN BOTH DIRECTIONS AND IN EITHER ARRIVAL ORDER, which the
    first two attempts did not: one only folded an incoming partial into a
    fuller record, and the second only ever anchored on the company -- so a
    capture that returned a title with no employer produced a duplicate all
    over again.
    """
    for item in into:
        shared = [
            field
            for field in fields
            if _norm(record, field) is not None and _norm(item, field) is not None
        ]
        if not shared:
            continue
        if any(_norm(record, field) != _norm(item, field) for field in shared):
            continue
        incomplete = any(
            _norm(record, field) is None or _norm(item, field) is None for field in fields
        )
        if incomplete:
            return item
    return None


def merge_profiles(profiles: list[dict[str, Any]]) -> dict[str, Any]:
    """The profiles, in order of authority, as one profile."""
    merged: dict[str, Any] = dict(EMPTY_PROFILE)
    # A FRESH LIST FOR EVERY LIST FIELD. `dict()` is a shallow copy, so
    # anything left pointing at EMPTY_PROFILE's own list would be shared by
    # every profile this process ever merges.
    merged["about"] = []
    merged["websites"] = []
    merged["skills"] = []
    merged["languages"] = []
    merged["experiences"] = []
    merged["education"] = []
    merged["certifications"] = []
    merged["projects"] = []

    seen: dict[str, set[str]] = {field: set() for field in _STRING_LISTS}

    for profile in profiles:
        if not isinstance(profile, dict):
            continue

        for field in _SCALARS:
            if merged.get(field) is None:
                value = _text(profile.get(field))
                if value:
                    merged[field] = value

        for field in _STRING_LISTS:
            for value in profile.get(field) or []:
                text = _text(value)
                if not text:
                    continue
                fingerprint = text.lower()
                if fingerprint in seen[field]:
                    continue
                seen[field].add(fingerprint)
                merged[field].append(text)

        for field, identity in _RECORD_LISTS.items():
            _merge_records(
                merged[field],
                profile.get(field),
                identity,
                fuzzy=field in _FUZZY_LISTS,
                partial=field in _PARTIAL_LISTS,
            )

    # EVERY RECORD LEAVES HERE WITH EVERY KEY. See `_RECORD_DEFAULTS`.
    for field, defaults in _RECORD_DEFAULTS.items():
        for record in merged[field]:
            for key, empty in defaults.items():
                if isinstance(empty, list):
                    # A list field is never null on the wire: the app calls
                    # `.map` on it without checking.
                    if not isinstance(record.get(key), list):
                        record[key] = list(empty)
                elif key not in record:
                    record[key] = empty

    return merged
