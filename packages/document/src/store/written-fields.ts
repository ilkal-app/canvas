import type { z } from 'zod';

import {
  boardObjectSchema,
  componentObjectSchema,
  findFreehandIssues,
  freehandObjectSchema,
  isSameValue,
  textContentSchema,
  variantPresetIssues,
} from '@canvas/schema';

import type { ValidationIssue } from './document-write-error.js';
import { checkNetworkWrite } from './network-write-check.js';

// Field-scoped validation of a write to an existing object (item 1). A write is judged by
// what it makes worse: the fields it changes, and the cross-field rules those fields take
// part in. A field it leaves as stored (by the door's equality, `isSameValue`) is not judged, so
// one a peer left invalid (a negative width, a NaN rotation, a nested style value of the wrong
// kind) does not block a move, a lock or a restyle of the object; a field it changes must be valid
// whatever it was. This replaces the stored-key exception of (a write keeping a `z` the
// key rule rejects), which is one case of it.

/** An object's fields, as a write holds them or as they are stored. */
export type Fields = Readonly<Record<string, unknown>>;

/** The outcome of checking the fields a write changes. */
export interface WrittenFieldsCheck {
  /** The problems; empty when the write may go ahead. */
  readonly issues: readonly ValidationIssue[];
  /**
   * The object to write: each changed field as parsed (a fresh copy), each other field as
   * stored. Meaningful only when there are no issues.
   */
  readonly object: Fields;
  /** The fields the write changes, cross-field units counted whole. */
  readonly written: ReadonlySet<string>;
}

/** Fields that one rule of the type's schema reads together, so a write of one judges them all. */
interface FieldUnit {
  /** The fields. */
  readonly fields: readonly string[];
  /**
   * Validates the unit as the write leaves it.
   *
   * @param object - The object as written.
   * @param stored - The object as stored.
   * @returns The problems and the unit's values to write.
   */
  readonly check: (
    object: Fields,
    stored: Fields,
  ) => { issues: readonly ValidationIssue[]; values: Fields };
}

/** A text's or sticky's characters and runs: the run invariant reads both (`refineRuns`). */
const TEXT_UNIT: FieldUnit = {
  fields: ['text', 'runs'],
  check: (object) => {
    const parsed = textContentSchema.safeParse({ text: object.text, runs: object.runs });
    return parsed.success
      ? { issues: [], values: parsed.data }
      : { issues: parsed.error.issues, values: {} };
  },
};

/** A path's network: a segment's ends must be its vertices (`findNetworkIssues`). */
const NETWORK_UNIT: FieldUnit = { fields: ['vertices', 'segments'], check: checkNetworkWrite };

/** A main's variants: each preset key must name one of its axis values (`variantPresetIssues`). */
const VARIANTS_UNIT: FieldUnit = {
  fields: ['variantAxes', 'variantPresets'],
  check: (object) => {
    const { variantAxes, variantPresets } = componentObjectSchema.shape;
    const axes = variantAxes.safeParse(object.variantAxes);
    const presets = variantPresets.safeParse(object.variantPresets);
    const fieldIssues: ValidationIssue[] = [
      ...(axes.error?.issues ?? []).map((issue) => ({
        ...issue,
        path: ['variantAxes', ...issue.path],
      })),
      ...(presets.error?.issues ?? []).map((issue) => ({
        ...issue,
        path: ['variantPresets', ...issue.path],
      })),
    ];
    if (fieldIssues.length > 0) return { issues: fieldIssues, values: {} };
    const issues = variantPresetIssues(axes.data, presets.data).map((message) => ({
      path: ['variantPresets'],
      message,
    }));
    const entries: [string, unknown][] = [
      ['variantAxes', axes.data],
      ['variantPresets', presets.data],
    ];
    const values = Object.fromEntries(entries.filter(([, value]) => value !== undefined));
    return { issues, values };
  },
};

/** A freehand stroke's points and pressures: one pressure per point (`findFreehandIssues`). */
const FREEHAND_UNIT: FieldUnit = {
  fields: ['points', 'pressures'],
  check: (object) => {
    const { points, pressures } = freehandObjectSchema.shape;
    const parsedPoints = points.safeParse(object.points);
    const parsedPressures = pressures.safeParse(object.pressures);
    const fieldIssues: ValidationIssue[] = [
      ...(parsedPoints.error?.issues ?? []).map((issue) => ({
        ...issue,
        path: ['points', ...issue.path],
      })),
      ...(parsedPressures.error?.issues ?? []).map((issue) => ({
        ...issue,
        path: ['pressures', ...issue.path],
      })),
    ];
    if (parsedPoints.data === undefined || fieldIssues.length > 0) {
      return { issues: fieldIssues, values: {} };
    }
    const issues = findFreehandIssues(parsedPoints.data, parsedPressures.data).map((message) => ({
      path: ['points'],
      message,
    }));
    const values =
      parsedPressures.data === undefined
        ? { points: parsedPoints.data }
        : { points: parsedPoints.data, pressures: parsedPressures.data };
    return { issues, values };
  },
};

/**
 * The cross-field units of each type: the object-level rules of its schema (`superRefine` on the
 * type's object), each with the fields it reads. Every other rule is a field's own, which its
 * field schema carries (a crop's edges, a label's runs, a video's trim). `written-fields.test.ts`
 * fails when a type gains an object-level rule this table does not list.
 */
