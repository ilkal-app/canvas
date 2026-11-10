import { z } from 'zod';

import { autoLayoutSchema, isSameValue, objectIdSchema } from '@canvas/schema';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { applyPatches, type PlannedPatch } from './object-patches.js';
import type { SetAutoLayoutResult } from './set-auto-layout.js';

/**
 * Some of an auto-layout's fields, at least one, each as the full schema takes it, and padding
 * per side: the sides given replace each container's own.
 */
const autoLayoutPatchSchema = autoLayoutSchema
  .partial()
  .extend({
    /** The padding sides to set; the others keep each container's own. */
    padding: autoLayoutSchema.shape.padding.partial().optional(),
  })
  .refine(
    (patch) =>
      Object.entries(patch).some(([field, value]) =>
        field === 'padding'
          ? Object.values(value ?? {}).some((side) => side !== undefined)
          : value !== undefined,
      ),
    { message: 'a patch must change at least one field or padding side' },
  );

/** Fields merged into each named container's auto-layout. */
export const patchAutoLayoutInputSchema = z.strictObject({
  /** The frames or mains whose auto-layout changes; each must already have one. */
  ids: z.array(objectIdSchema).min(1).describe('Frames or component mains with an auto-layout.'),
  /** The fields to set; the others keep each container's own value. */
  patch: autoLayoutPatchSchema.describe(
    'The auto-layout fields to set, padding per side; each container keeps its other fields.',
  ),
});

/**
 * Changes some fields of frames' and mains' live auto-layouts: the patch is merged
 * into each container's own layout, so one inspector edit on containers with different layouts
 * is one command, so one undo step, and `runCommand` re-lays them in the same transaction. A
 * container without an auto-layout is refused `unsupported-type` (`setAutoLayout` adds one), as
 * is anything but a frame or main; a container already holding every value is not written.
 */
export const patchAutoLayoutCommand: Command<
  typeof patchAutoLayoutInputSchema,
  readonly PlannedPatch[],
  SetAutoLayoutResult
> = {
  name: 'patchAutoLayout',
  description:
    'Changes some fields of the live auto-layout of frames and component mains that have one.',
  input: patchAutoLayoutInputSchema,
  validate(context, input) {
    const { named, errors } = lookUpNamed(
      context.board,
      input.ids,
      (id) => id,
      (index) => ['ids', index],
    );
    const patches: PlannedPatch[] = [];
    for (const { object, path } of named) {
      if ((object.type !== 'frame' && object.type !== 'component') || !object.autoLayout) {
        errors.push(
          commandError(
            'unsupported-type',
            object.id,
            path,
            'Only a frame or a component main with an auto-layout takes a change to it.',
          ),
        );
        continue;
      }
      const { padding, ...fields } = input.patch;
      const given = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      );
      const sides = Object.fromEntries(
        Object.entries(padding ?? {}).filter(([, value]) => value !== undefined),
      );
      const own = object.autoLayout;
      const autoLayout = { ...own, ...given, padding: { ...own.padding, ...sides } };
      if (isSameValue(object.autoLayout, autoLayout)) continue;
      const patch = { autoLayout };
      checkObject(context.board, { ...object, ...patch }, errors);
      patches.push({ id: object.id, patch });
    }
    return errors.length > 0 ? reject(errors) : accept(patches);
  },
  apply(transaction, input, plan) {
    return { updatedIds: applyPatches(transaction, plan) };
  },
};
