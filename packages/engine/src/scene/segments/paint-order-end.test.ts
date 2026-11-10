// The z-order segments' end edits against a fresh stage: seeded frames of objects
// created on top and the topmost removed (a stroke committed, a preview dropped), mixed with
// creations, deletions and restacks anywhere, children of frames and frame outlines (closing ranks).
import { expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { frameObject, shapeObject, zKeyAt } from '../__fixtures__/scene-objects.js';

import { textObject } from './__fixtures__/note-and-text-passes.js';
import { board, currentObjects, draw, freshDraw, install } from './__fixtures__/segment-board.js';
import { compareStacking } from './stacking-order.js';

it('matches a fresh segment stage after 300 seeded edits at and away from the end of the paint order', () => {
  let seed = 0x650;
  const random = (limit: number): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % limit;
  };
  const test = board();
  const ids = new Set<string>();
  const objects: BoardObject[] = [];
  for (let index = 0; index < 40; index += 1) {
    const id = `b${String(index)}`;
    ids.add(id);
    objects.push(
      index % 8 === 0
        ? frameObject(id, { z: zKeyAt(index), stroke: { color: [0, 0, 0, 1], width: 2 } })
        : index % 2 === 0
          ? shapeObject(id, { z: zKeyAt(index) })
          : textObject(id, { z: zKeyAt(index) }),
    );
  }
  install(test, objects);
  let nextId = 0;
  let topZ = 10_000; // Above every restack (at most 4,000): a top creation is on top.
  const roots = (): BoardObject[] =>
    [...ids]
      .flatMap((id) => test.document.get(id as ObjectId) ?? [])
      .filter((object) => object.parentId === null)
      .sort(compareStacking);
  const frames = (): string[] =>
    [...ids].filter((id) => test.document.get(id as ObjectId)?.type === 'frame');
  for (let step = 0; step < 300; step += 1) {
    // Mostly one edit a frame, mostly at the end: both the fast path and the walk are exercised.
    const edits = random(4) === 0 ? 2 : 1;
    for (let edit = 0; edit < edits; edit += 1) {
      const pick = random(12);
      const operation = pick <= 4 ? pick % 2 : pick <= 6 ? 2 : pick - 4;
      const added = `n${String(nextId++)}`;
      if (operation <= 1) {
        // A stroke-like object on top, the common case.
        ids.add(added);
        test.document.create(
          (operation === 0 ? shapeObject : textObject)(added, { z: zKeyAt(topZ++) }),
        );
      } else if (operation === 2) {
        // The topmost root goes (a preview dropped), whatever it is.
        const top = roots().at(-1);
        if (top !== undefined && ids.size > 20) {
          test.document.delete(top.id);
          ids.delete(top.id);
          for (const id of [...ids]) {
            if (test.document.get(id as ObjectId) === undefined) ids.delete(id);
          }
        }
      } else if (operation === 3) {
        ids.add(added);
        test.document.create(textObject(added, { z: zKeyAt(random(2_000)) }));
      } else if (operation === 4 && ids.size > 20) {
        const victim = [...ids][random(ids.size)];
        if (victim !== undefined && test.document.get(victim as ObjectId)?.type !== 'frame') {
          test.document.delete(victim);
          ids.delete(victim);
        }
      } else if (operation === 5) {
        const moved = [...ids][random(ids.size)];
        if (moved !== undefined) test.document.update(moved, { z: zKeyAt(random(4_000)) });
      } else if (operation === 6) {
        const parent = frames()[random(Math.max(1, frames().length))];
        if (parent !== undefined) {
          ids.add(added);
          test.document.create(shapeObject(added, { parentId: parent, z: zKeyAt(topZ++) }));
        }
      } else {
        const frame = frames()[random(Math.max(1, frames().length))];
        const current = frame === undefined ? undefined : test.document.get(frame as ObjectId);
        if (frame !== undefined && current?.type === 'frame') {
          test.document.update(frame, {
            stroke: current.stroke ? undefined : { color: [0, 0, 0, 1], width: 2 },
          });
        }
      }
    }
    test.renderer.enqueue(test.document.takeChanges());
    expect(draw(test), `step ${String(step)}`).toEqual(
      freshDraw(currentObjects(test.document, ids)),
    );
  }
  const walks = test.segments.counts.orderBuilds;
  expect(walks).toBeGreaterThan(30);
  expect(walks).toBeLessThan(200);
});
