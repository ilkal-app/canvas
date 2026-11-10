import { shadowValueReason } from '@canvas/schema';

// The codec's tolerance of a stored drop shadow, both ways. The relay's door judges
// every shadow a peer writes, but replays from Redis or storage pass no door, so a
// stored `shadow` may be one the schema refuses (a string, a missing key, a value out of this
// build's range, `'ink'`).
//
// - Reading: such a shadow reads as none (the field left out), before the field-kind check
//   (`field-kinds.ts`) would drop the whole object; the object, its fill and its children still
//   read, and nothing downstream (a command, the inspector) sees a value it cannot judge.
// - Writing: a write of the object that does not give a shadow (a move, a lock, a restyle of
//   another field) rebuilds the whole `style` group from the object, which would delete the
//   stored value though nobody edited it. So the writer carries the
//   stored value through: when the object leaves `shadow` out and the stored group holds one this
//   reader leaves out, the group is written with that stored value, and a write that changes
//   nothing else in the group writes nothing. Only an explicit shadow, or `null`, replaces it.
//
// The two use one predicate, `shadowValueReason`, so exactly what the reader leaves out is what
// the writer carries back. Package-internal.

/**
 * Whether a stored shadow is one the reader leaves out: present and refused by the schema.
 *
 * @param value - The stored value.
 * @returns True for a present, refused shadow.
 */
function isRefusedShadow(value: unknown): boolean {
  return value !== undefined && shadowValueReason(value) !== undefined;
}

/**
 * Removes, from an object being read, a stored `shadow` the schema refuses, so it reads as no
 * shadow. Absent, `null` and an acceptable shadow are kept.
 *
 * @param target - The object being built from its stored fields; changed in place.
 */
export function tolerateStoredShadow(target: Record<string, unknown>): void {
  if (isRefusedShadow(target.shadow)) delete target.shadow;
}

/**
 * Carries a stored, refused `shadow` into a `style` group about to be written for an object that
 * leaves the field out (`tolerateStoredShadow` left it out when the object was read), so a write
 * that does not set a shadow never deletes one. A group that holds a shadow (a new one, or `null`
 * to remove it) is written as given.
 *
 * @param group - The group value built from the object; changed in place.
 * @param stored - The group as stored, or anything else when there is none.
 */
export function carryRefusedShadow(group: Record<string, unknown>, stored: unknown): void {
  if (group.shadow !== undefined) return;
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return;
  const value = (stored as Readonly<Record<string, unknown>>).shadow;
  if (isRefusedShadow(value)) group.shadow = value;
}
