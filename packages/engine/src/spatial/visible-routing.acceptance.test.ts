import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import type { InstanceRange } from '../scene/scene-culler.js';
import type { ScenePass } from '../scene/scene-pass.js';
import { Scene } from '../scene/scene.js';

import { SpatialCuller } from './spatial-culler.js';

const PASSES: readonly ScenePass[] = [
  {
    ...FILLED_RECT_PASS,
    name: 'small',
    recordCount: (object) => (object.type === 'shape' && object.width < 40 ? 1 : 0),
    levelOfDetail: {
      rule: { kind: 'small', levels: [{ belowPx: 3, form: 'hidden' }] },
      sizeOf: (object) => (object.type === 'shape' ? object.width : 0),
    },
  },
  {
    ...FILLED_RECT_PASS,
    name: 'medium',
    recordCount: (object) => (object.type === 'shape' && object.width >= 40 ? 1 : 0),
    levelOfDetail: {
      rule: { kind: 'medium', levels: [{ belowPx: 3, form: 'hidden' }] },
      sizeOf: (object) => (object.type === 'shape' ? object.width : 0),
    },
  },
  {
    ...FILLED_RECT_PASS,
    name: 'detail',
    recordCount: (object) => (object.type === 'shape' && object.width >= 80 ? 2 : 0),
    levelOfDetail: {
      rule: { kind: 'detail', levels: [{ belowPx: 3, form: 'hidden' }] },
      sizeOf: (object) => (object.type === 'shape' ? object.width : 0),
    },
  },
  {
    ...FILLED_RECT_PASS,
    name: 'lod',
    recordCount: (object) => (object.type === 'shape' && object.width >= 80 ? 1 : 0),
    levelOfDetail: {
      rule: { kind: 'test', levels: [{ belowPx: 3, form: 'hidden' }] },
      sizeOf: (object) => (object.type === 'shape' ? object.width / 10 : 0),
    },
  },
];

function randomFrom(seed: number): () => number {
  let state = seed;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

function view(x: number, width: number): WorldBounds {
  return { minX: x, maxX: x + width, minY: -5, maxY: 30 };
}

function slots(ranges: readonly InstanceRange[]): Set<number> {
  const result = new Set<number>();
  for (const { start, count } of ranges)
    for (let slot = start; slot < start + count; slot++) result.add(slot);
  return result;
}

function culler(rangeCache: 'tables' | 'reference'): SpatialCuller {
  return new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0, rangeCache });
}

function apply(document: FakeSceneDocument, scene: Scene, cullers: readonly SpatialCuller[]): void {
  const changes = document.takeChanges();
  scene.apply(changes);
  for (const item of cullers) item.applyChanges(changes);
}

function compareFrame(
  scene: Scene,
  cullers: readonly SpatialCuller[],
  viewport: WorldBounds,
): void {
  const [tables, reference] = cullers;
  if (!tables || !reference) throw new Error('Both cullers are required');
  const actual = tables.cull(scene, viewport);
  const expected = reference.cull(scene, viewport);
  expect(actual).toEqual(expected);
  for (const { name } of PASSES) {
    const tableChange = tables.rangeChangeOf(name);
    const referenceChange = reference.rangeChangeOf(name);
    expect(tableChange === undefined).toBe(referenceChange === undefined);
    if (tableChange && referenceChange) {
      expect(slots(tableChange.added)).toEqual(slots(referenceChange.added));
      expect(slots(tableChange.removed)).toEqual(slots(referenceChange.removed));
    }
  }
}

function populate(document: FakeSceneDocument, count: number): void {
  for (let index = 0; index < count; index++) {
    const width = [20, 50, 90, 120][index % 4] ?? 20;
    document.create(shapeObject(`s${String(index)}`, { x: index * 20, width }));
  }
}

