import { z } from 'zod';

import {
  effectStyleValueSchema,
  isSameValue,
  objectIdSchema,
  styleIdSchema,
  styleNameSchema,
  textStyleValueSchema,
  type EffectStyleValue,
  type ObjectId,
  type StyleId,
  type TextStyleValue,
} from '@canvas/schema';

import type { DocumentTransaction } from '../../store/document-store.js';
import type { StyleKind, StyleWrite } from '../../styles/style-map.js';
import { commandError, type CommandError } from '../command-error.js';
import { accept, reject, type Command, type CommandContext } from '../command.js';
import { hasMeasuredBody, measuredSizeSchema } from '../measured-size.js';

import {
  agentStyleError,
  duplicateStyleNameError,
  existingStyle,
  objectsBoundTo,
  rangesBoundTo,
  styleLimitError,
  stylesOf,
  textStylePatchOf,
  type BoundRange,
} from './style-support.js';

// `setTextStyle` and `setEffectStyle`: create a board style with a fresh
// id, or update one, rewriting its values on every run or object that names it (on every page
// and in mains, so instances follow), in the same transaction and undo step. A text style's new
// values may change texts' sizes: the caller measures them (`measured`) and the boxes are written
// with the values, as `setStyle` takes a measured size.

/** One measured box a text style update writes (the caller measured the text in the new values). */
const measuredBoxSchema = z.strictObject({
  /** The text or sticky. */
  id: objectIdSchema,
  /** Its measured width, world px. */
  width: measuredSizeSchema.shape.width,
  /** Its measured height, world px. */
  height: measuredSizeSchema.shape.height,
});

/** Validates the input of {@link setTextStyleCommand}. */
export const setTextStyleInputSchema = z
  .strictObject({
    /** The style to update; absent to create one with a fresh id. */
    id: styleIdSchema.optional().describe('The text style to update; omit to create one.'),
    /** The style's name, unique among the board's text styles. */
    name: styleNameSchema,
    /** The style's value. */
    value: textStyleValueSchema,
    /** Boxes measured in the new values, written in the same step (an update's texts). */
    measured: z
      .array(measuredBoxSchema)
      .optional()
      .describe("Texts' and stickies' boxes measured in the new values, written in the same step."),
  })
  .describe("Creates a board text style, or sets a text style's name and value.");

/** Validates the input of {@link setEffectStyleCommand}. */
export const setEffectStyleInputSchema = z
  .strictObject({
    /** The style to update; absent to create one with a fresh id. */
    id: styleIdSchema.optional().describe('The effect style to update; omit to create one.'),
    /** The style's name, unique among the board's effect styles. */
    name: styleNameSchema,
    /** The style's value. */
    value: effectStyleValueSchema,
  })
  .describe("Creates a board effect style, or sets an effect style's name and value.");

/** A text's or sticky's box, measured by the caller in a text style's new values. */
export interface MeasuredBox {
  /** The text or sticky. */
  readonly id: ObjectId;
  /** Its measured width, world px. */
  readonly width: number;
  /** Its measured height, world px. */
  readonly height: number;
}

/** What {@link setTextStyleCommand} and {@link setEffectStyleCommand} return. */
export interface SetNamedStyleResult {
  /** The style's id: the new one for a created style. */
  readonly id: StyleId;
  /** Whether a style was created. */
  readonly isCreated: boolean;
}

/** What a set style command will write. */
export interface SetNamedStylePlan {
  /** The style as it will read, or `null` when the entry does not change. */
  readonly style: StyleWrite | null;
  /** The style's id. */
  readonly id: StyleId;
  /** Whether it is created. */
  readonly isCreated: boolean;
  /** The command's time, recorded for a new entry. */
  readonly createdAt: number;
  /** A text style update's runs to rewrite. */
  readonly ranges: readonly BoundRange[];
  /** An effect style update's objects to rewrite. */
  readonly objectIds: readonly ObjectId[];
  /** The measured boxes to write. */
  readonly measured: readonly MeasuredBox[];
}

/** The most fresh ids tried for a new style past one per style the board has. */
const MAX_ID_ATTEMPTS = 8;

/**
 * A fresh id for a new style: one no style of the kind has.
 *
 * @param context - The command's context.
 * @param kind - Text or effect styles.
 * @param errors - Where to add a refusal when none is found.
 * @returns The id, or `undefined`.
 */
function freshStyleId(
  context: CommandContext,
  kind: StyleKind,
  errors: CommandError[],
): StyleId | undefined {
  const taken = stylesOf(context.board, kind);
  for (let attempt = 0; attempt < taken.size + MAX_ID_ATTEMPTS; attempt += 1) {
    const id: StyleId = context.createId();
    if (!taken.has(id)) return id;
  }
  errors.push(commandError('duplicate-id', null, ['id'], 'no fresh style id was found'));
  return undefined;
}

/** The input of either command, as the planner takes it. */
interface NamedStyleInput {
  readonly id?: StyleId | undefined;
  readonly name: string;
  readonly value: TextStyleValue | EffectStyleValue;
  readonly measured?: readonly MeasuredBox[] | undefined;
}

/**
 * Checks the measured boxes name texts or stickies of the board.
 *
 * @param context - The command's context.
 * @param measured - The boxes.
 * @param errors - Where to add refusals.
 */
