import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, zKeyAt } from '../__fixtures__/scene-objects.js';
import { NO_FRAME_TIMERS, type FrameContext } from '../frame-context.js';
import { Frame } from '../frame.js';
import { SceneChangeQueue } from '../scene-change-queue.js';
import { SceneRenderer } from '../scene-renderer.js';
import type { SceneChangeSet } from '../scene-source.js';
import { Scene } from '../scene.js';

import { TEXT_PASS, textObject } from './__fixtures__/note-and-text-passes.js';
import * as segmentModule from './z-order-segments.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 };
const COUNT = 96;
// Eight former frames, twelve children each: lifted root children retain repeating sibling z keys.
const DOCUMENT_IDS = [...Array(COUNT).keys()].map(
  (index) => `leaf-${String(index).padStart(3, '0')}` as ObjectId,
);
const PAINT_IDS = [...DOCUMENT_IDS].sort((left, right) => {
  const a = Number(left.slice(5));
  const b = Number(right.slice(5));
  return (a % 12) - (b % 12) || a - b;
});

type CompactionStage = segmentModule.ZOrderSegments & {
  readonly counts: segmentModule.ZOrderSegmentCounts & { readonly slotCompactions: number };
  hasPendingCompaction(): boolean;
};

function rendererWithStage(compaction?: { ratio?: number; recordsPerFrame?: number } | false) {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, { passes: [TEXT_PASS], isZOrdered: false });
  const stage = new segmentModule.ZOrderSegments({ compaction }) as CompactionStage;
  stage.install(renderer.frame);
  return { backend, renderer, stage, document: new FakeSceneDocument() };
}

function populate(document: FakeSceneDocument, ids: readonly ObjectId[]): SceneChangeSet {
  for (const id of ids) {
    const index = Number(id.slice(5));
    document.create(textObject(id, { text: 'ab', z: zKeyAt(index % 12) }));
  }
  return document.takeChanges();
}

function frame(renderer: SceneRenderer): void {
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
}

function drawnRecords(backend: FakeGpuBackend, renderer: SceneRenderer): string[] {
  const owner = new Map<number, string>();
  for (const [id, slots] of renderer.scene.slotEntriesOf('text')) {
    slots.forEach((slot, record) => owner.set(slot, `${id}:${String(record)}`));
  }
  const records: string[] = [];
  for (const call of backend.calls) {
    if (call.method !== 'draw') continue;
    for (let slot = call.firstInstance; slot < call.firstInstance + call.instanceCount; slot += 1) {
      const value = owner.get(slot);
      if (value) records.push(value);
    }
  }
  return records;
}

