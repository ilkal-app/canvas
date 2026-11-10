import { z } from 'zod';

import { styleIdSchema, type ObjectId, type StyleId } from '@canvas/schema';

import type { DocumentTransaction } from '../../store/document-store.js';
import type { StyleKind } from '../../styles/style-map.js';
import type { CommandError } from '../command-error.js';
import { accept, reject, type Command, type CommandContext } from '../command.js';

import {
  agentStyleError,
  existingStyle,
  objectsBoundTo,
  rangesBoundTo,
  type BoundRange,
} from './style-support.js';

// `deleteTextStyle` and `deleteEffectStyle`: remove a board style and
// detach everything naming it, as Figma does: each run or object keeps the values it draws with
// and loses the id, in the same transaction and undo step.

/** Validates the input of {@link deleteTextStyleCommand} and {@link deleteEffectStyleCommand}. */
export const deleteNamedStyleInputSchema = z
  .strictObject({
    /** The style to delete. */
    id: styleIdSchema.describe('The style to delete.'),
  })
  .describe('Deletes a board style; whatever used it keeps its values.');

/** What a delete style command returns. */
export interface DeleteNamedStyleResult {
  /** The deleted style's id. */
  readonly id: StyleId;
}

/** What a delete style command will write. */
export interface DeleteNamedStylePlan {
  /** The text runs to detach. */
  readonly ranges: readonly BoundRange[];
  /** The shapes and frames to detach. */
  readonly objectIds: readonly ObjectId[];
}

/**
 * Plans a delete: the style exists and the caller may delete it.
 *
 * @param context - The command's context.
 * @param kind - Text or effect styles.
 * @param id - The style.
 * @returns The plan, or the errors.
 */
function planDelete(
  context: CommandContext,
  kind: StyleKind,
  id: StyleId,
): DeleteNamedStylePlan | CommandError[] {
  const errors: CommandError[] = [];
  const entry = existingStyle(context.board, kind, id, ['id'], errors);
  if (entry === undefined) return errors;
  const denied = agentStyleError(context, kind, entry);
  if (denied !== undefined) return [denied];
  return {
    ranges: kind === 'text' ? rangesBoundTo(context.board, id) : [],
    objectIds: kind === 'effect' ? objectsBoundTo(context.board, id) : [],
  };
}

/**
 * Detaches a style's users, then deletes it.
 *
 * @param transaction - The transaction.
 * @param kind - Text or effect styles.
 * @param id - The style.
 * @param plan - The plan.
 * @returns The result.
 */
function applyDelete(
  transaction: DocumentTransaction,
  kind: StyleKind,
  id: StyleId,
  plan: DeleteNamedStylePlan,
): DeleteNamedStyleResult {
  for (const range of plan.ranges) {
    transaction.formatText(range.id, range.index, range.length, { textStyleId: null });
  }
  for (const objectId of plan.objectIds) {
    transaction.patchObject(objectId, { effectStyleId: undefined });
  }
  transaction.deleteNamedStyle(kind, id);
  return { id };
}

/**
 * `deleteTextStyle`: deletes a board text style; every run naming it keeps its values
 * and loses the id. Refused: an id the board lacks (`missing-style`), and an agent deleting a
 * style it did not create (`not-own-style`). One undo step, which restores the style and the ids.
 */
export const deleteTextStyleCommand: Command<
  typeof deleteNamedStyleInputSchema,
  DeleteNamedStylePlan,
  DeleteNamedStyleResult
> = {
  name: 'deleteTextStyle',
  description: 'Deletes a board text style; every text using it keeps its values.',
  input: deleteNamedStyleInputSchema,
  validate(context, input) {
    const planned = planDelete(context, 'text', input.id);
    return Array.isArray(planned) ? reject(planned) : accept(planned);
  },
  apply(transaction, input, plan) {
    return applyDelete(transaction, 'text', input.id, plan);
  },
};

/**
 * `deleteEffectStyle`: deletes a board effect style; every shape and frame naming it
 * keeps its shadow layers and loses the id. Refused as `deleteTextStyle` is.
 */
export const deleteEffectStyleCommand: Command<
  typeof deleteNamedStyleInputSchema,
  DeleteNamedStylePlan,
  DeleteNamedStyleResult
> = {
  name: 'deleteEffectStyle',
  description: 'Deletes a board effect style; every shape and frame using it keeps its shadow.',
  input: deleteNamedStyleInputSchema,
  validate(context, input) {
    const planned = planDelete(context, 'effect', input.id);
    return Array.isArray(planned) ? reject(planned) : accept(planned);
  },
  apply(transaction, input, plan) {
    return applyDelete(transaction, 'effect', input.id, plan);
  },
};
