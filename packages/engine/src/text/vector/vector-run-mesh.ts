// A run's glyphs at the vector tier: each glyph's geometry, in em with y up, placed
// in its text box's frame (world units, y down) at its layout position and the run's font size,
// all in one triangle list for one non-zero stencil fill per run (one colour). Flipping y turns
// every triangle the other way, which a non-zero count does not mind, and the curve coordinates
// carry over unchanged: Loop–Blinn's u² − v is invariant under any affine map. Pure.
import { SPACE } from '@canvas/text';
import type { TextLayout } from '@canvas/text';

import { glyphFaceOf, glyphKeyOf, type GlyphKey } from '../atlas/glyph-key.js';
import type { GlyphPlacement } from '../renderer/glyph-quads.js';

import { EDGE_FLOATS_PER_VERTEX } from './glyph-edge-mesh.js';
import type { GlyphBounds, GlyphGeometry } from './glyph-geometry.js';

/** Finds a glyph's geometry by its face string (`glyphFaceOf`) and key (`glyphKeyOf`). */
export type GlyphGeometryLookup = (face: string, key: GlyphKey) => GlyphGeometry | undefined;

/** One run's glyph triangles placed in its box's frame, ready for the stencil pass. */
export interface VectorRunMesh {
  /** The run: an index into the layout's runs. */
  readonly run: number;
  /** Four floats per vertex: x and y in world units in the box's frame (y down), then u, v. */
  readonly vertices: Float32Array;
  /** How many vertices: a multiple of 3. */
  readonly vertexCount: number;
  /** The placed vertices' bounds, in the box's frame (`minY` is the top); none without any. */
  readonly bounds: GlyphBounds | undefined;
  /**
   * The glyphs' edge hulls placed the same way (`glyphEdgeMesh`'s layout), for the
   * edge pass; empty when no glyph has them.
   */
  readonly edges: Float32Array;
  /** How many edge vertices: six per edge. */
  readonly edgeVertexCount: number;
}

/** A run's mesh, or the glyphs whose geometry it is still waiting for. */
export type VectorRunMeshResult =
  | {
      /** The run's mesh: every glyph's geometry was found. */
      readonly mesh: VectorRunMesh;
      /** Nothing is missing. */
      readonly missing?: undefined;
    }
  | {
      /** No mesh until the missing geometry lands. */
      readonly mesh?: undefined;
      /** The glyphs whose geometry was not found, each once, in the order first met. */
      readonly missing: readonly GlyphKey[];
    };

/** Floats per vertex: x, y, u, v. */
const FLOATS_PER_VERTEX = 4;

/**
 * The key a glyph's geometry is cached by: its face string (a face at its variation
 * coordinates), `#`, and its key in decimal.
 *
 * @param face - The face string, from `glyphFaceOf`.
 * @param key - The glyph's key, from `glyphKeyOf`.
 * @returns The cache key.
 */
export function glyphGeometryKey(face: string, key: GlyphKey): string {
  return `${face}#${String(key)}`;
}

/**
 * Builds one run's mesh: the geometry of each of its glyphs that is not a space, in layout
 * order, placed at `origin` plus the glyph's position and scaled by the run's font size. When a
 * glyph's geometry is not found the run has no mesh yet, and the missing keys come back instead,
 * each once, in the order first met. A run with no glyphs, or none at that index, has an empty
 * mesh. The layout and geometry are not changed, and the mesh shares no buffer with them.
 *
 * @param layout - The laid-out text.
 * @param run - The run: an index into `layout.runs`.
 * @param origin - The box's origin in the object's frame, as the glyph quads take it.
 * @param lookup - Finds a glyph's geometry.
 * @returns The mesh, or the missing glyphs.
 */
