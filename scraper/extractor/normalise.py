"""Text normalisers, ported from the `job-url-autofill` edge function's
parser.ts (deleted 2026-09-17, in git history).

PORTED RATHER THAN REWRITTEN. Each of these encodes a decision someone made
against a real posting -- stripping "| LinkedIn" off a title, dropping a
"hiring ..." tail, decoding a percent-encoded company out of a URL path. The
twenty cases in `src/lib/__tests__/jobAutofillParser.test.ts` are the record of
which ones matter, and they are ported alongside so a regression is visible
rather than inferred.

The PARSING moves to a real DOM (see sites/); only this string handling stays
regex, because that is what it legitimately is.
"""

from __future__ import annotations

import html as _html
import re
from urllib.parse import unquote_plus

_WS = re.compile(r"\s+")


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return _html.unescape(_WS.sub(" ", value).strip()).strip()


def decode_possibly_encoded(value: str) -> str:
    """A company read out of a URL path is often percent-encoded, and `+` there
    is a space. `unquote_plus` does both; a malformed escape is left alone
    rather than raising, matching the TS `try/catch`."""
    if not value:
        return ""
    try:
        return unquote_plus(value)
    except Exception:  # pragma: no cover - unquote_plus is total in practice
        return value


_BY_SUFFIX = re.compile(r"\s+by\s+[^,|-]+$", re.I)
_TRAILING_SEGMENT = re.compile(r"\s*[|\-:].*$", re.I)


def normalize_company(raw: str) -> str:
    if not raw:
        return ""
    value = clean_text(decode_possibly_encoded(raw))
    value = _BY_SUFFIX.sub("", value)
    value = _TRAILING_SEGMENT.sub("", value)
    return value.strip()


_BOARD_TAIL = re.compile(
    r"\s*[|\-:]\s*.*(LinkedIn|Careers|Workday|Greenhouse|Indeed|Glassdoor|–|—).*$",
    re.I,
)
_HIRING_TAIL = re.compile(r"\b(hiring|recruiting)\b.*$", re.I)


def normalize_role(raw: str, company: str | None = None) -> str:
    if not raw:
        return ""
    value = clean_text(decode_possibly_encoded(raw))
    value = _BOARD_TAIL.sub("", value)
    if company:
        value = re.sub(r"^" + re.escape(company) + r"\s+", "", value, flags=re.I)
    value = _HIRING_TAIL.sub("", value)
    if company:
        c = _WS.sub(" ", company).strip()
        if c and value.lower().startswith(c.lower()):
            value = value[len(c) :].strip()
    return value.strip()


#: `wfh` IS WORD-BOUNDED because it is three letters that appear inside
#: nothing else worth matching, and leaving it out cost a real field: the
#: Philippine boards write "| WFH" in the TITLE where other markets write
#: "Remote", so every WFH posting read as no work mode at all.
_REMOTE = re.compile(r"(remote|work from home|\bwfh\b|telecommute|telework)", re.I)
_HYBRID = re.compile(r"hybrid", re.I)
_ONSITE = re.compile(r"(on[- ]site|onsite|in[- ]person)", re.I)


def infer_work_mode(text: str) -> str | None:
    if not text:
        return None
    if _REMOTE.search(text):
        return "remote"
    if _HYBRID.search(text):
        return "hybrid"
    if _ONSITE.search(text):
        return "onsite"
    return None


def title_to_role(title: str) -> str:
    """The first segment of a page title. `Role - Company | Board` is the shape
    almost every board uses, and everything after the first separator is the
    board talking rather than the posting."""
    if not title:
        return ""
    return clean_text(re.split(r"\s[-|]\s", title)[0] or title)


def source_from_host(hostname: str) -> str:
    return re.sub(r"^www\.", "", hostname, flags=re.I)


