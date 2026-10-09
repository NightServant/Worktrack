/**
 * Which page numbers a pager shows, with `null` where an ellipsis goes.
 *
 * Seven or fewer pages: all of them. More: the first, the last, the current
 * page and its neighbours, so the strip never grows past seven slots and the
 * reader can always reach both ends in one press.
 *
 *   pageWindow(1, 12) -> [1, 2, 3, 4, null, 12]
 *   pageWindow(6, 12) -> [1, null, 5, 6, 7, null, 12]
 */
export function pageWindow(current: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1)
  const near = new Set([1, count, current - 1, current, current + 1])
  if (current <= 3) [2, 3, 4].forEach((page) => near.add(page))
  if (current >= count - 2) [count - 3, count - 2, count - 1].forEach((page) => near.add(page))
  const pages = [...near].filter((page) => page >= 1 && page <= count).sort((a, b) => a - b)
  const out: (number | null)[] = []
  pages.forEach((page, index) => {
    const gap = index > 0 ? page - pages[index - 1] : 1
    // A gap of ONE page shows that page: an ellipsis there would take the
    // same slot to hide a single number.
    if (gap === 2) out.push(page - 1)
    else if (gap > 2) out.push(null)
    out.push(page)
  })
  return out
}
