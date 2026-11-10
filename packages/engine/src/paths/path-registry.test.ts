import { describe, expect, it } from 'vitest';

import type { ObjectId, PathObject } from '@canvas/schema';

import type { SceneChangeSet } from '../scene/scene-source.js';

import { squarePath, zigzagPath } from './__fixtures__/path-scene.js';
import { isSameMeshInput, pathLocalBounds } from './drawn-path.js';
import { PathRegistry, placedBounds } from './path-registry.js';

function changeOf(objects: readonly PathObject[], deleted: readonly string[] = []): SceneChangeSet {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return {
    created: [],
    updated: [...byId.keys()],
    deleted: deleted as ObjectId[],
    get: (id) => byId.get(id),
  };
}

describe('isSameMeshInput', () => {
  const square = squarePath('p', 0);

  it('ignores placement, colours and mirror modes', () => {
    const moved = {
      ...square,
      x: 99,
      fill: [1, 0, 0, 1] as const,
      vertices: square.vertices.map((vertex) => ({ ...vertex, mirror: 'both' as const })),
      segments: square.segments.map((segment) => ({ ...segment })),
    };
    expect(isSameMeshInput(square, { ...moved, fill: [1, 0, 0, 1] })).toBe(true);
  });

  it('sees a changed stroke width, fill flag, vertex or segment', () => {
    const changes: Partial<PathObject>[] = [
      { stroke: { color: [0, 0, 0, 1], width: 3 } },
      { fill: null },
      { vertices: square.vertices.slice(1) },
      {
        vertices: square.vertices.map((vertex, index) =>
          index === 1 ? { ...vertex, y: 1 } : vertex,
        ),
      },
      {
        vertices: square.vertices.map((vertex, index) =>
          index === 1 ? { ...vertex, id: 'x' } : vertex,
        ),
      },
      { segments: square.segments.slice(1) },
      {
        segments: square.segments.map((segment, index) =>
          index === 0 ? { ...segment, ha: { x: 1, y: 0 } } : segment,
        ),
      },
      {
        segments: square.segments.map((segment, index) =>
          index === 0 ? { ...segment, b: 'v3' } : segment,
        ),
      },
    ];
    for (const change of changes)
      expect(isSameMeshInput(square, { ...square, ...change })).toBe(false);
  });
});

describe('pathLocalBounds and placedBounds', () => {
  it('bounds the vertices and handles, grown by half the stroke', () => {
    const arch = zigzagPath('z', 0, {
      segments: zigzagPath('z', 0).segments.map((segment) => ({
        ...segment,
        ha: { x: 0, y: -10 },
      })),
      stroke: { color: [0, 0, 0, 1], width: 4 },
    });
    expect(pathLocalBounds(arch)).toEqual({ minX: -2, minY: -12, maxX: 42, maxY: 22 });
  });

  it('places a box by a rotation and an origin', () => {
    const box = { minX: 0, minY: 0, maxX: 10, maxY: 4 };
    expect(placedBounds(box, 1, 0, 5, 5)).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 9 });
    const turned = placedBounds(box, 0, 1, 0, 0);
    expect(turned.minX).toBeCloseTo(-4);
    expect(turned.maxX).toBeCloseTo(0);
    expect(turned.minY).toBeCloseTo(0);
    expect(turned.maxY).toBeCloseTo(10);
  });
});

describe('PathRegistry', () => {
  it('maps each record slot to its path and layer, and hands slots over within a change set', () => {
    const removed: string[] = [];
    const registry = new PathRegistry('path', (id) => removed.push(id));
    const slots = new Map<string, number[]>([
      ['a', [0, 1]],
      ['b', [2]],
    ]);
    const scene = { slotsOf: (id: string) => slots.get(id) ?? [] };
    registry.observe(changeOf([squarePath('a', 0), zigzagPath('b', 1)]), scene);
    expect(registry.size).toBe(2);
    expect(registry.ownerOf(1)).toMatchObject({ layer: 'stroke', path: { id: 'a' } });
    // 'b' takes slot 0, which 'a' let go when it lost its fill: 'b' is listed first.
    slots.set('a', [1]).set('b', [0, 2]);
    registry.observe(
      changeOf([zigzagPath('b', 1, { fill: [1, 0, 0, 1] }), squarePath('a', 0, { fill: null })]),
      scene,
    );
    expect(registry.ownerOf(0)?.path.id).toBe('b');
    expect(registry.ownerOf(1)?.path.id).toBe('a');
    registry.observe(changeOf([], ['a']), scene);
    expect(removed).toEqual(['a']);
    expect(registry.get('a' as ObjectId)).toBeUndefined();
    expect(registry.ownerOf(1)).toBeUndefined();
  });
});
