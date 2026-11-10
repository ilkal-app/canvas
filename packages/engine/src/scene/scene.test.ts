import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from './__fixtures__/scene-objects.js';
import type { ScenePass } from './scene-pass.js';
import { Scene } from './scene.js';

const STRIDE = FILLED_RECT_PASS.layout.byteStride;
const FLOATS = FILLED_RECT_PASS.layout.floatsPerRecord;

/** A pass for shapes without a fill (as an outline pass would draw them): one record of `x`. */
const UNFILLED_PASS: ScenePass = {
  ...FILLED_RECT_PASS,
  name: 'unfilled',
  recordCount: (object) => (object.type === 'shape' && object.fill === null ? 1 : 0),
  prepare: (record, { object }) => {
    record[0] = object.x;
  },
};

function createScene(): { scene: Scene; document: FakeSceneDocument } {
  const scene = new Scene([FILLED_RECT_PASS], { instanceBuffer: { maxGapBytes: 0 } });
  return { scene, document: new FakeSceneDocument() };
}

function recordOf(scene: Scene, id: string): number[] {
  const [slot] = scene.slotsOf(id as ObjectId, 'solid-rect');
  if (slot === undefined) return [];
  const data = scene.instanceBufferOf('solid-rect').data;
  return Array.from(data.subarray(slot * FLOATS, (slot + 1) * FLOATS));
}

