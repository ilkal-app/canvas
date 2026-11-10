import { z } from 'zod';

import { objectIdSchema, overrideFieldsSchema, type InstanceObject } from '@canvas/schema';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { instanceOverrideError } from './instance-override-target.js';
import {
  overridePathError,
  overridePathInputSchema,
  resolveOverridePath,
} from './override-path-names.js';

/** One path's content, text style, colour, image or visibility changes. */
export const setInstanceOverrideInputSchema = z.strictObject({
  /** The stored instance. */
  id: objectIdSchema.describe('The stored instance to edit.'),
  /** The source child path. */
  path: overridePathInputSchema,
  /**
   * Fields merged into this path's LWW record; a `text` without `runs` clears stored runs. A
   * `mainId` on a nested instance swaps its main: a live main, among the slot's
   * `swapOptions` when it lists some, that makes no cycle and stays within depth.
   */
  override: overrideFieldsSchema.describe(
    'Supported content, text style, colour, image or visibility fields to merge at this path; text without runs clears stored runs.',
  ),
});

/** Path changed by an override command. */
export interface SetInstanceOverrideResult {
  /** The addressed source path, as ids (a name path resolved). */
  readonly path: string;
}

/** The instance as the override leaves it, and the id path written. */
export interface SetInstanceOverridePlan {
  /** The instance with its new record. */
  readonly instance: InstanceObject;
  /** The id path the record is stored at. */
  readonly path: string;
}

/** Updates one instance override while preserving records at other child paths. */
export const setInstanceOverrideCommand: Command<
  typeof setInstanceOverrideInputSchema,
  SetInstanceOverridePlan,
  SetInstanceOverrideResult
> = {
  name: 'setInstanceOverride',
  description:
    'Overrides one source child’s content, text style, colour, image or visibility in an instance.',
  input: setInstanceOverrideInputSchema,
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
    // A name path is resolved to ids first, against the instance as stored.
    const resolution = resolveOverridePath(context.board, object, input.path);
    if ('error' in resolution) return reject([overridePathError(resolution, object.id, ['path'])]);
    const { path } = resolution;
    const prior = Object.hasOwn(object.overrides, path) ? object.overrides[path] : undefined;
    const record: Record<string, unknown> = { ...prior, ...input.override };
    // New characters without runs inherit styles again: stored runs covered the old text.
    if (input.override.text !== undefined && input.override.runs === undefined) {
      Reflect.deleteProperty(record, 'runs');
    }
    const overrides = { ...object.overrides, [path]: record };
    const candidate = { ...object, overrides } as InstanceObject;
    // Paths follow each slot's main as the write leaves it.
    const refused = instanceOverrideError(context.board, candidate, path, input.override, {
      path: ['path'],
      override: ['override'],
    });
    if (refused !== undefined) return reject([refused]);
    checkObject(context.board, candidate, errors);
    return errors.length > 0 ? reject(errors) : accept({ instance: candidate, path });
  },
  apply(transaction, input, plan) {
    transaction.patchObject(plan.instance.id, { overrides: plan.instance.overrides });
    return { path: plan.path };
  },
};
