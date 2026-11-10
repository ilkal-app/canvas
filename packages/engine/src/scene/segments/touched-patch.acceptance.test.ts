import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { SpatialCuller } from '../../spatial/spatial-culler.js';
import { TEXT_LEVEL_OF_DETAIL } from '../../text/scene/text-detail.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, zKeyAt } from '../__fixtures__/scene-objects.js';
import type { DrawListEntry } from '../draw-list.js';
import type { SceneObject, ScenePass } from '../scene-pass.js';
import { SceneRenderer } from '../scene-renderer.js';

import {
  NOTE_PASS,
  stickyObject,
  TEXT_PASS,
  textObject,
} from './__fixtures__/note-and-text-passes.js';
import {
  BOARD_PASSES,
  errorClass,
  orderErrors,
  seededRandom,
  type RandomBoard,
} from './__fixtures__/random-board.js';
import { hiddenTablesOf, plannedPassesOf } from './planned-passes.js';
import { planSegmentDraws, type PlannedPass } from './segment-plan.js';
import { slotOwnersOf } from './slot-owners.js';
import { ZOrderSegments } from './z-order-segments.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 500, dpr: 1 };
const COUNT = 18;

interface Harness {
  readonly renderer: SceneRenderer;
  readonly document: FakeSceneDocument;
  readonly culler: SpatialCuller;
  readonly segments: ZOrderSegments;
  readonly pages: Map<ObjectId, number>;
  readonly targets: Map<ObjectId, SceneObject>;
  readonly ids: ObjectId[];
  before: readonly DrawListEntry[];
  actual: readonly DrawListEntry[];
}

function createHarness(smallIds: readonly string[] = ['item-1', 'item-4', 'item-7']): Harness {
  const pages = new Map<ObjectId, number>();
  const targets = new Map<ObjectId, SceneObject>();
  const textPass: ScenePass = {
    ...TEXT_PASS,
    levelOfDetail: {
      ...TEXT_LEVEL_OF_DETAIL,
      sizeOf: (object) => (smallIds.includes(object.id) ? 16 : 1000),
    },
    pageOf: (target, record) => (record === 0 ? (pages.get(target.object.id) ?? 0) : 0),
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
    ids: [],
    before: [],
    actual: [],
  };
  renderer.frame.insertStage('before', 'zOrderSegments', {
    name: 'captureCullForAcceptance',
    run: (context) => {
      harness.before = [...context.drawList];
    },
  });
  renderer.frame.insertStage('before', 'draw', {
    name: 'capturePlanForAcceptance',
    run: (context) => {
      harness.actual = [...context.drawList];
    },
  });
  for (let rank = 0; rank < COUNT; rank += 1) {
    const id = `item-${String(rank)}` as ObjectId;
    harness.ids.push(id);
    pages.set(id, rank % 3);
    const fields = { z: zKeyAt(rank), x: (rank % 6) * 55, y: Math.floor(rank / 6) * 65 };
    harness.document.create(
      rank % 3 === 2
        ? stickyObject(id, { ...fields, text: 'ab' })
        : textObject(id, { ...fields, text: 'ab' }),
    );
  }
  renderer.enqueue(harness.document.takeChanges());
  return harness;
}

function coverage(entries: readonly DrawListEntry[]): string[] {
  return entries
    .flatMap(({ passName, ranges }) =>
      ranges.flatMap(({ start, count }) =>
        Array.from({ length: count }, (unused, index) => `${passName}:${String(start + index)}`),
      ),
    )
    .sort();
}

function idAt(harness: Harness, rank: number): ObjectId {
  const id = harness.ids[rank];
  if (id === undefined) throw new Error(`Missing rank ${String(rank)}`);
  return id;
}

function errorBoard(harness: Harness, passes: readonly PlannedPass[]): RandomBoard {
  const empty = (name: string): PlannedPass => ({
    name,
    owners: { rankOfSlot: new Int32Array(), recordOfSlot: new Int32Array() },
  });
  const boardPasses = BOARD_PASSES.map((name) => {
    const pass = passes.find((item) => item.name === (name === 'shape' ? 'note' : name));
    return pass ? { ...pass, name } : empty(name);
  });
  return {
    count: harness.ids.length,
    boxes: harness.ids.map((id) => harness.culler.index.boundsOf(id)),
    isTextHidden: harness.ids.map((id) =>
      harness.renderer.scene.levelOfDetail.hiddenIn('text').has(id),
    ),
    input: {
      passes: boardPasses,
      isOccluderByRank: new Uint8Array(harness.ids.length),
      visible: [],
    },
  };
}

function expectCorrectPlan(harness: Harness): void {
  const { scene } = harness.renderer;
  const ranks = new Map(harness.ids.map((id, rank) => [id, rank]));
  const hidden = hiddenTablesOf(scene, harness.ids.length, {
    rankById: ranks,
    closingRankById: new Map(),
  });
  const passes = plannedPassesOf(scene, slotOwnersOf(scene, ranks), hidden);
  const reference = planSegmentDraws({
    passes,
    isOccluderByRank: Uint8Array.from(harness.ids, (unused, rank) => (rank % 3 === 2 ? 1 : 0)),
    visible: harness.before,
    boundsOfRank: (rank) => harness.culler.index.boundsOf(idAt(harness, rank)),
  });
  expect(coverage(harness.actual)).toEqual(coverage(reference.entries));
  const board = errorBoard(harness, passes);
  const actual = harness.actual.map((entry) => ({
    ...entry,
    passName: entry.passName === 'note' ? 'shape' : entry.passName,
  }));
  for (const error of orderErrors(board, actual, board.boxes)) {
    expect(errorClass(board, error), error).not.toBe('unexpected');
  }
}

