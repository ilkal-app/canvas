import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { SpatialCuller } from '../../spatial/spatial-culler.js';
import { TEXT_LEVEL_OF_DETAIL } from '../../text/scene/text-detail.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, zKeyAt } from '../__fixtures__/scene-objects.js';
import type { DrawListEntry } from '../draw-list.js';
import type { SceneObject, ScenePass } from '../scene-pass.js';
import { SceneRenderer } from '../scene-renderer.js';

import { NOTE_PASS, stickyObject, TEXT_PASS } from './__fixtures__/note-and-text-passes.js';
import {
  BOARD_PASSES,
  orderErrors,
  seededRandom,
  type RandomBoard,
} from './__fixtures__/random-board.js';
import { hiddenTablesOf, plannedPassesOf } from './planned-passes.js';
import { planSegmentDraws, type PlannedPass } from './segment-plan.js';
import { slotOwnersOf } from './slot-owners.js';
import { ZOrderSegments } from './z-order-segments.js';

const COUNT = 1050;
const NEAR: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 10000,
  viewportHeightPx: 5000,
  dpr: 1,
};
const FAR: Camera = { ...NEAR, zoom: 0.1 };

interface Harness {
  readonly renderer: SceneRenderer;
  readonly document: FakeSceneDocument;
  readonly culler: SpatialCuller;
  readonly segments: ZOrderSegments;
  readonly pages: Map<ObjectId, number>;
  readonly targets: Map<ObjectId, SceneObject>;
  readonly sizes: Map<ObjectId, number>;
  readonly ids: ObjectId[];
  before: readonly DrawListEntry[];
  actual: readonly DrawListEntry[];
}

function createHarness(
  sizes = new Map<ObjectId, number>(),
  pages = new Map<ObjectId, number>(),
): Harness {
  const targets = new Map<ObjectId, SceneObject>();
  const textPass: ScenePass = {
    ...TEXT_PASS,
    levelOfDetail: { ...TEXT_LEVEL_OF_DETAIL, sizeOf: (object) => sizes.get(object.id) ?? 1000 },
    pageOf: (target) => pages.get(target.object.id) ?? 0,
    prepare: (record, target, index) => {
      targets.set(target.object.id, target);
      TEXT_PASS.prepare(record, target, index);
    },
  };
  const culler = new SpatialCuller({ maxGapRecords: 0 });
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    passes: [NOTE_PASS, textPass],
    culler,
    isZOrdered: false,
  });
  const segments = new ZOrderSegments({
    spatial: culler.index,
    rangeChangeOf: (name) => culler.rangeChangeOf(name),
    compaction: false,
  });
  segments.install(renderer.frame);
  const harness: Harness = {
    renderer,
    document: new FakeSceneDocument(),
    culler,
    segments,
    pages,
    targets,
    sizes,
    ids: [],
    before: [],
    actual: [],
  };
  renderer.frame.insertStage('before', 'zOrderSegments', {
    name: 'captureCullForHiddenAcceptance',
    run: (context) => {
      harness.before = [...context.drawList];
    },
  });
  renderer.frame.insertStage('before', 'draw', {
    name: 'capturePlanForHiddenAcceptance',
    run: (context) => {
      harness.actual = [...context.drawList];
    },
  });
  for (let rank = 0; rank < COUNT; rank += 1) {
    const id = `note-${String(rank)}` as ObjectId;
    harness.ids.push(id);
    harness.document.create(
      stickyObject(id, {
        z: zKeyAt(rank),
        text: 'ab',
        x: rank < 3 ? rank * 20 : 200 + (rank % 50) * 120,
        y: rank < 3 ? 0 : Math.floor(rank / 50) * 120,
      }),
    );
  }
  renderer.enqueue(harness.document.takeChanges());
  return harness;
}

function frame(harness: Harness, camera: Camera): void {
  harness.renderer.renderFrame({ timeMs: 0, camera });
}

function coverage(entries: readonly DrawListEntry[]): string[] {
  return entries
    .flatMap(({ passName, page, ranges }) =>
      ranges.flatMap(({ start, count }) =>
        Array.from(
          { length: count },
          (unused, index) => `${passName}:${String(page)}:${String(start + index)}`,
        ),
      ),
    )
    .sort();
}

function fresh(harness: Harness, camera: Camera): Harness {
  const reference = createHarness(new Map(harness.sizes), new Map(harness.pages));
  frame(reference, camera);
  return reference;
}

function expectFreshCoverage(harness: Harness, camera: Camera): Harness {
  const reference = fresh(harness, camera);
  expect(coverage(harness.actual)).toEqual(coverage(reference.actual));
  return reference;
}

function oracleEntries(harness: Harness): {
  entries: readonly DrawListEntry[];
  board: RandomBoard;
} {
  const { scene } = harness.renderer;
  const ranks = new Map(harness.ids.map((id, rank) => [id, rank]));
  const hidden = hiddenTablesOf(scene, COUNT, { rankById: ranks, closingRankById: new Map() });
  const passes = plannedPassesOf(scene, slotOwnersOf(scene, ranks), hidden);
  const boxes = harness.ids.map((id) => harness.culler.index.boundsOf(id));
  const entries = planSegmentDraws({
    passes,
    visible: harness.before,
    isOccluderByRank: new Uint8Array(COUNT).fill(1),
    boundsOfRank: (rank) => boxes[rank],
  }).entries;
  const empty = (name: string): PlannedPass => ({
    name,
    owners: {
      rankOfSlot: new Int32Array(),
      recordOfSlot: new Int32Array(),
    },
  });
  const board: RandomBoard = {
    count: COUNT,
    boxes,
    isTextHidden: harness.ids.map((id) => scene.levelOfDetail.hiddenIn('text').has(id)),
    input: {
      passes: BOARD_PASSES.map((name) => {
        const pass = passes.find((item) => item.name === (name === 'shape' ? 'note' : name));
        return pass ? { ...pass, name } : empty(name);
      }),
      visible: [],
      isOccluderByRank: new Uint8Array(COUNT).fill(1),
    },
  };
  return { entries, board };
}

