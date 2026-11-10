import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import type { CullRangeChange, InstanceRange } from '../scene/scene-culler.js';
import type { ScenePass } from '../scene/scene-pass.js';
import { Scene } from '../scene/scene.js';

import { SpatialCuller } from './spatial-culler.js';
import { visibleRanges } from './visible-ranges.js';
import { VisibleSlotPass } from './visible-slot-pass.js';

const GAP = 2;
const PASSES: readonly ScenePass[] = [
  FILLED_RECT_PASS,
  {
    ...FILLED_RECT_PASS,
    name: 'multi-record',
    recordCount: (object) => (object.type === 'shape' ? Math.floor(object.width / 10) : 0),
  },
];
const view = (minX: number, width: number): WorldBounds => ({
  minX,
  maxX: minX + width,
  minY: -5,
  maxY: 20,
});

function randomFrom(seed: number): () => number {
  let state = seed;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

function drawnSlots(ranges: readonly InstanceRange[]): Set<number> {
  const slots = new Set<number>();
  for (const { start, count } of ranges)
    for (let slot = start; slot < start + count; slot++) slots.add(slot);
  return slots;
}

function applyChange(previous: readonly InstanceRange[], change: CullRangeChange): Set<number> {
  const slots = drawnSlots(previous);
  for (const slot of drawnSlots(change.removed)) slots.delete(slot);
  for (const slot of drawnSlots(change.added)) slots.add(slot);
  return slots;
}

interface Previous {
  ranges: ReadonlyMap<string, readonly InstanceRange[]>;
  changes: Map<string, CullRangeChange | undefined>;
}

function checkFrame(
  scene: Scene,
  cullers: readonly SpatialCuller[],
  viewport: WorldBounds,
  previous: Previous[],
): void {
  const primary = cullers[0];
  if (!primary) throw new Error('Missing primary culler');
  const visibility = primary.visibilityFor(viewport);
  const reference = visibleRanges(
    scene,
    [...visibility.members],
    visibility.members.size === primary.index.size,
    GAP,
  );
  cullers.forEach((culler, cullerIndex) => {
    const ranges = culler.cull(scene, viewport);
    expect(ranges).toEqual(reference);
    const old = previous[cullerIndex];
    if (!old) throw new Error('Missing previous frame');
    const changes = new Map<string, CullRangeChange | undefined>();
    for (const { name } of PASSES) {
      const change = culler.rangeChangeOf(name);
      changes.set(name, change);
      if (visibility.members.size === culler.index.size) expect(change).toBeUndefined();
      if (change) {
        const prior = old.changes.get(name);
        if (prior?.source === change.source) {
          if (prior.revision === change.revision) {
            expect(ranges.get(name) ?? []).toEqual(old.ranges.get(name) ?? []);
          } else {
            expect(change.previousRevision).toBe(prior.revision);
            expect(change.revision).toBe(prior.revision + 1);
            expect(applyChange(old.ranges.get(name) ?? [], change)).toEqual(
              drawnSlots(ranges.get(name) ?? []),
            );
          }
        }
      }
    }
    previous[cullerIndex] = { ranges, changes };
  });
}

function makeCuller(rangeCache: 'tables' | 'reference'): SpatialCuller {
  const options = { paddingFraction: 0, maxGapRecords: GAP, rangeCache };
  return new SpatialCuller(options);
}

function runSequence(seed: number, objectCount: number): void {
  const random = randomFrom(seed);
  let scene = new Scene(PASSES);
  let document = new FakeSceneDocument();
  let cullers = [makeCuller('tables'), makeCuller('reference')];
  let previous: Previous[] = cullers.map(() => ({ ranges: new Map(), changes: new Map() }));
  for (let index = 0; index < objectCount; index++)
    document.create(
      shapeObject(`s${String(index)}`, { x: index * 20, width: 10 * (1 + (index % 4)) }),
    );
  const apply = () => {
    const changes = document.takeChanges();
    scene.apply(changes);
    cullers.forEach((culler) => {
      culler.applyChanges(changes);
    });
  };
  apply();
  for (let step = 0; step < 200; step++) {
    if (step === 100) {
      scene = new Scene(PASSES);
      document = new FakeSceneDocument();
      cullers = [makeCuller('tables'), makeCuller('reference')];
      previous = cullers.map(() => ({ ranges: new Map(), changes: new Map() }));
      for (let index = 0; index < objectCount; index++)
        document.create(
          shapeObject(`s${String(index)}`, { x: index * 20, width: 10 * (1 + (index % 4)) }),
        );
    } else {
      const id = `s${String(Math.floor(random() * objectCount))}`;
      if (step % 13 === 0) {
        document.delete(id);
        apply();
        document.create(shapeObject(id, { x: Math.floor(random() * objectCount) * 20, width: 30 }));
      } else if (step % 11 === 0) {
        document.delete(id);
      } else if (document.get(id as ObjectId)) {
        document.update(id, {
          x: Math.floor(random() * objectCount) * 20,
          width: 10 * (1 + Math.floor(random() * 4)),
        });
      } else {
        document.create(shapeObject(id, { x: Math.floor(random() * objectCount) * 20, width: 20 }));
      }
    }
    apply();
    const viewport =
      step % 17 === 0
        ? view(-100, objectCount * 20 + 200)
        : view(Math.floor(random() * objectCount) * 20, step % 5 === 0 ? 6000 : 1200);
    checkFrame(scene, cullers, viewport, previous);
  }
}

describe('visible handle table acceptance', () => {
  it.each([
    [3, 1000],
    [29, 1000],
    [156, 1000],
    [523, 5000],
  ])('matches reference ranges and bounded deltas for seed %i at %i objects', (seed, count) => {
    runSequence(seed, count);
  });

  it('avoids string-keyed scene slot lookups during large partial-view churn', () => {
    const scene = new Scene([FILLED_RECT_PASS]);
    const document = new FakeSceneDocument();
    const culler = new SpatialCuller({
      paddingFraction: 0,
      rangeCache: 'tables',
    });
    for (let index = 0; index < 50_000; index++)
      document.create(shapeObject(`s${String(index)}`, { x: index * 20 }));
    const changes = document.takeChanges();
    scene.apply(changes);
    culler.applyChanges(changes);
    culler.cull(scene, view(0, 200_000));
    const slots = vi.spyOn(scene, 'slotsOf');
    const revisions = vi.spyOn(scene, 'slotRevisionOf');
    try {
      culler.cull(scene, view(100_000, 200_000));
      expect(slots.mock.calls.length).toBe(0);
      expect(revisions.mock.calls.length).toBe(0);
    } finally {
      slots.mockRestore();
      revisions.mockRestore();
    }
  });

  it('defaults to table lookups in a partial view', () => {
    const scene = new Scene([FILLED_RECT_PASS]);
    const document = new FakeSceneDocument();
    const culler = new SpatialCuller({ paddingFraction: 0 });
    for (let index = 0; index < 100; index++)
      document.create(shapeObject(`s${String(index)}`, { x: index * 20 }));
    const changes = document.takeChanges();
    scene.apply(changes);
    culler.applyChanges(changes);
    culler.cull(scene, view(0, 400));
    const slots = vi.spyOn(scene, 'slotsOf');
    try {
      culler.cull(scene, view(600, 400));
      expect(slots.mock.calls.length).toBe(0);
    } finally {
      slots.mockRestore();
    }
  });

  it('drops partial passes on all-visible entry and rebuilds on exit', () => {
    const scene = new Scene([FILLED_RECT_PASS]);
    const document = new FakeSceneDocument();
    const culler = new SpatialCuller({
      paddingFraction: 0,
      rangeCache: 'tables',
    });
    for (let index = 0; index < 5000; index++)
      document.create(shapeObject(`s${String(index)}`, { x: index * 20 }));
    const changes = document.takeChanges();
    scene.apply(changes);
    culler.applyChanges(changes);
    culler.cull(scene, view(1000, 50_000));
    const updates = vi.spyOn(VisibleSlotPass.prototype, 'update');
    // Adapted: the handle API is `scene.handles` (SceneHandles).
    const handles = vi.spyOn(scene.handles, 'slotsOf');
    try {
      expect(culler.cull(scene, view(-100, 100_200))).toEqual(visibleRanges(scene, [], true, 16));
      expect(handles.mock.calls.length).toBe(0);
      expect(updates.mock.calls.length).toBe(0);
      expect(culler.rangeChangeOf('solid-rect')).toBeUndefined();
      culler.cull(scene, view(1000, 50_000));
      expect(handles).toHaveBeenCalled();
      expect(culler.rangeChangeOf('solid-rect')).toBeDefined();
    } finally {
      handles.mockRestore();
      updates.mockRestore();
    }
  });
});
