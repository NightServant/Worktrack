"""A public JobStreet (SEEK) profile, read from the page's own data.

WHY THIS IS NOT THE GENERIC READER (Gabe, 2026-09-18: "JobStreet problem:
could not fetch data properly from the given URL link"). The generic path looks
for a schema.org `Person` graph and falls back to Open Graph tags, and a
JobStreet profile has NEITHER: measured on a real profile, zero `ld+json`
blocks and an `og:` set that is site branding -- image, type, site_name, locale
-- with no `og:title` and no `og:description`. So a fetch that worked returned
an empty profile, and one that failed and one that succeeded looked the same.

WHAT IT DOES HAVE is `window.__APOLLO_STATE__`, the GraphQL cache the page
hydrates itself from, server-rendered into the HTML. It carries the fields this
app wants as structured data:

    firstName / lastName            -> name
    homeLocation.label(...)         -> location
    workHistories[]                 -> experiences (company + role)
    hasVerifiedCredentials          -> not mapped; a claim of SEEK's, not a CV field

THE AVATAR IS DELIBERATELY NOT MAPPED. `profileAvatarUrls` are pre-signed S3
links with `X-Amz-Expires=43200` -- twelve hours -- so storing one puts a broken
image on the profile panel by tomorrow. A picture that rots is worse than the
initials fallback.

WHAT THE PAGE WILL NOT GIVE, whatever we do: dates on the roles, education,
skills. The page says "Sign in to see more" in place of them, and the cache
says the same thing in its type names -- every node is a `Restricted...`
variant. That is a limit of the source and is reported as one.

Everything here is PURE: HTML in, a dict out. The fetch lives in `app.py`.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .profile import EMPTY_PROFILE, _clean

#: The cache assignment, up to the end of its script block.
#:
#: NON-GREEDY TO THE FIRST `</script>`, because the page carries several of
#: these blobs and a greedy match would swallow the rest of the document.
_APOLLO = re.compile(r"window\.__APOLLO_STATE__\s*=\s*(\{.*?\})\s*;?\s*</script>", re.S)


def _apollo_state(html: str) -> dict[str, Any] | None:
    match = _APOLLO.search(html)
    if not match:
        return None
    try:
        state = json.loads(match.group(1))
    except Exception:
        return None
    return state if isinstance(state, dict) else None


def _profile_node(state: dict[str, Any]) -> dict[str, Any] | None:
    """The `publicProfileView` entry, whatever its query arguments were.

    THE KEY CARRIES THE ARGUMENTS -- `publicProfileView({"input":{"slug":...}})`
    -- so it cannot be looked up by name. Matching on the prefix is what makes
    this survive a different slug, a different locale, or an extra argument.
    """
    root = state.get("ROOT_QUERY")
    if not isinstance(root, dict):
        return None
    for key, value in root.items():
        if key.startswith("publicProfileView") and isinstance(value, dict):
            return value
    return None


def _label(node: Any) -> str | None:
    """A SEEK localised field: `label({"locale":"en-PH"})` rather than `label`."""
    if not isinstance(node, dict):
        return None
    for key, value in node.items():
        if key == "label" or key.startswith("label("):
            cleaned = _clean(value)
            if cleaned:
                return cleaned
    return None


def profile_from_jobstreet(url: str, html: str) -> dict[str, Any] | None:
    """A `UserProfile`-shaped dict plus warnings, or None if this is not one.

    NONE RATHER THAN AN EMPTY PROFILE when the cache is missing: the caller
    then falls through to the generic reader instead of storing a blank, which
    is the difference between "JobStreet changed its markup" and "this person
    has no name".
    """
    state = _apollo_state(html)
    node = _profile_node(state) if state else None
    if node is None:
        return None

    profile = dict(EMPTY_PROFILE)
    warnings: list[str] = []

    name = " ".join(
        part for part in (_clean(node.get("firstName")), _clean(node.get("lastName"))) if part
    )
    profile["name"] = name or None
    profile["location"] = _label(node.get("homeLocation"))
    profile["url"] = url

    roles = [
        {
            "title": _clean(item.get("roleTitle")) or "",
            "company": _clean(item.get("companyName")),
            "period": None,
            "location": None,
            "description": None,
        }
        for item in node.get("workHistories") or []
        if isinstance(item, dict) and (item.get("roleTitle") or item.get("companyName"))
    ]
    profile["experiences"] = roles

    # THE HEADLINE IS THE CURRENT ROLE, written the way the page writes it.
    # JobStreet has no headline field; the page's own title is
    # "<role> at <company>", so that is what it is called here.
    if roles:
        current = roles[0]
        profile["headline"] = (
            f"{current['title']} at {current['company']}"
            if current["title"] and current["company"]
            else current["title"] or current["company"]
        )

    if not roles:
        warnings.append("JobStreet showed no career history on that profile.")
    warnings.append(
        "JobStreet only shows a signed-out visitor the current role — no dates, education "
        "or skills come through from it."
    )

    return {"profile": profile, "warnings": warnings}
