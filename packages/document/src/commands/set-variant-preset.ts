import { z } from 'zod';

import {
  mergeOverrideRecords,
  objectIdSchema,
  overrideFieldsSchema,
  overrideRecordSchema,
  presetKey,
  variantNameSchema,
  type ComponentObject,
  type InstanceOverrides,
} from '@canvas/schema';

import { checkObject } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command, type CommandContext } from './command.js';
import { overridePathError, overridePathInputSchema } from './override-path-names.js';
import {
  lookUpMain,
  presetRecordError,
  presetResetError,
  resolvePresetPath,
  unknownVariantError,
} from './variant-command-checks.js';

/** One axis value's preset record at one path of the main. */
export const setVariantPresetInputSchema = z.strictObject({
  /** The main. */
  componentId: objectIdSchema.describe('The main whose preset to edit.'),
  /** The axis. */
  axis: variantNameSchema.describe('The axis, for example "state".'),
  /** The value whose preset it is. */
  value: variantNameSchema.describe('The value whose preset to edit, for example "hover".'),
  /** The child, relative to the main, as an instance's override path is; the main's id for the variant. */
  path: overridePathInputSchema.describe(
    "Nested source instance ids followed by the target child id, relative to the main, or the layers' names down to it (e.g. icon/select/Vector); the main's own id or name for the variant's size and layout.",
  ),
  /** Fields merged into the record; a `text` without `runs` clears stored runs. */
  override: overrideFieldsSchema.describe(
    'Content, text style, colour, image, visibility or geometry (x, y, width, height, autoLayout) fields to merge into the preset at this path.',
  ),
});

/** Resets a preset: all of it, one path, or some fields of one path. */
export const resetVariantPresetInputSchema = z.strictObject({
  /** The main. */
  componentId: objectIdSchema.describe('The main whose preset to reset.'),
  /** The axis. */
  axis: variantNameSchema.describe('The axis.'),
  /** The value whose preset it is. */
  value: variantNameSchema.describe('The value whose preset to reset.'),
  /** One path; omitted resets the whole preset. */
  path: overridePathInputSchema
    .optional()
    .describe("One path, as ids or the layers' names; omit to reset the whole preset."),
  /** Fields to clear; omitted clears whole records. Clearing `text` clears `runs`. */
  fields: z
    .array(overrideRecordSchema.keyof())
    .min(1)
    .optional()
    .describe('Fields to clear; omit to remove whole records. Clearing text clears runs.'),
});

/**
 * Finds the main and checks the axis value, as both preset commands do.
 *
 * @param context - The command context.
 * @param input - The command input.
 * @param input.componentId - The main's id.
 * @param input.axis - The axis.
 * @param input.value - The value.
 * @returns The main, or the refusals.
 */
function presetMain(
  context: CommandContext,
  input: { readonly componentId: string; readonly axis: string; readonly value: string },
): { readonly main: ComponentObject } | { readonly errors: CommandError[] } {
  const found = lookUpMain(context.board, input.componentId as never, ['componentId']);
  if ('errors' in found) return found;
  const error = unknownVariantError(found.main, input.axis, input.value, ['value']);
  return error === undefined ? found : { errors: [error] };
}

/**
 * The main with one preset replaced. An emptied preset stays, as an empty map: deleting it would
 * let two people's next first edits each create a map under its key, one replacing the other.
 *
 * @param main - The main.
 * @param key - The preset key.
 * @param records - The preset's records.
 * @returns The new main.
 */
function withPreset(
  main: ComponentObject,
  key: string,
  records: InstanceOverrides,
): ComponentObject {
  return { ...main, variantPresets: { ...main.variantPresets, [key]: records } };
}

/** The path a preset edit wrote. */
export interface SetVariantPresetResult {
  /** The record's path, as ids (a name path resolved). */
  readonly path: string;
}

/** The main with its edited preset, and the id path written. */
export interface SetVariantPresetPlan extends SetVariantPresetResult {
  /** The main as it will be stored. */
  readonly main: ComponentObject;
}

/** Sets fields of one axis value's preset at one path. */
export const setVariantPresetCommand: Command<
  typeof setVariantPresetInputSchema,
  SetVariantPresetPlan,
  SetVariantPresetResult
