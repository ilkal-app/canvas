import { z } from 'zod';

import {
  autoLayoutSchema,
  isSameValue,
  layoutChildSchema,
  objectIdSchema,
  type ObjectId,
} from '@canvas/schema';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { applyPatches, type PlannedPatch } from './object-patches.js';

/** The types that take a live auto-layout: a frame or a main. */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['frame', 'component']);

/** The types that take `layoutChild`: the boxes, which have their own size. */
const BOX_TYPES: ReadonlySet<string> = new Set([
  'text',
  'sticky',
  'image',
  'video',
  'shape',
  'frame',
  'component',
  'instance',
]);

/** The input of {@link setAutoLayoutCommand}. */
export const setAutoLayoutInputSchema = z.strictObject({
  /** The frames or mains to lay out. */
  ids: z.array(objectIdSchema).min(1).describe('Frames or component mains.'),
  /** Their live auto-layout, or null to remove it and leave the children where they are. */
  autoLayout: autoLayoutSchema
    .nullable()
    .describe('The auto-layout to set, or null to remove it (children stay where they are).'),
});

/** The input of {@link setLayoutChildCommand}. */
export const setLayoutChildInputSchema = z.strictObject({
  /** The boxes to set it on. */
  ids: z.array(objectIdSchema).min(1).describe('Box objects inside auto-layout containers.'),
  /** How each sits in its auto-layout container, or null to remove it. */
  layoutChild: layoutChildSchema
    .nullable()
    .describe('How each sits in its auto-layout container, or null to remove it.'),
});

/** The objects a layout command changed. */
export interface SetAutoLayoutResult {
  /** The objects whose own field changed, in input order; the layout's moves are not listed. */
  readonly updatedIds: readonly ObjectId[];
}

/**
 * Plans one field written on each named object of the allowed types: the objects whose value
 * changes, each checked against its schema; an object of another type is refused
 * `unsupported-type`.
 *
 * @param context - The command's context.
 * @param context.board - The board.
 * @param ids - The named objects.
 * @param field - The field.
 * @param value - Its new value, or undefined to remove it.
 * @param types - The types that take it.
 * @param refusal - What a refused type is told.
 * @returns The plan or the errors.
 */
function planField(
  context: Parameters<(typeof setAutoLayoutCommand)['validate']>[0],
  ids: readonly ObjectId[],
  field: 'autoLayout' | 'layoutChild',
  value: unknown,
  types: ReadonlySet<string>,
  refusal: string,
): ReturnType<(typeof setAutoLayoutCommand)['validate']> {
  const { named, errors } = lookUpNamed(
    context.board,
    ids,
    (id) => id,
    (index) => ['ids', index],
  );
  const patches: PlannedPatch[] = [];
  for (const { object, path } of named) {
    if (!types.has(object.type)) {
      errors.push(commandError('unsupported-type', object.id, path, refusal));
      continue;
    }
    const previous = (object as Readonly<Record<string, unknown>>)[field];
    if (isSameValue(previous, value)) continue;
    const patch = { [field]: value };
    checkObject(context.board, { ...object, ...patch }, errors);
    patches.push({ id: object.id, patch });
  }
  return errors.length > 0 ? reject(errors) : accept(patches);
}

/**
 * Sets or removes a frame's or main's live auto-layout. The children are laid out in
 * the same transaction (`planRelayout`, through `runCommand`), so setting and laying out are one
 * undo step; removing it leaves them where the layout last put them. Another type is refused
 * `unsupported-type`.
 */
export const setAutoLayoutCommand: Command<
  typeof setAutoLayoutInputSchema,
  readonly PlannedPatch[],
  SetAutoLayoutResult
> = {
  name: 'setAutoLayout',
  description:
    'Sets or removes the live auto-layout of frames and component mains: a row or column stack of their children.',
  input: setAutoLayoutInputSchema,
  validate(context, input) {
    return planField(
      context,
      input.ids,
      'autoLayout',
      input.autoLayout ?? undefined,
      CONTAINER_TYPES,
      'Only a frame or a component main takes an auto-layout.',
    );
  },
  apply(transaction, input, plan) {
    return { updatedIds: applyPatches(transaction, plan) };
  },
};

/**
 * Sets or removes how boxes sit in their auto-layout containers: `{ fill }` takes the
 * main-axis space the container has left. The containers are laid out in the same transaction.
 * Only a box (text, sticky, image, video, shape, frame, main, instance) takes it; another type
 * is refused `unsupported-type`. Outside an auto-layout container it is stored but has no effect.
 */
export const setLayoutChildCommand: Command<
  typeof setLayoutChildInputSchema,
  readonly PlannedPatch[],
  SetAutoLayoutResult
> = {
  name: 'setLayoutChild',
  description:
    'Sets or removes how boxes sit in their auto-layout container: whether each fills the space left.',
  input: setLayoutChildInputSchema,
  validate(context, input) {
    return planField(
      context,
      input.ids,
      'layoutChild',
      input.layoutChild ?? undefined,
      BOX_TYPES,
      'Only a box (text, sticky, image, video, shape, frame, component or instance) takes layoutChild.',
    );
  },
  apply(transaction, input, plan) {
    return { updatedIds: applyPatches(transaction, plan) };
  },
};
