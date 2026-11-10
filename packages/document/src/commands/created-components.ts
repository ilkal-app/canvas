import {
  isStoredHidden,
  presetKey,
  withoutStoredHidden,
  type BoardObject,
  type ComponentObject,
  type InstanceOverrides,
  type ObjectId,
} from '@canvas/schema';

import { commandError, type CommandError } from './command-error.js';
import type { BoardReader } from './command.js';
import { withGivenPresets } from './given-presets.js';

// The mains a `createObjects` writes: their inline presets checked as
// `set_variant_preset` checks one (name paths resolved), and, for a main written as a component
// set, its default values' presets drawn on the main itself, each other value of that axis
// given the field back, so the main shows the default combination and every instance stays as it
// was. Pure.

/** The record fields a set's main takes from its default values' presets. */
const DRAWN_FIELDS = new Set([
  'isHidden',
  'opacity',
  'fill',
  'strokeColor',
  'color',
  'x',
  'y',
  'width',
  'height',
]);

/** The text fields a default value's preset may not set: the main's own text is the default. */
const TEXT_FIELDS = new Set(['text', 'runs', 'textStyle', 'measuredSize']);

/** An object's field as an override record names it, read or written. */
type Field = string;

/**
 * A field of an object as an override record reads it: visibility as a boolean, an absent
 * opacity as 1, a stroke's colour.
 *
 * @param object - The object.
 * @param field - The record field.
 * @returns The value, or `undefined` when the object has none to give back.
 */
function fieldOf(object: BoardObject, field: Field): unknown {
  if (field === 'isHidden') return isStoredHidden(object);
  if (field === 'opacity') return Reflect.get(object, 'opacity') ?? 1;
  if (field === 'strokeColor') {
    const stroke: unknown = Reflect.get(object, 'stroke');
    return stroke !== null && typeof stroke === 'object' ? Reflect.get(stroke, 'color') : undefined;
  }
  const value: unknown = Reflect.get(object, field);
  return value === null ? undefined : value;
}

/**
 * An object with a record field drawn on it.
 *
 * @param object - The object.
 * @param field - The record field.
 * @param value - Its value.
 * @returns A new object.
 */
function withField(object: BoardObject, field: Field, value: unknown): BoardObject {
  if (field === 'isHidden') {
    return value === true
      ? ({ ...object, isHidden: true } as BoardObject)
      : withoutStoredHidden(object);
  }
  if (field === 'strokeColor') {
    const stroke = Reflect.get(object, 'stroke') as object;
    return { ...object, stroke: { ...stroke, color: value } } as BoardObject;
  }
  return { ...object, [field]: value };
}

/**
 * Why a default value's record cannot be drawn on its set's main, if it cannot.
 *
 * @param key - The preset's `axis=value`.
 * @param path - The record's path.
 * @param field - The field.
 * @param target - The object it names, if listed.
 * @returns The message, or `undefined` when it can be drawn.
 */
function undrawable(
  key: string,
  path: string,
  field: Field,
  target: BoardObject | undefined,
): string | undefined {
  if (TEXT_FIELDS.has(field)) {
    return `${key} sets ${field} at ${path}: write the default text in the main, and other values' text in their presets.`;
  }
  if (path.includes('/') || target === undefined) {
    return `${key} reaches into a nested instance at ${path}: in a component set, write the default on that instance in the main.`;
  }
  if (!DRAWN_FIELDS.has(field)) {
    return `${key} sets ${field} at ${path}, which a component set does not draw on its main: write the default in the main.`;
  }
  if (fieldOf(target, field) === undefined) {
    return `${key} sets ${field} at ${path}, which has none to give back to the other values: give it one in the main.`;
  }
  return undefined;
}

/**
 * Each field at each path, as `JSON.stringify([path, field])`, and the axes whose presets set it.
 *
 * @param main - The main, its presets by id path.
 * @returns The axes setting each field.
 */
function axesSetting(main: ComponentObject): Map<string, Set<string>> {
  const setting = new Map<string, Set<string>>();
  for (const axis of main.variantAxes ?? []) {
    for (const value of axis.values) {
      for (const [path, record] of Object.entries(
        main.variantPresets?.[presetKey(axis.name, value)] ?? {},
      )) {
        for (const field of Object.keys(record)) {
          const key = JSON.stringify([path, field]);
          const axes = setting.get(key) ?? new Set<string>();
          axes.add(axis.name);
          setting.set(key, axes);
        }
      }
    }
  }
  return setting;
}

