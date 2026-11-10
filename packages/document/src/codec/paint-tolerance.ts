import { paintReason } from '@canvas/schema';

/** The object types whose fill may not be an image paint (shapes and frames only). */
const NO_IMAGE_PAINT_TYPES: ReadonlySet<unknown> = new Set(['path']);

// The reader's tolerance of stored paints. The relay's door judges
// every fill and background a peer writes, but replays from Redis or storage pass no door,
// so the reader stays hardened: a value under `fill` or `background` that the schema
// refuses as a paint (a bad gradient, `ink`, any other string, a number, a boolean) reads as no
// fill, before the field-kind check (`field-kinds.ts`) would drop the whole object, so the
// object, its outline and its label still read. Only the read projection changes; the stored
// value stays as it is. Solid tuples are read as before (their ranges are the engine reader's to
// judge). An unreadable stroke or text colour is the renderer's to draw in the base colour.
// Package-internal.

/** The fields that hold a paint. */
const PAINT_FIELDS = ['fill', 'background'] as const;

/**
 * Replaces, in an object being read, a stored paint the schema refuses (anything but absent,
 * null or a tuple) with `null`, and an image paint on an object that may not hold one (a path,
 *), so the rest of the object still reads.
 *
 * @param target - The object being built from its stored fields; changed in place.
 */
export function tolerateStoredPaints(target: Record<string, unknown>): void {
  for (const field of PAINT_FIELDS) {
    const value = target[field];
    if (Array.isArray(value)) continue;
    const isMisplacedImage =
      NO_IMAGE_PAINT_TYPES.has(target.type) &&
      typeof value === 'object' &&
      value !== null &&
      (value as { type?: unknown }).type === 'image';
    if (isMisplacedImage || paintReason(value) !== undefined) target[field] = null;
  }
}
