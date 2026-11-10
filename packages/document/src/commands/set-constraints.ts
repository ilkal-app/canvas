import { z } from 'zod';

import {
  CONSTRAINT_MODES,
  effectiveConstraints,
  objectIdSchema,
  type ObjectId,
} from '@canvas/schema';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { applyPatches, type PlannedPatch } from './object-patches.js';

/** Axes to change on direct children of frames or main definitions. */
export const setConstraintsInputSchema = z.strictObject({
  /** Stored children to constrain. */
  ids: z.array(objectIdSchema).min(1).describe('Direct children of frames or component mains.'),
  /** Horizontal pin or stretch behavior. */
  x: z
    .enum(CONSTRAINT_MODES)
    .optional()
    .describe('Horizontal mode; omitted keeps the existing mode.'),
  /** Vertical pin or stretch behavior. */
  y: z
    .enum(CONSTRAINT_MODES)
    .optional()
    .describe('Vertical mode; omitted keeps the existing mode.'),
});

/** Identities whose constraint records changed. */
export interface SetConstraintsResult {
  /** Updated children in input order. */
  readonly updatedIds: readonly ObjectId[];
}

/** Sets resize constraints without changing geometry or the omitted axis. */
export const setConstraintsCommand: Command<
  typeof setConstraintsInputSchema,
  readonly PlannedPatch[],
  SetConstraintsResult
> = {
  name: 'setConstraints',
  description: 'Sets pin and stretch constraints on children of frames and component mains.',
  input: setConstraintsInputSchema,
  validate(context, input) {
    const { named, errors } = lookUpNamed(
      context.board,
      input.ids,
      (id) => id,
      (index) => ['ids', index],
    );
    const patches: PlannedPatch[] = [];
    for (const { object, path } of named) {
      const parent = object.parentId === null ? undefined : context.board.get(object.parentId);
      if (parent?.type !== 'frame' && parent?.type !== 'component') {
        errors.push(
          commandError(
            'invalid-parent',
            object.id,
            path,
            'Constraints require a frame or component parent.',
          ),
        );
        continue;
      }
      const previous = effectiveConstraints(object);
      const constraints = { x: input.x ?? previous.x, y: input.y ?? previous.y };
      if (constraints.x === previous.x && constraints.y === previous.y) continue;
      const patch = { constraints };
      checkObject(context.board, { ...object, ...patch }, errors);
      patches.push({ id: object.id, patch });
    }
    return errors.length > 0 ? reject(errors) : accept(patches);
  },
  apply(transaction, input, plan) {
    return { updatedIds: applyPatches(transaction, plan) };
  },
};