> = {
  name: 'setVariantPreset',
  description:
    "Sets content, colour, text style, image, visibility or geometry in one variant value's preset of a main.",
  input: setVariantPresetInputSchema,
  validate(context, input) {
    const found = presetMain(context, input);
    if ('errors' in found) return reject(found.errors);
    const { main } = found;
    const key = presetKey(input.axis, input.value);
    const preset = main.variantPresets?.[key] ?? {};
    // A name path is read through the main as stored, then written as ids.
    const resolution = resolvePresetPath(context.board, main, input, input.path);
    if ('error' in resolution) return reject([overridePathError(resolution, main.id, ['path'])]);
    const { path } = resolution;
    const record = mergeOverrideRecords(preset[path], input.override);
    const next = withPreset(main, key, { ...preset, [path]: record });
    // Checked against the main as it will be, so paths follow the preset's own swaps.
    const refused = presetRecordError(context.board, next, input, path, input.override);
    if (refused !== undefined) return reject([refused]);
    const errors: CommandError[] = [];
    checkObject(context.board, next, errors);
    return errors.length > 0 ? reject(errors) : accept({ main: next, path });
  },
  apply(transaction, input, plan) {
    transaction.setObject(plan.main);
    return { path: plan.path };
  },
};

/** Paths a preset reset changed. */
export interface ResetVariantPresetResult {
  /** Changed paths in stable lexical order; empty when nothing was removed. */
  readonly paths: readonly string[];
}

/** The main with its reset preset, and the paths that changed. */
export interface ResetVariantPresetPlan extends ResetVariantPresetResult {
  /** The main as it will be stored. */
  readonly main: ComponentObject;
}

/** Resets a preset, or one path or some fields of it, back to the main's own content. */
export const resetVariantPresetCommand: Command<
  typeof resetVariantPresetInputSchema,
  ResetVariantPresetPlan,
  ResetVariantPresetResult
> = {
  name: 'resetVariantPreset',
  description: "Resets a variant value's preset of a main: all of it, one path, or some fields.",
  input: resetVariantPresetInputSchema,
  validate(context, input) {
    const found = presetMain(context, input);
    if ('errors' in found) return reject(found.errors);
    const { main } = found;
    const key = presetKey(input.axis, input.value);
    const preset = { ...main.variantPresets?.[key] };
    // A stored path is reset as written; any other is read as names.
    let only = input.path;
    if (only !== undefined && !Object.hasOwn(preset, only)) {
      const resolution = resolvePresetPath(context.board, main, input, only);
      if ('path' in resolution) only = resolution.path;
      else if (resolution.error === 'ambiguous-override-path') {
        return reject([overridePathError(resolution, main.id, ['path'])]);
      }
    }
    if (only !== undefined) {
      const refused = presetResetError(context.board, main, input, only, input.fields);
      // A stored record is reset even when its child no longer answers the path (a swap moved
      // it away): only a path that is neither stored nor resolvable is refused.
      const isStoredOrphan =
        refused?.code === 'invalid-override-path' && Object.hasOwn(preset, only);
      if (refused !== undefined && !isStoredOrphan) return reject([refused]);
    }
    // Runs cover the text they were written for, so clearing the text clears them too.
    const cleared =
      input.fields?.includes('text') === true ? [...input.fields, 'runs' as const] : input.fields;
    const paths: string[] = [];
    for (const [path, record] of Object.entries(preset).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (only !== undefined && only !== path) continue;
      const remaining = Object.fromEntries(
        Object.entries(record).filter(
          ([field]) => cleared !== undefined && !cleared.includes(field as never),
        ),
      );
      if (Object.keys(remaining).length === Object.keys(record).length) continue;
      if (Object.keys(remaining).length === 0) Reflect.deleteProperty(preset, path);
      else preset[path] = remaining;
      paths.push(path);
    }
    if (paths.length === 0) {
      // Nothing to clear writes nothing, so the write checks never see it: an agent's reset of
      // another's main is refused here as the write would have been.
      const { origin } = context;
      if (origin.kind === 'agent' && main.createdBy !== origin.principalId) {
        return reject([
          commandError(
            'not-own-main',
            main.id,
            [],
            'An agent may edit only its own main definitions.',
          ),
        ]);
      }
      return accept({ main, paths });
    }
    const next = withPreset(main, key, preset);
    const errors: CommandError[] = [];
    checkObject(context.board, next, errors);
    return errors.length > 0 ? reject(errors) : accept({ main: next, paths });
  },
  apply(transaction, input, plan) {
    if (plan.paths.length > 0) transaction.setObject(plan.main);
    return { paths: plan.paths };
  },
};
