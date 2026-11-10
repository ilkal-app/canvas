// What the bundled fonts fingerprint hashes of the generated tables: every face's encoded
// metrics without the decoration field, since an underline moves no glyph and no stored
// size goes stale when it changes.
import { COVERAGE_FACES } from '../bundled/coverage-generated/index.js';
import { BUNDLED_FAMILIES } from '../bundled/generated/index.js';

/**
 * An encoded face table without its decoration field: its first six fields.
 *
 * @param encoded - The table.
 * @returns The table as sizes depend on it.
 */
function withoutDecoration(encoded: string): string {
  return encoded.split(';').slice(0, 6).join(';');
}

/** The bundled families as the fingerprint hashes them. */
export const SIZED_FAMILIES = BUNDLED_FAMILIES.map((family) => ({
  ...family,
  faces: family.faces.map((face) => ({ ...face, metrics: withoutDecoration(face.metrics) })),
}));

/** The coverage faces as the fingerprint hashes them. */
export const SIZED_COVERAGE = COVERAGE_FACES.map((face) => ({
  ...face,
  metrics: withoutDecoration(face.metrics),
}));
