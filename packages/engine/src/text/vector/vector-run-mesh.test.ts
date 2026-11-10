import { describe, expect, it } from 'vitest';

import type { TextLayout } from '@canvas/text';

import type { GlyphGeometry } from './glyph-geometry.js';
import { buildVectorRunMesh } from './vector-run-mesh.js';

/** One glyph of one run, where rounding the em bound first or not gives different floats. */
const LAYOUT = {
  text: 'A',
  runs: [{ faceId: 'face', fontSize: 1000, color: 0 }],
  glyphs: [
    {
      codepoint: 65,
      glyphId: null,
      index: 0,
      end: 1,
      level: 0,
      line: 0,
      x: 36.64,
      y: 1.7,
      advance: 1,
      run: 0,
    },
  ],
  lines: [],
  width: 1,
  height: 1,
} as unknown as TextLayout;

describe('buildVectorRunMesh', () => {
  it('bounds the stored vertices exactly when the em bounds are the unrounded corners', () => {
    // As tessellateGlyph gives them: bounds from the corners before they were stored in floats.
    const corners = [0.371, 0.2, 0.7, 0.2, 0.371, 0.9];
    const geometry: GlyphGeometry = {
      vertices: Float32Array.from(
        corners.flatMap((value, index) => (index % 2 === 1 ? [value, 0, 1] : [value])),
      ),
      vertexCount: 3,
      bounds: { minX: 0.371, minY: 0.2, maxX: 0.7, maxY: 0.9 },
    };
    const { mesh } = buildVectorRunMesh(LAYOUT, 0, { originX: 0, originY: 5.3 }, () => geometry);
    const xs = [0, 4, 8].map((index) => mesh?.vertices[index]);
    const ys = [1, 5, 9].map((index) => mesh?.vertices[index]);
    expect(mesh?.bounds).toEqual({
      minX: Math.min(...(xs as number[])),
      minY: Math.min(...(ys as number[])),
      maxX: Math.max(...(xs as number[])),
      maxY: Math.max(...(ys as number[])),
    });
  });
});
