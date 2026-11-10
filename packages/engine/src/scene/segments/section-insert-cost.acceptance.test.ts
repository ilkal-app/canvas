// Written before the code. CONTRACT: a leaf made or removed within a 5,000-child section touches only edited ranks and slots.
import { expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from '../__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
  zKeyAt,
} from '../__fixtures__/scene-objects.js';
import type { ScenePass } from '../scene-pass.js';
import { SceneRenderer } from '../scene-renderer.js';

import { ZOrderSegments } from './z-order-segments.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

function stage(
  objects: readonly BoardObject[],
  checks: { count: number },
): { document: FakeSceneDocument; renderer: SceneRenderer; segments: ZOrderSegments } {
  const pass: ScenePass = {
    ...FILLED_RECT_PASS,
    isOccluder: (object) => {
      checks.count += 1;
      return FILLED_RECT_PASS.isOccluder?.(object) === true;
    },
  };
  const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [pass], isZOrdered: false });
  const segments = new ZOrderSegments();
  segments.install(renderer.frame);
  const document = new FakeSceneDocument();
  document.create(...objects);
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  return { document, renderer, segments };
}

let captureIndex = 0;

function drawOrder(renderer: SceneRenderer): ObjectId[] {
  const drawn: ObjectId[] = [];
  renderer.frame.insertStage('after', 'zOrderSegments', {
    name: `captureSectionDraw${String(captureIndex++)}`,
    run: ({ drawList }) => {
      const slots = new Map<number, ObjectId>();
      for (const [id, owned] of renderer.scene.slotEntriesOf(FILLED_RECT_PASS.name)) {
        for (const slot of owned) slots.set(slot, id);
      }
      drawn.length = 0;
      for (const entry of drawList)
        for (const range of entry.ranges) {
          for (let slot = range.start; slot < range.start + range.count; slot += 1) {
            const id = slots.get(slot);
            if (id !== undefined) drawn.push(id);
          }
        }
    },
  });
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  return drawn;
}

it('inserts at the top of a non-topmost section, removes a middle child, and commits a root preview into it', () => {
  const objects: BoardObject[] = [frameObject('section', { z: zKeyAt(1) })];
  for (let index = 0; index < 5_000; index += 1)
    objects.push(
      shapeObject(`child-${String(index)}`, {
        parentId: 'section',
        z: zKeyAt(index),
        x: index % 800,
        y: Math.floor(index / 800) * 12,
      }),
    );
  for (let index = 0; index < 4_999; index += 1)
    objects.push(
      shapeObject(`root-${String(index)}`, {
        z: zKeyAt(index + 2),
        x: index % 800,
        y: Math.floor(index / 800) * 12,
      }),
    );
  const checks = { count: 0 };
  const test = stage(objects, checks);
  const ids = new Set(objects.map(({ id }) => id));
  const edits = [
    () => {
      test.document.create(shapeObject('inserted', { parentId: 'section', z: zKeyAt(6_000) }));
      ids.add('inserted' as ObjectId);
    },
    () => {
      test.document.delete('child-2500');
      ids.delete('child-2500' as ObjectId);
    },
    () => {
      test.document.create(shapeObject('preview', { z: '~' }));
      test.renderer.enqueue(test.document.takeChanges());
      test.renderer.renderFrame({ timeMs: 0, camera: CAMERA });
      ids.add('preview' as ObjectId);
      test.document.delete('preview');
      test.document.create(shapeObject('preview', { parentId: 'section', z: zKeyAt(6_001) }));
    },
  ];
  for (const [index, edit] of edits.entries()) {
    edit();
    const before = { ...test.segments.counts };
    checks.count = 0;
    test.renderer.enqueue(test.document.takeChanges());
    test.renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const label = `edit ${String(index)}`;
    expect(test.segments.counts.orderBuilds, label).toBe(before.orderBuilds);
    expect(test.segments.counts.slotBuilds, label).toBe(before.slotBuilds);
    expect((test.segments.counts as typeof before & { orderEdits: number }).orderEdits, label).toBe(
      (before as typeof before & { orderEdits: number }).orderEdits + 1,
    );
    expect(checks.count, label).toBeLessThan(10);
    const current = [...ids].flatMap((id) => test.document.get(id) ?? []);
    const fresh = stage(current, { count: 0 });
    expect(drawOrder(test.renderer), label).toEqual(drawOrder(fresh.renderer));
  }
});
