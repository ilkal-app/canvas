import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { TEXT_LOD_RULE } from '../../lod/lod-thresholds.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from '../__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject, zKeyAt } from '../__fixtures__/scene-objects.js';
import type { DrawListEntry } from '../draw-list.js';
import type { CullRangeChange, InstanceRange, SceneCuller } from '../scene-culler.js';
import type { SceneObject, ScenePass } from '../scene-pass.js';
import { SceneRenderer } from '../scene-renderer.js';

import { NOTE_PASS, TEXT_PASS, stickyObject } from './__fixtures__/note-and-text-passes.js';
import { planSegmentDraws } from './segment-plan.js';
import { slotOwnersOf } from './slot-owners.js';
import { ZOrderSegments } from './z-order-segments.js';

class DeltaCuller implements SceneCuller {
  readonly visible = new Map<string, readonly InstanceRange[]>();
  readonly changes = new Map<string, CullRangeChange>();

  cull(): ReadonlyMap<string, readonly InstanceRange[]> {
    return this.visible;
  }

  rangeChangeOf(name: string): CullRangeChange | undefined {
    return this.changes.get(name);
  }

  set(name: string, ranges: readonly InstanceRange[], removed: readonly InstanceRange[]): void {
    const previous = this.changes.get(name);
    this.visible.set(name, ranges);
    this.changes.set(name, {
      source: previous?.source ?? {},
      revision: (previous?.revision ?? 0) + 1,
      previousRevision: previous?.revision ?? 0,
      added: previous ? [] : ranges,
      removed,
    });
  }
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

describe('removal-only segment planning', () => {
  it.each([false, true])(
    'patches removals and retains multi-record ranks (paged: %s)',
    (isPaged) => {
      const culler = new DeltaCuller();
      const pass: ScenePass = {
        ...FILLED_RECT_PASS,
        name: 'shape',
        recordCount: () => 2,
        ...(isPaged
          ? {
              pageOf: (unusedTarget: SceneObject, record: number) => record,
              isPaintOrderedAcrossPages: true,
            }
          : {}),
      };
      const renderer = new SceneRenderer(new FakeGpuBackend(), {
        passes: [pass],
        culler,
        isZOrdered: false,
      });
      const segments = new ZOrderSegments({ rangeChangeOf: (name) => culler.rangeChangeOf(name) });
      segments.install(renderer.frame);
      const document = new FakeSceneDocument();
      const ids: ObjectId[] = [];
      for (let index = 0; index < 1000; index += 1) {
        const object = shapeObject(`s${String(index)}`, { z: zKeyAt(index) });
        ids.push(object.id);
        document.create(object);
      }
      renderer.enqueue(document.takeChanges());
      let actual: readonly DrawListEntry[] = [];
      renderer.frame.insertStage('before', 'draw', {
        name: 'captureRemovalPlan',
        run: (context) => {
          actual = [...context.drawList];
        },
      });
      const frame = (): void => {
        renderer.renderFrame({
          timeMs: 0,
          camera: {
            x: 0,
            y: 0,
            zoom: 1,
            dpr: 1,
            viewportWidthPx: 200,
            viewportHeightPx: 100,
          },
        });
        const reference = planSegmentDraws({
          passes: slotOwnersOf(renderer.scene, new Map(ids.map((id, rank) => [id, rank]))).map(
            (owned) => ({
              ...owned,
              ...(isPaged
                ? {
                    pageOfSlot: renderer.scene.pagesOf(owned.name) ?? new Int32Array(),
                    isPaintOrderedAcrossPages: true,
                  }
                : {}),
            }),
          ),
          isOccluderByRank: new Uint8Array(ids.length),
          visible: [...culler.visible].map(([passName, ranges]) => ({ passName, ranges })),
        });
        expect(coverage(actual)).toEqual(coverage(reference.entries));
        expect(segments.segmentCount).toBe(reference.segmentCount);
      };
      culler.set('shape', [{ start: 0, count: 2000 }], []);
      frame();
      expect(segments.counts.plans).toBe(1);
      culler.set('shape', [{ start: 1, count: 1999 }], [{ start: 0, count: 1 }]);
      frame();
      expect(segments.counts.plans).toBe(1);
      expect(segments.removalCounts).toMatchObject({ patches: 1, slotReads: isPaged ? 4 : 2 });
      expect(segments.windowCounts).toMatchObject({ graphBuilds: 1, removalBuilds: 1 });
      culler.set('shape', [{ start: 2, count: 1998 }], [{ start: 1, count: 1 }]);
      frame();
      expect(segments.counts.plans).toBe(1);
      expect(segments.removalCounts).toMatchObject({ patches: 2, slotReads: isPaged ? 6 : 4 });
      expect(segments.windowCounts).toMatchObject({ graphBuilds: 1, removalBuilds: 1 });
      renderer.destroy();
    },
  );
});

it.each(['move', 'order', 'slots', 'pages', 'bounds', 'lod'] as const)(
  'falls back when removals accompany changed %s',
  (kind) => {
    const culler = new DeltaCuller();
    const targets: SceneObject[] = [];
    let page = 0;
    const pass: ScenePass = {
      ...FILLED_RECT_PASS,
      name: 'shape',
      pageOf: () => page,
      levelOfDetail: { rule: TEXT_LOD_RULE, sizeOf: () => 10 },
      prepare: (record, target, index) => {
        targets.push(target);
        FILLED_RECT_PASS.prepare(record, target, index);
      },
    };
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      passes: [pass],
      culler,
      isZOrdered: false,
    });
    const spatial = { drawingBoundsRevision: 0, boundsOf: () => undefined, searchRect: () => [] };
    const segments = new ZOrderSegments({
      spatial,
      rangeChangeOf: (name) => culler.rangeChangeOf(name),
    });
    segments.install(renderer.frame);
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'), shapeObject('b', { z: 'a1' }));
    renderer.enqueue(document.takeChanges());
    const camera = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 200, viewportHeightPx: 100 };
    culler.set('shape', [{ start: 0, count: 2 }], []);
    renderer.renderFrame({ timeMs: 0, camera });
    expect(segments.counts.plans).toBe(1);
    if (kind === 'move') document.update('b', { x: 50 });
    if (kind === 'order') document.update('b', { z: 'a2' });
    if (kind === 'slots') document.create(shapeObject('c', { z: 'a2' }));
    if (kind === 'bounds') spatial.drawingBoundsRevision += 1;
    if (kind === 'pages') {
      page = 1;
      renderer.scene.rewriteRecords('shape', targets.slice());
    }
    renderer.enqueue(document.takeChanges());
    culler.set('shape', [{ start: 1, count: 1 }], [{ start: 0, count: 1 }]);
    renderer.renderFrame({ timeMs: 16, camera: { ...camera, zoom: kind === 'lod' ? 0.05 : 1 } });
    expect(segments.counts.plans).toBe(2);
    expect(segments.windowCounts).toMatchObject({
      graphBuilds: 0,
      windowsBuilt: 0,
      removalBuilds: 0,
    });
    expect(segments.removalCounts.patches).toBe(0);
    renderer.destroy();
  },
);

