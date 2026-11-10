import { describe, expect, it } from 'vitest';

import type { StrokeStyle } from '@canvas/schema';

import { connectorLocalBounds, isSameConnectorMesh } from '../connectors/connector-mesh.js';
import {
  connectorObject,
  lineObject,
  pathObject,
} from '../spatial/__fixtures__/spatial-objects.js';
import { worldBoundsOf } from '../spatial/object-world-bounds.js';

import { flattenChainCorners } from './chains.js';
import { isSameDrawnMesh, pathLocalBounds } from './drawn-path.js';
import { isSameLineMesh, lineLocalBounds } from './line-mesh.js';
import { meshJobRequestOf, runMeshJob } from './mesh-job.js';
import {
  isSameStrokeStyle,
  PLAIN_OUTLINE,
  roundJoined,
  strokeOutlineOf,
  strokeOutlineReach,
} from './stroke-outline.js';

// Reading an object's stroke style for its mesh, the mesh cache's key, the payload
// of a mesh job and the bounds a styled stroke draws in.

const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 };

describe('strokeOutlineOf', () => {
  it('reads no style as the plain outline', () => {
    expect(strokeOutlineOf({})).toBe(PLAIN_OUTLINE);
    expect(strokeOutlineOf({ strokeDash: null })).toBe(PLAIN_OUTLINE);
  });

  it('reads every field, the dash offset defaulting to 0', () => {
    expect(
      strokeOutlineOf({
        strokeDash: { pattern: [4, 2] },
        strokeJoin: 'bevel',
        strokeMiterLimit: 6,
        strokeCap: 'square',
      }),
    ).toEqual({
      dash: { pattern: [4, 2], offset: 0 },
      join: 'bevel',
      miterLimit: 6,
      cap: 'square',
    });
  });

  it('reads a value the schema refuses as absent, so the stroke still draws', () => {
    const hostile = {
      strokeDash: { pattern: [Number.NaN] },
      strokeJoin: 'loops',
      strokeMiterLimit: -1,
      strokeCap: 'arrow',
    } as unknown as StrokeStyle;
    expect(strokeOutlineOf(hostile)).toBe(PLAIN_OUTLINE);
  });
});

describe('isSameStrokeStyle', () => {
  it('compares every field, a null dash equal to an absent one', () => {
    expect(isSameStrokeStyle({}, { strokeDash: null })).toBe(true);
    const dash = { strokeDash: { pattern: [4, 2], offset: 1 } };
    expect(isSameStrokeStyle(dash, { strokeDash: { pattern: [4, 2], offset: 1 } })).toBe(true);
    expect(isSameStrokeStyle(dash, { strokeDash: { pattern: [4, 2] } })).toBe(false);
    expect(isSameStrokeStyle(dash, { strokeDash: { pattern: [4, 3], offset: 1 } })).toBe(false);
    expect(isSameStrokeStyle(dash, { strokeDash: { pattern: [4], offset: 1 } })).toBe(false);
    expect(isSameStrokeStyle(dash, {})).toBe(false);
    expect(isSameStrokeStyle({ strokeJoin: 'miter' }, {})).toBe(false);
    expect(isSameStrokeStyle({ strokeMiterLimit: 2 }, {})).toBe(false);
    expect(isSameStrokeStyle({ strokeCap: 'butt' }, {})).toBe(false);
    expect(
      isSameStrokeStyle(
        { strokeDash: { pattern: [1] } },
        { strokeDash: { pattern: [1], offset: 0 } },
      ),
    ).toBe(true);
  });
});

describe('strokeOutlineReach and roundJoined', () => {
  it('reaches half the width, more for square caps and miter joins', () => {
    expect(strokeOutlineReach(4, PLAIN_OUTLINE)).toBe(2);
    expect(strokeOutlineReach(4, { cap: 'square' })).toBeCloseTo(2 * Math.SQRT2);
    expect(strokeOutlineReach(4, { join: 'miter' })).toBe(8);
    expect(strokeOutlineReach(4, { join: 'miter', miterLimit: 10 })).toBe(20);
    expect(strokeOutlineReach(4, { join: 'bevel', miterLimit: 10 })).toBe(2);
  });

  it('drops only the join', () => {
    const outline = { join: 'miter', cap: 'butt', miterLimit: 3 } as const;
    expect(roundJoined(outline)).toEqual({ cap: 'butt', miterLimit: 3 });
    expect(outline).toEqual({ join: 'miter', cap: 'butt', miterLimit: 3 });
    expect(roundJoined(PLAIN_OUTLINE)).toBe(PLAIN_OUTLINE);
  });
});

