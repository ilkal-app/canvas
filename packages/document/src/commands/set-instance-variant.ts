import { z } from 'zod';

import {
  effectiveOverrides,
  objectIdSchema,
  variantNameSchema,
  type ComponentObject,
  type InstanceObject,
  type InstanceOverrides,
  type OverrideRecord,
  type VariantSelection,
} from '@canvas/schema';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { unknownVariantError } from './variant-command-checks.js';

/** An instance's new choice per axis: a value, or `null` to go back to the axis default. */
export const setInstanceVariantInputSchema = z.strictObject({
  /** The stored instance. */
  id: objectIdSchema.describe('The stored instance whose variant to switch.'),
  /** The axes to change; axes left out keep their choice. */
  variant: z
    .record(variantNameSchema, variantNameSchema.nullable())
    .describe('A value per axis to change, or null to return that axis to its default.'),
});

/** Record fields a variant switch never drops: the person's own characters (decision 2). */
const ALWAYS_KEPT: ReadonlySet<string> = new Set(['text', 'runs', 'measuredSize']);

/** Record fields whose values are maps the switch thins key by key. */
const KEYED: ReadonlySet<string> = new Set(['textStyle', 'variant']);

/**
 * The preset layers alone that a selection composes, with no own records on top.
 *
 * @param instance - The instance.
 * @param main - Its main.
 * @param selection - The selection to compose.
 * @returns The composed preset records by path.
 */
function presetLayers(
  instance: InstanceObject,
  main: ComponentObject,
  selection: VariantSelection | undefined,
): InstanceOverrides {
  const bare: InstanceObject = { ...instance, overrides: {} };
  if (selection === undefined) Reflect.deleteProperty(bare, 'variant');
  else bare.variant = selection;
  return effectiveOverrides(bare, main);
}

/**
 * Keeps the parts of one own record the switch leaves: every field the old and new presets
 * leave alone at that path, key by key for `textStyle` and a nested `variant`, and always the
 * text, its runs and their measured size.
 *
 * @param record - The own record.
 * @param controlled - The old and new preset records at the same path.
 * @returns What remains, or `undefined` when nothing does.
 */
function keptRecord(
  record: OverrideRecord,
  controlled: readonly (OverrideRecord | undefined)[],
): OverrideRecord | undefined {
  const kept: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(record)) {
    if (ALWAYS_KEPT.has(field)) {
      kept[field] = value;
    } else if (KEYED.has(field)) {
      // `textStyle` and `variant` are maps (the record schema).
      const keyedValue = value as Readonly<Record<string, unknown>>;
      const taken = new Set(
        controlled.flatMap((preset) => {
          const keyed: unknown = preset?.[field as keyof OverrideRecord];
          return typeof keyed === 'object' && keyed !== null ? Object.keys(keyed) : [];
        }),
      );
      const rest = Object.fromEntries(
        Object.entries(keyedValue).filter(([key]) => !taken.has(key)),
      );
      if (Object.keys(rest).length > 0) kept[field] = rest;
    } else if (
      controlled.every((preset) => preset?.[field as keyof OverrideRecord] === undefined)
    ) {
      kept[field] = value;
    }
  }
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/**
 * The switching rule (decision 2): the instance's own records after its selection moves
 * from `before` to `after`. An own override of a field the old or the new selection's presets set
 * at the same path is dropped, because that field is the variant's; its text and runs are always
 * kept; a record left empty is removed. Pure.
 *
 * @param instance - The instance, with its current selection and own records.
 * @param main - Its main.
 * @param after - The new selection.
 * @returns The own records to store.
 */
export function switchedOverrides(
  instance: InstanceObject,
  main: ComponentObject,
  after: VariantSelection | undefined,
): InstanceOverrides {
  const oldPresets = presetLayers(instance, main, instance.variant);
  const newPresets = presetLayers(instance, main, after);
  const result: Record<string, OverrideRecord> = {};
  for (const [path, record] of Object.entries(instance.overrides)) {
    const kept = keptRecord(record, [oldPresets[path], newPresets[path]]);
    if (kept !== undefined) result[path] = kept;
  }
  return result;
}

/**
 * The new selection: `changes` merged into the stored one, `null` removing an axis's choice.
 *
 * @param stored - The stored selection, if any.
 * @param changes - The changes.
 * @returns The selection, or `undefined` when no axis has a choice left.
 */
