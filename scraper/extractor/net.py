"""Which hostnames this service is allowed to fetch.

A SECOND COPY OF THE GATE, ON PURPOSE. `/api/autofill` validates the URL the
user supplied before it calls this service, and that is the primary control.
This runs again HERE because a redirect is a second URL: the caller validated
what was typed, and only the thing performing the fetch can see where it landed.
The Deno function made exactly this check after `redirect: 'follow'` for the
same reason.

Ported from the `job-url-autofill` edge function (deleted 2026-09-17, in git
history), including the
ranges it chose: RFC1918, loopback, link-local, carrier-grade NAT and
multicast, plus IPv6 loopback, link-local and unique-local. Single-label hosts
are refused because `http://intranet/` is the shape of an internal target.
"""

from __future__ import annotations

import ipaddress
import re
from urllib.parse import urlsplit

MAX_URL_LENGTH = 2048

_CARRIER_GRADE_NAT = ipaddress.ip_network("100.64.0.0/10")


def normalize_hostname(hostname: str) -> str:
    return hostname.strip().lower().strip("[]").rstrip(".")


def is_disallowed_hostname(raw_hostname: str) -> bool:
    host = normalize_hostname(raw_hostname or "")
    if not host:
        return True
    if host == "localhost" or host.endswith(".localhost"):
        return True
    if host.endswith(".local") or host.endswith(".internal"):
        return True
    # A single label cannot be a public site, and IS the shape of an intranet
    # name. Checked before the IP parse so `intranet` is refused too.
    if "." not in host and ":" not in host:
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    if address in _CARRIER_GRADE_NAT:
        # RFC 6598, 100.64.0.0/10. Python's `ipaddress` reports this as
        # PUBLIC -- `is_private`, `is_reserved`, `is_link_local` and
        # `is_multicast` are all False for 100.64.0.1, checked on 3.13 -- so
        # the stdlib alone would have let it through. The Deno function blocked
        # it explicitly (`a === 100 && b >= 64 && b <= 127`), and porting the
        # range rather than trusting the library is what kept it blocked. The
        # test for it is what found the gap.
        return True
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def normalize_target_url(raw_url: str) -> str:
    """What a person pastes is not always a URL. A bare `acme.com/jobs/1` and a
    protocol-relative `//acme.com/...` both mean https here."""
    trimmed = (raw_url or "").strip()
    if not trimmed:
        return ""
    if trimmed.startswith("//"):
        return f"https:{trimmed}"
    if re.match(r"^[a-z][a-z0-9+.-]*://", trimmed, re.I):
        return trimmed
    if re.match(r"^[\w.-]+\.[a-z]{2,}(/|$)", trimmed, re.I):
        return f"https://{trimmed}"
    return trimmed


def reject_reason(url: str) -> str | None:
    """None when the URL may be fetched, else why not."""
    if not url:
        return "URL is required"
    if len(url) > MAX_URL_LENGTH:
        return "URL is too long"
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return "URL must start with http:// or https://"
    if is_disallowed_hostname(parts.hostname or ""):
        return "URL must be a public job posting URL"
    return None
