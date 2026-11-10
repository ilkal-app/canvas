// The vector tier's edge and cover passes on the CPU, one sample per pixel centre: each
// edge hull in mesh order paints the pixels it reaches that no hull painted yet, with the
// coverage glyph-edge.wgsl computes there (before gamma); then the cover fills the unpainted
// pixels whose winding is non-zero. The shader's math is mirrored line for line, so a test can
// compare what the tier draws with the exact coverage of the outline, with no GPU.
import type { GlyphOutline } from '@canvas/text';

import { EDGE_FLOATS_PER_VERTEX, type GlyphEdgeMesh } from '../glyph-edge-mesh.js';

import { boxCoverage, joined, type Vec } from './edge-pass-coverage.js';

/** A coverage image: one value per pixel, 0..1, rows bottom-up (y up, as the outline). */
export interface CoverageImage {
  readonly width: number;
  readonly height: number;
  readonly values: Float64Array;
  /** 1 where an edge hull painted the pixel (the cover is exact elsewhere at pixel centres). */
  readonly painted?: Uint8Array;
}

/** Where the glyph sits: device px per em, and the pixel the em origin falls on. */
export interface Placement {
  readonly pxPerEm: number;
  readonly originPx: Vec;
  readonly width: number;
  readonly height: number;
}

const REACH_PX = 1;

const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const sign = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);

function normalize(v: Vec): Vec {
  const length = Math.hypot(v[0], v[1]);
  return length === 0 ? [0, 0] : [v[0] / length, v[1] / length];
}

/** One hull's floats, read from its first vertex. */
interface Hull {
  readonly start: Vec;
  readonly control: Vec;
  readonly end: Vec;
  readonly side: number;
  readonly previousNormal: Vec;
  readonly nextNormal: Vec;
  readonly joins: Vec;
}

/**
 * A mesh's hulls, one per six vertices.
 *
 * @param mesh - The mesh.
 * @returns The hulls, in draw order.
 */
function hullsOf(mesh: GlyphEdgeMesh): Hull[] {
  const hulls: Hull[] = [];
  const f = mesh.vertices;
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 6) {
    const o = vertex * EDGE_FLOATS_PER_VERTEX;
    const at = (index: number): number => f[o + index] ?? 0;
    hulls.push({
      start: [at(0), at(1)],
      control: [at(2), at(3)],
      end: [at(4), at(5)],
      side: at(8),
      previousNormal: [at(9), at(10)],
      nextNormal: [at(11), at(12)],
      joins: [at(13), at(14)],
    });
  }
  return hulls;
}

/** A hull placed in pixels: its edge's frame, its box, and its Loop–Blinn derivatives. */
interface PlacedHull {
  readonly hull: Hull;
  readonly a: Vec;
  readonly b: Vec;
  readonly toControl: Vec;
  readonly toEnd: Vec;
  readonly along: Vec;
  readonly left: Vec;
  readonly chordLength: number;
  readonly box: readonly [x0: number, x1: number, y0: number, y1: number];
  readonly det: number;
  readonly du: Vec;
  readonly dv: Vec;
}

/**
 * A hull placed as glyph-edge.wgsl's vertex stage places it: the chord-aligned box of its control
 * triangle, grown by the reach all round.
 *
 * @param hull - The hull.
 * @param toPx - From em to pixels.
 * @returns The placed hull.
 */
function place(hull: Hull, toPx: (p: Vec) => Vec): PlacedHull {
  const [a, c, b] = [toPx(hull.start), toPx(hull.control), toPx(hull.end)];
  const toEnd = sub(b, a);
  const chordLength = Math.hypot(toEnd[0], toEnd[1]);
  const along: Vec = chordLength > 0 ? [toEnd[0] / chordLength, toEnd[1] / chordLength] : [1, 0];
  const left: Vec = [-along[1], along[0]];
  const toControl = sub(c, a);
  const [alongControl, acrossControl] = [dot(toControl, along), dot(toControl, left)];
  const determinant = toControl[0] * toEnd[1] - toControl[1] * toEnd[0];
  const det = Math.abs(determinant) > 0 ? determinant : 1;
  // (s, t) are affine in the point: their gradients give the Loop–Blinn derivatives.
  const ds: Vec = [toEnd[1] / det, -toEnd[0] / det];
  const dt: Vec = [-toControl[1] / det, toControl[0] / det];
  return {
    hull,
    a,
    b,
    toControl,
    toEnd,
    along,
    left,
    chordLength,
    box: [
      Math.min(0, alongControl) - REACH_PX,
      Math.max(chordLength, alongControl) + REACH_PX,
      Math.min(0, acrossControl) - REACH_PX,
      Math.max(0, acrossControl) + REACH_PX,
    ],
    det,
    du: [0.5 * ds[0] + dt[0], 0.5 * ds[1] + dt[1]],
    dv: dt,
  };
}

