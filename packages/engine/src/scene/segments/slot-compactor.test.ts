import { expect, it } from 'vitest';

import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from '../__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject, zKeyAt } from '../__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene-renderer.js';

import {
  NOTE_PASS,
  stickyObject,
  TEXT_PASS,
  textObject,
} from './__fixtures__/note-and-text-passes.js';
import { slotOwnersOf } from './slot-owners.js';
import { ZOrderSegments } from './z-order-segments.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 2000, viewportHeightPx: 100, dpr: 1 };
const COUNT = 60;
const BUDGET = 8;

it('moves at most recordsPerFrame records a frame, each record once, ending in paint order', () => {
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    passes: [FILLED_RECT_PASS],
    isZOrdered: false,
  });
  const stage = new ZOrderSegments({ compaction: { ratio: 1, recordsPerFrame: BUDGET } });
  stage.install(renderer.frame);
  const document = new FakeSceneDocument();
  // Created in reverse paint order, in batches too small to be sorted: the low slots are taken,
  // so the job appends.
  for (let start = 0; start < COUNT; start += 10) {
    for (let index = start; index < start + 10; index += 1) {
      const rank = COUNT - 1 - index;
      document.create(shapeObject(`s${String(rank)}`, { x: rank * 30, z: zKeyAt(rank) }));
    }
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  }
  let before = stage.counts.slotCompactions;
  for (let frame = 0; frame < 4 * COUNT && stage.hasPendingCompaction(); frame += 1) {
    renderer.renderFrame({ timeMs: frame * 16, camera: CAMERA });
    const moved = stage.counts.slotCompactions - before;
    expect(moved).toBeLessThanOrEqual(BUDGET);
    before = stage.counts.slotCompactions;
  }
  expect(stage.hasPendingCompaction()).toBe(false);
  const slots = Array.from({ length: COUNT }, (unused, rank) =>
    renderer.scene.slotsOf(`s${String(rank)}` as never, FILLED_RECT_PASS.name),
  ).flat();
  expect(slots).toEqual([...slots].sort((left, right) => left - right));
  expect(stage.counts.slotCompactions).toBe(COUNT);
});

it('keeps the buffer within twice its records over successive jobs', () => {
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    passes: [FILLED_RECT_PASS],
    isZOrdered: false,
  });
  const stage = new ZOrderSegments({ compaction: { ratio: 1, recordsPerFrame: BUDGET } });
  stage.install(renderer.frame);
  const document = new FakeSceneDocument();
  for (let index = 0; index < COUNT; index += 1)
    document.create(shapeObject(`s${String(index)}`, { x: index * 30, z: zKeyAt(index) }));
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  const buffer = renderer.scene.instanceBufferOf(FILLED_RECT_PASS.name);
  for (let job = 0; job < 5; job += 1) {
    // Reverse the paint order, then let the still frames re-slot it.
    const isReversed = job % 2 === 0;
    for (let index = 0; index < COUNT; index += 1)
      document.update(`s${String(index)}`, { z: zKeyAt(isReversed ? COUNT - 1 - index : index) });
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    for (let frame = 0; frame < 4 * COUNT && stage.hasPendingCompaction(); frame += 1)
      renderer.renderFrame({ timeMs: frame * 16, camera: CAMERA });
    expect(stage.hasPendingCompaction()).toBe(false);
    const ranks = Array.from({ length: COUNT }, (unused, rank) =>
      isReversed ? COUNT - 1 - rank : rank,
    );
    const slots = ranks.flatMap((index) =>
      renderer.scene.slotsOf(`s${String(index)}` as never, FILLED_RECT_PASS.name),
    );
    expect(slots).toEqual([...slots].sort((left, right) => left - right));
    expect(buffer.recordCount).toBeLessThanOrEqual(2 * COUNT);
  }
});

it('rebuilds only the re-slotted pass’s slot owners after a step, equal to a full build', () => {
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    passes: [NOTE_PASS, TEXT_PASS],
    isZOrdered: false,
  });
  const stage = new ZOrderSegments({ compaction: { ratio: 1, recordsPerFrame: BUDGET } });
  stage.install(renderer.frame);
  const document = new FakeSceneDocument();
  // Notes in paint order under every text; texts created in reverse, in batches too small to be
  // sorted, so only the text pass is fragmented.
  for (let start = 0; start < COUNT; start += 10) {
    for (let index = start; index < start + 10; index += 1) {
      const rank = COUNT - 1 - index;
      document.create(
        stickyObject(`n${String(index)}`, { x: index * 30, z: zKeyAt(index) }),
        textObject(`t${String(rank)}`, { x: rank * 30, y: 40, z: zKeyAt(1000 + rank) }),
      );
    }
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  }
  const builds = stage.counts.slotBuilds;
  const notes = stage.tables().slotOwners.find(({ name }) => name === NOTE_PASS.name);
  let steps = 0;
  for (let frame = 0; frame < 4 * COUNT && stage.hasPendingCompaction(); frame += 1) {
    renderer.renderFrame({ timeMs: frame * 16, camera: CAMERA });
    steps += 1;
    const tables = stage.tables();
    const full = slotOwnersOf(renderer.scene, tables.rankById, tables.closingRankById);
    tables.slotOwners.forEach((pass, index) => {
      const count = renderer.scene.instanceBufferOf(pass.name).recordCount;
      expect([...pass.owners.rankOfSlot.subarray(0, count)]).toEqual([
        ...(full[index]?.owners.rankOfSlot ?? []),
      ]);
    });
  }
  expect(steps).toBeGreaterThan(1);
  expect(stage.counts.slotBuilds).toBe(builds);
  // The notes were never re-slotted: their table is the one the last build made.
  expect(stage.tables().slotOwners.find(({ name }) => name === NOTE_PASS.name)).toBe(notes);
});

it('keeps a large pass with a few objects inserted mid-order as a few more ranges', () => {
  const fragmented = (recordsPerExtraRange?: number) => {
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      passes: [TEXT_PASS],
      isZOrdered: false,
    });
    const compaction = recordsPerExtraRange === undefined ? {} : { recordsPerExtraRange };
    const stage = new ZOrderSegments({ compaction });
    stage.install(renderer.frame);
    const document = new FakeSceneDocument();
    // 600 texts in paint order, two records each, in one segment (text does not occlude).
    for (let index = 0; index < 600; index += 1)
      document.create(textObject(`t${String(index)}`, { x: index % 40, z: zKeyAt(2 * index) }));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    // Three texts inserted between others: their slots follow every other's.
    for (const index of [100, 300, 500])
      document.create(textObject(`in${String(index)}`, { x: 1, z: zKeyAt(2 * index + 1) }));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    return stage.hasPendingCompaction();
  };
  // Six extra ranges against 1,206 records: under one per 64, so nothing is re-slotted.
  expect(fragmented()).toBe(false);
  expect(fragmented(1000)).toBe(true);
});
