import { describe, expect, it, vi } from 'vitest';

import type { WorldBounds } from '../camera/camera.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import type { ScenePass } from '../scene/scene-pass.js';
import { Scene } from '../scene/scene.js';

import { BridgedSlots } from './bridged-slots.js';
import { SpatialCuller } from './spatial-culler.js';
import { visibleRanges } from './visible-ranges.js';

/**
 * Creates a mutable scene mirrored by a culler.
 *
 * @param pass - The pass.
 * @param gap - Maximum bridged gap.
 * @param rangeCache - The range cache strategy.
 * @returns The fixture and its shared change application.
 */
function fixture(
  pass: ScenePass = FILLED_RECT_PASS,
  gap = 16,
  rangeCache: 'tables' | 'reference' = 'reference',
) {
  const scene = new Scene([pass]);
  const document = new FakeSceneDocument();
  const options = { paddingFraction: 0, maxGapRecords: gap, rangeCache };
  const culler = new SpatialCuller(options);
  const apply = () => {
    const changes = document.takeChanges();
    scene.apply(changes);
    culler.applyChanges(changes);
  };
  return { scene, document, culler, apply };
}

/**
 * A view spanning the row of test shapes.
 *
 * @param minX - Left edge.
 * @param maxX - Right edge.
 * @returns The query viewport.
 */
function view(minX: number, maxX: number): WorldBounds {
  return { minX, maxX, minY: -5, maxY: 20 };
}

describe('incremental culler slot ranges', () => {
  it('reads only changed object slots when ten IDs enter and leave a 50k board', () => {
    const { scene, document, culler, apply } = fixture();
    for (let index = 0; index < 50_000; index += 1) {
      document.create(shapeObject(`s${String(index)}`, { x: index * 100 }));
    }
    apply();
    culler.cull(scene, view(-5, 4_998_905));
    const slots = vi.spyOn(scene, 'slotsOf');
    const ranges = culler.cull(scene, view(995, 4_999_905));
    expect(ranges.get('solid-rect')).toEqual([{ start: 10, count: 49_990 }]);
    expect(slots.mock.calls.length).toBeLessThanOrEqual(40);
  });

  it('reference retains partial-view slot caches through whole-board coverage', () => {
    const { scene, document, culler, apply } = fixture();
    for (let index = 0; index < 5000; index += 1) {
      document.create(shapeObject(`s${String(index)}`, { x: index * 100 }));
    }
    apply();
    culler.cull(scene, view(95, 500_100));
    culler.cull(scene, view(-5, 500_000));
    expect(culler.rangeChangeOf('solid-rect')).toBeUndefined();
    const slots = vi.spyOn(scene, 'slotsOf');
    try {
      const ranges = culler.cull(scene, view(95, 500_100));
      expect(ranges.get('solid-rect')).toEqual([{ start: 1, count: 4999 }]);
      expect(slots.mock.calls.length).toBeLessThanOrEqual(2);
      expect(culler.rangeChangeOf('solid-rect')).toBeDefined();
    } finally {
      slots.mockRestore();
    }
  });

  it('keeps initial whole-board coverage free of per-object slot-cache construction', () => {
    const { scene, document, culler, apply } = fixture();
    document.create(shapeObject('a'), shapeObject('b', { x: 100 }));
    apply();
    const slots = vi.spyOn(scene, 'slotsOf');
    try {
      culler.cull(scene, view(-1000, 1000));
      expect(slots).not.toHaveBeenCalled();
    } finally {
      slots.mockRestore();
    }
  });

  it('patches contiguous records of entering and departing objects as runs', () => {
    const pass: ScenePass = { ...FILLED_RECT_PASS, recordCount: () => 100 };
    const { scene, document, culler, apply } = fixture(pass, 0);
    for (let index = 0; index < 20; index += 1) {
      document.create(shapeObject(`s${String(index)}`, { x: index * 100 }));
    }
    apply();
    culler.cull(scene, view(-5, 1005));
    const one = vi.spyOn(BridgedSlots.prototype, 'set');
    const run = vi.spyOn(BridgedSlots.prototype, 'setRange');
    try {
      const ranges = culler.cull(scene, view(195, 1205));
      expect(ranges.get('solid-rect')).toEqual([{ start: 200, count: 1100 }]);
      expect(one).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledTimes(4);
    } finally {
      one.mockRestore();
      run.mockRestore();
    }
  });

  it.each([0, 16])(
    'matches the full reference across slot reuse, record counts and LOD with gap %i',
    (gap) => {
      const pass: ScenePass = {
        ...FILLED_RECT_PASS,
        recordCount: (object) => (object.type === 'shape' ? Math.ceil(object.width / 10) : 0),
        levelOfDetail: {
          rule: { kind: 'test', levels: [{ belowPx: 3, form: 'hidden' }], hysteresis: 0.2 },
          sizeOf: (object) => (object.type === 'shape' ? object.width : 0),
        },
      };
      const { scene, document, culler, apply } = fixture(pass, gap);
      for (let index = 0; index < 80; index += 1) {
        document.create(shapeObject(`s${String(index)}`, { x: index * 100 }));
      }
      apply();
      let seed = 156;
      const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
      for (let step = 0; step < 150; step += 1) {
        const id = `s${String(step % 80)}`;
        document.update(id, { x: random() * 8000, width: 1 + Math.floor(random() * 40) });
        if (step % 5 === 0) {
          document.delete('temporary');
          document.create(shapeObject('temporary', { x: random() * 8000 }));
        }
        apply();
        const minX = random() * 6000;
        const viewport = step % 9 === 0 ? view(-100, 9000) : view(minX, minX + 1200);
        const visibility = culler.visibilityFor(viewport);
        const scale = step % 4 === 0 ? 0.05 : 1;
        scene.levelOfDetail.update(visibility, scale, { lodTransitions: 0, lodThrashes: 0 });
        // Occasionally skip a cull between LOD updates; the next cull must recover safely.
        if (step % 7 === 0) {
          scene.levelOfDetail.update(visibility, 0.1, { lodTransitions: 0, lodThrashes: 0 });
        }
        const ranges = culler.cull(scene, viewport);
        expect(ranges).toEqual(
          visibleRanges(
            scene,
            [...visibility.members],
            visibility.members.size === culler.index.size,
            gap,
          ),
        );
      }
    },
  );
  it('retains whole-board coverage identity after a geometry-only object change', () => {
    const { scene, document, culler, apply } = fixture();
    document.create(shapeObject('a'), shapeObject('b', { x: 100 }));
    apply();
    const viewport = view(-1000, 1000);
    const before = culler.cull(scene, viewport);
    document.update('a', { x: 20 });
    apply();
    expect(culler.cull(scene, viewport)).toBe(before);
  });
});
