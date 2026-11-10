import type { SearchGroup, SearchHit } from '@canvas/document';

/** A group of the search sheet's results under its head ("Stickies · 2"). */
export interface SearchResultGroup {
  /** The kind of object. */
  readonly group: SearchGroup;
  /** The head's name. */
  readonly title: 'Stickies' | 'Text' | 'Sections';
  /** Its results, in the index's order. */
  readonly hits: readonly SearchHit[];
}

/** The groups in the sheet's order (design frame B), with their heads' names. */
const GROUP_TITLES: readonly (readonly [SearchGroup, SearchResultGroup['title']])[] = [
  ['stickies', 'Stickies'],
  ['text', 'Text'],
  ['sections', 'Sections'],
];

/**
 * The search sheet's groups: stickies, text, sections, each keeping its results' order, and only
 * those with results.
 *
 * @param hits - The results.
 * @returns The groups.
 */
export function groupSearchHits(hits: readonly SearchHit[]): readonly SearchResultGroup[] {
  return GROUP_TITLES.flatMap(([group, title]) => {
    const inGroup = hits.filter((hit) => hit.group === group);
    return inGroup.length === 0 ? [] : [{ group, title, hits: inGroup }];
  });
}

/**
 * The active result after an arrow key: one step, stopping at either end.
 *
 * @param current - The active result's index.
 * @param delta - -1 for ↑, 1 for ↓.
 * @param count - How many results there are.
 * @returns The new index, or -1 without results.
 */
export function nextActiveIndex(current: number, delta: -1 | 1, count: number): number {
  if (count === 0) return -1;
  return Math.min(count - 1, Math.max(0, current + delta));
}
