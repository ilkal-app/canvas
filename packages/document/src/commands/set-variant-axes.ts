import { z } from 'zod';

import {
  objectIdSchema,
  parsePresetKey,
  presetKey,
  variantAxesSchema,
  variantNameSchema,
  type BoardObject,
  type ComponentObject,
  type InstanceOverrides,
  type ObjectId,
  type VariantAxis,
  type VariantSelection,
} from '@canvas/schema';

import { checkObject } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type BoardReader, type Command } from './command.js';
import { givenPresetsSchema, withGivenPresets } from './given-presets.js';
import { lookUpMain } from './variant-command-checks.js';

/** An axis renamed: its old name and its new one. */
const axisRenameSchema = z.strictObject({
  /** The axis's old name. */
  from: variantNameSchema.describe("The axis's old name."),
  /** Its new name, one of the new axes. */
  to: variantNameSchema.describe('Its new name, one of the new axes.'),
});

/** A value renamed within an axis. */
const valueRenameSchema = z.strictObject({
  /** The axis, by its new name. */
  axis: variantNameSchema.describe('The axis, by its new name.'),
  /** The value's old name. */
  from: variantNameSchema.describe("The value's old name."),
  /** Its new name, one of the axis's new values. */
  to: variantNameSchema.describe("Its new name, one of the axis's new values."),
});

/** A main's new axes, with the renames that carry its presets and selections across. */
export const setVariantAxesInputSchema = z.strictObject({
  /** The main. */
  componentId: objectIdSchema.describe('The main whose variant axes to set.'),
  /** Its new axes, in composition order; `null` removes its variants and presets entirely. */
  axes: variantAxesSchema
    .nullable()
    .describe('The new axes in composition order; null removes variants and their presets.'),
  /** Renames, so presets and instances' choices follow an axis or value to its new name. */
  renames: z
    .strictObject({
      /** Axes renamed, old name to new. */
      axes: z
        .array(axisRenameSchema)
        .optional()
        .describe('Axes renamed: from the old name to the new.'),
      /** Values renamed, within `axis` (its new name). */
      values: z
        .array(valueRenameSchema)
        .optional()
        .describe("Values renamed within an axis (the axis's new name)."),
    })
    .optional()
    .describe('Renames that carry presets and instance choices to the new names.'),
  /** Presets for the new axes' values, merged in the same command. */
  variantPresets: givenPresetsSchema.optional(),
});

/** The input of {@link setVariantAxesCommand}. */
type SetVariantAxesInput = z.output<typeof setVariantAxesInputSchema>;

/** Every object the command writes: the main first, then instances and mains it rewrites. */
export interface SetVariantAxesPlan {
  /** The objects to write. */
  readonly objects: readonly BoardObject[];
}