/**
 * Whether a point lies in a hull: the chord-aligned box the vertex stage builds.
 *
 * @param placed - The placed hull.
 * @param p - The point, px.
 * @returns True inside.
 */
function isInHull(placed: PlacedHull, p: Vec): boolean {
  const { a, along, left, box } = placed;
  const offset = sub(p, a);
  const [x, y] = [dot(offset, along), dot(offset, left)];
  return x >= box[0] && x <= box[1] && y >= box[2] && y <= box[3];
}

/**
 * What glyph-edge.wgsl's fragment stage writes for a pixel (before gamma): its varyings are
 * affine, so they are read at the pixel's centre whichever of its samples the hull covers.
 *
 * @param placed - The placed hull.
 * @param p - The pixel's centre, px.
 * @returns The coverage.
 */
function fragmentCoverage(placed: PlacedHull, p: Vec): number {
  const { hull, a, b, toControl, toEnd, along, left, chordLength, det, du, dv } = placed;
  const offset = sub(p, a);
  const [x, y] = [dot(offset, along), dot(offset, left)];
  const s = (offset[0] * toEnd[1] - offset[1] * toEnd[0]) / det;
  const t = (toControl[0] * offset[1] - toControl[1] * offset[0]) / det;
  const u = 0.5 * s + t;
  const grad: Vec = [2 * u * du[0] - dv[0], 2 * u * du[1] - dv[1]];
  const gradient = Math.max(Math.hypot(grad[0], grad[1]), 1e-6);
  const isLine = Math.abs(hull.side) < 1.5;
  const distance = isLine ? sign(hull.side) * y : (sign(hull.side) * (u * u - t)) / gradient;
  const own = boxCoverage(distance, isLine ? left : [grad[0] / gradient, grad[1] / gradient]);
  const outward: Vec = isLine
    ? [sign(hull.side) * left[0], sign(hull.side) * left[1]]
    : [(sign(hull.side) * grad[0]) / gradient, (sign(hull.side) * grad[1]) / gradient];
  const isNearStart = -x > x - chordLength;
  const neighbourNormal = normalize(isNearStart ? hull.previousNormal : hull.nextNormal);
  const neighbourDistance = dot(sub(p, isNearStart ? a : b), neighbourNormal);
  return joined(
    own,
    [outward, distance],
    [neighbourNormal, neighbourDistance],
    isNearStart ? hull.joins[0] : hull.joins[1],
  );
}

/** The four samples of the canvas pass's 4× MSAA, within a pixel (D3D's standard pattern). */
const SAMPLES: readonly Vec[] = [
  [0.375, 0.125],
  [0.875, 0.375],
  [0.125, 0.625],
  [0.625, 0.875],
];

/**
 * The edge pass and the cover over a glyph's mesh, at the canvas's four samples a pixel: each hull
 * in order paints the samples it covers that no hull painted yet, with the value its fragment
 * computes at the pixel's centre; the cover fills the rest by the winding at each sample. A pixel
 * is the mean of its samples. Only pixels a hull touched are resolved (`painted`); away from the
 * hulls, a pixel's samples are all in or all out.
 *
 * @param mesh - The glyph's edge hulls (`glyphEdgeMesh`).
 * @param outline - Its outline, for the cover's winding.
 * @param placement - The scale and the image.
 * @returns The coverage per pixel, and which pixels a hull touched.
 */
