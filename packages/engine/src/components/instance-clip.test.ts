import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { CLIP_FLOATS_PER_SLOT } from '../scene/clip-table.js';
import { ROUNDED_RECT_PASS } from '../scene/rounded-rect-pass.js';
import type { SceneChangeSet } from '../scene/scene-source.js';
import { Scene } from '../scene/scene.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

import {
  component,
  ComponentBoard,
  ExpansionHarness,
  frame,
  instance,
  shape,
} from './__fixtures__/component-scene.js';
import { InstanceExpansion } from './instance-expansion.js';

// A main whose content sits in a clipping frame, and an instance of it at (400, 50).
function clippedBoard(): ComponentBoard {
  return new ComponentBoard([
    component('main'),
    frame('clipper', 'main', { x: 10, y: 10, width: 80, height: 60, clip: true }),
    shape('inside', 'clipper', { x: 70, y: 50 }),
    instance('inst', 'main', { x: 400, y: 50 }),
  ]);
}

function clipIndexOf(scene: Scene, id: string): number | undefined {
  const buffer = scene.instanceBufferOf(SDF_SHAPE_PASS.name);
  const [slot] = scene.slotsOf(id as ObjectId, SDF_SHAPE_PASS.name);
  const { floatsPerRecord, clipFloat = -1 } = buffer.layout;
  return slot === undefined ? undefined : buffer.data[slot * floatsPerRecord + clipFloat];
}

function clipOriginOf(scene: Scene, id: string): number[] {
  const at = scene.clipTable.slotOf(id as ObjectId) * CLIP_FLOATS_PER_SLOT;
  return Array.from(scene.clipTable.data.subarray(at, at + 2));
}

function applyAll(scene: Scene, outputs: readonly SceneChangeSet[]): void {
  for (const changes of outputs) scene.apply(changes);
}

describe('clipping inside component instances', () => {
  it('clips an instance’s virtual content by its virtual frame, as the main’s by its own', () => {
    const harness = new ExpansionHarness(clippedBoard(), InstanceExpansion);
    harness.step();
    const scene = new Scene([SDF_SHAPE_PASS]);
    applyAll(scene, harness.outputs);
    const virtualFrame = scene.clipTable.slotOf('inst/clipper' as ObjectId);
    expect(virtualFrame).toBeGreaterThan(0);
    expect(clipIndexOf(scene, 'inst/inside')).toBe(virtualFrame);
    expect(clipIndexOf(scene, 'inside')).toBe(scene.clipTable.slotOf('clipper' as ObjectId));
    expect(clipOriginOf(scene, 'inst/clipper')).toEqual([410, 60]);
    expect(clipOriginOf(scene, 'clipper')).toEqual([10, 10]);
  });

  it('rounds an instance’s virtual frame and clip as its main’s', () => {
    const board = new ComponentBoard([
      component('main'),
      frame('clipper', 'main', {
        x: 10,
        y: 10,
        width: 80,
        height: 60,
        clip: true,
        cornerRadius: [0, 8, 16, 24],
      }),
      shape('inside', 'clipper', { x: 70, y: 50 }),
      instance('inst', 'main', { x: 400, y: 50 }),
    ]);
    const harness = new ExpansionHarness(board, InstanceExpansion);
    harness.step();
    const scene = new Scene([SDF_SHAPE_PASS, ROUNDED_RECT_PASS]);
    applyAll(scene, harness.outputs);
    expect(scene.slotsOf('inst/clipper' as ObjectId, ROUNDED_RECT_PASS.name)).toHaveLength(1);
    const at = scene.clipTable.slotOf('inst/clipper' as ObjectId) * CLIP_FLOATS_PER_SLOT;
    expect(Array.from(scene.clipTable.data.subarray(at + 12, at + 16))).toEqual([0, 8, 16, 24]);
  });

  it('follows the instance as it moves, and the worker mirror’s scene agrees', () => {
    const harness = new ExpansionHarness(clippedBoard(), InstanceExpansion);
    harness.step();
    const scene = new Scene([SDF_SHAPE_PASS]);
    applyAll(scene, harness.outputs);
    const from = harness.outputs.length;
    harness.board.update('inst', { x: 500 });
    harness.step();
    applyAll(scene, harness.outputs.slice(from));
    expect(clipOriginOf(scene, 'inst/clipper')).toEqual([510, 60]);
    expect(clipIndexOf(scene, 'inst/inside')).toBe(
      scene.clipTable.slotOf('inst/clipper' as ObjectId),
    );
    // The engine worker's scene reads the serialised mirror, which carries `clip` and parents.
    const worker = new Scene([SDF_SHAPE_PASS]);
    worker.apply(harness.worker.everything());
    expect(clipOriginOf(worker, 'inst/clipper')).toEqual([510, 60]);
    expect(clipIndexOf(worker, 'inst/inside')).toBe(
      worker.clipTable.slotOf('inst/clipper' as ObjectId),
    );
  });
});