export const FIELD_UNITS: Readonly<Record<string, readonly FieldUnit[]>> = {
  text: [TEXT_UNIT],
  sticky: [TEXT_UNIT],
  path: [NETWORK_UNIT],
  freehand: [FREEHAND_UNIT],
  component: [VARIANTS_UNIT],
};

/**
 * Optional fields that most objects never store: absent on both sides, they are not written, so
 * they stay absent (`constraints`; a box's `layoutChild`; a main's variants and
 * an instance's selection; a shape's or frame's drop `shadow`; a layer
 * `name` on any object but a frame or main; a freehand stroke's `pressures` when its
 * device reported none).
 */
const ABSENT_OPTIONAL_FIELDS: ReadonlySet<string> = new Set([
  'constraints',
  'layoutChild',
  'name',
  'pressures',
  'shadow',
  'variant',
  'variantAxes',
  'variantPresets',
]);

/** Each type's schema, by type. */
const TYPE_SCHEMAS: ReadonlyMap<unknown, z.ZodObject> = new Map(
  boardObjectSchema.options.map((option) => [option.shape.type.value, option as z.ZodObject]),
);

/**
 * Prefixes the paths of issues.
 *
 * @param issues - The issues.
 * @param prefix - The path to put first.
 * @returns The issues, re-pathed.
 */
function under(
  issues: readonly ValidationIssue[],
  prefix: readonly PropertyKey[],
): ValidationIssue[] {
  return issues.map(({ path, message }) => ({ path: [...prefix, ...path], message }));
}

/**
 * The fields a write changes: those it holds a value for that differs from the stored one, or
 * that it lacks, unless the field is optional and the stored object lacks it too (optional
 * constraints stay absent on pre-layout-5 objects, a drop shadow on objects never given one,
 * {@link ABSENT_OPTIONAL_FIELDS} also stay out of the result); a cross-field unit
 * counts whole when it changes one of its fields.
 *
 * @param object - The object as written.
 * @param stored - The object as stored.
 * @param shape - The type's field schemas.
 * @param units - The type's cross-field units.
 * @returns The changed fields.
 */
function changedFields(
  object: Fields,
  stored: Fields,
  shape: Readonly<Record<string, z.ZodType>>,
  units: readonly FieldUnit[],
): Set<string> {
  const written = new Set(
    Object.keys(shape).filter((name) => {
      if (!Object.hasOwn(object, name)) {
        // Safe: an optional field the write lacks and the stored object lacks (or reads as
        // undefined) is left as stored, so it is not judged and the result keeps the stored
        // undefined, exactly what judging it would give (an optional field parses undefined).
        // A required field never qualifies (its schema refuses undefined), so a write that lacks
        // one is still refused; a field the stored object holds is still written, as a removal.
        const isAbsentAlike =
          stored[name] === undefined && shape[name]?.safeParse(undefined).success === true;
        return !isAbsentAlike;
      }
      return !isSameValue(object[name], stored[name]);
    }),
  );
  for (const unit of units) {
    if (unit.fields.some((field) => written.has(field))) {
      for (const field of unit.fields) written.add(field);
    }
  }
  return written;
}

/**
 * Checks a write to an existing object field by field: each field it changes against
 * the type's field schema, and each cross-field rule a changed field takes part in
 * ({@link FIELD_UNITS}); a field it leaves as stored is not judged, valid or not. An unknown key
 * is refused, as the type's strict schema refuses it. Pure; O(the object's fields) comparisons,
 * and parsing only of what changed (a path's network member by member).
 *
 * @param object - The object as written, of a type `boardObjectSchema` knows.
 * @param stored - The object as stored (or, for an entry that cannot be read, what is known of it).
 * @returns The problems, the object to write and the changed fields; `undefined` when `object`
 *   is not a record of a known type, which only a whole validation can describe.
 */
export function checkWrittenFields(
  object: unknown,
  stored: Fields,
): WrittenFieldsCheck | undefined {
  if (typeof object !== 'object' || object === null || Array.isArray(object)) return undefined;
  const fields = object as Fields;
  const schema = TYPE_SCHEMAS.get(fields.type);
  if (schema === undefined) return undefined;
  const shape = schema.shape as Readonly<Record<string, z.ZodType>>;
  const units = FIELD_UNITS[fields.type as string] ?? [];
  const written = changedFields(fields, stored, shape, units);
  const issues: ValidationIssue[] = Object.keys(fields)
    .filter((key) => !Object.hasOwn(shape, key))
    .map((key) => ({ path: [], message: `Unrecognized key: "${key}"` }));
  const unitValues: Record<string, unknown> = {};
  for (const unit of units) {
    if (!unit.fields.some((field) => written.has(field))) continue;
    const checked = unit.check(fields, stored);
    issues.push(...checked.issues);
    Object.assign(unitValues, checked.values);
  }
  const result: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(shape)) {
    if (ABSENT_OPTIONAL_FIELDS.has(name) && !written.has(name) && !Object.hasOwn(stored, name))
      continue;
    if (!written.has(name)) result[name] = stored[name];
    else if (Object.hasOwn(unitValues, name)) result[name] = unitValues[name];
    else if (!units.some((unit) => unit.fields.includes(name))) {
      const parsed = field.safeParse(fields[name]);
      if (parsed.success) result[name] = parsed.data;
      else issues.push(...under(parsed.error.issues, [name]));
    }
  }
  return { issues, object: result, written };
}
