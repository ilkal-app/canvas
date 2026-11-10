import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { LevelOfDetail } from '../lod/level-of-detail.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { NO_FRAME_TIMERS, type FrameContext } from '../scene/frame-context.js';
import { Frame } from '../scene/frame.js';
import type { SceneObject } from '../scene/scene-pass.js';

import { writeFlatShapeRecord } from './shape-flat-form.js';
import { SHAPE_FLAT_KIND_CODE, SHAPE_INSTANCE_FLOATS } from './shape-instance-layout.js';
import { SDF_SHAPE_PASS, SDF_SHAPE_PASS_NAME } from './shape-pass.js';

const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 } as const;

/**
 * A full rounded-box record: its box, its fill's alpha, its radius and its outline.
 *
 * @param fields - The floats to set, by index.
 * @returns The record.
 */
function recordWith(fields: Readonly<Record<number, number>>): Float32Array {
  const record = new Float32Array(SHAPE_INSTANCE_FLOATS);
  for (const [index, value] of Object.entries(fields)) record[Number(index)] = value;
  return record;
}

describe('writeFlatShapeRecord', () => {
  it('keeps the whole alpha of a rounded box with no area', () => {
    const record = recordWith({ 2: 0, 3: 10, 7: 0.8, 8: 4 });
    writeFlatShapeRecord(record, false);
    expect(record[7]).toBeCloseTo(0.8, 6);
    expect(record[10]).toBe(SHAPE_FLAT_KIND_CODE);
  });

  it('keeps the whole alpha of an outline alone round a box with no area', () => {
    const record = recordWith({ 2: 0, 3: 10, 7: 0, 10: 1, 13: 0.2, 16: 0.5, 17: 3 });
    writeFlatShapeRecord(record, false);
    expect(record[7]).toBeCloseTo(0.5 * (Math.PI / 4), 6);
    expect(record[4]).toBeCloseTo(0.2, 6);
  });

  it('makes a shape that paints nothing clear', () => {
    const record = recordWith({ 2: 10, 3: 10, 7: 0, 16: 1, 17: 0 });
    writeFlatShapeRecord(record, false);
    expect(record[7]).toBe(0);
  });

  it('reads a record shorter than the layout as zeros', () => {
    const record = new Float32Array(4);
    expect(() => {
      writeFlatShapeRecord(record, false);
    }).not.toThrow();
  });
});

describe('the SDF shape pass a renderer builds', () => {
  /**
   * The pass with a stubbed level of detail whose changed set and forms the test sets.
   *
   * @param changed - What `changedIn` reports.
   * @returns The pass, its frame and the scene's rewrite spy.
   */
  function built(changed: ObjectId[]) {
    const levelOfDetail = {
      formOf: () => 'full',
      changedIn: () => new Set(changed),
    } as unknown as LevelOfDetail;
    const pass = SDF_SHAPE_PASS.create({
      backend: new FakeGpuBackend(),
      requestFrame: () => undefined,
      now: () => 0,
      levelOfDetail,
    });
    const frame = new Frame([{ name: 'uploadDirtyRanges', run: () => undefined }]);
    pass.install?.(frame);
    /** What each rewrite was given, copied: the pass reuses its set. */
    const rewritten: SceneObject[][] = [];
    const rewriteRecords = vi.fn((passName: string, targets: Iterable<SceneObject>) => {
      expect(passName).toBe(SDF_SHAPE_PASS_NAME);
      rewritten.push([...targets]);
      return rewritten.length;
    });
    const context = { scene: { rewriteRecords }, timers: NO_FRAME_TIMERS };
    return { pass, frame, rewriteRecords, rewritten, context: context as unknown as FrameContext };
  }

  it('rewrites a changed object from the target its retained move last gave it', () => {
    const { pass, frame, rewriteRecords, rewritten, context } = built(['a' as ObjectId]);
    const first = { object: shapeObject('a'), transform: IDENTITY };
    pass.prepare(new Float32Array(pass.layout.floatsPerRecord), first, 0);
    const moved = { object: shapeObject('a', { x: 5 }), transform: IDENTITY };
    pass.retainMoveTarget?.(moved);
    pass.retainMoveTarget?.({ object: shapeObject('b'), transform: IDENTITY });
    frame.run(context);
    expect(rewriteRecords).toHaveBeenCalledOnce();
    expect(rewritten).toEqual([[moved]]);
  });

  it('forgets a deleted object and rewrites nothing for it', () => {
    const { pass, frame, rewriteRecords, context } = built(['a' as ObjectId]);
    const target = { object: shapeObject('a'), transform: IDENTITY };
    pass.prepare(new Float32Array(pass.layout.floatsPerRecord), target, 0);
    pass.forget?.('a' as ObjectId);
    frame.run(context);
    expect(rewriteRecords).not.toHaveBeenCalled();
  });

  it('installs nothing and keeps no target without a level of detail', () => {
    const pass = SDF_SHAPE_PASS.create({
      backend: new FakeGpuBackend(),
      requestFrame: () => undefined,
      now: () => 0,
    });
    const frame = new Frame([{ name: 'uploadDirtyRanges', run: () => undefined }]);
    const wrap = vi.spyOn(frame, 'wrapStage');
    pass.install?.(frame);
    expect(wrap).not.toHaveBeenCalled();
    const record = new Float32Array(pass.layout.floatsPerRecord);
    pass.prepare(record, { object: shapeObject('a'), transform: IDENTITY }, 0);
    expect(record[10]).not.toBe(SHAPE_FLAT_KIND_CODE);
  });
});
