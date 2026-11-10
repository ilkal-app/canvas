import type { FarSkip } from '@canvas/tools';

/**
 * What the shell says when a transform of the selection (a drag, a nudge, an arrangement) skipped
 * far objects (`isFarObject`): an object whose place on the board, or a part it carries,
 * is past the board's bound or cannot be worked out. It names no cause, since an object can be far
 * in several ways (placed out there by another client, carried there by a number that is not
 * finite, a hair past the edge). The rest of the selection was transformed; when every object was
 * far nothing was. No ids.
 *
 * @param skip - What was skipped, and whether that was all of it.
 * @returns The notice's text.
 */
export function farObjectsNotice(skip: FarSkip): string {
  if (skip.isEvery) {
    return 'That change could not be made: the selected objects are out of range of the board.';
  }
  return skip.ids.length === 1
    ? '1 object was left where it was: it is out of range of the board.'
    : `${String(skip.ids.length)} objects were left where they were: they are out of range of the board.`;
}
