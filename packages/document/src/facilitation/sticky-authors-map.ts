import type * as Y from 'yjs';

// The board's "Show authors on stickies" setting, beside the board timer in the
// facilitation map: its `stickyAuthors` key holds one plain boolean, written whole, so
// concurrent toggles converge to one writer's value (last writer wins). No key, or any value that
// is not a boolean (a peer's hostile or newer write), reads as false. Like the timer it is outside
// every undo scope and needs no layout gate: an older build ignores the key it does not know (one
// before never opens the map). An older relay's door refuses the key, so the relay deploys
// before any client offers the toggle. This key is part of the persisted format.

/** The facilitation map's key for the board's sticky author setting. */
export const STICKY_AUTHORS_KEY = 'stickyAuthors';

/**
 * Whether the board shows authors on its stickies.
 *
 * @param map - The facilitation map.
 * @returns True only for a stored `true`.
 */
export function readStickyAuthors(map: Y.Map<unknown>): boolean {
  return map.get(STICKY_AUTHORS_KEY) === true;
}

/**
 * Stores the board's sticky author setting, writing nothing when it already holds that value.
 *
 * @param map - The facilitation map.
 * @param isShown - Whether authors are shown.
 */
export function writeStickyAuthors(map: Y.Map<unknown>, isShown: boolean): void {
  if (map.get(STICKY_AUTHORS_KEY) === isShown) return;
  map.set(STICKY_AUTHORS_KEY, isShown);
}
