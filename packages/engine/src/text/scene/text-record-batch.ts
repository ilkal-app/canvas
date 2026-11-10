import { registerRecordBatch } from '../../scene/record-batches.js';
import type { SceneObject, ScenePass } from '../../scene/scene-pass.js';

import type { OrderedGlyphQuads } from './ordered-glyph-quads.js';
import { writePlacedGlyph, type PagePlacements } from './text-record.js';

/**
 * Resolves text layout and quads once for each synchronous object rewrite.
 *
 * @param pass - Built-in renderer-local text pass.
 * @param resolve - Performs ordinary layout/resource preparation for the target.
 * @param pages - Where each glyph page draws from (its group and index).
 * @param valueOf - What a record holds in place of its page's index (`TextPassKind.recordValueOf`).
 */
export function registerTextRecordBatch(
  pass: ScenePass,
  resolve: (target: SceneObject) => OrderedGlyphQuads['quads'] | undefined,
  pages: PagePlacements,
  valueOf?: (object: SceneObject['object']) => number,
): void {
  registerRecordBatch(pass, (target) => {
    const quads = resolve(target);
    const value = valueOf?.(target.object);
    return (record, index) => {
      return writePlacedGlyph(record, target, quads?.[index], pages, value);
    };
  });
}
