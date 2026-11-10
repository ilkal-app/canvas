import type { z } from 'zod';

import {
  frameCornerRadiusSchema,
  LAYER_OPACITY_TYPES,
  LAYER_VISIBILITY_TYPES,
  linkSchema,
  opacitySchema,
  stickyAspectSchema,
  textObjectSchema,
  visibilityShape,
} from '@canvas/schema';

// The codec's tolerance of an optional `style` field whose absence is its default (a frame's
// corner radius; a layer's opacity; a layer's visibility; a text's
// direction; a sticky's aspect; a text's, sticky's or image's link),
// both ways, as `shadow-tolerance.ts` is of
// a drop shadow. The relay's door judges every value a peer writes, but replays from Redis or
// storage pass no door, so a stored value may be one the schema refuses (a negative
// radius, an opacity of 2, a string).
//
// - Reading: such a value reads as absent (sharp corners, opaque), before the field-kind check
//   (`field-kinds.ts`) would drop the whole object, and nothing downstream sees it.
// - Writing: a write of the object that does not give the field (a move, a lock, a restyle of
//   another field) rebuilds the whole `style` group from the object, which would delete the
//   stored value though nobody edited it. So the writer carries a stored value the reader left
//   out back into the group, unless the write names the field: an explicit value replaces it,
//   and an explicit removal (`setStyle`'s `cornerRadius: undefined` or `opacity: undefined`, a
//   patch giving the key as `undefined`, which `writeObject` receives as removed) removes it. A
//   shadow is removed with `null`, a value the group holds, so it needs no such signal; these are
//   removed by leaving them out, so only the patch can tell a removal from an unrelated write.
//
// A shape's `cornerRadius` and an image's `opacity` are required and keep their existing reading,
// so only the types below are tolerated. Package-internal.

/** One tolerated field: its name, the types storing it as optional, and what the schema takes. */
interface TolerantField {
  /** The field's name in the `style` group. */
  readonly field: string;
  /** The object types whose optional field this is. */
  readonly types: ReadonlySet<string>;
  /** The field's schema, which a stored value must pass to be read. */
  readonly schema: z.ZodType;
}

/** The optional style fields read as absent when refused, and carried through when unset. */
const TOLERANT_FIELDS: readonly TolerantField[] = [
  { field: 'cornerRadius', types: new Set(['frame']), schema: frameCornerRadiusSchema },
  { field: 'opacity', types: new Set(LAYER_OPACITY_TYPES), schema: opacitySchema },
  { field: 'isHidden', types: new Set(LAYER_VISIBILITY_TYPES), schema: visibilityShape.isHidden },
  {
    field: 'direction',
    types: new Set(['text', 'sticky']),
    schema: textObjectSchema.shape.direction,
  },
  { field: 'aspect', types: new Set(['sticky']), schema: stickyAspectSchema },
  { field: 'link', types: new Set(['text', 'sticky', 'image']), schema: linkSchema },
];

/**
 * Whether a stored value is one the reader leaves out: present and refused.
 *
 * @param tolerant - The field.
 * @param value - The stored value.
 * @returns True for a present, refused value.
 */
function isRefused(tolerant: TolerantField, value: unknown): boolean {
  return value !== undefined && !tolerant.schema.safeParse(value).success;
}

/**
 * Removes, from an object being read, each tolerated optional field ({@link TOLERANT_FIELDS})
 * whose stored value the schema refuses, so it reads as absent. Absent and acceptable values,
 * and the fields of types that require them, are kept.
 *
 * @param target - The object being built from its stored fields; changed in place.
 */
export function tolerateStoredOptionalStyle(target: Record<string, unknown>): void {
  for (const tolerant of TOLERANT_FIELDS) {
    if (!tolerant.types.has(target.type as string)) continue;
    if (isRefused(tolerant, target[tolerant.field])) Reflect.deleteProperty(target, tolerant.field);
  }
}

/**
 * Carries each stored, refused tolerated field into a `style` group about to be written for an
 * object that leaves it out ({@link tolerateStoredOptionalStyle} left it out when it was read),
 * so an unrelated write never deletes it. A write that names the field wins: a value the group
 * holds is written as given, and an explicit removal (a patch giving the field as `undefined`)
 * removes it. A type whose field is required always holds it in the group, so it is never
 * carried.
 *
 * @param group - The group value built from the object; changed in place.
 * @param fields - The fields the group holds for the object's type.
 * @param stored - The group as stored, or anything else when there is none.
 * @param removed - The fields the write removes explicitly.
 */
export function carryRefusedOptionalStyle(
  group: Record<string, unknown>,
  fields: readonly string[],
  stored: unknown,
  removed: ReadonlySet<string>,
): void {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return;
  const record = stored as Readonly<Record<string, unknown>>;
  for (const tolerant of TOLERANT_FIELDS) {
    const { field } = tolerant;
    if (!fields.includes(field) || removed.has(field) || group[field] !== undefined) continue;
    if (isRefused(tolerant, record[field])) group[field] = record[field];
  }
}