def parse_salary_value(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        digits = re.sub(r"[^\d.]", "", value)
        if not digits:
            return None
        try:
            return float(digits)
        except ValueError:
            return None
    return None


#: Currency tokens, MOST SPECIFIC FIRST.
#:
#: The order is load-bearing rather than cosmetic: `S$` and `A$` both end in
#: `$`, so a pattern that tried plain `$` first would read "S$7,000" as USD
#: 7,000 and silently mislabel a Singapore salary.
#:
#: These are exactly the six currencies the app supports -- the same vocabulary
#: as SUPPORTED_CURRENCIES and the `jobs_salary_currency_check` constraint. A
#: seventh detected here would be a value the form cannot store.
_CURRENCIES: tuple[tuple[str, str], ...] = (
    ("SGD", r"S\$|SGD"),
    ("AUD", r"A\$|AUD"),
    ("USD", r"US\$|USD|\$"),
    ("PHP", r"₱|PHP|Php"),
    ("EUR", r"€|EUR"),
    ("GBP", r"£|GBP"),
)

_CURRENCY_ALT = "|".join(pattern for _, pattern in _CURRENCIES)

#: A number, optionally with thousands separators and an optional `k` suffix.
#:
#: Built per-name rather than reused as one constant: a pattern cannot carry
#: the same group name twice, and reading the two amounts out by POSITION is
#: what broke the first version of this -- adding the named currency group
#: silently shifted every index by one.
def _number(name: str) -> str:
    return rf"(?P<{name}>[\d,]{{2,}}(?:\.\d+)?)\s*(?P<{name}_k>k\b)?"


_DASH = r"\s*(?:-|to|–|—|until)\s*"

#: `₱50,000 - ₱70,000`, `$120,000 to $150,000`, `S$5,000-7,000`.
_RANGE_PREFIXED = re.compile(
    rf"(?P<cur>{_CURRENCY_ALT})\s?{_number('lo')}{_DASH}"
    rf"(?:{_CURRENCY_ALT})?\s?{_number('hi')}",
    re.I,
)

#: `50,000 - 70,000 PHP`, `40k to 55k GBP`. The suffix form is common on job
#: boards outside the US, which is exactly where the old dollar-only pattern
#: found nothing.
_RANGE_SUFFIXED = re.compile(
    rf"{_number('lo')}{_DASH}{_number('hi')}\s*(?P<cur>{_CURRENCY_ALT})",
    re.I,
)


def _currency_of(token: str) -> str | None:
    """Maps a matched symbol or code back to its ISO code."""
    cleaned = token.strip().upper()
    for code, pattern in _CURRENCIES:
        if re.fullmatch(pattern, cleaned, re.I):
            return code
    return None


def _amount(digits: str, k_suffix: str | None) -> float | None:
    try:
        value = float(digits.replace(",", ""))
    except ValueError:
        return None
    # "70k" is 70,000. Applied AFTER the comma strip so "70,000k" -- which is
    # not a thing anyone writes -- cannot quietly become 70 million.
    return value * 1000 if k_suffix else value


def salary_range_from_text(text: str) -> tuple[float | None, float | None, str | None]:
    """A salary range and its currency, from free text.

    WAS DOLLAR-ONLY UNTIL 2026-09-06, and that was a real defect rather than a
    simplification: the pattern required a literal `$` before BOTH numbers, so
    `₱50,000 - ₱70,000` -- the ordinary shape of a Philippine posting, which is
    most of what this deployment reads -- could never match. Auto-fill reported
    "Salary was not found in page metadata" on pages that stated it plainly.

    Returns the currency too. Without it a peso range would be stored under
    whatever default the user happened to have set, which is right only by
    accident and wrong the moment they look at a posting from anywhere else.
    """
    flat = _WS.sub(" ", text)
    for pattern in (_RANGE_PREFIXED, _RANGE_SUFFIXED):
        match = pattern.search(flat)
        if not match:
            continue
        # BY NAME, never by index. The first version read positional groups
        # and the named currency group shifted all of them by one.
        low = _amount(match.group("lo"), match.group("lo_k"))
        high = _amount(match.group("hi"), match.group("hi_k"))
        if low is None or high is None:
            continue
        # A "range" that runs backwards is a false positive -- almost always a
        # date, a page number or an unrelated pair of figures.
        if high < low:
            continue
        return low, high, _currency_of(match.group("cur"))
    return None, None, None
