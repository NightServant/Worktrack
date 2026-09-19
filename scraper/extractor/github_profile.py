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

import re
from typing import Any
from urllib.parse import unquote, urlparse

from .profile import EMPTY_PROFILE, _clean

#: How many repositories become projects.
#:
#: A CV lists a handful of things somebody built, not an inventory. Ten is
#: enough that the panel has something to show after the empties and the forks
#: are dropped, and few enough that the section stays readable.
MAX_PROJECTS = 10


#: The badge services a README announces a stack with.
#:
#: A BADGE IS THE ONLY MACHINE-READABLE THING IN A README. Everything else is
#: prose a parser would have to guess at; a shields.io URL names the technology
#: in its own path, because that is what the image says.
_BADGE_HOSTS = ("img.shields.io", "badgen.net", "badge.fury.io", "forthebadge.com")

#: `![label](url)` and `<img alt="label" src="url">`, the two ways a README
#: puts a badge on a line.
_MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)")

#: A badge WRAPPED IN A LINK: `[![LinkedIn](badge)](https://linkedin.com/in/x)`.
#:
#: THE WRAPPER IS WHAT TELLS A CONTACT FROM A SKILL, and nothing else does.
#: Every README's "connect with me" row is badges of exactly the same shape as
#: its tech stack row -- so `LinkedIn`, `Gmail` and `Facebook` arrived on this
#: profile's skills list beside `TypeScript` (measured on Gabe's own README,
#: 2026-09-19). A stack badge links to the project's docs or to nothing; a
#: contact badge links at the person somewhere else.
_MD_LINKED_IMAGE = re.compile(r"\[!\[([^\]]*)\]\(([^)\s]+)[^\]]*\]\(([^)\s]+)\)")

#: The same wrapper in HTML, which is how a README written in `<p align="center">`
#: spells it -- and how Gabe's does, with the anchor and the image on separate
#: lines. `DOTALL` because of exactly that.
_HTML_LINKED_IMAGE = re.compile(
    r"""<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>""", re.I | re.S
)

#: Where a badge points when it is a way to reach somebody rather than a skill.
_CONTACT_TARGETS = (
    "mailto:",
    "linkedin.com",
    "facebook.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "t.me",
    "telegram",
    "discord",
    "wa.me",
    "whatsapp",
    "youtube.com",
    "tiktok.com",
    "reddit.com",
    "stackoverflow.com",
    "medium.com",
    "dev.to",
    "hashnode",
    "buymeacoffee",
    "ko-fi.com",
    "patreon.com",
    "paypal",
)


def _contact_badges(markdown: str) -> set[str]:
    """The badge URLs that are a way to reach somebody, not a technology.

    KEYED ON THE BADGE IMAGE URL, because that is what both passes below have
    in hand -- the wrapper is only visible in the markdown form, and the set it
    produces is what filters the rest.
    """
    out: set[str] = set()
    for _, badge, target in _MD_LINKED_IMAGE.findall(markdown):
        if any(marker in target.lower() for marker in _CONTACT_TARGETS):
            out.add(badge)
    for target, inner in _HTML_LINKED_IMAGE.findall(markdown):
        if not any(marker in target.lower() for marker in _CONTACT_TARGETS):
            continue
        for raw in _HTML_IMAGE.findall(inner):
            attrs = {name.lower(): value for name, value in _ATTR.findall(raw)}
            src = attrs.get("src")
            if src:
                out.add(src)
        for _, url in _MD_IMAGE.findall(inner):
            out.add(url)
    return out
_HTML_IMAGE = re.compile(r"<img\b([^>]*)>", re.I)
_ATTR = re.compile(r"""(\w+)\s*=\s*["']([^"']*)["']""")

#: A line that is structure rather than prose.
_MD_NOISE = re.compile(
    r"^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|<|\||!\[|\[!\[|---|===)"
)

#: Bullets in a README, however the file writes them.
_MD_BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(.*)$")

#: Inline markdown that a plain sentence should not carry into a CV.
_MD_INLINE = (
    (re.compile(r"!\[[^\]]*\]\([^)]*\)"), ""),
    (re.compile(r"\[([^\]]*)\]\([^)]*\)"), r"\1"),
    (re.compile(r"<[^>]+>"), ""),
    (re.compile(r"[*_`~]{1,3}"), ""),
    (re.compile(r"&[a-z]+;"), " "),
)