function editFrame(
  document: FakeSceneDocument,
  random: () => number,
  frame: number,
  count: number,
): void {
  for (let index = 0; index < 12; index++) {
    const id = `s${String(Math.floor(random() * count))}`;
    if (frame % 7 === 0 && index === 0) document.delete(id);
    else if (document.get(id as ObjectId)) {
      document.update(id, {
        x: Math.floor(random() * count) * 20,
        width: [20, 50, 90, 120][Math.floor(random() * 4)],
      });
    } else document.create(shapeObject(id, { x: Math.floor(random() * count) * 20, width: 90 }));
  }
  document.create(
    shapeObject(`new-${String(frame)}`, { x: frame * 100, width: frame % 2 ? 20 : 90 }),
  );
  if (frame > 2) document.delete(`new-${String(frame - 3)}`);
}

function runSequence(seed: number): void {
  const random = randomFrom(seed);
  const scene = new Scene(PASSES);
  const document = new FakeSceneDocument();
  const cullers = [culler('tables'), culler('reference')];
  populate(document, 3_000);
  apply(document, scene, cullers);
  for (let frame = 0; frame < 40; frame++) {
    editFrame(document, random, frame, 3_000);
    apply(document, scene, cullers);
    if (frame === 19)
      expect(
        scene.compactSlots('detail', ['s2999', 's2998', 's2997'] as ObjectId[]),
      ).toBeGreaterThan(0);
    const viewport = view(Math.floor(random() * 2_000) * 20, frame % 3 === 0 ? 30_000 : 10_000);
    const visibility = cullers[0]?.visibilityFor(viewport);
    scene.levelOfDetail.update(visibility, frame % 4 === 0 ? 0.1 : 1, {
      lodTransitions: 0,
      lodThrashes: 0,
    });
    compareFrame(scene, cullers, viewport);
  }
}

describe('visibility routing acceptance', () => {
  it.each([541, 1541])(
    'keeps ranges and per-pass changes equivalent for seed %i over 40 frames',
    (seed) => {
      runSequence(seed);
    },
  );

  it('resolves each touched id once across four passes', () => {
    const scene = new Scene(PASSES);
    const document = new FakeSceneDocument();
    const tables = culler('tables');
    populate(document, 3_000);
    apply(document, scene, [tables]);
    tables.cull(scene, view(0, 10_000));
    const before = new Set(tables.visibleIdsFor(view(0, 10_000)));
    const after = new Set(tables.visibleIdsFor(view(30_000, 10_000)));
    const touched = new Set([...before, ...after]);
    const lookup = vi.spyOn(scene.handles, 'handleOf');
    try {
      tables.cull(scene, view(30_000, 10_000));
      expect(touched.size).toBeGreaterThan(500);
      expect(lookup.mock.calls.length).toBeLessThanOrEqual(touched.size + 4);
    } finally {
      lookup.mockRestore();
    }
  });

  it('checks hidden membership only in passes where a touched id has or had slots', () => {
    const scene = new Scene(PASSES);
    const document = new FakeSceneDocument();
    const tables = culler('tables');
    for (let index = 0; index < 800; index++)
      document.create(shapeObject(`s${String(index)}`, { x: index * 20, width: 20 }));
    apply(document, scene, [tables]);
    tables.cull(scene, view(0, 5_000));
    const spies = PASSES.map(({ name }) => vi.spyOn(scene.levelOfDetail.hiddenIn(name), 'has'));
    try {
      tables.cull(scene, view(8_000, 5_000));
      expect(spies[0]?.mock.calls.length).toBeGreaterThan(100);
      for (const spy of spies.slice(1)) expect(spy.mock.calls.length).toBe(0);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('unmarks a pass in the update that removes its last record', () => {
    const scene = new Scene(PASSES);
    const document = new FakeSceneDocument();
    const tables = culler('tables');
    const reference = culler('reference');
    document.create(shapeObject('target', { x: 10, width: 90 }));
    document.create(shapeObject('outside', { x: 10_000, width: 20 }));
    apply(document, scene, [tables, reference]);
    compareFrame(scene, [tables, reference], view(0, 200));
    expect(tables.cull(scene, view(0, 200)).get('detail')).toEqual([{ start: 0, count: 2 }]);
    document.update('target', { width: 20 });
    apply(document, scene, [tables, reference]);
    compareFrame(scene, [tables, reference], view(0, 200));
    expect(tables.cull(scene, view(0, 200)).has('detail')).toBe(false);
    expect(slots(tables.rangeChangeOf('detail')?.removed ?? [])).toEqual(new Set([0, 1]));
  });
});