/** Old to new names: axes, and values per new axis name. */
interface Renaming {
  /** Axis renames. */
  readonly axes: ReadonlyMap<string, string>;
  /** Value renames, by new axis name. */
  readonly values: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/**
 * Finds names that two old names would both become, so their presets or selections would merge
 * into one: each old name's new name (renamed, else its own), among those the new list keeps.
 *
 * @param oldNames - The old names.
 * @param renamed - Old name to new name.
 * @param kept - The new names.
 * @returns Each new name two or more old names would become, with those old names.
 */
function collisions(
  oldNames: readonly string[],
  renamed: ReadonlyMap<string, string>,
  kept: readonly string[],
): [newName: string, oldNames: string[]][] {
  const byNew = new Map<string, string[]>();
  for (const oldName of oldNames) {
    const newName = renamed.get(oldName) ?? oldName;
    if (!kept.includes(newName)) continue;
    byNew.set(newName, [...(byNew.get(newName) ?? []), oldName]);
  }
  return [...byNew].filter(([, sources]) => sources.length > 1);
}

/**
 * Checks the renames against the old and new axes and builds the name maps. A name renamed twice,
 * or two old names that would become one (a rename onto a name that stays), is refused
 * (`invalid-input`): one of their presets would be lost and their instances' choices merged.
 *
 * @param main - The main before the command.
 * @param input - The input.
 * @returns The maps, or the refusals (`unknown-variant`, `invalid-input`).
 */
function renamingOf(
  main: ComponentObject,
  input: SetVariantAxesInput,
): { readonly renaming: Renaming } | { readonly errors: CommandError[] } {
  const oldAxes = main.variantAxes ?? [];
  const newAxes = input.axes ?? [];
  const errors: CommandError[] = [];
  const unknown = (path: (string | number)[], message: string) =>
    errors.push(commandError('unknown-variant', main.id, ['renames', ...path], message));
  const ambiguous = (path: (string | number)[], message: string) =>
    errors.push(commandError('invalid-input', main.id, ['renames', ...path], message));
  const axes = new Map<string, string>();
  input.renames?.axes?.forEach(({ from, to }, index) => {
    if (axes.has(from)) ambiguous(['axes', index, 'from'], `Axis ${from} is renamed twice.`);
    if (!oldAxes.some(({ name }) => name === from))
      unknown(['axes', index, 'from'], `No axis ${from}.`);
    if (!newAxes.some(({ name }) => name === to))
      unknown(['axes', index, 'to'], `No new axis ${to}.`);
    axes.set(from, to);
  });
  const values = new Map<string, Map<string, string>>();
  input.renames?.values?.forEach(({ axis, from, to }, index) => {
    const oldName = [...axes].find(([, renamed]) => renamed === axis)?.[0] ?? axis;
    const oldAxis = oldAxes.find(({ name }) => name === oldName);
    const newAxis = newAxes.find(({ name }) => name === axis);
    if (oldAxis?.values.includes(from) !== true) {
      unknown(['values', index, 'from'], `No value ${from} on ${oldName}.`);
    }
    if (newAxis?.values.includes(to) !== true) {
      unknown(['values', index, 'to'], `No new value ${to} on ${axis}.`);
    }
    const map = values.get(axis) ?? new Map<string, string>();
    if (map.has(from)) {
      ambiguous(['values', index, 'from'], `Value ${from} of ${axis} is renamed twice.`);
    }
    map.set(from, to);
    values.set(axis, map);
  });
  const newAxisNames = newAxes.map(({ name }) => name);
  for (const [name, sources] of collisions(
    oldAxes.map(({ name: old }) => old),
    axes,
    newAxisNames,
  )) {
    ambiguous(['axes'], `Axes ${sources.join(' and ')} would both become ${name}.`);
  }
  for (const oldAxis of oldAxes) {
    const axis = axes.get(oldAxis.name) ?? oldAxis.name;
    const kept = newAxes.find(({ name }) => name === axis)?.values ?? [];
    const renamed = values.get(axis) ?? new Map<string, string>();
    for (const [name, sources] of collisions(oldAxis.values, renamed, kept)) {
      ambiguous(
        ['values'],
        `Values ${sources.join(' and ')} of ${axis} would both become ${name}.`,
      );
    }
  }
  return errors.length > 0 ? { errors } : { renaming: { axes, values } };
}

/**
 * Carries a selection to the new names; a choice of a removed axis or value is kept as it is
 * (decision 5).
 *
 * @param selection - A stored selection.
 * @param renaming - The name maps.
 * @returns The renamed selection.
 */
function renamedSelection(selection: VariantSelection, renaming: Renaming): VariantSelection {
  return Object.fromEntries(
    Object.entries(selection).map(([axis, value]) => {
      const newAxis = renaming.axes.get(axis) ?? axis;
      return [newAxis, renaming.values.get(newAxis)?.get(value) ?? value];
    }),
  );
}

/**
 * Carries a main's presets to its new axes: renamed keys follow, keys of removed axes or values
 * are dropped, and every axis value without one gets an empty preset. Each preset's map then
 * exists before anyone edits it, so two people's first edits to one preset land in the same map
 * and merge, instead of each creating a map under the same key and one replacing the other.
 *
 * @param presets - The stored presets.
 * @param axes - The new axes.
 * @param renaming - The name maps.
 * @returns The presets to store.
 */
function renamedPresets(
  presets: Readonly<Record<string, InstanceOverrides>>,
  axes: readonly VariantAxis[],
  renaming: Renaming,
): Record<string, InstanceOverrides> {
  const result: Record<string, InstanceOverrides> = {};
  for (const [key, records] of Object.entries(presets)) {
    const parsed = parsePresetKey(key);
    if (parsed === undefined) continue;
    const axis = renaming.axes.get(parsed.axis) ?? parsed.axis;
    const value = renaming.values.get(axis)?.get(parsed.value) ?? parsed.value;
    if (axes.find(({ name }) => name === axis)?.values.includes(value) === true) {
      result[presetKey(axis, value)] = records;
    }
  }
  for (const { name, values } of axes) {
    for (const value of values) result[presetKey(name, value)] ??= {};
  }
  return result;
}

/**
 * Renames the nested selections in a set of records that address one of `nested`.
 *
 * @param records - Override records by path.
 * @param nested - Ids of instances of the renamed main.
 * @param renaming - The name maps.
 * @returns The records, or `undefined` when none changed.
 */
function renamedNestedRecords(
  records: InstanceOverrides,
  nested: ReadonlySet<ObjectId>,
  renaming: Renaming,
): InstanceOverrides | undefined {
  let didChange = false;
  const result: Record<string, InstanceOverrides[string]> = {};
  for (const [path, record] of Object.entries(records)) {
    const target = path.split('/').at(-1) as ObjectId;
    if (record.variant !== undefined && nested.has(target)) {
      result[path] = { ...record, variant: renamedSelection(record.variant, renaming) };
      didChange = true;
    } else {
      result[path] = record;
    }
  }
  return didChange ? result : undefined;
}

/**
 * The main an object is part of, if any: its nearest component ancestor.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns The main, or `undefined` for an object on the board itself.
 */
function containingMain(board: BoardReader, object: BoardObject): ComponentObject | undefined {
  const seen = new Set<ObjectId>();
  let parentId = object.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = board.get(parentId);
    if (parent === undefined) return undefined;
    if (parent.type === 'component') return parent;
    parentId = parent.parentId;
  }
  return undefined;
}

