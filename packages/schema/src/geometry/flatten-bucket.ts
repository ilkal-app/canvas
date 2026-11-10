/**
 * How far a flattened curve or a stroke's arcs may stray from the exact outline: a quarter of
 * a device pixel at the zoom its bucket stands for (the prototype's `0.25 / zoom`,
 * `webgl-whiteboard/src/render/pathRenderer.ts`, in device pixels here, so a dpr-2 screen is
 * as smooth as a dpr-1 one).
 */
export const FLATTEN_TOLERANCE_PX = 0.25;

/**
 * How far past a boundary between buckets the zoom must go before the bucket changes, in
 * buckets. Buckets are
 * half a zoom octave apart, so 0.25 is an eighth of an octave, about 9% of zoom. Tunes
 * it against its zoom thrash benchmark.
 */
export const FLATTEN_BUCKET_HYSTERESIS = 0.25;

/** Below this, a zoom counts as this (a zero or negative zoom has no bucket). */
const MIN_ZOOM = 1e-6;

/**
 * The zoom bucket to flatten paths for ("path meshes are cached per
 * zoom bucket"): zooms are quantised to powers of √2, bucket `b` standing for zoom `2^(b/2)`,
 * so meshes are rebuilt only when the zoom moves by about 41%, and never for a pan. With a
 * previous bucket, the zoom must cross the boundary by {@link FLATTEN_BUCKET_HYSTERESIS}
 * before the bucket changes, so a zoom that wobbles about a boundary does not rebuild meshes
 * on every frame. Pure.
 *
 * @param zoom - Device pixels per world unit: the camera's zoom times its dpr.
 * @param previous - The bucket the last frame used, if any.
 * @returns The bucket, an integer (0 at zoom 1, 2 at zoom 2, −4 at zoom 0.25).
 */
export function pickFlattenBucket(zoom: number, previous?: number): number {
  const position = 2 * Math.log2(Math.max(zoom, MIN_ZOOM));
  if (previous !== undefined && Math.abs(position - previous) <= 0.5 + FLATTEN_BUCKET_HYSTERESIS) {
    return previous;
  }
  return Math.round(position);
}

/**
 * The flattening tolerance of a bucket: {@link FLATTEN_TOLERANCE_PX} device pixels at the
 * bucket's zoom, in world units.
 *
 * @param bucket - The bucket, from {@link pickFlattenBucket}.
 * @returns The tolerance, world units.
 */
export function flattenToleranceOf(bucket: number): number {
  return FLATTEN_TOLERANCE_PX / 2 ** (bucket / 2);
}