function expectOrder(harness: Harness): void {
  const { entries, board } = oracleEntries(harness);
  expect(coverage(harness.actual)).toEqual(coverage(entries));
  const rename = (list: readonly DrawListEntry[]) =>
    list.map((entry) => ({
      ...entry,
      passName: entry.passName === 'note' ? 'shape' : entry.passName,
    }));
  const allowed = orderErrors(board, rename(entries), board.boxes);
  expect(
    [...orderErrors(board, rename(harness.actual), board.boxes)].filter(
      (error) => !allowed.has(error),
    ),
  ).toEqual([]);
}

function patchCount(harness: Harness): number {
  return harness.segments.removalCounts.patches;
}

function mergesFirstNotes(entries: readonly DrawListEntry[]): boolean {
  return entries.some(
    ({ passName, ranges }) =>
      passName === 'note' && ranges.some(({ start, count }) => start === 0 && count >= 3),
  );
}

function resizeTrackedText(harness: Harness, id: ObjectId, size: number): void {
  const target = harness.targets.get(id);
  if (target?.object.type !== 'sticky') throw new Error('Missing sticky');
  harness.sizes.set(id, size);
  harness.renderer.scene.levelOfDetail.track(1, {
    ...target.object,
    runs: target.object.runs.map((run) => ({
      ...run,
      style: { ...run.style, fontSize: size === 16 ? 15 : size },
    })),
  });
}

it('patches LOD hides and merges adjacent notes as a fresh full plan does', () => {
  const sizes = new Map<ObjectId, number>(
    [0, 1, 2].map((rank) => [`note-${String(rank)}` as ObjectId, 16]),
  );
  const harness = createHarness(sizes);
  frame(harness, NEAR);
  expect(coverage(harness.actual).length).toBeGreaterThan(1024);
  const plans = harness.segments.counts.plans;
  const patches = patchCount(harness);
  frame(harness, FAR);
  expect(harness.renderer.scene.levelOfDetail.hiddenIn('text').size).toBe(3);
  const reference = expectFreshCoverage(harness, FAR);
  expectOrder(harness);
  expect(mergesFirstNotes(reference.actual)).toBe(true);
  expect(mergesFirstNotes(harness.actual)).toBe(true);
  expect(harness.segments.counts.plans).toBe(plans);
  expect(patchCount(harness)).toBeGreaterThan(patches);
  reference.renderer.destroy();
  harness.renderer.destroy();
});

it('patches seeded hides mixed with shows, page changes and moved drawing boxes', () => {
  const sizes = new Map<ObjectId, number>(
    [0, 1, 2].map((rank) => [`note-${String(rank)}` as ObjectId, 16]),
  );
  const harness = createHarness(sizes);
  frame(harness, FAR);
  const random = seededRandom(581);
  for (let step = 0; step < 3; step += 1) {
    for (let index = 0; index < 3; index += 1) {
      const hidden = `note-${String(step * 3 + index)}` as ObjectId;
      const shown = `note-${String((step + 1) * 3 + index)}` as ObjectId;
      resizeTrackedText(harness, hidden, 1000);
      resizeTrackedText(harness, shown, 16);
    }
    const pageRank = 50 + Math.floor(random() * 20);
    const pageId = harness.ids[pageRank];
    if (!pageId) throw new Error('Missing page object');
    harness.pages.set(pageId, step + 1);
    const target = harness.targets.get(pageId);
    if (!target) throw new Error('Missing target');
    harness.renderer.scene.rewriteRecords('text', [target]);
    const moveId = harness.ids[100 + step];
    if (!moveId) throw new Error('Missing move object');
    const base = harness.culler.index.boundsWithoutDrawingOf(moveId);
    if (!base) throw new Error('Missing bounds');
    harness.culler.setDrawingBounds(moveId, { ...base, maxX: base.maxX + 10 + step });
    const plans = harness.segments.counts.plans;
    const patches = patchCount(harness);
    frame(harness, { ...FAR, zoom: 0.1 + step * 0.001 });
    const reference = expectFreshCoverage(harness, { ...FAR, zoom: 0.1 + step * 0.001 });
    expectOrder(harness);
    expect(harness.segments.counts.plans).toBe(plans);
    expect(patchCount(harness)).toBeGreaterThan(patches);
    reference.renderer.destroy();
  }
  harness.renderer.destroy();
});

it('plans in full when one frame hides more than a quarter of drawn records', () => {
  const sizes = new Map<ObjectId, number>(
    Array.from({ length: 450 }, (unused, rank) => [`note-${String(rank)}` as ObjectId, 16]),
  );
  const harness = createHarness(sizes);
  frame(harness, NEAR);
  expect(450 * 2).toBeGreaterThan(coverage(harness.actual).length / 4);
  const plans = harness.segments.counts.plans;
  frame(harness, FAR);
  expect(harness.renderer.scene.levelOfDetail.hiddenIn('text').size).toBe(450);
  expect(harness.segments.counts.plans).toBeGreaterThan(plans);
  const reference = expectFreshCoverage(harness, FAR);
  expectOrder(harness);
  reference.renderer.destroy();
  harness.renderer.destroy();
});
