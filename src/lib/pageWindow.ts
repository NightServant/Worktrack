/**
 * Which page numbers a pager shows, with `null` where an ellipsis goes.
 *
 * Seven or fewer pages: all of them. More: ALWAYS exactly seven slots -- the
 * first, the last, the current page and its neighbours, padded towards
 * whichever end is near. A fixed slot count is the point: a strip that grows
 * with the data (every number of a 38-page list) runs off the screen, and one
 * that changes length as you page makes the next/previous buttons jump out
 * from under the pointer.
 *
 *   pageWindow(1, 12)  -> [1, 2, 3, 4, 5, null, 12]
 *   pageWindow(6, 12)  -> [1, null, 5, 6, 7, null, 12]
 *   pageWindow(12, 12) -> [1, null, 8, 9, 10, 11, 12]
 */
export function pageWindow(current: number, count: number): (number | null)[] {
  if (count <= 0) return []
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1)
  const page = Math.min(Math.max(1, current), count)
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, index) => from + index)
  if (page <= 4) return [...range(1, 5), null, count]
  if (page >= count - 3) return [1, null, ...range(count - 4, count)]
  return [1, null, page - 1, page, page + 1, null, count]
}
