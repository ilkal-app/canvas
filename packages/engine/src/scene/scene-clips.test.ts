import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from './__fixtures__/scene-objects.js';
import { CLIP_FLOATS_PER_SLOT } from './clip-table.js';
import type { ScenePass } from './scene-pass.js';
import { Scene } from './scene.js';

const PASS = 'solid-rect';
const FLOATS = FILLED_RECT_PASS.layout.floatsPerRecord;
const CLIP_FLOAT = FILLED_RECT_PASS.layout.clipFloat ?? -1;

function setUp(passes: readonly ScenePass[] = [FILLED_RECT_PASS]) {
  const scene = new Scene(passes, { instanceBuffer: { maxGapBytes: 0 } });
  const document = new FakeSceneDocument();
  const apply = (): number => scene.apply(document.takeChanges());
  return { scene, document, apply };
}

// The clip index each of an object's records carries in a pass.
function clipIndicesOf(scene: Scene, id: string, pass = PASS): number[] {
  const buffer = scene.instanceBufferOf(pass);
  const floats = buffer.layout.floatsPerRecord;
  const clipFloat = buffer.layout.clipFloat ?? -1;
  return scene
    .slotsOf(id as ObjectId, pass)
    .map((slot) => buffer.data[slot * floats + clipFloat] ?? -1);
}

function slotOf(scene: Scene, id: string): number {
  return scene.clipTable.slotOf(id as ObjectId);
}

function clipRecordOf(scene: Scene, id: string): number[] {
  const slot = slotOf(scene, id);
  const data = scene.clipTable.data;
  return Array.from(data.subarray(slot * CLIP_FLOATS_PER_SLOT, (slot + 1) * CLIP_FLOATS_PER_SLOT));
}

