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

#: Record lists where a record identified by ONE field is a partial copy of a
#: fuller one, keyed by the field that stands alone.
#:
#: AN EMPLOYER WITH NO ROLE IS NOT A SECOND JOB (Gabe, 2026-09-18: "there is
#: redundant information from experience"). LinkedIn does not show job titles
#: to a signed-out visitor on some profiles, so it returns the company and the
#: dates with an empty title; JobStreet returns the same job WITH its title.
#: Keyed on title+company those are two records, and the panel listed the same
#: employer twice -- once as a job with no name.
#:
#: IT IS SAFE PRECISELY BECAUSE THE PARTIAL CARRIES NOTHING TO CONTRADICT. A
#: record with no title cannot be "a different role at that company"; it is an
#: incomplete copy of one of them, and folding it into the first is the only
#: reading that does not invent a job.
_PARTIAL_LISTS = {"experiences": "company"}

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
    partial_on: str | None = None,
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
        if existing is None and partial_on:
            existing = _partial_match(into, record, fields, partial_on)
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


def _anchor(record: dict[str, Any], field: str) -> str | None:
    value = _text(record.get(field))
    return " ".join(value.split()).lower() if value else None


def _is_partial(record: dict[str, Any], fields: tuple[str, ...], anchor_field: str) -> bool:
    """Whether a record names only its anchor -- an employer with no role."""
    return any(
        field != anchor_field and not _text(record.get(field)) for field in fields
    )


def _partial_match(
    into: list[dict[str, Any]],
    record: dict[str, Any],
    fields: tuple[str, ...],
    anchor_field: str,
) -> dict[str, Any] | None:
    """A record already held that this one is a fuller or thinner copy of.

    IT HAS TO WORK IN BOTH DIRECTIONS, and the first pass only did one. The
    real order is LinkedIn first, which is the source that returns an employer
    with an EMPTY title -- so the incomplete record arrives first and the
    complete one second. Matching only when the incoming record is the partial
    one left both in the list, which is the duplicate Gabe reported.
    """
    anchor = _anchor(record, anchor_field)
    if not anchor:
        return None
    incoming_partial = _is_partial(record, fields, anchor_field)
    for item in into:
        if _anchor(item, anchor_field) != anchor:
            continue
        if incoming_partial or _is_partial(item, fields, anchor_field):
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
                partial_on=_PARTIAL_LISTS.get(field),
            )

    return merged
