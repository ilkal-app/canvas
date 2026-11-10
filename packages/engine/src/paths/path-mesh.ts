import type { WorldBounds } from '../camera/camera.js';

import {
  closedLoops,
  flattenChain,
  flattenChainCorners,
  isolatedVertices,
  loopCubics,
  strokeChains,
} from './chains.js';
import { writeFan } from './fill-mesh.js';
import { indexNetwork, type NetworkIndex, type PathNetwork } from './network-index.js';
import { writeStroke } from './stroke-mesh.js';
import { PLAIN_OUTLINE, type StrokeOutline } from './stroke-outline.js';
import { TriangleWriter } from './triangle-writer.js';

/** Vertices of a mesh's cover quad: two triangles over everything it draws. */
export const COVER_VERTEX_COUNT = 6;

/** What a path's mesh is built from. */
export interface PathMeshInput {
  /** The vector network, in the path's own frame. */
  readonly network: PathNetwork;
  /** The stroke's width, world units; 0 for no stroke. */
  readonly strokeWidth: number;
  /** Whether the path has a fill (its closed loops are filled, even-odd). */
  readonly isFilled: boolean;
  /** The flattening tolerance, world units (`flattenToleranceOf` of the zoom bucket). */
  readonly tolerance: number;
  /** The stroke's join, dash and cap (`strokeOutlineOf`); absent for none. */
  readonly outline?: StrokeOutline | undefined;
}

/**
 * A path's triangles in its own frame, as one vertex list the path pass draws in three ranges:
 * the fill's stencil fans, then the cover quad, then the stroke.
 */
export interface PathMeshData {
  /**
   * `x, y` per vertex: `fillVertexCount` fan vertices, then {@link COVER_VERTEX_COUNT} cover
   * vertices, then `strokeVertexCount` stroke vertices. Empty when the path draws nothing.
   */
  readonly vertices: Float32Array<ArrayBuffer>;
  /** Vertices of the fill's fans (three per triangle); 0 without a filled loop. */
  readonly fillVertexCount: number;
  /** Vertices of the stroke's triangles; 0 without a stroke. */
  readonly strokeVertexCount: number;
  /** The box the fans and the stroke lie in, own frame; `undefined` when nothing is drawn. */
  readonly bounds: WorldBounds | undefined;
}

/**
 * The polygons of the network's closed loops, each without its repeated closing point.
 *
 * @param index - The network's index.
 * @param tolerance - The flattening tolerance.
 * @returns One polygon per loop.
 */
function loopPolygons(index: NetworkIndex, tolerance: number): ReturnType<typeof flattenChain>[] {
  return closedLoops(index).map((loop) => {
    const polygon = flattenChain(loopCubics(index, loop), tolerance);
    polygon.pop();
    return polygon;
  });
}

/**
 * Writes the stroke of every chain, and a dot for every vertex no segment touches. A chain's open
 * ends take the outline's cap (round by default); with a miter or bevel join, the join applies at
 * the chain's vertices and the points inside a flattened curve join round.
 *
 * @param writer - Where the triangles go.
 * @param index - The network's index.
 * @param width - The stroke's width.
 * @param tolerance - The flattening tolerance.
 * @param outline - The stroke's join, dash and cap.
 */
function writeNetworkStroke(
  writer: TriangleWriter,
  index: NetworkIndex,
  width: number,
  tolerance: number,
  outline: StrokeOutline,
): void {
  const cap = outline.cap ?? 'round';
  const hasCorners = outline.join === 'miter' || outline.join === 'bevel';
  for (const { cubics, isClosed } of strokeChains(index)) {
    if (hasCorners) {
      const { points, corners } = flattenChainCorners(cubics, tolerance);
      writeStroke(writer, points, width, isClosed, cap, tolerance, outline, corners);
    } else {
      writeStroke(
        writer,
        flattenChain(cubics, tolerance),
        width,
        isClosed,
        cap,
        tolerance,
        outline,
      );
    }
  }
  // A lone vertex (the pen's first click) still shows, as a dot (the prototype's rule).
  for (const { x, y } of isolatedVertices(index)) {
    writeStroke(writer, [{ x, y }], width, false, 'round', tolerance);
  }
}

