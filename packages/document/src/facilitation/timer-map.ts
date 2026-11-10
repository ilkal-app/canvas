import type * as Y from 'yjs';

import { boardTimerSchema, type BoardTimer } from '@canvas/schema';

import { isSamePlainValue } from '../codec/plain-value.js';

// The stored layout of the board's facilitation state: a top-level `Y.Map` named
// `facilitation` whose `timer` key holds the board timer as one plain value, written whole, so
// concurrent starts, pauses and resumes converge to one writer's timer (last writer wins) and a
// reader never sees one person's status with another's time. No key means no timer. A value that
// does not validate (a peer's hostile or newer write) reads as no timer. The map is outside every
// undo scope: a timer action is never undone. A build that does not know the map never opens it,
// so it needs no layout gate. This name and this key are part of the persisted format.

/** The name of the document's top-level map of facilitation state. Part of the persisted format. */
export const FACILITATION_MAP_NAME = 'facilitation';

/** The key of the board timer in the facilitation map. Part of the persisted format. */
export const BOARD_TIMER_KEY = 'timer';

/**
 * Reads the board timer from the facilitation map.
 *
 * @param map - The facilitation map.
 * @returns The timer, frozen, or `undefined` when there is none or the stored value is invalid.
 */
export function readBoardTimer(map: Y.Map<unknown>): BoardTimer | undefined {
  const parsed = boardTimerSchema.safeParse(map.get(BOARD_TIMER_KEY));
  return parsed.success ? Object.freeze(parsed.data) : undefined;
}

/**
 * Writes the board timer whole, or deletes it, unless the map already holds the same.
 *
 * @param map - The facilitation map, inside a transaction.
 * @param timer - The timer, already validated, or `undefined` for none.
 */
export function writeBoardTimer(map: Y.Map<unknown>, timer: BoardTimer | undefined): void {
  if (timer === undefined) {
    if (map.has(BOARD_TIMER_KEY)) map.delete(BOARD_TIMER_KEY);
    return;
  }
  if (map.has(BOARD_TIMER_KEY) && isSamePlainValue(map.get(BOARD_TIMER_KEY), timer)) return;
  map.set(BOARD_TIMER_KEY, structuredClone(timer));
}