describe('paint-order allocation and compaction', () => {
  it('sorts a large document-order load before assigning slots and bounds its draw ranges', () => {
    const { backend, renderer, document } = rendererWithStage();
    renderer.enqueue(populate(document, DOCUMENT_IDS));
    frame(renderer);
    const slots = PAINT_IDS.flatMap((id) => renderer.scene.slotsOf(id, 'text'));
    expect(slots).toEqual([...slots].sort((left, right) => left - right));
    expect(backend.count('draw')).toBeLessThanOrEqual(1);
    expect(segmentModule).toHaveProperty('PAINT_ORDER_BATCH', 64);
  });

  it.each([
    ['small', DOCUMENT_IDS.slice(0, 8)],
    ['already ordered', PAINT_IDS],
  ])('passes the same change-set object through for a %s load', (label, ids) => {
    expect(label).toBeTruthy();
    const document = new FakeSceneDocument();
    const changes = populate(document, ids);
    const queue = new SceneChangeQueue();
    queue.push(changes);
    let applied: SceneChangeSet | undefined;
    const stopped = new Error('captured');
    const frameLoop = new Frame([
      {
        name: 'collectChanges',
        run: (context) => {
          applied = context.changes.drain();
          throw stopped;
        },
      },
      { name: 'cull', run: () => undefined },
    ]);
    new segmentModule.ZOrderSegments().install(frameLoop);
    const scene = new Scene([TEXT_PASS]);
    expect(() => {
      frameLoop.run({ changes: queue, scene, timers: NO_FRAME_TIMERS } as FrameContext);
    }).toThrow(stopped);
    expect(applied).toBe(changes);
  });

  it('defers slot rewrites while change sets arrive, the camera moves, or a retained move is active', () => {
    const { renderer, document, stage } = rendererWithStage({ ratio: 1, recordsPerFrame: 24 });
    for (let offset = 0; offset < COUNT; offset += 16) {
      renderer.enqueue(populate(document, DOCUMENT_IDS.slice(offset, offset + 16)));
      frame(renderer);
      expect(stage.counts.slotCompactions).toBe(0);
    }
    for (let index = 1; index <= 3; index += 1) {
      renderer.renderFrame({ timeMs: index * 16, camera: { ...CAMERA, x: index * 20 } });
      expect(stage.counts.slotCompactions).toBe(0);
    }
    const first = PAINT_IDS.at(0);
    if (!first) throw new Error('Expected one object.');
    document.update(first, { x: 25 });
    renderer.enqueueRetainedMove(document.takeChanges(), [first]);
    frame(renderer);
    expect(stage.counts.slotCompactions).toBe(0);
  });

  it('fills a page left’s slots lowest first, so a sliced page switch needs no re-slot', () => {
    const { backend, renderer, document, stage } = rendererWithStage();
    renderer.enqueue(populate(document, DOCUMENT_IDS));
    frame(renderer);
    // The page shown next, in paint order, announced as a page switch does: its first slice with
    // the page left's deletes, the rest in a later change set that reuses their slots.
    const next = [...Array(160).keys()].map(
      (index) => `next-${String(index).padStart(3, '0')}` as ObjectId,
    );
    const create = (ids: readonly ObjectId[]): void => {
      for (const id of ids)
        document.create(textObject(id, { text: 'ab', z: zKeyAt(Number(id.slice(5))) }));
    };
    create(next.slice(0, 64));
    document.delete(...DOCUMENT_IDS);
    renderer.enqueue(document.takeChanges());
    frame(renderer);
    create(next.slice(64));
    renderer.enqueue(document.takeChanges());
    backend.resetCalls();
    frame(renderer);
    const slots = next.slice(64).flatMap((id) => renderer.scene.slotsOf(id, 'text'));
    expect(slots).toEqual([...slots].sort((left, right) => left - right));
    expect(backend.count('draw')).toBeLessThanOrEqual(3);
    expect(stage.hasPendingCompaction()).toBe(false);
    expect(renderer.hasPendingWork()).toBe(false);
  });

  it('settles fragmented chunks while preserving each frame’s paint output', () => {
    const compacted = rendererWithStage({ ratio: 1, recordsPerFrame: 24 });
    const reference = rendererWithStage(false);
    for (let offset = 0; offset < COUNT; offset += 16) {
      const ids = DOCUMENT_IDS.slice(offset, offset + 16);
      compacted.renderer.enqueue(populate(compacted.document, ids));
      reference.renderer.enqueue(populate(reference.document, ids));
      compacted.backend.resetCalls();
      reference.backend.resetCalls();
      frame(compacted.renderer);
      frame(reference.renderer);
      expect(drawnRecords(compacted.backend, compacted.renderer)).toEqual(
        drawnRecords(reference.backend, reference.renderer),
      );
      expect(compacted.stage.counts).toHaveProperty('slotCompactions', 0);
    }
    expect(compacted.renderer.hasPendingWork()).toBe(true);
    const maxFrames = Math.ceil((COUNT * 2) / 24) + 2;
    for (let index = 0; index < maxFrames && compacted.stage.hasPendingCompaction(); index += 1) {
      compacted.backend.resetCalls();
      reference.backend.resetCalls();
      frame(compacted.renderer);
      frame(reference.renderer);
      expect(drawnRecords(compacted.backend, compacted.renderer)).toEqual(
        drawnRecords(reference.backend, reference.renderer),
      );
    }
    expect(compacted.stage.hasPendingCompaction()).toBe(false);
    expect(compacted.renderer.hasPendingWork()).toBe(false);
    const slots = PAINT_IDS.flatMap((id) => compacted.renderer.scene.slotsOf(id, 'text'));
    expect(slots).toEqual([...slots].sort((left, right) => left - right));
    expect(compacted.stage.counts.slotCompactions).toBeGreaterThan(0);
  });
});
