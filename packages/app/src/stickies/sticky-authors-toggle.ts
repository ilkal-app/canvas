import {
  createRandomObjectId,
  runCommand,
  setStickyAuthorsCommand,
  SYSTEM_ORIGIN,
  type DocumentStore,
} from '@canvas/document';

/**
 * Turns the board's "Show authors on stickies" setting over (the sticky popover's
 * Author): for everyone on the board, run under the system origin as the board timer is, so it is
 * never part of anyone's undo history.
 *
 * @param store - The board's store.
 */
export function toggleStickyAuthors(store: DocumentStore): void {
  const input = { isShown: !store.stickyAuthors.current };
  const environment = { clock: () => Date.now(), createId: createRandomObjectId };
  runCommand(store, SYSTEM_ORIGIN, setStickyAuthorsCommand, input, environment);
}
