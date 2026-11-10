import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import type { CullRangeChange, InstanceRange } from '../scene/scene-culler.js';
import { Scene } from '../scene/scene.js';

import { SpatialCuller } from './spatial-culler.js';
import { SpatialVisibility } from './spatial-visibility.js';
import { visibleRanges } from './visible-ranges.js';

const BUDGET = 37;
const GAP = 0;
const pending = (culler: SpatialCuller): boolean =>
  (culler as unknown as { hasPendingAdmissions(): boolean }).hasPendingAdmissions();
const view = (x: number, width: number): WorldBounds => ({
  minX: x,
  maxX: x + width,
  minY: -5,
  maxY: 20,
});

function randomFrom(seed: number): () => number {
  let state = seed;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

function slots(ranges: readonly InstanceRange[]): Set<number> {
  const result = new Set<number>();
  for (const { start, count } of ranges)
    for (let slot = start; slot < start + count; slot++) result.add(slot);
  return result;
}

function applyDelta(previous: readonly InstanceRange[], change: CullRangeChange): Set<number> {
  const result = slots(previous);
  for (const slot of slots(change.removed)) result.delete(slot);
  for (const slot of slots(change.added)) result.add(slot);
  return result;
}

function sequence(seed: number, count: number): void {
  const random = randomFrom(seed);
  const document = new FakeSceneDocument();
  const scene = new Scene([FILLED_RECT_PASS]);
  const capped = new SpatialCuller({
    entriesPerFrame: BUDGET,
    paddingFraction: 0,
    maxGapRecords: GAP,
  });
  const reference = new SpatialCuller({ paddingFraction: 0, maxGapRecords: GAP });
  const visibilityFor = vi.spyOn(capped, 'visibilityFor');
  const latest = () => {
    const result = visibilityFor.mock.results.at(-1);
    if (result?.type !== 'return') throw new Error('Cull did not read visibility');
    return result.value;
  };
  for (let i = 0; i < count; i++)
    document.create(shapeObject(`s${String(i)}`, { x: i * 20, width: 10 }));
  const apply = () => {
    const changes = document.takeChanges();
    scene.apply(changes);
    capped.applyChanges(changes);
    reference.applyChanges(changes);
  };
  apply();
  let priorRanges: readonly InstanceRange[] = [];
  let priorChange: CullRangeChange | undefined;
  let priorRevision = 0;
  const checkFrame = (viewport: WorldBounds, desired: ReadonlySet<ObjectId>): number => {
    const ranges = capped.cull(scene, viewport);
    const admitted = latest();
    const published = ranges.get(FILLED_RECT_PASS.name) ?? [];
    expect([priorRevision, priorRevision + 1]).toContain(admitted.revision);
    if (admitted.revision !== priorRevision)
      expect(admitted.entered.length + admitted.left.length).toBeLessThanOrEqual(BUDGET);
    const outstanding =
      [...desired].filter((id) => !admitted.members.has(id)).length +
      [...admitted.members].filter((id) => !desired.has(id)).length;
    expect(pending(capped)).toBe(outstanding > 0);
    expect(ranges).toEqual(
      visibleRanges(
        scene,
        [...admitted.members],
        // A finite budget never draws whole buffers: the ranges are the members'.
        false,
        GAP,
      ),
    );
    const publishedSlots = slots(published);
    for (const id of desired) {
      if (!admitted.members.has(id)) {
        for (const slot of scene.slotsOf(id, FILLED_RECT_PASS.name))
          expect(publishedSlots.has(slot)).toBe(false);
      }
    }
    for (const id of admitted.members) {
      if (!desired.has(id)) expect(admitted.left).not.toContain(id);
    }
    const delta = capped.rangeChangeOf(FILLED_RECT_PASS.name);
    if (delta && priorChange?.source === delta.source && delta.revision !== priorChange.revision)
      expect(applyDelta(priorRanges, delta)).toEqual(publishedSlots);
    priorRanges = published;
    priorChange = delta;
    priorRevision = admitted.revision;
    return outstanding;
  };
  for (let step = 0; step < (count === 5000 ? 30 : 150); step++) {
    const id = `s${String(Math.floor(random() * count))}`;
    if (step % 13 === 0) {
      document.delete(id);
      apply();
      document.create(shapeObject(id, { x: Math.floor(random() * count) * 20, width: 10 }));
    } else if (step % 11 === 0) {
      document.delete(id);
    } else if (document.get(id as ObjectId)) {
      document.update(id, { x: Math.floor(random() * count) * 20 });
    } else {
      document.create(shapeObject(id, { x: Math.floor(random() * count) * 20, width: 10 }));
    }
    apply();
    const viewport =
      step % 17 === 0
        ? view(-100, count * 20 + 200)
        : view(Math.floor(random() * count) * 20, step % 5 === 0 ? 6000 : 1200);
    const desired = new Set(reference.visibilityFor(viewport).members);
    const pendingCount = checkFrame(viewport, desired);
    for (let frame = 0; frame < Math.ceil(pendingCount / BUDGET) + 1; frame++) {
      if (!pending(capped)) break;
      checkFrame(viewport, desired);
    }
    expect(pending(capped)).toBe(false);
    expect(latest().members).toEqual(desired);
  }
}

describe('budgeted spatial admission', () => {
  it('reports pendingCount on the visibility table and drops a reverted candidate', () => {
    const document = new FakeSceneDocument();
    const index = new SpatialCuller().index;
    const visibility = new SpatialVisibility();
    // Entries nearest the viewport's centre (x 50) come first.
    document.create(shapeObject('first', { x: 45, width: 10 }));
    document.create(shapeObject('reverted', { x: 0, width: 10 }));
    index.apply(document.takeChanges());
    const viewport = view(0, 100);
    visibility.update(index, viewport, [], { entriesPerFrame: 1, viewport });
    expect(visibility.pendingCount).toBe(1);
    document.update('reverted', { x: 500 });
    index.apply(document.takeChanges());
    visibility.update(index, viewport, ['reverted' as ObjectId], {
      entriesPerFrame: 1,
      viewport,
    });
    expect(visibility.pendingCount).toBe(0);
    expect(visibility.toArray()).toEqual(['first']);
  });

  it.each([
    [3, 1000],
    [29, 1000],
    [156, 1000],
    [541, 5000],
  ])(
    'converges with bounded admissions for seed %i at %i objects',
    (seed, count) => {
      sequence(seed, count);
    },
    // Adapted: the per-slot and per-member assertions of every drain frame dominate (about 11 s
    // at 5k on a loaded machine; the admission itself is under 0.1 s).
    60_000,
  );

  it('admits carried candidates, viewport entries, padding entries, then exits', () => {
    const document = new FakeSceneDocument();
    const culler = new SpatialCuller({ entriesPerFrame: 1, paddingFraction: 0.5 });
    for (const [id, x] of [
      // Entries nearest the viewport's centre (x 50) come first.
      ['old', 45],
      ['middle', 25],
      ['padding', 120],
    ] as const)
      document.create(shapeObject(id, { x, width: 10 }));
    culler.applyChanges(document.takeChanges());
    const viewport = view(0, 100);
    expect([...culler.visibilityFor(viewport).members]).toEqual(['old']);
    document.create(shapeObject('new', { x: 70, width: 10 }));
    culler.applyChanges(document.takeChanges());
    expect([...culler.visibilityFor(viewport).members]).toEqual(['old', 'middle']);
    expect([...culler.visibilityFor(viewport).members]).toEqual(['old', 'middle', 'padding']);
    expect([...culler.visibilityFor(viewport).members]).toEqual([
      'old',
      'middle',
      'padding',
      'new',
    ]);
    expect(pending(culler)).toBe(false);
  });

  it('admits entries before exits and carries a leaving member', () => {
    const document = new FakeSceneDocument();
    const culler = new SpatialCuller({ entriesPerFrame: 1, paddingFraction: 0 });
    document.create(shapeObject('leaving', { x: 0, width: 10 }));
    document.create(shapeObject('entering', { x: 100, width: 10 }));
    culler.applyChanges(document.takeChanges());
    culler.visibilityFor(view(0, 20));
    const first = culler.visibilityFor(view(95, 20));
    expect([...first.members]).toEqual(['leaving', 'entering']);
    expect(first.entered).toEqual(['entering']);
    expect(pending(culler)).toBe(true);
    const second = culler.visibilityFor(view(95, 20));
    expect([...second.members]).toEqual(['entering']);
    expect(second.left).toEqual(['leaving']);
  });

  it('drops a carried entry that leaves before admission', () => {
    const document = new FakeSceneDocument();
    const culler = new SpatialCuller({ entriesPerFrame: 1, paddingFraction: 0 });
    // Entries nearest the viewport's centre (x 50) come first.
    document.create(shapeObject('first', { x: 45 }));
    document.create(shapeObject('carried', { x: 0 }));
    culler.applyChanges(document.takeChanges());
    culler.visibilityFor(view(0, 100));
    document.update('carried', { x: 500 });
    culler.applyChanges(document.takeChanges());
    expect(culler.visibilityFor(view(0, 100)).members.has('carried' as ObjectId)).toBe(false);
    expect(pending(culler)).toBe(false);
  });

  it('keeps the default and explicit Infinity identical and validates the cap', () => {
    for (const value of [0, -1, 1.5, Number.NaN, -Infinity])
      expect(() => new SpatialCuller({ entriesPerFrame: value })).toThrow(RangeError);
    const document = new FakeSceneDocument();
    const defaultCuller = new SpatialCuller({ paddingFraction: 0 });
    const infinity = new SpatialCuller({ entriesPerFrame: Infinity, paddingFraction: 0 });
    for (let i = 0; i < 100; i++) document.create(shapeObject(`s${String(i)}`, { x: i * 20 }));
    const changes = document.takeChanges();
    defaultCuller.applyChanges(changes);
    infinity.applyChanges(changes);
    for (const viewport of [view(0, 200), view(-100, 2200), view(500, 200)])
      expect(infinity.visibilityFor(viewport).members).toEqual(
        defaultCuller.visibilityFor(viewport).members,
      );
  });
});
