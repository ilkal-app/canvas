import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import type { ScenePass } from './scene-pass.js';
import { Scene } from './scene.js';

const MULTI_PASS: ScenePass = {
  ...FILLED_RECT_PASS,
  name: 'multi-record',
  recordCount: (object) => (object.type === 'shape' ? Math.floor(object.width / 10) : 0),
};
const PASSES = [FILLED_RECT_PASS, MULTI_PASS];
const id = (value: string) => value as ObjectId;
interface HandleApi {
  handleOf(objectId: ObjectId): number | undefined;
  passIndexOf(name: string): number;
  slotsOfHandle(handle: number, passIndex: number): readonly number[] | undefined;
  slotRevisionOfHandle(handle: number, passIndex: number): number;
}
// Adapted: the handle API is `scene.handles` (SceneHandles), so Scene stays within its size limit.
const handles = (scene: Scene): HandleApi => ({
  handleOf: (objectId) => scene.handles.handleOf(objectId),
  passIndexOf: (name) => scene.handles.passIndexOf(name),
  slotsOfHandle: (handle, passIndex) => scene.handles.slotsOf(handle, passIndex),
  slotRevisionOfHandle: (handle, passIndex) => scene.handles.revisionOf(handle, passIndex),
});

function checkHandles(scene: Scene, ids: readonly string[]): void {
  for (const objectId of ids) {
    const handle = handles(scene).handleOf(id(objectId));
    const hasSlots = PASSES.some((pass) => scene.slotsOf(id(objectId), pass.name).length > 0);
    expect(handle === undefined).toBe(!hasSlots);
    if (handle === undefined) continue;
    PASSES.forEach((pass, passIndex) => {
      const slots = scene.slotsOf(id(objectId), pass.name);
      expect(handles(scene).slotsOfHandle(handle, passIndex)).toBe(
        slots.length ? slots : undefined,
      );
      expect(handles(scene).slotRevisionOfHandle(handle, passIndex)).toBe(
        scene.slotRevisionOf(id(objectId), pass.name),
      );
    });
  }
}

describe('Scene dense handles', () => {
  it('indexes passes in draw order and rejects an unknown pass', () => {
    const scene = new Scene(PASSES);
    PASSES.forEach((pass, index) => {
      expect(handles(scene).passIndexOf(pass.name)).toBe(index);
    });
    expect(() => handles(scene).passIndexOf('missing')).toThrow(RangeError);
  });

  it('keeps live slot arrays through growth and shrink, and fresh revisions on recreation', () => {
    const scene = new Scene(PASSES);
    const document = new FakeSceneDocument();
    document.create(
      shapeObject('a', { width: 30 }),
      shapeObject('b', { width: 10 }),
      shapeObject('zero', { width: 0 }),
    );
    scene.apply(document.takeChanges());
    checkHandles(scene, ['a', 'b', 'zero', 'absent']);
    expect(handles(scene).slotRevisionOfHandle(handles(scene).handleOf(id('zero')) ?? -1, 1)).toBe(
      0,
    );
    const firstHandle = handles(scene).handleOf(id('a'));
    expect(firstHandle).toBeDefined();
    const slots = scene.slotsOf(id('a'), MULTI_PASS.name);
    const firstRevision = scene.slotRevisionOf(id('a'), MULTI_PASS.name);
    document.update('a', { width: 50 });
    scene.apply(document.takeChanges());
    expect(scene.slotsOf(id('a'), MULTI_PASS.name)).toBe(slots);
    checkHandles(scene, ['a', 'b']);
    document.update('a', { width: 20 });
    scene.apply(document.takeChanges());
    expect(scene.slotsOf(id('a'), MULTI_PASS.name)).toBe(slots);
    checkHandles(scene, ['a', 'b']);
    document.delete('a');
    scene.apply(document.takeChanges());
    // Adapted: a deleted id keeps its handle for the scene's life, so a reader can still find
    // what it held; the handle holds no slots until the id is recreated.
    expect(handles(scene).handleOf(id('a'))).toBe(firstHandle);
    expect(handles(scene).slotsOfHandle(firstHandle ?? -1, 1)).toBeUndefined();
    expect(handles(scene).slotRevisionOfHandle(firstHandle ?? -1, 1)).toBe(0);
    document.create(shapeObject('a', { width: 20 }));
    scene.apply(document.takeChanges());
    expect(scene.slotRevisionOf(id('a'), MULTI_PASS.name)).toBeGreaterThan(firstRevision);
    checkHandles(scene, ['a', 'b']);
  });

  it('starts a replacement scene with its own handle and slot tables', () => {
    const first = new Scene(PASSES);
    const second = new Scene(PASSES);
    const document = new FakeSceneDocument();
    document.create(shapeObject('a', { width: 20 }));
    first.apply(document.takeChanges());
    document.update('a', { width: 40 });
    second.apply(document.takeChanges());
    checkHandles(first, ['a']);
    checkHandles(second, ['a']);
    expect(handles(second).slotsOfHandle(handles(second).handleOf(id('a')) ?? -1, 1)).toHaveLength(
      4,
    );
  });
});