/**
 * A component set's main drawn as its default combination: each axis's first value's records
 * written onto the main and its children, and each other value of that axis given the field's
 * previous value unless its own record sets it.
 *
 * @param main - The main, its presets by id path.
 * @param byId - The listed objects by id, the main among them.
 * @returns The changed objects by id (the main with its new presets), or the refusals.
 */
function drawDefaults(
  main: ComponentObject,
  byId: Map<ObjectId, BoardObject>,
): { readonly changed: Map<ObjectId, BoardObject> } | { readonly errors: CommandError[] } {
  const errors: CommandError[] = [];
  const changed = new Map<ObjectId, BoardObject>();
  const presets: Record<string, InstanceOverrides> = { ...main.variantPresets };
  const current = (id: ObjectId) => changed.get(id) ?? byId.get(id);
  // A field one axis's default draws on the main must be that axis's alone: a value of another
  // axis setting it too would compose over the restore, or the restore over it.
  const setting = axesSetting(main);
  for (const axis of main.variantAxes ?? []) {
    const [first, ...others] = axis.values;
    const key = first === undefined ? undefined : presetKey(axis.name, first);
    for (const [path, record] of Object.entries(key === undefined ? {} : (presets[key] ?? {}))) {
      for (const [field, value] of Object.entries(record)) {
        const target = current(path as ObjectId);
        const shared = [...(setting.get(JSON.stringify([path, field])) ?? [])].filter(
          (name) => name !== axis.name,
        );
        const refusal =
          undrawable(key ?? '', path, field, target) ??
          (shared.length > 0
            ? `${key ?? ''} sets ${field} at ${path}, which ${shared.join(' and ')} also sets: in a component set, give a field at a path to one axis.`
            : undefined);
        if (refusal !== undefined || target === undefined) {
          errors.push(
            commandError(
              'invalid-input',
              main.id,
              ['variantPresets', key ?? '', path],
              refusal ?? '',
            ),
          );
          continue;
        }
        // The main's own value, before any default was drawn on it.
        const previous = fieldOf(byId.get(target.id) ?? target, field);
        changed.set(target.id, withField(target, field, value));
        for (const value of others) {
          const otherKey = presetKey(axis.name, value);
          const preset = presets[otherKey] ?? {};
          const own = preset[path] ?? {};
          if (field in own) continue;
          presets[otherKey] = { ...preset, [path]: { ...own, [field]: previous } };
        }
      }
    }
  }
  if (errors.length > 0) return { errors };
  const drawnMain = (changed.get(main.id) ?? main) as ComponentObject;
  changed.set(main.id, { ...drawnMain, variantPresets: presets });
  return { changed };
}

/**
 * The listed objects with every listed main's inline presets checked and resolved as
 * `set_variant_preset` resolves them (name paths to id paths, records checked against the main
 * as it will be), and each main named in `drawn` drawn as its default combination.
 *
 * @param board - The board before the command.
 * @param objects - The listed objects, ids already new.
 * @param drawn - The new ids of the mains written as component sets.
 * @returns The objects to write, or the refusals (by main id).
 */
export function checkCreatedComponents(
  board: BoardReader,
  objects: readonly BoardObject[],
  drawn: ReadonlySet<ObjectId>,
): { readonly objects: BoardObject[] } | { readonly errors: CommandError[] } {
  const errors: CommandError[] = [];
  const byId = new Map(objects.map((object) => [object.id, object]));
  for (const object of objects) {
    if (object.type !== 'component' || object.variantAxes === undefined) continue;
    if (object.variantPresets === undefined) continue;
    const checked = withGivenPresets(
      board,
      { ...object, variantPresets: {} },
      object.variantPresets,
      objects,
    );
    if ('errors' in checked) errors.push(...checked.errors);
    else byId.set(object.id, checked.main);
  }
  if (errors.length > 0) return { errors };
  for (const id of drawn) {
    const main = byId.get(id);
    if (main?.type !== 'component') continue;
    const result = drawDefaults(main, byId);
    if ('errors' in result) errors.push(...result.errors);
    else for (const [changedId, object] of result.changed) byId.set(changedId, object);
  }
  if (errors.length > 0) return { errors };
  return { objects: objects.map((object) => byId.get(object.id) ?? object) };
}