describe('Scene', () => {
  it('gives each created object the records its passes ask for', () => {
    const { scene, document } = createScene();
    document.create(shapeObject('a', { x: 1, y: 2 }), groupObject('g'), frameObject('f'));
    scene.apply(document.takeChanges());
    expect(scene.objectCount).toBe(3);
    expect(scene.slotsOf('a' as ObjectId, 'solid-rect')).toEqual([0]);
    expect(scene.slotsOf('g' as ObjectId, 'solid-rect')).toEqual([]);
    expect(scene.slotsOf('f' as ObjectId, 'solid-rect')).toEqual([1]);
    // The pass's floats, then the clip index (0: nothing clips the shape) and the transparency
    // (0: nothing fades it).
    expect(recordOf(scene, 'a')).toEqual([1, 2, 10, 10, 1, 0, 1, 0, 0, 1, 0, 0]);
    expect(scene.instanceBufferOf('solid-rect').dirtyRanges).toEqual([[0, 2 * STRIDE]]);
  });

  it('rewrites only the records of an updated object', () => {
    const { scene, document } = createScene();
    document.create(shapeObject('a'), shapeObject('b'), shapeObject('c'));
    scene.apply(document.takeChanges());
    scene.instanceBufferOf('solid-rect').clearDirty();
    document.update('c', { x: 50 });
    scene.apply(document.takeChanges());
    expect(recordOf(scene, 'c')[0]).toBe(50);
    expect(scene.instanceBufferOf('solid-rect').dirtyRanges).toEqual([[2 * STRIDE, 3 * STRIDE]]);
  });

  it('leaves the buffer clean when an update changes nothing a pass draws', () => {
    const { scene, document } = createScene();
    document.create(shapeObject('a'));
    scene.apply(document.takeChanges());
    scene.instanceBufferOf('solid-rect').clearDirty();
    document.update('a', { z: 'b0', locked: true });
    scene.apply(document.takeChanges());
    expect(scene.instanceBufferOf('solid-rect').dirtyRanges).toEqual([]);
  });

  it('releases the records of a deleted object and reuses its slot', () => {
    const { scene, document } = createScene();
    document.create(shapeObject('a'), shapeObject('b'));
    scene.apply(document.takeChanges());
    scene.instanceBufferOf('solid-rect').clearDirty();
    document.delete('a');
    scene.apply(document.takeChanges());
    expect(scene.objectCount).toBe(1);
    expect(scene.slotsOf('a' as ObjectId, 'solid-rect')).toEqual([]);
    expect(
      scene
        .instanceBufferOf('solid-rect')
        .data.subarray(0, FLOATS)
        .every((v) => v === 0),
    ).toBe(true);
    expect(scene.instanceBufferOf('solid-rect').dirtyRanges).toEqual([[0, STRIDE]]);
    document.create(shapeObject('c'));
    scene.apply(document.takeChanges());
    expect(scene.slotsOf('c' as ObjectId, 'solid-rect')).toEqual([0]);
  });

  it('adds and drops records when an object starts or stops needing them', () => {
    const { scene, document } = createScene();
    document.create(shapeObject('a', { fill: null }));
    scene.apply(document.takeChanges());
    expect(scene.slotsOf('a' as ObjectId, 'solid-rect')).toEqual([]);
    document.update('a', { fill: [0, 0, 1, 1] });
    scene.apply(document.takeChanges());
    expect(scene.slotsOf('a' as ObjectId, 'solid-rect')).toEqual([0]);
    document.update('a', { fill: null });
    scene.apply(document.takeChanges());
    expect(scene.slotsOf('a' as ObjectId, 'solid-rect')).toEqual([]);
    expect(scene.instanceBufferOf('solid-rect').liveCount).toBe(0);
  });

  it('rewrites an id deleted and recreated within one change set as the new object', () => {
    const { scene, document } = createScene();
    document.create(shapeObject('a', { x: 1 }), shapeObject('b'));
    scene.apply(document.takeChanges());
    scene.instanceBufferOf('solid-rect').clearDirty();
    document.delete('a');
    document.create(shapeObject('a', { x: 42 }));
    scene.apply(document.takeChanges());
    expect(scene.objectCount).toBe(2);
    expect(scene.slotsOf('a' as ObjectId, 'solid-rect')).toEqual([0]);
    expect(recordOf(scene, 'a')[0]).toBe(42);
    expect(scene.instanceBufferOf('solid-rect').liveCount).toBe(2);
    expect(scene.instanceBufferOf('solid-rect').dirtyRanges).toEqual([[0, STRIDE]]);
  });

  it('moves an object between passes when a change makes one drop it and another take it', () => {
    const scene = new Scene([FILLED_RECT_PASS, UNFILLED_PASS], {
      instanceBuffer: { maxGapBytes: 0 },
    });
    const document = new FakeSceneDocument();
    document.create(shapeObject('a', { x: 5 }));
    scene.apply(document.takeChanges());
    expect(scene.slotsOf('a' as ObjectId, 'solid-rect')).toEqual([0]);
    expect(scene.slotsOf('a' as ObjectId, 'unfilled')).toEqual([]);
    scene.instanceBufferOf('solid-rect').clearDirty();
    document.update('a', { fill: null });
    scene.apply(document.takeChanges());
    expect(scene.slotsOf('a' as ObjectId, 'solid-rect')).toEqual([]);
    expect(scene.slotsOf('a' as ObjectId, 'unfilled')).toEqual([0]);
    expect(scene.instanceBufferOf('solid-rect').dirtyRanges).toEqual([[0, STRIDE]]);
    expect(scene.instanceBufferOf('unfilled').data[0]).toBe(5);
    document.update('a', { fill: [0, 1, 0, 1] });
    scene.apply(document.takeChanges());
    expect(scene.slotsOf('a' as ObjectId, 'solid-rect')).toEqual([0]);
    expect(scene.slotsOf('a' as ObjectId, 'unfilled')).toEqual([]);
    expect(scene.instanceBufferOf('unfilled').liveCount).toBe(0);
  });

  it('moves the children of an updated parent without their being listed', () => {
    const { scene, document } = createScene();
    document.create(
      frameObject('f', { background: null }),
      groupObject('g', { parentId: 'f', x: 5 }),
      shapeObject('s', { parentId: 'g', x: 1 }),
    );
    scene.apply(document.takeChanges());
    expect(recordOf(scene, 's')[0]).toBe(6);
    document.update('f', { x: 100 });
    scene.apply(document.takeChanges());
    expect(recordOf(scene, 's')[0]).toBe(106);
  });

  it('stops moving a child with its old parent once it is reparented', () => {
    const { scene, document } = createScene();
    document.create(frameObject('f1'), frameObject('f2'), shapeObject('s', { parentId: 'f1' }));
    scene.apply(document.takeChanges());
    document.update('s', { parentId: 'f2' as ObjectId });
    scene.apply(document.takeChanges());
    document.update('f1', { x: 500 });
    scene.apply(document.takeChanges());
    expect(recordOf(scene, 's')[0]).toBe(0);
  });

  it('removes an object the change set lists as created but whose final state is deleted', () => {
    const { scene, document } = createScene();
    document.create(shapeObject('a'));
    document.delete('a');
    scene.apply(document.takeChanges());
    expect(scene.objectCount).toBe(0);
    expect(scene.instanceBufferOf('solid-rect').recordCount).toBe(0);
  });

  it('does not mutate the objects it reads', () => {
    const { scene } = createScene();
    const shape = Object.freeze(shapeObject('a'));
    const frame = Object.freeze(frameObject('f'));
    const objects = new Map<ObjectId, typeof shape | typeof frame>([
      [shape.id, shape],
      [frame.id, frame],
    ]);
    expect(() => {
      scene.apply({
        created: [shape.id, frame.id],
        updated: [],
        deleted: [],
        get: (id) => objects.get(id),
      });
    }).not.toThrow();
  });

  it('refuses two passes with the same name and an unknown pass name', () => {
    expect(() => new Scene([FILLED_RECT_PASS, FILLED_RECT_PASS])).toThrow(RangeError);
    expect(() => new Scene([FILLED_RECT_PASS]).instanceBufferOf('text')).toThrow(RangeError);
  });
});
