import { describe, expect, it } from 'vitest';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import {
  connectorObject,
  lineObject,
  pathObject,
} from '../spatial/__fixtures__/spatial-objects.js';

import { createPathScene } from './__fixtures__/path-scene.js';
import { CHORD_BUCKET, chordMeshRequestOf, PATH_LEVEL_OF_DETAIL } from './chord-mesh.js';
import { pathLocalBounds } from './drawn-path.js';
import { meshJobRequestOf, runMeshJob } from './mesh-job.js';

/**
 * A 100-unit wave of two curved segments, stroked 2 wide.
 *
 * @param id - Its id.
 * @returns The path.
 */
const wave = (id = 'wave') =>
  pathObject(
    id,
    [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ],
    {
      handles: [
        { x: 10, y: 30 },
        { x: -10, y: 30 },
      ],
      strokeWidth: 2,
    },
  );

describe('PATH_LEVEL_OF_DETAIL', () => {
  it("measures a path's or a line's box by its longer side, and nothing else", () => {
    const path = wave();
    const bounds = pathLocalBounds(path);
    expect(PATH_LEVEL_OF_DETAIL.sizeOf(path)).toBe(bounds.maxX - bounds.minX);
    expect(PATH_LEVEL_OF_DETAIL.sizeOf(lineObject('line'))).toBeGreaterThan(0);
    expect(PATH_LEVEL_OF_DETAIL.sizeOf(shapeObject('shape'))).toBe(0);
  });

  it('measures nothing again on a move or a recolour, and again when the geometry changes', () => {
    const path = wave();
    const isSameSize = PATH_LEVEL_OF_DETAIL.isSameSize;
    if (isSameSize === undefined) throw new Error('the path rule tells same sizes');
    expect(isSameSize(path, structuredClone({ ...path, x: 30, y: 4 }))).toBe(true);
    const wider = structuredClone(path);
    const [vertex] = wider.vertices;
    if (vertex !== undefined) vertex.x -= 50;
    expect(isSameSize(path, wider)).toBe(false);
    const line = lineObject('line');
    expect(isSameSize(line, { ...line, x: 2 })).toBe(true);
    expect(isSameSize(line, { ...line, stroke: { ...line.stroke, width: 9 } })).toBe(false);
    expect(isSameSize(line, path)).toBe(false);
    expect(isSameSize(shapeObject('a'), shapeObject('a'))).toBe(false);
  });
});

describe('chordMeshRequestOf', () => {
  it('straightens every segment and flattens at a quarter pixel of the largest chord scale', () => {
    const path = wave();
    const bounds = pathLocalBounds(path);
    const request = chordMeshRequestOf(path, 3, bounds);
    expect(request.bucket).toBe(CHORD_BUCKET);
    expect(request.version).toBe(3);
    for (const segment of request.network.segments) {
      expect(segment.ha).toEqual({ x: 0, y: 0 });
      expect(segment.hb).toEqual({ x: 0, y: 0 });
    }
    // The chord form is drawn while the box is under 7.2 device px: 0.25 px there.
    expect(request.tolerance).toBeCloseTo((0.25 * (bounds.maxX - bounds.minX)) / 7.2, 9);
    // Two straight pieces and a join: far fewer triangles than the curves at zoom 1.
    const chord = runMeshJob(request);
    const curved = runMeshJob(meshJobRequestOf(path, 3, 0));
    expect(chord.strokeVertexCount).toBeLessThan(curved.strokeVertexCount / 4);
  });
});

describe('chordMeshRequestOf a connector', () => {
  it('keeps its route and heads, at the chord tolerance, as a line does', () => {
    const connector = connectorObject('c');
    const request = chordMeshRequestOf(connector, 3, { minX: 0, minY: 0, maxX: 50, maxY: 50 });
    expect(request.bucket).toBe(CHORD_BUCKET);
    expect(request.network.segments).toEqual([]);
    expect(request.line?.route).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 50 },
    ]);
    expect(request.tolerance).toBeGreaterThan(0);
    expect(PATH_LEVEL_OF_DETAIL.sizeOf(connector)).toBeGreaterThanOrEqual(50);
  });
});

describe('the path pass at a far zoom', () => {
  it('draws a path under 6 device px from one chord mesh across zoom buckets', () => {
    const scene = createPathScene();
    scene.document.create(wave());
    // 100 units: 5 device px at 0.05, 3 px at 0.03, still chords at 0.07 (7 px, inside the band).
    scene.frame({
      x: -100,
      y: -100,
      zoom: 0.05,
      viewportWidthPx: 400,
      viewportHeightPx: 300,
      dpr: 1,
    });
    expect(scene.reports.at(-1)?.meshesBuilt).toBe(1);
    for (const zoom of [0.03, 0.04, 0.07]) {
      scene.frame({ x: -100, y: -100, zoom, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 });
      expect(scene.reports.at(-1)?.meshesBuilt).toBe(0);
    }
    // 7.5 px: its curves again, built for the zoom's bucket.
    scene.frame({
      x: -100,
      y: -100,
      zoom: 0.075,
      viewportWidthPx: 400,
      viewportHeightPx: 300,
      dpr: 1,
    });
    expect(scene.reports.at(-1)?.meshesBuilt).toBe(1);
  });
});
