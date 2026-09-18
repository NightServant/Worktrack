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


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


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
    into: list[dict[str, Any]], incoming: Any, fields: tuple[str, ...]
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
    return into


def merge_profiles(profiles: list[dict[str, Any]]) -> dict[str, Any]:
    """The profiles, in order of authority, as one profile."""
    merged: dict[str, Any] = dict(EMPTY_PROFILE)
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
            _merge_records(merged[field], profile.get(field), identity)

    return merged