export function buildVectorRunMesh(
  layout: TextLayout,
  run: number,
  origin: Pick<GlyphPlacement, 'originX' | 'originY'>,
  lookup: GlyphGeometryLookup,
): VectorRunMeshResult {
  const style = layout.runs[run];
  const placed: { readonly x: number; readonly y: number; readonly geometry: GlyphGeometry }[] = [];
  const missing: GlyphKey[] = [];
  if (style !== undefined) {
    const face = glyphFaceOf(style);
    for (const glyph of layout.glyphs) {
      if (glyph.run !== run || glyph.codepoint === SPACE) continue;
      const key = glyphKeyOf(glyph);
      const geometry = lookup(face, key);
      if (geometry === undefined) {
        if (!missing.includes(key)) missing.push(key);
      } else {
        placed.push({ x: origin.originX + glyph.x, y: origin.originY + glyph.y, geometry });
      }
    }
  }
  if (missing.length > 0) return { missing };
  const fontSize = style?.fontSize ?? 0;
  const vertexCount = placed.reduce((sum, { geometry }) => sum + geometry.vertexCount, 0);
  const vertices = new Float32Array(vertexCount * FLOATS_PER_VERTEX);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  let offset = 0;
  for (const { x, y, geometry } of placed) {
    const floats = geometry.vertices.subarray(0, geometry.vertexCount * FLOATS_PER_VERTEX);
    vertices.set(
      floats.map((value, index) => {
        const component = index % FLOATS_PER_VERTEX;
        return component === 0
          ? x + value * fontSize
          : component === 1
            ? y - value * fontSize
            : value;
      }),
      offset,
    );
    offset += floats.length;
    const { bounds } = geometry;
    if (bounds === undefined) continue;
    // The stored em values' extremes are the rounded extremes (rounding keeps order), placed as
    // the vertices are: so these bound the stored vertices exactly.
    const [left, bottom] = [Math.fround(bounds.minX), Math.fround(bounds.minY)];
    const [right, top] = [Math.fround(bounds.maxX), Math.fround(bounds.maxY)];
    minX = Math.min(minX, Math.fround(x + left * fontSize));
    maxX = Math.max(maxX, Math.fround(x + right * fontSize));
    minY = Math.min(minY, Math.fround(y - top * fontSize));
    maxY = Math.max(maxY, Math.fround(y - bottom * fontSize));
  }
  const bounds = vertexCount === 0 ? undefined : { minX, minY, maxX, maxY };
  const { edges, edgeVertexCount } = placedEdges(placed, fontSize);
  return { mesh: { run, vertices, vertexCount, bounds, edges, edgeVertexCount } };
}

/**
 * The glyphs' edge hulls placed in the box's frame: each point scaled by the font size, y
 * flipped, and moved to its glyph; the neighbours' normals with their y flipped; the corners and
 * joins kept. Flipping y mirrors the plane, so a line's outside, left or right of its direction,
 * swaps sides; a quadratic's chord side, and whether a join is convex, do not.
 *
 * @param placed - The glyphs, with their positions in the box's frame.
 * @param fontSize - The run's font size.
 * @returns The placed hulls and their vertex count.
 */
function placedEdges(
  placed: readonly { readonly x: number; readonly y: number; readonly geometry: GlyphGeometry }[],
  fontSize: number,
): { edges: Float32Array; edgeVertexCount: number } {
  const edgeVertexCount = placed.reduce(
    (sum, { geometry }) => sum + (geometry.edges?.vertexCount ?? 0),
    0,
  );
  const edges = new Float32Array(edgeVertexCount * EDGE_FLOATS_PER_VERTEX);
  let offset = 0;
  for (const { x, y, geometry } of placed) {
    const mesh = geometry.edges;
    if (mesh === undefined) continue;
    const floats = mesh.vertices.subarray(0, mesh.vertexCount * EDGE_FLOATS_PER_VERTEX);
    edges.set(
      floats.map((value, index) => {
        const component = index % EDGE_FLOATS_PER_VERTEX;
        // The edge's three points, x then y; the hull corner; the kind and side; the
        // neighbours' normals, whose y flips with the box frame's; then the joins.
        if (component < 6) return component % 2 === 0 ? x + value * fontSize : y - value * fontSize;
        if (component === 8) return Math.abs(value) === 1 ? -value : value;
        if (component >= 9 && component < 13 && component % 2 === 0) return -value;
        return value;
      }),
      offset,
    );
    offset += floats.length;
  }
  return { edges, edgeVertexCount };
}
