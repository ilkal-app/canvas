import type { BoardObject } from '@canvas/schema';

import { objectFontRuns } from './follow-board-fonts.js';
import { pageFontStatus } from './page-fonts.js';

/** One explicit request; closing it never mutates the document. */
export interface FontReplacement {
  readonly owner: object;
  readonly families: readonly string[];
  /**
   * What the choice changes: one text's font before it is edited (the default), or
   * the family everywhere the board names it (the missing-fonts notice).
   */
  readonly scope?: 'object' | 'board';
  readonly replace: (family: string) => Promise<boolean>;
}
let current: FontReplacement | undefined;
const LISTENERS = new Set<() => void>();
/**
 * Reads the active request without starting work.
 *
 * @returns The stable snapshot for the replacement dialog.
 */
export function readFontReplacement(): FontReplacement | undefined {
  return current;
}
/**
 * Follows replacement requests.
 *
 * @param listener - React's subscriber.
 * @returns Unsubscribe.
 */
export function subscribeFontReplacement(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}
/**
 * Opens or dismisses a request without writing text.
 *
 * @param request - New request, or undefined to cancel.
 */
export function setFontReplacement(request: FontReplacement | undefined): void {
  current = request;
  for (const listener of LISTENERS) listener();
}
/**
 * Reads missing families. Known loading fonts retain the existing held-edit behaviour.
 *
 * @param object - Text, note or label.
 * @returns Missing or failed families, deduplicated.
 */
export function missingObjectFonts(object: BoardObject): readonly string[] {
  return [
    ...new Set(
      objectFontRuns(object)
        .filter(({ style }) => {
          const status = pageFontStatus(style.fontFamily);
          return status === 'missing' || status === 'failed';
        })
        .map(({ style }) => style.fontFamily),
    ),
  ];
}