function checkMeasured(
  context: CommandContext,
  measured: NonNullable<NamedStyleInput['measured']>,
  errors: CommandError[],
): void {
  for (const [index, { id }] of measured.entries()) {
    const object = context.board.get(id);
    if (object === undefined) {
      errors.push(
        commandError('missing-object', id, ['measured', index, 'id'], `no object "${id}"`),
      );
    } else if (!hasMeasuredBody(object.type)) {
      const message = `a ${object.type} has no measured size of its own`;
      errors.push(commandError('unsupported-type', id, ['measured', index, 'id'], message));
    }
  }
}

/**
 * Plans a create or an update of a style of a kind.
 *
 * @param context - The command's context.
 * @param kind - Text or effect styles.
 * @param input - The input.
 * @returns The plan, or the errors.
 */
function planNamedStyle(
  context: CommandContext,
  kind: StyleKind,
  input: NamedStyleInput,
): SetNamedStylePlan | CommandError[] {
  const errors: CommandError[] = [];
  const measured = input.measured ?? [];
  checkMeasured(context, measured, errors);
  if (input.id === undefined) {
    const limit = styleLimitError(context.board, kind);
    if (limit !== undefined) errors.push(limit);
    const duplicate = duplicateStyleNameError(context.board, kind, input.name, undefined);
    if (duplicate !== undefined) errors.push(duplicate);
    const id = errors.length > 0 ? undefined : freshStyleId(context, kind, errors);
    if (id === undefined) return errors;
    return {
      style: { id, name: input.name, value: input.value },
      id,
      isCreated: true,
      createdAt: context.now,
      ranges: [],
      objectIds: [],
      measured,
    };
  }
  const { id } = input;
  const entry = existingStyle(context.board, kind, id, ['id'], errors);
  if (entry === undefined) return errors;
  const denied = agentStyleError(context, kind, entry);
  if (denied !== undefined) errors.push(denied);
  const duplicate = duplicateStyleNameError(context.board, kind, input.name, id);
  if (duplicate !== undefined) errors.push(duplicate);
  if (errors.length > 0) return errors;
  const isSame = entry.name === input.name && isSameValue(entry.value, input.value);
  return {
    style: isSame ? null : { id, name: input.name, value: input.value },
    id,
    isCreated: false,
    createdAt: context.now,
    ranges: kind === 'text' ? rangesBoundTo(context.board, id) : [],
    objectIds: kind === 'effect' ? objectsBoundTo(context.board, id) : [],
    measured,
  };
}

/**
 * Writes a planned style, the values of the runs or objects naming it, and the measured boxes.
 *
 * @param transaction - The transaction.
 * @param kind - Text or effect styles.
 * @param input - The input.
 * @param plan - The plan.
 * @returns The result.
 */
function applyNamedStyle(
  transaction: DocumentTransaction,
  kind: StyleKind,
  input: NamedStyleInput,
  plan: SetNamedStylePlan,
): SetNamedStyleResult {
  if (plan.style !== null) {
    transaction.setNamedStyle(kind, plan.style, {
      createdBy: transaction.origin.principalId,
      createdAt: plan.createdAt,
    });
  }
  if (kind === 'text') {
    const patch = textStylePatchOf(input.value as TextStyleValue, plan.id);
    for (const { id, index, length } of plan.ranges)
      transaction.formatText(id, index, length, patch);
  } else {
    const { shadows } = input.value as EffectStyleValue;
    for (const id of plan.objectIds) transaction.patchObject(id, { shadow: [...shadows] });
  }
  for (const { id, width, height } of plan.measured) transaction.patchObject(id, { width, height });
  return { id: plan.id, isCreated: plan.isCreated };
}

/**
 * `setTextStyle`: creates a board text style with a fresh id when `id`
 * is absent, else sets a style's name and value and rewrites the value on every run naming it
 * (on every page and in mains; a run's colour is its own), with the caller's `measured` boxes, in
 * one transaction and one undo step. Refused: an id the board lacks (`missing-style`), a name
 * another text style has (`duplicate-style-name`, case-blind), a creation on a board of 64 text
 * styles (`too-many-styles`), and an agent changing a style it did not create (`not-own-style`;
 * agents may create).
 */
export const setTextStyleCommand: Command<
  typeof setTextStyleInputSchema,
  SetNamedStylePlan,
  SetNamedStyleResult
> = {
  name: 'setTextStyle',
  description:
    "Creates a board text style, or sets a text style's name and value and rewrites every run using it.",
  input: setTextStyleInputSchema,
  validate(context, input) {
    const planned = planNamedStyle(context, 'text', input);
    return Array.isArray(planned) ? reject(planned) : accept(planned);
  },
  apply(transaction, input, plan) {
    return applyNamedStyle(transaction, 'text', input, plan);
  },
};

/**
 * `setEffectStyle`: creates a board effect style (1 to 8 shadow layers)
 * with a fresh id when `id` is absent, else sets a style's name and value and rewrites the layers
 * of every shape and frame naming it, in one transaction and one undo step. Refused as
 * `setTextStyle` is.
 */
export const setEffectStyleCommand: Command<
  typeof setEffectStyleInputSchema,
  SetNamedStylePlan,
  SetNamedStyleResult
> = {
  name: 'setEffectStyle',
  description:
    "Creates a board effect style, or sets an effect style's name and shadow layers and rewrites every shape and frame using it.",
  input: setEffectStyleInputSchema,
  validate(context, input) {
    const planned = planNamedStyle(context, 'effect', input);
    return Array.isArray(planned) ? reject(planned) : accept(planned);
  },
  apply(transaction, input, plan) {
    return applyNamedStyle(transaction, 'effect', input, plan);
  },
};