function mergedSelection(
  stored: VariantSelection | undefined,
  changes: Readonly<Record<string, string | null>>,
): VariantSelection | undefined {
  const merged: Record<string, string> = { ...stored };
  for (const [axis, value] of Object.entries(changes)) {
    if (value === null) Reflect.deleteProperty(merged, axis);
    else merged[axis] = value;
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}

/**
 * Checks a selection's chosen values against the main: each must be a value one of its axes
 * lists (a `null`, an axis it has), and the main must have axes at all.
 *
 * @param main - The main.
 * @param changes - The chosen values (`null`s pass).
 * @param path - Where errors point in the input.
 * @returns The refusals.
 */
export function selectionErrors(
  main: ComponentObject,
  changes: Readonly<Record<string, string | null>>,
  path: readonly (string | number)[],
): CommandError[] {
  if (main.variantAxes === undefined || main.variantAxes.length === 0) {
    return [commandError('unknown-variant', main.id, path, 'This main has no variants.')];
  }
  return Object.entries(changes).flatMap(([axis, value]) => {
    // Clearing a choice still names an axis, which the main must have.
    if (value === null) {
      return main.variantAxes?.some(({ name }) => name === axis) === true
        ? []
        : [commandError('unknown-variant', main.id, [...path, axis], `No axis ${axis}.`)];
    }
    const error = unknownVariantError(main, axis, value, [...path, axis]);
    return error === undefined ? [] : [error];
  });
}

/** An own override record's fields that a variant switch dropped. */
export interface DroppedOverride {
  /** The record's path. */
  readonly path: string;
  /** Its dropped fields, sorted; a text style key or nested axis as `textStyle.color`, `variant.state`. */
  readonly fields: readonly string[];
}

/** What a variant switch stored and dropped. */
export interface SetInstanceVariantResult {
  /** The selection now stored; absent when no axis has a choice. */
  readonly variant?: VariantSelection;
  /** Own overrides the switching rule dropped, by path in lexical order. */
  readonly droppedOverrides: readonly DroppedOverride[];
}

/** The switched instance, and what it dropped. */
export interface SetInstanceVariantPlan {
  /** The instance as it will be stored. */
  readonly instance: InstanceObject;
  /** Own overrides the switching rule dropped. */
  readonly droppedOverrides: readonly DroppedOverride[];
}

/** Record fields the switching rule drops key by key: a text style's keys, a nested choice's axes. */
const KEYED_FIELDS = ['textStyle', 'variant'] as const;

/**
 * The own override fields present before a switch and gone after it. A text style key or a
 * nested choice's axis dropped while the field keeps others is named `textStyle.color` or
 * `variant.state`.
 *
 * @param before - The stored own overrides.
 * @param after - The own overrides after the switch.
 * @returns The dropped fields, by path in lexical order, each path's fields sorted.
 */
function droppedFields(before: InstanceOverrides, after: InstanceOverrides): DroppedOverride[] {
  return Object.keys(before)
    .sort()
    .flatMap((path) => {
      const prior: Readonly<Record<string, unknown>> = before[path] ?? {};
      const kept: Readonly<Record<string, unknown>> = after[path] ?? {};
      const fields = Object.keys(prior).flatMap((field) => {
        if (!(field in kept)) return [field];
        if (!KEYED_FIELDS.includes(field as (typeof KEYED_FIELDS)[number])) return [];
        const keptKeys = Object.keys(kept[field] ?? {});
        return Object.keys(prior[field] ?? {})
          .filter((key) => !keptKeys.includes(key))
          .map((key) => `${field}.${key}`);
      });
      return fields.length === 0 ? [] : [{ path, fields: fields.sort() }];
    });
}

/** Switches an instance's variant, dropping own overrides of what the variant controls. */
export const setInstanceVariantCommand: Command<
  typeof setInstanceVariantInputSchema,
  SetInstanceVariantPlan,
  SetInstanceVariantResult
> = {
  name: 'setInstanceVariant',
  description:
    "Switches an instance's variant: a value per axis, keeping own overrides the variant leaves alone.",
  input: setInstanceVariantInputSchema,
  validate(context, input) {
    const { named, errors } = lookUpNamed(
      context.board,
      [input.id],
      (id) => id,
      () => ['id'],
    );
    const object = named[0]?.object;
    if (object === undefined) return reject(errors);
    if (object.type !== 'instance') {
      return reject([
        commandError('unsupported-type', object.id, ['id'], 'An instance is required.'),
      ]);
    }
    const main = context.board.get(object.mainId);
    if (main?.type !== 'component') {
      return reject([commandError('missing-main', object.id, ['id'], 'Its main is missing.')]);
    }
    const refused = selectionErrors(main, input.variant, ['variant']);
    if (refused.length > 0) return reject(refused);
    const variant = mergedSelection(object.variant, input.variant);
    const overrides = switchedOverrides(object, main, variant);
    const candidate: InstanceObject = { ...object, overrides };
    if (variant === undefined) Reflect.deleteProperty(candidate, 'variant');
    else candidate.variant = variant;
    checkObject(context.board, candidate, errors);
    if (errors.length > 0) return reject(errors);
    return accept({
      instance: candidate,
      droppedOverrides: droppedFields(object.overrides, overrides),
    });
  },
  apply(transaction, input, plan) {
    transaction.setObject(plan.instance);
    const { variant } = plan.instance;
    return {
      ...(variant === undefined ? {} : { variant }),
      droppedOverrides: plan.droppedOverrides,
    };
  },
};
