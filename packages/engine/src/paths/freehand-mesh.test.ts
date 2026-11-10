import { describe, expect, it } from 'vitest';

import type { FreehandObject } from '@canvas/schema';

import { isDrawnPath, isSameDrawnMesh, drawnLocalBounds } from './drawn-path.js';
import {
  buildFreehandMesh,
  freehandHalfWidth,
  freehandMeshShapeOf,
  isSameFreehandMesh,
  MARKER_MIN_WIDTH_SHARE,
} from './freehand-mesh.js';
import { meshJobRequestOf, runMeshJob } from './mesh-job.js';
import { meshSegmentsOf } from './mesh-segments.js';
import { pathLayersOf } from './path-layers.js';

const TOLERANCE = 0.05;

/**
 * A stroke for the tests.
 *
 * @param fields - Fields to change.
 * @returns The stroke.
 */
function stroke(fields: Partial<FreehandObject> = {}): FreehandObject {
  return {
    id: 'ink',
    type: 'freehand',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada',
    createdAt: 0,
    updatedAt: 0,
    tool: 'pencil',
    points: [0, 0, 100, 0],
    stroke: { color: 'ink', width: 10 },
    ...fields,
  } as FreehandObject;
}

/**
 * The stroke's mesh for its own shape at the test tolerance.
 *
 * @param object - The stroke.
 * @returns The mesh.
 */
function meshOf(object: FreehandObject): ReturnType<typeof buildFreehandMesh> {
  return buildFreehandMesh({
    ...freehandMeshShapeOf(object),
    strokeWidth: object.stroke.width,
    tolerance: TOLERANCE,
  });
}

/**
 * The y extent of a mesh's stroke vertices whose x lies within a band.
 *
 * @param vertices - The mesh's vertices.
 * @param from - The band's left edge.
 * @param to - Its right edge.
 * @returns The largest |y| there.
 */
function reachWithin(vertices: Float32Array, from: number, to: number): number {
  let reach = 0;
  for (let index = 12; index + 1 < vertices.length; index += 2) {
    const x = vertices[index] ?? 0;
    if (x >= from && x <= to) reach = Math.max(reach, Math.abs(vertices[index + 1] ?? 0));
  }
  return reach;
}

describe('buildFreehandMesh', () => {
  it('draws a straight pencil stroke round-ended, half its width either side', () => {
    const mesh = meshOf(stroke());
    expect(mesh.fillVertexCount).toBe(0);
    expect(mesh.strokeVertexCount % 3).toBe(0);
    expect(mesh.bounds?.minX).toBeCloseTo(-5, 1);
    expect(mesh.bounds?.maxX).toBeCloseTo(105, 1);
    expect(mesh.bounds?.minY).toBeCloseTo(-5, 1);
    expect(mesh.bounds?.maxY).toBeCloseTo(5, 1);
  });

  it('gives a highlighter flat ends', () => {
    const mesh = meshOf(stroke({ tool: 'highlighter' }));
    expect(mesh.bounds?.minX).toBeCloseTo(0, 5);
    expect(mesh.bounds?.maxX).toBeCloseTo(100, 5);
  });

  it('draws one point as a disc of the width, a highlighter’s too', () => {
    for (const tool of ['pencil', 'highlighter'] as const) {
      const mesh = meshOf(stroke({ tool, points: [3, 4] }));
      expect(mesh.bounds?.minX).toBeCloseTo(-2, 5);
      expect(mesh.bounds?.maxY).toBeCloseTo(9, 5);
    }
  });

  it('narrows a marker where the pressure is low', () => {
    const mesh = meshOf(stroke({ tool: 'marker', pressures: [0, 1] }));
    expect(reachWithin(mesh.vertices, 0, 2)).toBeCloseTo(5 * MARKER_MIN_WIDTH_SHARE, 1);
    expect(reachWithin(mesh.vertices, 98, 100)).toBeCloseTo(5, 1);
  });

  it('keeps a pencil one width whatever pressures it carries', () => {
    const shape = freehandMeshShapeOf(stroke({ pressures: [0, 1] }));
    expect(shape.pressures).toBeUndefined();
  });

  it('joins a bent stroke and draws nothing for no points', () => {
    const bent = meshOf(stroke({ points: [0, 0, 50, 50, 100, 0, 150, 60] }));
    expect(bent.strokeVertexCount).toBeGreaterThan(60);
    expect(meshOf(stroke({ points: [] })).strokeVertexCount).toBe(0);
  });
});

describe('freehandHalfWidth', () => {
  it('follows pressure only for a marker', () => {
    expect(freehandHalfWidth('marker', 10, 0.5)).toBeCloseTo(5 * (0.3 + 0.7 * 0.5));
    expect(freehandHalfWidth('marker', 10, undefined)).toBe(5);
    expect(freehandHalfWidth('pencil', 10, 0)).toBe(5);
  });
});

describe('a freehand stroke in the path pass', () => {
  it('is a drawn object with one stroke layer and its inked box', () => {
    const object = stroke();
    expect(isDrawnPath(object)).toBe(true);
    expect(pathLayersOf(object)).toEqual(['stroke']);
    expect(drawnLocalBounds(object)).toEqual({ minX: -5, minY: -5, maxX: 105, maxY: 5 });
    expect(meshSegmentsOf(object)).toBe(2);
  });

  it('keeps its mesh through a recolour or a move, not through new points, width or ends', () => {
    const object = stroke();
    expect(
      isSameDrawnMesh(object, { ...object, x: 9, stroke: { color: [1, 0, 0, 1], width: 10 } }),
    ).toBe(true);
    expect(isSameFreehandMesh(object, { ...object, points: [0, 0, 90, 0] })).toBe(false);
    expect(isSameFreehandMesh(object, { ...object, stroke: { color: 'ink', width: 4 } })).toBe(
      false,
    );
    expect(isSameFreehandMesh(object, { ...object, tool: 'highlighter' })).toBe(false);
    const marker = stroke({ tool: 'marker', pressures: [0.2, 0.4] });
    expect(isSameFreehandMesh(marker, { ...marker, pressures: [0.2, 0.5] })).toBe(false);
    expect(isSameFreehandMesh(marker, { ...marker, pressures: [0.2, 0.4] })).toBe(true);
    expect(isSameDrawnMesh(object, { ...object, type: 'line' } as never)).toBe(false);
  });

  it('builds its mesh through a mesh job', () => {
    const request = meshJobRequestOf(stroke({ tool: 'highlighter' }), 3, 0);
    expect(request.freehand?.isFlatEnded).toBe(true);
    const response = runMeshJob(request);
    expect(response.version).toBe(3);
    expect(response.strokeVertexCount).toBeGreaterThan(0);
  });
});