/**
 * Every object whose records can select for a nested instance of the renamed main, found through
 * the reference index alone: the main each instance of it sits in (its presets), every instance
 * of that main (its overrides), and so on up, as those instances may sit in other mains.
 *
 * @param board - The board before the command.
 * @param nested - The instances of the renamed main.
 * @returns The mains and instances to look through.
 */
function recordCarriers(board: BoardReader, nested: ReadonlySet<ObjectId>): BoardObject[] {
  const carriers = new Map<ObjectId, BoardObject>();
  const visitedMains = new Set<ObjectId>();
  const pending = [...nested];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const object = board.get(id);
    const outer = object === undefined ? undefined : containingMain(board, object);
    if (outer === undefined || visitedMains.has(outer.id)) continue;
    visitedMains.add(outer.id);
    carriers.set(outer.id, outer);
    for (const instanceId of board.references.instancesOf(outer.id)) {
      const instance = board.get(instanceId);
      if (instance === undefined) continue;
      carriers.set(instanceId, instance);
      pending.push(instanceId);
    }
  }
  return [...carriers.values()];
}

/**
 * The other objects a rename rewrites: every instance of the main (its selection) and every
 * instance's or main's records that select for a nested instance of it (`recordCarriers`).
 *
 * @param board - The board before the command.
 * @param main - The main.
 * @param renaming - The name maps.
 * @returns The rewritten objects.
 */
function renamedReferences(
  board: BoardReader,
  main: ComponentObject,
  renaming: Renaming,
): BoardObject[] {
  if (renaming.axes.size === 0 && renaming.values.size === 0) return [];
  const nested = board.references.instancesOf(main.id);
  const written = new Map<ObjectId, BoardObject>();
  for (const id of nested) {
    const instance = board.get(id);
    if (instance?.type === 'instance' && instance.variant !== undefined) {
      written.set(id, { ...instance, variant: renamedSelection(instance.variant, renaming) });
    }
  }
  for (const object of recordCarriers(board, nested)) {
    const current = written.get(object.id) ?? object;
    if (current.type === 'instance') {
      const overrides = renamedNestedRecords(current.overrides, nested, renaming);
      if (overrides !== undefined) written.set(object.id, { ...current, overrides });
    } else if (current.type === 'component' && current.id !== main.id) {
      const next: Record<string, InstanceOverrides> = {};
      let didChange = false;
      for (const [key, records] of Object.entries(current.variantPresets ?? {})) {
        const renamed = renamedNestedRecords(records, nested, renaming);
        if (renamed !== undefined) didChange = true;
        next[key] = renamed ?? records;
      }
      if (didChange) written.set(object.id, { ...current, variantPresets: next });
    }
  }
  return [...written.values()];
}

/** Sets a main's variant axes, carrying presets and instance choices across renames. */
export const setVariantAxesCommand: Command<
  typeof setVariantAxesInputSchema,
  SetVariantAxesPlan,
  Record<string, never>
> = {
  name: 'setVariantAxes',
  description:
    "Sets a main's variant axes; renames carry its presets and instances' choices, null removes variants.",
  input: setVariantAxesInputSchema,
  validate(context, input) {
    const found = lookUpMain(context.board, input.componentId, ['componentId']);
    if ('errors' in found) return reject(found.errors);
    const { main } = found;
    const checked = renamingOf(main, input);
    if ('errors' in checked) return reject(checked.errors);
    let next: ComponentObject = { ...main };
    if (input.axes === null) {
      if (input.variantPresets !== undefined) {
        const message = 'Presets need axes; null removes variants.';
        return reject([commandError('invalid-input', main.id, ['variantPresets'], message)]);
      }
      Reflect.deleteProperty(next, 'variantAxes');
      Reflect.deleteProperty(next, 'variantPresets');
    } else {
      next.variantAxes = input.axes;
      next.variantPresets = renamedPresets(main.variantPresets ?? {}, input.axes, checked.renaming);
    }
    // Presets given with the axes, keyed by the new names, after the renames carry.
    if (input.variantPresets !== undefined) {
      const given = withGivenPresets(context.board, next, input.variantPresets);
      if ('errors' in given) return reject(given.errors);
      next = given.main;
    }
    const objects = [next, ...renamedReferences(context.board, main, checked.renaming)];
    const errors: CommandError[] = [];
    for (const object of objects) checkObject(context.board, object, errors);
    return errors.length > 0 ? reject(errors) : accept({ objects });
  },
  apply(transaction, input, plan) {
    for (const object of plan.objects) transaction.setObject(object);
    return {};
  },
};