describe('flattenChainCorners', () => {
  it('flags the chain’s vertices and not the points inside a curve', () => {
    const curve = [
      [
        { x: 0, y: 0 },
        { x: 0, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 0 },
      ],
      [
        { x: 100, y: 0 },
        { x: 120, y: 0 },
        { x: 140, y: 0 },
        { x: 160, y: 0 },
      ],
    ] as const;
    const { points, corners } = flattenChainCorners(curve, 0.5);
    expect(points.length).toBeGreaterThan(4);
    expect(corners).toHaveLength(points.length);
    const flagged = points.filter((unused, index) => corners[index]);
    expect(flagged).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 160, y: 0 },
    ]);
  });
});

describe('the mesh cache key and the mesh job', () => {
  const path = pathObject('p', [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
  ]);

  it('re-meshes when any stroke style field changes, and not otherwise', () => {
    expect(isSameDrawnMesh(path, { ...path })).toBe(true);
    expect(isSameDrawnMesh(path, { ...path, strokeDash: null })).toBe(true);
    const styles: StrokeStyle[] = [
      { strokeDash: { pattern: [4, 2] } },
      { strokeJoin: 'miter' },
      { strokeMiterLimit: 9 },
      { strokeCap: 'butt' },
    ];
    for (const style of styles) {
      expect(isSameDrawnMesh(path, { ...path, ...style })).toBe(false);
    }
    const line = lineObject('l');
    expect(isSameLineMesh(line, { ...line, strokeCap: 'square' })).toBe(false);
    expect(isSameLineMesh(line, { ...line })).toBe(true);
    const connector = connectorObject('c');
    expect(isSameConnectorMesh(connector, { ...connector, strokeJoin: 'bevel' })).toBe(false);
    expect(isSameConnectorMesh(connector, { ...connector })).toBe(true);
  });

  it('carries the outline in the job, and none for an unstyled stroke', () => {
    expect(meshJobRequestOf(path, 1, 0)).not.toHaveProperty('outline');
    expect(meshJobRequestOf(lineObject('l'), 1, 0)).not.toHaveProperty('outline');
    const dashed = { ...path, strokeDash: { pattern: [5, 5] }, strokeCap: 'butt' as const };
    const request = meshJobRequestOf(dashed, 1, 0);
    expect(request.outline).toEqual({ dash: { pattern: [5, 5], offset: 0 }, cap: 'butt' });
    // A structured clone (a worker's copy) builds the same mesh.
    const cloned = structuredClone(request);
    expect(runMeshJob(cloned).vertices).toEqual(runMeshJob(request).vertices);
    expect(runMeshJob(request).strokeVertexCount).not.toBe(
      runMeshJob(meshJobRequestOf(path, 1, 0)).strokeVertexCount,
    );
    const line = { ...lineObject('l'), strokeDash: { pattern: [10, 10] } };
    const lineRequest = meshJobRequestOf(line, 1, 0);
    expect(lineRequest.outline).toEqual({ dash: { pattern: [10, 10], offset: 0 } });
    expect(runMeshJob(lineRequest).bounds?.maxX).toBeCloseTo(91, 0);
  });

  it('grows the bounds by a miter’s reach and a square cap’s corners', () => {
    expect(pathLocalBounds(path)).toEqual({ minX: -1, minY: -1, maxX: 41, maxY: 41 });
    const mitred = { ...path, strokeJoin: 'miter' as const, strokeMiterLimit: 10 };
    expect(pathLocalBounds(mitred)).toEqual({ minX: -10, minY: -10, maxX: 50, maxY: 50 });
    expect(worldBoundsOf(mitred, IDENTITY)?.maxX).toBeGreaterThanOrEqual(50);
    expect(worldBoundsOf(path, IDENTITY)?.maxX).toBe(44);
    const line = lineObject('l', { strokeJoin: 'miter', strokeMiterLimit: 20 });
    expect(lineLocalBounds(line).maxX).toBe(120);
    expect(lineLocalBounds(lineObject('l')).maxX).toBe(102);
    const connector = {
      ...connectorObject('c'),
      strokeJoin: 'miter' as const,
      strokeMiterLimit: 30,
    };
    expect(connectorLocalBounds(connector).maxX).toBe(80);
  });
});
