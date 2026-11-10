import type { CommandError, RunStoppedError } from '@canvas/document';

import { MAX_PASTE_OBJECTS } from '../clipboard/clipboard-notice.js';

// What the person is told about a paste or a duplicate that did less than asked:
// how many of its objects went in.

/** Which change created the objects: a paste (any drop or placed image too) or a duplicate. */
export type CreateKind = 'paste' | 'duplicate';

/** The most objects one duplicate creates, as many as one paste (`MAX_PASTE_OBJECTS`). */
export const MAX_DUPLICATE_OBJECTS = MAX_PASTE_OBJECTS;

/**
 * The notice of a create the board refused whole: how many objects it held, and the first
 * problem.
 *
 * @param kind - A paste or a duplicate.
 * @param count - How many objects it asked for.
 * @param errors - The command's problems.
 * @returns A sentence for the person.
 */
export function createRefusedNotice(
  kind: CreateKind,
  count: number,
  errors: readonly CommandError[],
): string {
  const [first] = errors;
  const why = first === undefined ? 'the board refused them' : first.message;
  const more = errors.length > 1 ? ` (and ${String(errors.length - 1)} more)` : '';
  const verb = kind === 'paste' ? 'pasted' : 'duplicated';
  return `None of the ${String(count)} objects were ${verb}: ${why}${more}.`;
}

/**
 * The notice of a create that stopped partway: how many of its objects went in.
 *
 * @param kind - A paste or a duplicate.
 * @param count - How many objects it asked for.
 * @param error - What the run rejected with; its committed parts' created ids are counted.
 * @returns A sentence for the person.
 */
export function createStoppedNotice(
  kind: CreateKind,
  count: number,
  error: RunStoppedError,
): string {
  const created = error.changes?.created.length ?? 0;
  const verb = kind === 'paste' ? 'Pasted' : 'Duplicated';
  return `${verb} ${String(created)} of ${String(count)} objects before it stopped.`;
}

/**
 * The notice of a duplicate refused for its size, before anything was copied.
 *
 * @param count - How many objects the selection would copy.
 * @returns A sentence for the person.
 */
export function duplicateTooLargeNotice(count: number): string {
  return `A duplicate creates at most ${MAX_DUPLICATE_OBJECTS.toLocaleString('en-US')} objects; this selection holds ${String(count)}.`;
}