/**
 * The bounds of triangle lists.
 *
 * @param lists - The lists, `x, y` per vertex.
 * @returns Their box, or `undefined` when all are empty.
 */
function boundsOf(...lists: Float32Array[]): WorldBounds | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const list of lists) {
    list.forEach((value, index) => {
      // Even floats are x, odd ones y.
      if (index % 2 === 0) {
        minX = Math.min(minX, value);
        maxX = Math.max(maxX, value);
      } else {
        minY = Math.min(minY, value);
        maxY = Math.max(maxY, value);
      }
    });
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : undefined;
}

/**
 * Builds a path's mesh (paths use CPU flattening with stencil even-odd
 * fills; the prototype's `PathRenderer.meshOf`, `webgl-whiteboard/src/render/pathRenderer.ts`):
 * every curve flattened to the tolerance; for a filled path, a fan per closed loop (a loop is a
 * component whose vertices all have two segments, so a branching network is stroked but not
 * filled); a cover quad over everything, padded by two tolerances so it covers every pixel a
 * fan marks; and the stroke of every chain, with round joins and caps unless the outline says
 * otherwise. Pure: this is the work of
 * the `mesh` job, run in a job worker or on the rendering thread.
 *
 * @param input - The network, stroke width, fill flag and tolerance; not mutated.
 * @returns The mesh.
 */
export function buildPathMesh(input: PathMeshInput): PathMeshData {
  const { network, strokeWidth, isFilled, tolerance, outline = PLAIN_OUTLINE } = input;
  const index = indexNetwork(network);
  const fill = new TriangleWriter();
  if (isFilled) {
    for (const polygon of loopPolygons(index, tolerance)) writeFan(fill, polygon);
  }
  const stroke = new TriangleWriter();
  if (strokeWidth > 0) writeNetworkStroke(stroke, index, strokeWidth, tolerance, outline);
  return assembleMesh(fill.toFloat32Array(), stroke.toFloat32Array(), tolerance);
}

/**
 * Lays a mesh's triangles out as the path pass draws them: the fill's fans, a cover quad over
 * both lists (padded by two tolerances so it covers every pixel a fan marks), then the stroke.
 * Shared by paths (`buildPathMesh`) and lines (`buildLineMesh`). Pure.
 *
 * @param fillTriangles - The fill's fans, `x, y` per vertex; empty for none.
 * @param strokeTriangles - The stroke's triangles; empty for none.
 * @param tolerance - The flattening tolerance, world units.
 * @returns The mesh; empty, with no bounds, when both lists are.
 */
export function assembleMesh(
  fillTriangles: Float32Array<ArrayBuffer>,
  strokeTriangles: Float32Array<ArrayBuffer>,
  tolerance: number,
): PathMeshData {
  const bounds = boundsOf(fillTriangles, strokeTriangles);
  if (!bounds) {
    return { vertices: new Float32Array(0), fillVertexCount: 0, strokeVertexCount: 0, bounds };
  }
  const pad = 2 * tolerance;
  const [x0, y0, x1, y1] = [
    bounds.minX - pad,
    bounds.minY - pad,
    bounds.maxX + pad,
    bounds.maxY + pad,
  ];
  const vertices = new TriangleWriter(fillTriangles.length + 12 + strokeTriangles.length);
  vertices.append(fillTriangles);
  vertices.triangle(x0, y0, x1, y0, x1, y1);
  vertices.triangle(x0, y0, x1, y1, x0, y1);
  vertices.append(strokeTriangles);
  return {
    vertices: vertices.toFloat32Array(),
    fillVertexCount: fillTriangles.length / 2,
    strokeVertexCount: strokeTriangles.length / 2,
    bounds,
  };
}