def _plain(line: str) -> str:
    """One README line as a sentence: no links, no emphasis, no tags."""
    text = line
    for pattern, replacement in _MD_INLINE:
        text = pattern.sub(replacement, text)
    # Emoji and the decorative glyphs a README opens a bullet with carry no
    # meaning on a CV, and a bullet that starts with one reads as a typo.
    text = re.sub(r"^[^\w(]+", "", text)
    return " ".join(text.split())


def _badge_label(url: str) -> str | None:
    """`.../badge/Tailwind_CSS-38B2AC?logo=...` -> `Tailwind CSS`.

    SHIELDS.IO'S OWN ESCAPING, which is the whole reason this is not a split
    on `-`: a literal dash is written `--`, a literal underscore `__`, and a
    space is `_`. Undoing them in that order is what turns `Next.js-black`
    into `Next.js` rather than into `Next.js black`.
    """
    try:
        path = urlparse(url).path
    except Exception:
        return None
    if "/badge/" not in path:
        return None
    raw = path.split("/badge/", 1)[1]
    # The colour is the last dash-separated field; the label is everything
    # before it, with `--` standing for a dash inside the label itself.
    label = re.split(r"(?<!-)-(?!-)", raw)[0]
    text = unquote(label).replace("__", "\x00").replace("_", " ").replace("\x00", "_")
    text = text.replace("--", "-").strip()
    # `%23F7DF1E` colours and `.svg` suffixes are not technologies.
    text = re.sub(r"\.(svg|png)$", "", text, flags=re.I).strip()
    return text or None


def _readme_badges(markdown: str) -> list[str]:
    """Every technology a README names on a badge, in the order it names them.

    THE ALT TEXT FIRST, THE URL SECOND. A README author writes `![Tailwind
    CSS](...)` for a screen reader and the URL then repeats it in shields.io's
    escaping; the alt text is the human spelling, so it wins where it exists.
    """
    found: list[str] = []
    seen: set[str] = set()
    contacts = _contact_badges(markdown)

    def keep(value: str | None) -> None:
        text = _clean(value)
        if not text or len(text) > 40:
            return
        if text.lower() in seen:
            return
        seen.add(text.lower())
        found.append(text)

    # IN DOCUMENT ORDER, across both spellings. A README mixes `![x](url)` and
    # `<img>` freely -- a row of badges is copied from wherever the author
    # found each one -- so scanning all of one kind and then all of the other
    # reorders the stack against the way its owner laid it out.
    seen_at: list[tuple[int, str | None]] = []
    for match in _MD_IMAGE.finditer(markdown):
        alt, url = match.group(1), match.group(2)
        if any(host in url for host in _BADGE_HOSTS) and url not in contacts:
            seen_at.append((match.start(), _clean(alt) or _badge_label(url)))
    for match in _HTML_IMAGE.finditer(markdown):
        attrs = {name.lower(): value for name, value in _ATTR.findall(match.group(1))}
        url = attrs.get("src", "")
        if any(host in url for host in _BADGE_HOSTS) and url not in contacts:
            seen_at.append((match.start(), attrs.get("alt") or _badge_label(url)))

    for _, label in sorted(seen_at, key=lambda item: item[0]):
        keep(label)

    return found


def _readme_intro(markdown: str) -> str | None:
    """The first real paragraph of a README, as prose.

    WHAT A PROFILE README OPENS WITH is a sentence about the person -- the
    thing a GitHub bio is 160 characters too short to hold. Everything above it
    is a banner, a heading and a row of badges, and every one of those is
    skipped by shape rather than by position: a README that opens with prose
    and a README that opens with three images both arrive here.

    LONG ENOUGH TO BE A SENTENCE. A one-word line under a heading is a label,
    not an introduction, and putting it on a CV as a summary would be worse
    than having none.
    """
    paragraph: list[str] = []
    for line in markdown.splitlines():
        stripped = line.strip()
        if not stripped:
            if paragraph:
                break
            continue
        if _MD_NOISE.match(stripped):
            if paragraph:
                break
            continue
        paragraph.append(_plain(stripped))
    text = " ".join(part for part in paragraph if part).strip()
    # A LEAD-IN IS NOT A SENTENCE. A README paragraph often ends "Three pillars
    # I'm working toward:" and the list it introduces is the next block, which
    # `_MD_NOISE` stops at -- so the summary would end on a colon with nothing
    # after it. Dropped, unless dropping it leaves nothing worth keeping.
    if text.endswith(":"):
        trimmed = re.sub(r"[^.!?]*:$", "", text).strip()
        if len(trimmed) >= 60:
            text = trimmed
    return text if len(text) >= 60 else None


