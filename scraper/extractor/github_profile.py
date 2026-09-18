"""A person's public GitHub profile, from GitHub's own API.

WHY THIS SOURCE IS NOT SCRAPED. Every other profile route in this service
fetches a rendered page through a paid hosted browser, because the sites in
question answer a signed-out request with a challenge. GitHub publishes the
same data as JSON, unauthenticated, CORS-open and rate limited at 60 requests
an hour per address -- so a scrape here would cost money to get a worse copy of
something that is free and structured. `app.py` fetches; this maps.

WHAT IT ADDS TO A PROFILE that LinkedIn does not. Repositories are the only
public evidence of what somebody has actually built: their languages are a
skills list nobody wrote by hand, and a repository with a description and stars
is a project entry. For an engineer's CV that is the half LinkedIn is weakest
at -- a signed-out LinkedIn profile carries no skills at all.

WHAT IT DELIBERATELY DOES NOT CLAIM. GitHub has no concept of employment, so
`experiences` is empty here even when `company` is set -- "@vercel" in a bio
field is not a dated role, and inventing one would put a job on a CV with no
start date and no title. The company is folded into the headline instead, where
it is a fact about the profile rather than a fabricated position.

Everything is PURE: the API payloads in, a `UserProfile` out.
"""

from __future__ import annotations

from typing import Any

from .profile import EMPTY_PROFILE, _clean

#: How many repositories become projects.
#:
#: A CV lists a handful of things somebody built, not an inventory. Ten is
#: enough that the panel has something to show after the empties and the forks
#: are dropped, and few enough that the section stays readable.
MAX_PROJECTS = 10


def _login(url: str) -> str | None:
    """`https://github.com/octocat` -> `octocat`.

    Everything after the first path segment is a repository, a gist or a tab,
    and none of them are the person. A URL with no segment at all (the site's
    front page) is not a profile and returns None rather than a guess.
    """
    try:
        from urllib.parse import urlparse

        parts = [part for part in urlparse(url).path.split("/") if part]
    except Exception:
        return None
    if not parts:
        return None
    first = parts[0]
    # `orgs`, `sponsors`, `settings` and friends are site chrome, not people.
    if first.lower() in {"orgs", "sponsors", "settings", "features", "about", "pricing"}:
        return None
    return first


def _projects(repos: Any) -> list[dict[str, Any]]:
    """The owned, described repositories, most-starred first.

    FORKS ARE NOT PROJECTS. A fork is a copy of somebody else's work, and a CV
    section that lists one as a project is a claim its owner did not make.

    A REPOSITORY WITH NO DESCRIPTION IS NOT ONE EITHER, which is a judgement
    rather than a technicality: the entry would be a bare name, and a reader
    cannot tell a weekend experiment from a product from a name.
    """
    if not isinstance(repos, list):
        return []
    owned = [
        repo
        for repo in repos
        if isinstance(repo, dict)
        and not repo.get("fork")
        and not repo.get("archived")
        and _clean(repo.get("description"))
    ]
    owned.sort(key=lambda repo: repo.get("stargazers_count") or 0, reverse=True)
    return [
        {
            "title": _clean(repo.get("name")) or "",
            "description": _clean(repo.get("description")),
            "url": _clean(repo.get("html_url")),
        }
        for repo in owned[:MAX_PROJECTS]
    ]


def _languages(repos: Any) -> list[str]:
    """The languages actually used, most-used first.

    COUNTED OVER REPOSITORIES, not weighted by bytes: this is a skills list,
    and one enormous vendored file should not outrank ten projects. Forks are
    excluded for the same reason they are not projects -- somebody else chose
    that language.
    """
    if not isinstance(repos, list):
        return []
    counts: dict[str, int] = {}
    for repo in repos:
        if not isinstance(repo, dict) or repo.get("fork"):
            continue
        language = _clean(repo.get("language"))
        if language:
            counts[language] = counts.get(language, 0) + 1
    return [name for name, _ in sorted(counts.items(), key=lambda item: -item[1])]


def profile_from_github(
    user: dict[str, Any], repos: Any, requested_url: str
) -> dict[str, Any]:
    """A `UserProfile`-shaped dict plus the warnings worth showing."""
    profile = dict(EMPTY_PROFILE)
    warnings: list[str] = []

    name = _clean(user.get("name"))
    login = _clean(user.get("login"))
    profile["name"] = name or login
    profile["location"] = _clean(user.get("location"))
    profile["pictureUrl"] = _clean(user.get("avatar_url"))
    profile["email"] = _clean(user.get("email"))
    profile["summary"] = _clean(user.get("bio"))
    profile["url"] = _clean(user.get("html_url")) or requested_url

    # THE HEADLINE IS THE BIO'S FIRST CLAIM, or the employer. GitHub has no
    # headline field; a bio is often exactly one, and where it is not, the
    # company is the nearest true thing.
    company = _clean(user.get("company"))
    profile["headline"] = company or None

    blog = _clean(user.get("blog"))
    if blog:
        # GitHub stores what the owner typed, which is `example.com` as often
        # as a full address. A bare host is not a link the panel can open.
        profile["websites"] = [blog if blog.startswith("http") else f"https://{blog}"]

    profile["projects"] = _projects(repos)
    profile["skills"] = _languages(repos)

    if not profile["projects"]:
        warnings.append(
            "No public repositories with a description came back from GitHub, so "
            "nothing was added to projects."
        )
    # SAID EVERY TIME, because the absence is structural rather than a failed
    # read: somebody comparing this panel with their CV needs to know the work
    # history did not come from here.
    warnings.append("GitHub carries no work history, so roles and dates come from elsewhere.")

    return {"profile": profile, "warnings": warnings}
