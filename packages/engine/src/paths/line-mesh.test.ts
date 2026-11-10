import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { lineObject } from '../spatial/__fixtures__/spatial-objects.js';

import { meshBounds } from './__fixtures__/mesh-coverage.js';
import { capReach } from './caps.js';
import { buildLineMesh, isSameLineMesh, lineLocalBounds, lineMeshShapeOf } from './line-mesh.js';
import { COVER_VERTEX_COUNT } from './path-mesh.js';
import { PathRegistry } from './path-registry.js';

const TOLERANCE = 0.25;

describe('buildLineMesh', () => {
  it('lays out a cover quad then the stroke, with no fill', () => {
    const mesh = buildLineMesh({
      ...lineMeshShapeOf(lineObject('l', { endCap: 'arrow' })),
      strokeWidth: 2,
      tolerance: TOLERANCE,
    });
    expect(mesh.fillVertexCount).toBe(0);
    expect(mesh.strokeVertexCount).toBeGreaterThan(0);
    expect(mesh.vertices.length / 2).toBe(COVER_VERTEX_COUNT + mesh.strokeVertexCount);
  });

  it('stays inside the line’s local bounds for every cap and width', () => {
    for (const width of [1, 8, 64]) {
      for (const cap of ['none', 'arrow', 'triangle', 'circle', 'diamond'] as const) {
        const line = lineObject('l', {
          route: 'elbow',
          points: [
            { x: 0, y: 0 },
            { x: 90, y: 60 },
          ],
          stroke: { color: [0, 0, 0, 1], width },
          startCap: cap,
          endCap: cap,
        });
        const mesh = buildLineMesh({
          ...lineMeshShapeOf(line),
          strokeWidth: width,
          tolerance: TOLERANCE,
        });
        const drawn = meshBounds(mesh.vertices.subarray(COVER_VERTEX_COUNT * 2));
        const box = lineLocalBounds(line);
        expect(drawn.minX).toBeGreaterThanOrEqual(box.minX);
        expect(drawn.minY).toBeGreaterThanOrEqual(box.minY);
        expect(drawn.maxX).toBeLessThanOrEqual(box.maxX);
        expect(drawn.maxY).toBeLessThanOrEqual(box.maxY);
      }
    }
  });
});

describe('lineLocalBounds', () => {
  it('grows the points’ box by the farther cap’s reach', () => {
    const line = lineObject('l', { endCap: 'triangle' });
    const reach = capReach('triangle', 2);
    expect(lineLocalBounds(line)).toEqual({
      minX: -reach,
      minY: -reach,
      maxX: 100 + reach,
      maxY: reach,
    });
  });
});

describe('isSameLineMesh', () => {
  const line = lineObject('l');

  it('ignores placement and colour', () => {
    const moved = { ...line, x: 50, rotation: 1, stroke: { color: [1, 0, 0, 1], width: 2 } };
    expect(isSameLineMesh(line, moved as typeof line)).toBe(true);
  });

  it('changes with the points, route, caps and stroke width', () => {
    const changes = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 1 },
        ] as typeof line.points,
      },
      { route: 'elbow' as const },
      { startCap: 'circle' as const },
      { endCap: 'arrow' as const },
      { stroke: { color: line.stroke.color, width: 3 } },
    ];
    for (const change of changes) expect(isSameLineMesh(line, { ...line, ...change })).toBe(false);
  });
});

describe('PathRegistry with lines', () => {
  it('tracks a line with one stroke record and keeps its mesh version across a move', () => {
    const registry = new PathRegistry('path', () => undefined);
    const scene = { slotsOf: () => [4] };
    const observe = (object: ReturnType<typeof lineObject>) => {
      registry.observe(
        { created: [], updated: [object.id], deleted: [], get: () => object },
        scene,
      );
    };
    const line = lineObject('l', { endCap: 'diamond' });
    observe(line);
    const tracked = registry.get('l' as ObjectId);
    expect(registry.ownerOf(4)).toMatchObject({ layer: 'stroke', path: { id: 'l' } });
    expect(tracked?.localBounds).toEqual(lineLocalBounds(line));
    observe({ ...line, x: 300 });
    expect(registry.get('l' as ObjectId)?.version).toBe(tracked?.version);
    observe({ ...line, endCap: 'none' });
    expect(registry.get('l' as ObjectId)?.version).not.toBe(tracked?.version);
  });
});