def _readme_highlights(markdown: str, limit: int = 6) -> list[str]:
    """The bullets a README uses to say what the project does.

    THE FILE'S OWN SENTENCES, NOT A SUMMARY OF THEM (Gabe, 2026-09-19: "Fetch
    the readme of every project and display only the relevant information.
    That information will be used to build the bullet-formatted sentences in
    the CV itself"). A CV bullet has to be defensible in an interview, so
    everything here is a line the repository's owner already wrote.

    WHAT IS SKIPPED, and why each one is noise rather than a judgement call:
    a badge row is an image list; an install step is `npm install`, which is
    about the reader rather than the work; a bullet under two words is a
    checklist item; and a bullet that is only a link is a table of contents.
    """
    out: list[str] = []
    for line in markdown.splitlines():
        match = _MD_BULLET.match(line)
        if not match:
            continue
        text = _plain(match.group(1))
        if len(text) < 24 or len(text) > 240:
            continue
        if re.match(r"^(npm|yarn|pnpm|pip|git|cd|docker|make|bun)\b", text, re.I):
            continue
        if re.match(r"^(installation|usage|license|contributing|table of contents)\b", text, re.I):
            continue
        if text.lower() in {item.lower() for item in out}:
            continue
        out.append(text)
        if len(out) >= limit:
            break
    return out


def readme_profile_facts(markdown: str | None) -> dict[str, Any]:
    """What a person's own profile README says about them.

    THE SPECIAL REPOSITORY (Gabe, 2026-09-19: "do not forget the readme of the
    special repository for the user, since there are relevant information there
    that can be fetched for this profile"). `github.com/<user>/<user>` renders
    at the top of a GitHub profile, and for a lot of developers it is the
    fullest thing they have written about themselves anywhere -- an
    introduction, and a stack laid out in labelled rows that the API's
    `language` counts cannot see.

    IT IS PARSED, NOT STORED WHOLE. A README is markdown with banners and
    tables in it; what a CV can use is the opening paragraph and the
    technologies named on the badges.
    """
    if not markdown:
        return {"summary": None, "skills": []}
    return {
        "summary": _readme_intro(markdown),
        "skills": _readme_badges(markdown),
    }


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


def projectable(repos: Any) -> list[dict[str, Any]]:
    """The repositories that become projects, best first.

    FORKS ARE NOT PROJECTS. A fork is a copy of somebody else's work, and a CV
    section that lists one as a project is a claim its owner did not make.

    A REPOSITORY WITH NO DESCRIPTION IS STILL ONE NOW (2026-09-19), which
    reverses an earlier call. It was excluded because the entry would have been
    a bare name, and that was true while a project was a title and one line --
    but the dialog reads the README, so a repository with no blurb and a good
    README is exactly the entry this section wants. One with neither drops out
    below, where the evidence is actually counted.

    EXPORTED, because `app.py` fetches a README per repository and has to know
    which ones will survive before it spends the requests.
    """
    if not isinstance(repos, list):
        return []
    owned = [
        repo
        for repo in repos
        if isinstance(repo, dict) and not repo.get("fork") and not repo.get("archived")
    ]
    owned.sort(key=lambda repo: repo.get("stargazers_count") or 0, reverse=True)
    return owned[:MAX_PROJECTS]


def _tech(repo: dict[str, Any]) -> list[str]:
    """The language and the topics a repository declares, de-duplicated.

    TOPICS ARE THE OWNER'S OWN LABELS -- `nextjs`, `supabase`, `tailwindcss` --
    and they are the only place a repository names the stack around its primary
    language. Written back as they are: a topic is lowercase by GitHub's rule,
    and correcting the case would be guessing at somebody's spelling.
    """
    out: list[str] = []
    seen: set[str] = set()
    language = _clean(repo.get("language"))
    if language:
        out.append(language)
        seen.add(language.lower())
    topics = repo.get("topics")
    if isinstance(topics, list):
        for topic in topics:
            text = _clean(topic)
            if not text or text.lower() in seen:
                continue
            seen.add(text.lower())
            out.append(text)
    return out