describe('Scene clip indices', () => {
  it('gives a clipping frame’s descendants its slot and leaves the frame itself unclipped', () => {
    const { scene, document, apply } = setUp();
    document.create(
      frameObject('f', { x: 10, y: 20, width: 300, height: 200, clip: true }),
      groupObject('g', { parentId: 'f' }),
      shapeObject('child', { parentId: 'f' }),
      shapeObject('grandchild', { parentId: 'g' }),
      shapeObject('outside'),
    );
    apply();
    const slot = slotOf(scene, 'f');
    expect(slot).toBeGreaterThan(0);
    expect(clipIndicesOf(scene, 'child')).toEqual([slot]);
    expect(clipIndicesOf(scene, 'grandchild')).toEqual([slot]);
    expect(clipIndicesOf(scene, 'f')).toEqual([0]);
    expect(clipIndicesOf(scene, 'outside')).toEqual([0]);
    expect(clipRecordOf(scene, 'f')).toEqual([
      10, 20, 1, 0, 300, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('links a nested clip to its clipping ancestor, whatever order the change set lists them', () => {
    const { scene, document, apply } = setUp();
    document.create(
      shapeObject('leaf', { parentId: 'inner' }),
      frameObject('inner', { parentId: 'open', x: 5, y: 5, clip: true }),
      frameObject('open', { parentId: 'outer', x: 10, y: 10 }),
      frameObject('outer', { x: 100, y: 100, clip: true, width: 500, height: 500 }),
    );
    apply();
    const outer = slotOf(scene, 'outer');
    const inner = slotOf(scene, 'inner');
    expect(clipIndicesOf(scene, 'leaf')).toEqual([inner]);
    expect(clipIndicesOf(scene, 'inner')).toEqual([outer]);
    expect(clipIndicesOf(scene, 'open')).toEqual([outer]);
    // Inner's world origin, its parent slot, and its frame in outer's: 15 units in on each axis.
    expect(clipRecordOf(scene, 'inner')).toEqual([
      115,
      115,
      1,
      0,
      100,
      100,
      outer,
      0,
      1,
      0,
      15,
      15,
      0,
      0,
      0,
      0,
    ]);
  });

  it('follows a frame that stops clipping, and clips again when it starts', () => {
    const { scene, document, apply } = setUp();
    document.create(frameObject('f', { clip: true }), shapeObject('s', { parentId: 'f' }));
    apply();
    expect(clipIndicesOf(scene, 's')).toEqual([slotOf(scene, 'f')]);
    document.update('f', { clip: false });
    apply();
    expect(clipIndicesOf(scene, 's')).toEqual([0]);
    expect(scene.clipTable.size).toBe(0);
    document.update('f', { clip: true });
    apply();
    expect(clipIndicesOf(scene, 's')).toEqual([slotOf(scene, 'f')]);
  });

  it('starts clipping with a board’s first clipping frame and stops with its last', () => {
    // A board with no clipping frame skips the ancestor walk; the first one must turn it on,
    // even for a child its change set lists before it.
    const { scene, document, apply } = setUp();
    document.create(frameObject('f'), shapeObject('s', { parentId: 'f' }));
    apply();
    expect(clipIndicesOf(scene, 's')).toEqual([0]);
    document.create(shapeObject('t', { parentId: 'g' }), frameObject('g', { clip: true }));
    apply();
    expect(slotOf(scene, 'g')).toBeGreaterThan(0);
    expect(clipIndicesOf(scene, 't')).toEqual([slotOf(scene, 'g')]);
    expect(clipIndicesOf(scene, 's')).toEqual([0]);
    document.update('f', { clip: true });
    apply();
    expect(slotOf(scene, 'f')).toBeGreaterThan(0);
    expect(clipIndicesOf(scene, 's')).toEqual([slotOf(scene, 'f')]);
    document.delete('g', 't');
    document.update('f', { clip: false });
    apply();
    expect(clipIndicesOf(scene, 's')).toEqual([0]);
    expect(scene.clipTable.size).toBe(0);
  });

  it('follows a child reparented into and out of a clipping frame', () => {
    const { scene, document, apply } = setUp();
    document.create(frameObject('f', { clip: true }), shapeObject('s'));
    apply();
    expect(clipIndicesOf(scene, 's')).toEqual([0]);
    document.update('s', { parentId: 'f' as ObjectId });
    apply();
    expect(clipIndicesOf(scene, 's')).toEqual([slotOf(scene, 'f')]);
    document.update('s', { parentId: null });
    apply();
    expect(clipIndicesOf(scene, 's')).toEqual([0]);
  });

  it('releases a deleted frame’s slot for the next clipping frame', () => {
    const { scene, document, apply } = setUp();
    document.create(frameObject('f', { clip: true }), shapeObject('s', { parentId: 'f' }));
    apply();
    const slot = slotOf(scene, 'f');
    document.delete('f', 's');
    apply();
    expect(scene.clipTable.size).toBe(0);
    expect(clipRecordOf(scene, 'f')).toEqual(new Array(16).fill(0));
    document.create(frameObject('g', { clip: true }), shapeObject('t', { parentId: 'g' }));
    apply();
    expect(slotOf(scene, 'g')).toBe(slot);
  });

  it('moves a clipping frame by rewriting its record, not its children’s clip floats', () => {
    const { scene, document, apply } = setUp();
    document.create(
      frameObject('f', { clip: true }),
      shapeObject('s', { parentId: 'f' }),
      shapeObject('unrelated'),
    );
    apply();
    const buffer = scene.instanceBufferOf(PASS);
    buffer.clearDirty();
    scene.clipTable.clearDirty();
    const before = clipIndicesOf(scene, 's');
    document.update('f', { x: 40 });
    apply();
    expect(clipIndicesOf(scene, 's')).toEqual(before);
    expect(clipRecordOf(scene, 'f')[0]).toBe(40);
    const slot = slotOf(scene, 'f');
    expect(scene.clipTable.dirtyTexels).toEqual([slot * 4, slot * 4 + 4]);
    // The frame's and the child's records changed (their origins); the unrelated one did not.
    const [unrelated = -1] = scene.slotsOf('unrelated' as ObjectId, PASS);
    const at = unrelated * FILLED_RECT_PASS.layout.byteStride;
    expect(buffer.dirtyRanges.some(([start, end]) => start <= at && at < end)).toBe(false);
  });

  it('marks nothing dirty when a frame is re-applied unchanged', () => {
    const { scene, document, apply } = setUp();
    document.create(frameObject('f', { clip: true }), shapeObject('s', { parentId: 'f' }));
    apply();
    scene.instanceBufferOf(PASS).clearDirty();
    scene.clipTable.clearDirty();
    document.update('f', {});
    apply();
    expect(scene.instanceBufferOf(PASS).dirtyRanges).toEqual([]);
    expect(scene.clipTable.dirtyTexels).toEqual([0, 0]);
  });

  it('keeps a record’s clip index through ink and drawing rewrites', () => {
    const { scene, document, apply } = setUp();
    document.create(frameObject('f', { clip: true }), shapeObject('s', { parentId: 'f' }));
    apply();
    const slot = slotOf(scene, 'f');
    const object = document.get('s' as ObjectId);
    if (object === undefined) throw new Error('No fixture s.');
    scene.rewriteRecords(PASS, [{ object, transform: { cos: 1, sin: 0, x: 0, y: 0 } }]);
    scene.setInk([0.5, 0.5, 0.5, 1]);
    expect(clipIndicesOf(scene, 's')).toEqual([slot]);
  });

  it('writes the clip index into every retained record of a patched object', () => {
    // A pass that patches its first float in place, as the text pass patches glyph origins.
    const patching: ScenePass = {
      ...FILLED_RECT_PASS,
      name: 'patching',
      recordCount: (object) => (object.type === 'shape' ? 2 : 0),
      prepare: (record, { object }) => {
        record[0] = object.x;
      },
      preparePatch: ({ object }) => ({
        recordCount: 1,
        firstFloat: 0,
        values: new Float32Array([object.x]),
      }),
    };
    const { scene, document, apply } = setUp([patching]);
    document.create(frameObject('f', { clip: true }), shapeObject('s', { x: 3 }));
    apply();
    expect(clipIndicesOf(scene, 's', 'patching')).toEqual([0, 0]);
    document.update('s', { parentId: 'f' as ObjectId, x: 4 });
    apply();
    expect(clipIndicesOf(scene, 's', 'patching')).toEqual([slotOf(scene, 'f'), slotOf(scene, 'f')]);
    const buffer = scene.instanceBufferOf('patching');
    const [first] = scene.slotsOf('s' as ObjectId, 'patching');
    expect(buffer.data[(first ?? 0) * buffer.layout.floatsPerRecord]).toBe(4);
  });

  it('records each clipping frame’s true parent, past the shaders’ eight levels', () => {
    const { scene, document, apply } = setUp();
    const frames = Array.from({ length: 10 }, (unused, index) =>
      frameObject(`f${String(index)}`, {
        parentId: index === 0 ? null : `f${String(index - 1)}`,
        clip: true,
      }),
    );
    document.create(...frames, shapeObject('leaf', { parentId: 'f9' }));
    apply();
    expect(clipIndicesOf(scene, 'leaf')).toEqual([slotOf(scene, 'f9')]);
    for (let index = 1; index < 10; index++) {
      expect(clipRecordOf(scene, `f${String(index)}`)[6]).toBe(
        slotOf(scene, `f${String(index - 1)}`),
      );
    }
    expect(clipRecordOf(scene, 'f0')[6]).toBe(0);
  });

  it('has the clip index just before the trailing transparency of every record layout it writes', () => {
    expect(CLIP_FLOAT).toBe(FLOATS - 2);
  });
});