function frame(harness: Harness, camera: Camera = CAMERA): void {
  harness.renderer.renderFrame({ timeMs: 0, camera });
  expectCorrectPlan(harness);
}

function changePage(harness: Harness, rank: number): void {
  const id = idAt(harness, rank);
  harness.pages.set(id, (harness.pages.get(id) ?? 0) + 1);
  const target = harness.targets.get(id);
  if (target === undefined) throw new Error(`Missing target ${id}`);
  harness.renderer.scene.rewriteRecords('text', [target]);
}

function changeBounds(harness: Harness, rank: number, extra: number): void {
  const id = idAt(harness, rank);
  const base = harness.culler.index.boundsWithoutDrawingOf(id);
  if (base === undefined) throw new Error(`Missing bounds ${id}`);
  harness.culler.setDrawingBounds(id, { ...base, maxX: base.maxX + extra });
}

function expectPatch(
  harness: Harness,
  change: () => void,
  camera: Camera = CAMERA,
  shouldKeepCullCoverage = true,
): void {
  const plans = harness.segments.counts.plans;
  const patches = Number(Reflect.get(harness.segments, 'removalPatches'));
  const beforeCoverage = coverage(harness.before);
  change();
  frame(harness, camera);
  if (shouldKeepCullCoverage) expect(coverage(harness.before)).toEqual(beforeCoverage);
  expect(harness.segments.counts.plans).toBe(plans);
  expect(Number(Reflect.get(harness.segments, 'removalPatches'))).toBeGreaterThan(patches);
}

describe('touched-record segment patches', () => {
  it('keeps coverage and paint order through three seeded 40-frame page, extent, LOD and camera churns', () => {
    for (const seed of [4, 17, 52]) {
      const harness = createHarness();
      const random = seededRandom(seed);
      frame(harness);
      let coverageChanges = 0;
      for (let step = 0; step < 40; step += 1) {
        const previous = coverage(harness.before);
        changePage(harness, Math.floor(random() * COUNT));
        changeBounds(harness, Math.floor(random() * COUNT), 5 + (step % 20));
        const camera = {
          ...CAMERA,
          x: Math.floor(random() * 900),
          y: Math.floor(random() * 400),
          zoom: step % 4 < 2 ? 1 : 0.05,
        };
        frame(harness, camera);
        if (coverage(harness.before).join() !== previous.join()) coverageChanges += 1;
      }
      expect(coverageChanges).toBeGreaterThan(0);
      harness.renderer.destroy();
    }
  });

  it('patches one known drawing-extent change without a full plan', () => {
    const harness = createHarness();
    frame(harness);
    expectPatch(harness, () => {
      changeBounds(harness, 4, 40);
    });
    harness.renderer.destroy();
  });

  it('patches one glyph-page change without a full plan', () => {
    const harness = createHarness();
    frame(harness);
    expectPatch(harness, () => {
      changePage(harness, 4);
    });
    harness.renderer.destroy();
  });

  // Refined after the design review (Claude): hiding lets the segments around merge,
  // which only a full plan does, so text shown again is what patches; hiding plans in full.
  // One text, so the entering records stay under the wide fallback's half of this small board.
  it('patches a hidden text shown again without a full plan', () => {
    const harness = createHarness(['item-1']);
    frame(harness, { ...CAMERA, zoom: 0.05 });
    expect(harness.renderer.scene.levelOfDetail.hiddenIn('text').size).toBe(1);
    expectPatch(harness, () => undefined, CAMERA, false);
    expect(harness.renderer.scene.levelOfDetail.hiddenIn('text').size).toBe(0);
    harness.renderer.destroy();
  });

  it('plans in full when text is hidden, so the segments around it can merge', () => {
    const harness = createHarness();
    frame(harness);
    const plans = harness.segments.counts.plans;
    frame(harness, { ...CAMERA, zoom: 0.05 });
    expect(harness.renderer.scene.levelOfDetail.hiddenIn('text').size).toBe(3);
    expect(harness.segments.counts.plans).toBeGreaterThan(plans);
    harness.renderer.destroy();
  });

  it('still plans in full for order changes and both retained-move boundaries', () => {
    const harness = createHarness();
    frame(harness);
    let plans = harness.segments.counts.plans;
    harness.document.update(idAt(harness, 0), { z: zKeyAt(COUNT + 1) });
    harness.renderer.enqueue(harness.document.takeChanges());
    harness.renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(harness.segments.counts.plans).toBeGreaterThan(plans);
    plans = harness.segments.counts.plans;
    harness.culler.beginRetained([idAt(harness, 1)], new Float64Array([55, 0]));
    harness.renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(harness.segments.counts.plans).toBeGreaterThan(plans);
    plans = harness.segments.counts.plans;
    harness.culler.endRetained();
    harness.renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(harness.segments.counts.plans).toBeGreaterThan(plans);
    harness.renderer.destroy();
  });
});