it('repairs an entering note through the real renderer without a full plan', () => {
  const culler = new DeltaCuller();
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [NOTE_PASS, TEXT_PASS],
    culler,
    isZOrdered: false,
  });
  const segments = new ZOrderSegments({ rangeChangeOf: (name) => culler.rangeChangeOf(name) });
  segments.install(renderer.frame);
  const document = new FakeSceneDocument();
  for (let rank = 0; rank < 20; rank += 1) {
    document.create(stickyObject(`n${String(rank)}`, { z: zKeyAt(rank), text: 'ab' }));
  }
  renderer.enqueue(document.takeChanges());
  const camera = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 200, viewportHeightPx: 100 };
  culler.set(
    'note',
    [
      { start: 0, count: 10 },
      { start: 11, count: 9 },
    ],
    [],
  );
  culler.set(
    'text',
    [
      { start: 0, count: 20 },
      { start: 22, count: 18 },
    ],
    [],
  );
  renderer.renderFrame({ timeMs: 0, camera });
  expect(segments.counts.plans).toBe(1);
  for (const [name, count, start, addedCount] of [
    ['note', 20, 10, 1],
    ['text', 40, 20, 2],
  ] as const) {
    culler.set(name, [{ start: 0, count }], []);
    const old = culler.changes.get(name);
    if (!old) throw new Error('Missing change');
    culler.changes.set(name, { ...old, added: [{ start, count: addedCount }] });
  }
  backend.resetCalls();
  renderer.renderFrame({ timeMs: 16, camera });
  expect(segments.counts.plans).toBe(1);
  expect(segments.windowCounts).toMatchObject({ repairs: 1, plannedRecords: 6, wideFallbacks: 0 });
  const drawn = backend.calls.reduce(
    (sum, call) => sum + (call.method === 'draw' ? call.instanceCount : 0),
    0,
  );
  expect(drawn).toBe(60);
  expect(segments.segmentCount).toBe(20);
  renderer.destroy();
});
