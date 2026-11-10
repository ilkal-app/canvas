import { BOARD_BOUND } from '@canvas/schema';

import { commandError, type CommandError } from '../commands/command-error.js';

import type { WorldBoundViolation } from './world-bound-check.js';
import type { WorldBox } from './world-box.js';

/**
 * A place on the board, for a message.
 *
 * @param where - Where the object is.
 * @returns A short description.
 */
function describe(where: WorldBox | undefined): string {
  if (where === undefined) return 'new';
  if (where.kind === 'unplaceable') return 'at no place that can be worked out';
  const { minX, maxX, minY, maxY } = where.box;
  return `at x ${String(minX)}..${String(maxX)}, y ${String(minY)}..${String(maxY)}`;
}

/**
 * The refusal of a command that breaks the board's bound: one `invalid-input` error per
 * violation, naming the object. An extent's error has an empty path (the place is worked out from
 * several fields, and a carried object is named by no input); a value's names its field.
 *
 * @param violations - What `worldBoundViolations` found.
 * @returns The errors.
 */
export function boundErrorsOf(violations: readonly WorldBoundViolation[]): CommandError[] {
  const bound = String(BOARD_BOUND);
  return violations.map((violation) => {
    const { objectId } = violation;
    if (violation.kind === 'value') {
      const was = violation.before === undefined ? '' : ` (it was ${String(violation.before)})`;
      return commandError(
        'invalid-input',
        objectId,
        violation.issue.path,
        `${violation.issue.message}${was}`,
      );
    }
    const { verdict, before, after } = violation;
    const what =
      verdict.kind === 'unplaceable'
        ? 'would have no place on the board that can be worked out'
        : `would reach past the board's bound of ±${bound} world units at ${verdict.extents.join(', ')}`;
    return commandError(
      'invalid-input',
      objectId,
      [],
      `"${objectId}" ${what}: it would be ${describe(after)}, it was ${describe(before)}`,
    );
  });
}