export function emulateVectorGlyph(
  mesh: GlyphEdgeMesh,
  outline: GlyphOutline,
  placement: Placement,
): CoverageImage {
  const { pxPerEm, originPx, width, height } = placement;
  const toPx = (p: Vec): Vec => [originPx[0] + p[0] * pxPerEm, originPx[1] + p[1] * pxPerEm];
  const sampleValues = new Float64Array(width * height * SAMPLES.length);
  const samplePainted = new Uint8Array(width * height * SAMPLES.length);
  const painted = new Uint8Array(width * height);
  for (const hull of hullsOf(mesh)) {
    const placed = place(hull, toPx);
    const { a, along, left, box } = placed;
    const corners = [
      [box[0], box[2]],
      [box[1], box[2]],
      [box[1], box[3]],
      [box[0], box[3]],
    ].map(([x = 0, y = 0]): Vec => [
      a[0] + along[0] * x + left[0] * y,
      a[1] + along[1] * x + left[1] * y,
    ]);
    const [xs, ys] = [corners.map((p) => p[0]), corners.map((p) => p[1])];
    const [minX, maxX] = [
      Math.max(0, Math.floor(Math.min(...xs))),
      Math.min(width - 1, Math.ceil(Math.max(...xs))),
    ];
    const [minY, maxY] = [
      Math.max(0, Math.floor(Math.min(...ys))),
      Math.min(height - 1, Math.ceil(Math.max(...ys))),
    ];
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const index = py * width + px;
        let value: number | undefined;
        SAMPLES.forEach(([sx, sy], sample) => {
          const at = index * SAMPLES.length + sample;
          if (samplePainted[at] === 1 || !isInHull(placed, [px + sx, py + sy])) return;
          value ??= fragmentCoverage(placed, [px + 0.5, py + 0.5]);
          sampleValues[at] = value;
          samplePainted[at] = 1;
          painted[index] = 1;
        });
      }
    }
  }
  const lines = flattened(outline, pxPerEm, originPx);
  const values = new Float64Array(width * height);
  for (let index = 0; index < values.length; index += 1) {
    if (painted[index] !== 1) continue;
    const [px, py] = [index % width, Math.floor(index / width)];
    let sum = 0;
    SAMPLES.forEach(([sx, sy], sample) => {
      const at = index * SAMPLES.length + sample;
      sum +=
        samplePainted[at] === 1
          ? (sampleValues[at] ?? 0)
          : windingAt(lines, [px + sx, py + sy]) !== 0
            ? 1
            : 0;
    });
    values[index] = sum / SAMPLES.length;
  }
  return { width, height, values, painted };
}

/**
 * The exact coverage of each pixel by the outline (non-zero), by `samples`² point samples.
 *
 * @param outline - The glyph's outline, em with y up.
 * @param placement - The scale and the image.
 * @param samples - Samples per pixel side.
 * @param only - When given, only the pixels it marks are measured; the rest read 0.
 * @returns The coverage per pixel.
 */
export function referenceCoverage(
  outline: GlyphOutline,
  placement: Placement,
  samples = 16,
  only?: Uint8Array,
): CoverageImage {
  const { pxPerEm, originPx, width, height } = placement;
  const lines = flattened(outline, pxPerEm, originPx);
  const values = new Float64Array(width * height);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      if (only !== undefined && only[py * width + px] !== 1) continue;
      let inside = 0;
      for (let sy = 0; sy < samples; sy += 1)
        for (let sx = 0; sx < samples; sx += 1)
          if (windingAt(lines, [px + (sx + 0.5) / samples, py + (sy + 0.5) / samples]) !== 0)
            inside += 1;
      values[py * width + px] = inside / (samples * samples);
    }
  }
  return { width, height, values };
}

/**
 * The outline as lines in pixels, for counting windings: the truth both the cover (which counts
 * the original contours in the stencil) and the reference read, never the boundary edges, whose
 * pieces keep their contours' directions.
 *
 * @param outline - The glyph's outline, em with y up.
 * @param pxPerEm - Device px per em.
 * @param originPx - Where the em origin falls.
 * @returns The lines.
 */
function flattened(outline: GlyphOutline, pxPerEm: number, originPx: Vec): [Vec, Vec][] {
  const toPx = (p: Vec): Vec => [originPx[0] + p[0] * pxPerEm, originPx[1] + p[1] * pxPerEm];
  const lines: [Vec, Vec][] = [];
  const steps = 32;
  for (const segment of outline.contours.flat()) {
    let previous = toPx([segment.x0, segment.y0]);
    for (let step = 1; step <= (segment.kind === 'line' ? 1 : steps); step += 1) {
      const t = segment.kind === 'line' ? 1 : step / steps;
      const s = 1 - t;
      const point: Vec =
        segment.kind === 'line'
          ? [segment.x1, segment.y1]
          : segment.kind === 'quadratic'
            ? [
                s * s * segment.x0 + 2 * s * t * segment.cx + t * t * segment.x1,
                s * s * segment.y0 + 2 * s * t * segment.cy + t * t * segment.y1,
              ]
            : [
                s ** 3 * segment.x0 +
                  3 * s * s * t * segment.c1x +
                  3 * s * t * t * segment.c2x +
                  t ** 3 * segment.x1,
                s ** 3 * segment.y0 +
                  3 * s * s * t * segment.c1y +
                  3 * s * t * t * segment.c2y +
                  t ** 3 * segment.y1,
              ];
      const next = toPx(point);
      lines.push([previous, next]);
      previous = next;
    }
  }
  return lines;
}

function windingAt(lines: readonly (readonly [Vec, Vec])[], [x, y]: Vec): number {
  let winding = 0;
  for (const [a, b] of lines) {
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (a[1] <= y && y < b[1] && cross > 0) winding += 1;
    else if (b[1] <= y && y < a[1] && cross < 0) winding -= 1;
  }
  return winding;
}
