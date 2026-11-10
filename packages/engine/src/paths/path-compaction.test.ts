import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createPathScene, squarePath, zigzagPath } from './__fixtures__/path-scene.js';

type Scene = ReturnType<typeof createPathScene>;

/**
 * Each drawn path's stroke vertex count, by the id that owns the drawn record's slot now.
 *
 * @param scene - The scene, just drawn.
 * @param ids - The paths.
 * @returns The counts by id; a path drawn twice or not at all shows as a list of its draws.
 */
function strokeVerticesById(scene: Scene, ids: readonly string[]): Record<string, number[]> {
  const idBySlot = new Map(
    ids.map((id) => [scene.renderer.scene.slotsOf(id as ObjectId, 'path')[0], id]),
  );
  const result: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
  for (const { firstInstance, vertexCount } of scene.backend.draws()) {
    const id = idBySlot.get(firstInstance);
    if (id) result[id]?.push(vertexCount);
  }
  return result;
}

// Per path (`isBatched: false`), so each draw names its record slot; opaque and translucent
// strokes, for both stroke sequences.
it.each([1, 0.5])(
  'draws every path with its own mesh after slot compaction (stroke alpha %s)',
  (alpha) => {
    const scene = createPathScene({ isBatched: false, maxMeshSegmentsPerFrame: Infinity });
    const stroke = { color: [0, 0, 0, alpha] as [number, number, number, number], width: 4 };
    const ids = ['a', 'b', 'd'];
    scene.document.create(
      zigzagPath('a', 0, { x: 100, y: 10, stroke }),
      zigzagPath('c', 2, { x: 100, y: 10, stroke }),
      squarePath('d', 3, { x: 100, y: 10, stroke, fill: null }),
    );
    scene.frame();
    scene.document.create(squarePath('b', 1, { x: 160, y: 60, stroke, fill: null }));
    scene.frame();
    scene.document.delete('c');
    scene.backend.resetCalls();
    scene.frame();
    const before = strokeVerticesById(scene, ids);
    expect(Object.values(before).every((counts) => counts.length > 0)).toBe(true);
    // Re-slot without a change set, as the z-order segments' compactor does on still frames.
    expect(scene.renderer.scene.compactSlots('path', ['d', 'b', 'a'] as ObjectId[])).toBe(3);
    scene.backend.resetCalls();
    scene.frame();
    expect(strokeVerticesById(scene, ids)).toEqual(before);
    scene.renderer.destroy();
  },
);
