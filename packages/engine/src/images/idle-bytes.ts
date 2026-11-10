import type { EvictionCandidate } from './eviction-order.js';

/**
 * The bytes evicting every idle level would free: idle own textures, and the atlas pages
 * holding only idle entries (a page is freed only once empty). The page of an entry that is
 * being replaced never counts: that entry stays until its replacement is placed, so the page
 * cannot empty.
 *
 * @param candidates - The resident levels, with whether each is needed.
 * @param pageOf - The atlas page a level's entry is on, or undefined for an own texture.
 * @param pageBytes - The bytes of one atlas page.
 * @param pinnedPage - The page of the entry being replaced, if it is an atlas entry.
 * @returns Bytes.
 */
export function idleBytesOf(
  candidates: readonly EvictionCandidate[],
  pageOf: (key: string) => number | undefined,
  pageBytes: number,
  pinnedPage: number | undefined,
): number {
  let bytes = 0;
  const pages = new Map<number, boolean>();
  if (pinnedPage !== undefined) pages.set(pinnedPage, false);
  for (const { key, isNeeded, bytes: levelBytes } of candidates) {
    const page = pageOf(key);
    if (page === undefined) {
      if (!isNeeded) bytes += levelBytes;
      continue;
    }
    pages.set(page, (pages.get(page) ?? true) && !isNeeded);
  }
  for (const isIdle of pages.values()) if (isIdle) bytes += pageBytes;
  return bytes;
}
