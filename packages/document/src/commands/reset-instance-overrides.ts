import { z } from 'zod';

import {
  objectIdSchema,
  overrideRecordSchema,
  type InstanceOverrides,
  type ObjectId,
} from '@canvas/schema';

import { lookUpNamed } from './command-checks.js';
import { commandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import {
  overridePathError,
  overridePathInputSchema,
  resolveOverridePath,
} from './override-path-names.js';

/** Clears all records, a single path, or selected fields at the selected paths. */
export const resetInstanceOverridesInputSchema = z.strictObject({
  /** The stored instance. */
  id: objectIdSchema.describe('The stored instance to reset.'),
  /** Optional single path; omitted selects all records. */
  path: overridePathInputSchema
    .optional()
    .describe("One source path, as ids or the layers' names; omit to reset all paths."),
  /** Optional fields to clear; omitted clears complete records. Clearing `text` clears `runs`. */
  fields: z
    .array(overrideRecordSchema.keyof())
    .min(1)
    .optional()
    .describe('Fields to clear; omit to remove complete records. Clearing text clears runs.'),
});

/** Paths changed by resetting overrides. */
export interface ResetInstanceOverridesResult {
  /** Changed paths in stable lexical order. */
  readonly paths: readonly string[];
}

/** Validated replacement override map and changed paths. */
export interface ResetInstanceOverridesPlan extends ResetInstanceOverridesResult {
  /** Stored instance identity. */
  readonly id: ObjectId;
  /** Remaining per-child records. */
  readonly overrides: InstanceOverrides;
}

/** Removes instance overrides so the selected content inherits from its main again. */
export const resetInstanceOverridesCommand: Command<
  typeof resetInstanceOverridesInputSchema,
  ResetInstanceOverridesPlan,
  ResetInstanceOverridesResult
> = {
  name: 'resetInstanceOverrides',
  description: 'Resets instance overrides to the current main definition.',
  input: resetInstanceOverridesInputSchema,
  validate(context, input) {
    const { named, errors } = lookUpNamed(
      context.board,
      [input.id],
      (id) => id,
      () => ['id'],
    );
    const object = named[0]?.object;
    if (object === undefined) return reject(errors);
    if (object.type !== 'instance')
      return reject([
        commandError('unsupported-type', object.id, ['id'], 'An instance is required.'),
      ]);
    const overrides = { ...object.overrides };
    // A stored path is reset as written, even one no child answers any more; any other is read as
    // names, and one that reads no way changes nothing.
    let only = input.path;
    if (only !== undefined && !Object.hasOwn(overrides, only)) {
      const resolution = resolveOverridePath(context.board, object, only);
      if ('path' in resolution) only = resolution.path;
      else if (resolution.error === 'ambiguous-override-path') {
        return reject([overridePathError(resolution, object.id, ['path'])]);
      }
    }
    // Runs cover the text they were written for, so clearing the text clears them too.
    const cleared =
      input.fields?.includes('text') === true ? [...input.fields, 'runs' as const] : input.fields;
    const paths: string[] = [];
    for (const path of Object.keys(overrides).sort()) {
      if (only !== undefined && only !== path) continue;
      const prior = overrides[path];
      const remaining = Object.fromEntries(
        Object.entries(prior ?? {}).filter(
          ([key]) => cleared !== undefined && !cleared.includes(key as never),
        ),
      );
      if (Object.keys(remaining).length === Object.keys(prior ?? {}).length) continue;
      if (Object.keys(remaining).length === 0) Reflect.deleteProperty(overrides, path);
      else overrides[path] = remaining;
      paths.push(path);
    }
    return accept({ id: object.id, overrides, paths });
  },
  apply(transaction, input, plan) {
    if (plan.paths.length > 0) transaction.patchObject(plan.id, { overrides: plan.overrides });
    return { paths: plan.paths };
  },
};