def _projects(repos: Any, readmes: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """One project per repository, with what its README says it does.

    THE README IS THE ENTRY (Gabe, 2026-09-19). A repository description is
    one line written for a directory listing; the README is where its owner
    already wrote down what the thing does and how -- which is the difference
    between a CV project entry and a link.

    A REPOSITORY WITH NEITHER A DESCRIPTION NOR A README IS NOT A PROJECT.
    That is the same judgement the description-only filter used to make, moved
    to where all the evidence is: a bare name tells a reader nothing, and an
    entry nobody can act on is worse than a shorter list.
    """
    files = readmes or {}
    out: list[dict[str, Any]] = []
    for repo in projectable(repos):
        name = _clean(repo.get("name")) or ""
        markdown = files.get(name) or files.get(name.lower()) or ""
        description = _clean(repo.get("description"))
        highlights = _readme_highlights(markdown) if markdown else []
        if not description and not highlights:
            continue
        out.append(
            {
                "title": name,
                # THE README'S OPENING LINE FILLS A MISSING BLURB and never
                # replaces one: the description is what the owner chose to say
                # in one line, and a README intro is longer by construction.
                "description": description or (_readme_intro(markdown) if markdown else None),
                "url": _clean(repo.get("html_url")),
                "highlights": highlights,
                "tech": _tech(repo),
                "language": _clean(repo.get("language")),
                "stars": repo.get("stargazers_count")
                if isinstance(repo.get("stargazers_count"), int)
                else None,
                "homepage": _clean(repo.get("homepage")),
                "updatedAt": _clean(repo.get("pushed_at")) or _clean(repo.get("updated_at")),
            }
        )
    return out


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
    user: dict[str, Any],
    repos: Any,
    requested_url: str,
    profile_readme: str | None = None,
    repo_readmes: dict[str, str] | None = None,
) -> dict[str, Any]:
    """A `UserProfile`-shaped dict plus the warnings worth showing."""
    profile = dict(EMPTY_PROFILE)
    warnings: list[str] = []

    name = _clean(user.get("name"))
    login = _clean(user.get("login"))
    profile["name"] = name or login
    profile["location"] = _clean(user.get("location"))
    # NO PHOTO FROM HERE (Gabe, 2026-09-19: "Profile Pic must not come from
    # GitHub. It should come from LinkedIn, Jobstreet, Glassdoor, and Indeed").
    # A GitHub avatar is whatever somebody picked for a code host -- an
    # illustration, a cat, a logo -- and the merge takes the first non-empty
    # value, so on a profile where LinkedIn withheld its picture the avatar won
    # by default and became the face on a CV. Leaving the field unset is what
    # lets a later source fill it; initials are the honest fallback until one
    # does.
    profile["email"] = _clean(user.get("email"))
    profile["url"] = _clean(user.get("html_url")) or requested_url

    # THE PROFILE README IS THE BETTER BIO (Gabe, 2026-09-19). GitHub's `bio`
    # field is 160 characters and is as often a joke as a summary -- this
    # profile's said "All will be well.", which then led the CV. The special
    # `<user>/<user>` repository is where the same person wrote a paragraph.
    readme = readme_profile_facts(profile_readme)
    profile["summary"] = readme["summary"] or _clean(user.get("bio"))

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

    profile["projects"] = _projects(repos, repo_readmes)

    # THE README'S BADGES LEAD THE LANGUAGE COUNTS. A badge row is a stack
    # somebody chose to declare -- Figma, Tailwind, Laravel, tools that never
    # appear as a repository's `language` -- while the counts are a by-product
    # of what GitHub could detect. Both are kept; the declared ones come first
    # because they are the deliberate half.
    languages = _languages(repos)
    seen = {skill.lower() for skill in readme["skills"]}
    profile["skills"] = readme["skills"] + [
        language for language in languages if language.lower() not in seen
    ]

    if not profile["projects"]:
        warnings.append(
            "No public repositories with a description or a README came back from "
            "GitHub, so nothing was added to projects."
        )
    if profile_readme is None:
        warnings.append(
            "No profile README was found at github.com/"
            + (login or "your-username")
            + "/"
            + (login or "your-username")
            + " — a repository named after your account renders at the top of your "
            "profile, and Worktrack reads its introduction and its badges."
        )
    # SAID EVERY TIME, because the absence is structural rather than a failed
    # read: somebody comparing this panel with their CV needs to know the work
    # history did not come from here.
    warnings.append("GitHub carries no work history, so roles and dates come from elsewhere.")

    return {"profile": profile, "warnings": warnings}
