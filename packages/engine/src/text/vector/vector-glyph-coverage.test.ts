/// <reference types="node" />
// What the vector tier draws against the exact coverage of the outline, through the edge
// and cover passes run on the CPU (`emulateVectorGlyph`, glyph-edge.wgsl's math at pixel centres).
// The owner saw dark seams and wedges in Roboto's g, p and q at high zoom: their bowl and stem
// are overlapping contours, and #525 antialiased the edges buried inside them; at the crossings,
// hulls painted pixels a corner's other edge covers. Before the fix Roboto 400 had 881 (g) to
// 1,478 (q) pixels off by more than a quarter at 520 px/em, some by 1.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadShaper, shapeText, type GlyphOutline } from '@canvas/text';

import {
  emulateVectorGlyph,
  referenceCoverage,
  type Placement,
} from './__fixtures__/edge-pass-emulator.js';
import { glyphEdgeMesh } from './glyph-edge-mesh.js';
import { glyphEdges } from './glyph-edges.js';

/** Device px per em: deep in the vector tier, where a pixel is a small part of a stem. */
const PX_PER_EM = 400;
/**
 * How far a pixel may be from its exact coverage. One sample at the pixel's centre stands in for
 * the GPU's four, so a pixel a hull reaches only in part reads its coverage, not a share of it;
 * every glyph here is within 0.18 after the fix.
 */
const MAX_ERROR = 0.25;

/**
 * The pixels the tier draws more than {@link MAX_ERROR} from the outline's exact coverage.
 *
 * @param outline - The glyph, em with y up.
 * @returns Those pixels, as `x,y emulated exact`.
 */
function wrongPixels(outline: GlyphOutline): string[] {
  const edges = glyphEdges(outline);
  const placement: Placement = {
    pxPerEm: PX_PER_EM,
    originPx: [10.3, 0.27 * PX_PER_EM + 0.6],
    width: Math.ceil(0.75 * PX_PER_EM),
    height: Math.ceil(0.95 * PX_PER_EM),
  };
  const drawn = emulateVectorGlyph(glyphEdgeMesh(edges), outline, placement);
  const exact = referenceCoverage(outline, placement, 4, drawn.painted);
  const wrong: string[] = [];
  drawn.values.forEach((value, index) => {
    // The cover is exact at pixel centres; only what a hull painted can be off.
    if (drawn.painted?.[index] !== 1) return;
    const truth = exact.values[index] ?? 0;
    if (Math.abs(value - truth) > MAX_ERROR) {
      const [x, y] = [index % placement.width, Math.floor(index / placement.width)];
      wrong.push(`${String(x)},${String(y)} ${value.toFixed(2)} ${truth.toFixed(2)}`);
    }
  });
  return wrong;
}

/**
 * A square contour.
 *
 * @param x - Its left, em.
 * @param y - Its bottom, em.
 * @param size - Its side, em.
 * @returns Its four lines, counter-clockwise.
 */
function square(x: number, y: number, size: number): GlyphOutline['contours'][number] {
  const corners = [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ] as const;
  return corners.map(([x0, y0], index) => {
    const [x1, y1] = corners[(index + 1) % corners.length] ?? [x0, y0];
    return { kind: 'line' as const, x0, y0, x1, y1 };
  });
}

describe('the vector tier against exact coverage', () => {
  it('draws overlapping squares as their union', () => {
    const outline = { contours: [square(0.05, 0, 0.4), square(0.25, 0.2, 0.4)] };
    expect(wrongPixels(outline)).toEqual([]);
  });

  it.each([['roboto/300.ttf'], ['roboto/400.ttf'], ['roboto/700.ttf'], ['inter/400.ttf']])(
    "draws %s's g, p and q, whose bowls and stems overlap in Roboto",
    async (file) => {
      const shaper = await loadShaper();
      const url = new URL(`../../../../app/assets/fonts/library/${file}`, import.meta.url);
      const face = shaper.face(file, Uint8Array.from(readFileSync(url)));
      const run = shapeText(shaper, face, 'gpq', 0, 3);
      for (const glyph of run.glyphs) {
        expect(wrongPixels(shaper.outline(face, glyph.glyphId))).toEqual([]);
      }
    },
    120_000,
  );
});
