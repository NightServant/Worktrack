/**
 * Which URLs `/api/autofill` is allowed to hand to the extractor.
 *
 * PORTED FROM the `job-url-autofill` edge function, not re-derived. (That
 * function was deleted on 2026-09-17, never having been deployed; the original
 * list is in git history.)
 * These ranges were settled once, under review, and re-deriving them from
 * memory is how one gets dropped -- which is not hypothetical: the Python copy
 * of this same gate initially leaned on the standard library and silently let
 * carrier-grade NAT through, because Python's `ipaddress` reports
 * 100.64.0.0/10 as public. It is listed explicitly here for the same reason.
 *
 * THIS IS THE PRIMARY CONTROL. The extractor runs the same check again on the
 * URL a redirect lands on, because only the thing performing the fetch can see
 * that -- but this is the one that decides whether a request is made at all.
 * Without it, an authenticated user could point the server at
 * `http://169.254.169.254/` and read cloud metadata off our own egress.
 */

export const MAX_URL_LENGTH = 2048

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/g, '')
}

function parseIpv4(hostname: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null
  const octets = hostname.split('.').map(Number)
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return octets
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // RFC 6598 carrier-grade NAT
  if (a >= 224) return true // multicast and above
  return false
}

export function isDisallowedHostname(rawHostname: string): boolean {
  const hostname = normalizeHostname(rawHostname)
  if (!hostname) return true
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true
  // A single label cannot be a public site and IS the shape of an intranet
  // name -- `http://intranet/`.
  if (!hostname.includes('.') && !hostname.includes(':')) return true

  const ipv4 = parseIpv4(hostname)
  if (ipv4) return isPrivateIpv4(ipv4)

  if (hostname.includes(':')) {
    if (hostname === '::' || hostname === '::1') return true
    if (hostname.startsWith('fe80:')) return true
    if (hostname.startsWith('fc') || hostname.startsWith('fd')) return true
    if (hostname.includes('%')) return true
  }
  return false
}

/**
 * What a person pastes is not always a URL. A bare `acme.com/jobs/1` and a
 * protocol-relative `//acme.com/...` both mean https here.
 */
export function normalizeTargetUrl(rawUrl: string): string {
  const trimmed = (rawUrl ?? '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

/** `null` when the URL may be fetched, otherwise the reason it may not. */
export function rejectReason(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return 'URL is required'
  const url = normalizeTargetUrl(rawUrl)
  if (!url) return 'URL is required'
  if (url.length > MAX_URL_LENGTH) return 'URL is too long'

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Invalid URL format'
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return 'URL must start with http:// or https://'
  }
  if (isDisallowedHostname(parsed.hostname)) return 'URL must be a public job posting URL'
  return null
}
