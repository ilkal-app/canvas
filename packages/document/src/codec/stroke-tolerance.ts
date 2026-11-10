import { strokeAlignValueReason, strokeValueReason } from '@canvas/schema';

// The codec's tolerance of a stored stroke alignment and frame outline, both ways,
// as `shadow-tolerance.ts` is of a drop shadow. The relay's door judges every value a peer
// writes, but replays from Redis or storage pass no door, so a stored `strokeAlign`
// may be one the schema refuses (`null`, another string), and a frame's `stroke` one with a bad
// colour or width.
//
// - Reading: such a value reads as absent (inside; no frame outline), before the field-kind check
//   (`field-kinds.ts`) would drop the whole object, and nothing downstream (a command, the
//   inspector) sees a value it cannot judge.
// - Writing: a write of the object that does not give the field (a move, a lock, a restyle of
//   another field) rebuilds the whole `style` group from the object, which would delete the
//   stored value though nobody edited it. So the writer carries a stored value the reader left
//   out back into the group; only an explicit value (or a frame's `null` stroke) replaces it.
//
// A shape's `stroke` is required and keeps its existing reading (an unreadable colour is the
// renderer's to draw in the base colour), so only a frame's optional one is tolerated here, and
// an image's optional `border` the same way.
// Package-internal.

/**
 * Whether a stored stroke alignment is one the reader leaves out: present and refused.
 *
 * @param value - The stored value.
 * @returns True for a present, refused alignment.
 */
function isRefusedStrokeAlign(value: unknown): boolean {
  return value !== undefined && strokeAlignValueReason(value) !== undefined;
}

/**
 * Whether a stored frame outline is one the reader leaves out: present and refused.
 *
 * @param value - The stored value.
 * @returns True for a present, refused outline.
 */
function isRefusedFrameStroke(value: unknown): boolean {
  return value !== undefined && strokeValueReason(value) !== undefined;
}

/**
 * Removes, from an object being read, a stored `strokeAlign` the schema refuses (so it reads as
 * inside), and a frame's stored `stroke` or an image's stored `border` the schema refuses (so it
 * reads as none). Absent and acceptable values are kept.
 *
 * @param target - The object being built from its stored fields; changed in place.
 */
export function tolerateStoredStrokeStyle(target: Record<string, unknown>): void {
  if (isRefusedStrokeAlign(target.strokeAlign)) delete target.strokeAlign;
  if (target.type === 'frame' && isRefusedFrameStroke(target.stroke)) delete target.stroke;
  if (target.type === 'image' && isRefusedFrameStroke(target.border)) delete target.border;
}

/**
 * Carries stored, refused stroke fields into a `style` group about to be written for an object
 * that leaves them out ({@link tolerateStoredStrokeStyle} left them out when it was read), so a
 * write that does not set them never deletes them. A field the group holds is written as given.
 * A shape's group always holds its `stroke` (required, `null` for none), so only a frame's
 * omitted outline is ever carried.
 *
 * @param group - The group value built from the object; changed in place.
 * @param stored - The group as stored, or anything else when there is none.
 */
export function carryRefusedStrokeStyle(group: Record<string, unknown>, stored: unknown): void {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return;
  const record = stored as Readonly<Record<string, unknown>>;
  if (group.strokeAlign === undefined && isRefusedStrokeAlign(record.strokeAlign)) {
    group.strokeAlign = record.strokeAlign;
  }
  if (group.stroke === undefined && isRefusedFrameStroke(record.stroke)) {
    group.stroke = record.stroke;
  }
  if (group.border === undefined && isRefusedFrameStroke(record.border)) {
    group.border = record.border;
  }
}
