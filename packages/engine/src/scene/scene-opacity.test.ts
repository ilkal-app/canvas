import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { imageObject } from '../images/__fixtures__/image-objects.js';

import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
  sourceOf,
} from './__fixtures__/scene-objects.js';
import { SceneHierarchy } from './scene-hierarchy.js';
import { SceneOpacity } from './scene-opacity.js';
import { Scene } from './scene.js';

const id = (value: string): ObjectId => value as ObjectId;

/**
 * Counts the reads a source serves, so a test can tell an ancestor was worked out once.
 *
 * @param objects - The document.
 * @returns The source and its read count.
 */
function countingSource(objects: readonly BoardObject[]) {
  const source = sourceOf(objects);
  const reads: ObjectId[] = [];
  return {
    reads,
    source: {
      get: (objectId: ObjectId) => {
        reads.push(objectId);
        return source.get(objectId);
      },
    },
  };
}

describe('SceneOpacity', () => {
  it('keeps nothing for an opaque object, and forgets a removed one', () => {
    const opacity = new SceneOpacity();
    const plain = shapeObject('plain');
    expect(opacity.update(plain, sourceOf([plain]))).toBe(1);
    expect(opacity.recordMultiplierOf(plain.id)).toBe(1);
    const faded = shapeObject('faded', { opacity: 0.4 });
    expect(opacity.update(faded, sourceOf([faded]))).toBeCloseTo(0.4);
    expect(opacity.recordMultiplierOf(faded.id)).toBeCloseTo(0.4);
    expect(opacity.update({ ...faded, opacity: 1 }, sourceOf([]))).toBe(1);
    expect(opacity.recordMultiplierOf(faded.id)).toBe(1);
    opacity.update(faded, sourceOf([faded]));
    opacity.remove(faded.id);
    expect(opacity.recordMultiplierOf(faded.id)).toBe(1);
  });

  it('gives an image’s records its own opacity times its ancestors’, as any object’s', () => {
    const opacity = new SceneOpacity();
    const group = groupObject('g', { opacity: 0.5 });
    const image = imageObject({ id: id('i'), parentId: group.id, opacity: 0.5 });
    expect(opacity.update(image, sourceOf([group, image]))).toBeCloseTo(0.25);
    // Its border's record (another pass) carries the same, so the border fades with the picture.
    expect(opacity.recordMultiplierOf(image.id)).toBeCloseTo(0.25);
  });

  it('reads a refused stored opacity as opaque', () => {
    const opacity = new SceneOpacity();
    const group = groupObject('g', { opacity: 2 });
    const child = shapeObject('c', { parentId: group.id, opacity: Number.NaN });
    expect(opacity.update(child, sourceOf([group, child]))).toBe(1);
  });

  it('works an ancestor chain out once per apply, and afresh after beginApply', () => {
    const frame = frameObject('f', { opacity: 0.5 });
    const group = groupObject('g', { parentId: frame.id, opacity: 0.5 });
    const a = shapeObject('a', { parentId: group.id });
    const b = shapeObject('b', { parentId: group.id, opacity: 0.5 });
    const { reads, source } = countingSource([frame, group, a, b]);
    const opacity = new SceneOpacity();
    expect(opacity.update(a, source)).toBeCloseTo(0.25);
    expect(opacity.update(b, source)).toBeCloseTo(0.125);
    expect(reads).toEqual([group.id, frame.id]);
    opacity.beginApply();
    opacity.update(a, source);
    expect(reads).toEqual([group.id, frame.id, group.id, frame.id]);
  });

  it('ends a chain at a missing ancestor or a cycle', () => {
    const opacity = new SceneOpacity();
    const orphan = shapeObject('o', { parentId: id('gone'), opacity: 0.5 });
    expect(opacity.update(orphan, sourceOf([orphan]))).toBeCloseTo(0.5);
    const first = groupObject('first', { parentId: id('second'), opacity: 0.5 });
    const second = groupObject('second', { parentId: id('first'), opacity: 0.5 });
    const child = shapeObject('child', { parentId: first.id });
    opacity.beginApply();
    expect(opacity.update(child, sourceOf([first, second, child]))).toBeCloseTo(0.25);
  });
});

describe('the scene’s layer opacity', () => {
  function setUp() {
    const document = new FakeSceneDocument();
    const scene = new Scene([FILLED_RECT_PASS], { instanceBuffer: { maxGapBytes: 0 } });
    const { floatsPerRecord, opacityFloat = -1 } = FILLED_RECT_PASS.layout;
    const transparencyOf = (objectId: string): number | undefined => {
      const [slot] = scene.slotsOf(objectId as ObjectId, FILLED_RECT_PASS.name);
      const data = scene.instanceBufferOf(FILLED_RECT_PASS.name).data;
      return slot === undefined ? undefined : data[slot * floatsPerRecord + opacityFloat];
    };
    return { document, scene, transparencyOf };
  }

  it('rewrites a child’s transparency when its group’s opacity changes, and clears it', () => {
    const { document, scene, transparencyOf } = setUp();
    document.create(groupObject('g'), shapeObject('child', { parentId: 'g' }));
    scene.apply(document.takeChanges());
    expect(transparencyOf('child')).toBe(0);
    document.update('g', { opacity: 0.25 });
    scene.apply(document.takeChanges());
    expect(transparencyOf('child')).toBeCloseTo(0.75);
    document.update('g', { opacity: undefined });
    scene.apply(document.takeChanges());
    expect(transparencyOf('child')).toBe(0);
  });

  it('draws nothing at opacity 0 but keeps the records, as a hidden object would not', () => {
    const { document, scene, transparencyOf } = setUp();
    document.create(shapeObject('zero', { opacity: 0 }));
    scene.apply(document.takeChanges());
    expect(scene.slotsOf('zero' as ObjectId, FILLED_RECT_PASS.name)).toHaveLength(1);
    expect(transparencyOf('zero')).toBe(1);
  });

  it('stops at the nearest layer and leaves a layer’s own opacity to its composite (C2b)', () => {
    const opacity = new SceneOpacity({ isLayerFormDrawn: true });
    const outer = groupObject('outer', { opacity: 0.5 });
    const inner = groupObject('inner', { parentId: 'outer', opacity: 0.5 });
    const child = shapeObject('child', { parentId: 'inner', opacity: 0.6 });
    const labelled = shapeObject('labelled', {
      parentId: 'inner',
      opacity: 0.5,
      label: { text: 'A', runs: [] },
    });
    const source = sourceOf([outer, inner, child, labelled]);
    opacity.beginApply();
    for (const object of [outer, inner, child, labelled]) opacity.update(object, source);
    expect(opacity.recordMultiplierOf(child.id)).toBeCloseTo(0.6);
    expect(opacity.recordMultiplierOf(outer.id)).toBe(1);
    expect(opacity.recordMultiplierOf(inner.id)).toBe(1);
    expect(opacity.recordMultiplierOf(labelled.id)).toBe(1);
  });

  it('multiplies across a group that is not a layer: an opaque group passes its parent’s', () => {
    const opacity = new SceneOpacity({ isLayerFormDrawn: true });
    const layer = frameObject('layer', { opacity: 0.5 });
    const plain = groupObject('plain', { parentId: 'layer' });
    const child = shapeObject('child', { parentId: 'plain', opacity: 0.5 });
    const source = sourceOf([layer, plain, child]);
    opacity.beginApply();
    expect(opacity.update(child, source)).toBeCloseTo(0.5);
    expect(opacity.recordMultiplierOf(child.id)).toBeCloseTo(0.5);
  });

  it('multiplies a fallen-back layer into its subtree, and stops there again once it composites (C2c)', () => {
    const opacity = new SceneOpacity({ isLayerFormDrawn: true });
    const outer = frameObject('outer', { opacity: 0.5 });
    const inner = groupObject('inner', { parentId: 'outer', opacity: 0.5 });
    const image = imageObject({ id: id('image'), parentId: 'inner' as ObjectId, opacity: 0.4 });
    const labelled = shapeObject('labelled', {
      parentId: 'inner',
      opacity: 0.8,
      label: { text: 'A', runs: [] },
    });
    const plain = shapeObject('plain');
    const objects = [outer, inner, image, labelled, plain];
    const hierarchy = new SceneHierarchy();
    for (const object of objects) hierarchy.setParent(object.id, object.parentId);
    const source = sourceOf(objects);
    opacity.beginApply();
    for (const object of objects) opacity.update(object, source);
    expect(opacity.changeFallbacks([inner.id, labelled.id, plain.id], [])).toEqual([
      inner.id,
      labelled.id,
    ]);
    expect(opacity.refresh(inner.id, hierarchy)).toBeCloseTo(0.5);
    // The image's own 0.4 rides in its multiplier, as any leaf's.
    expect(opacity.refresh(image.id, hierarchy)).toBeCloseTo(0.2);
    expect(opacity.refresh(labelled.id, hierarchy)).toBeCloseTo(0.4);
    expect(opacity.refresh(plain.id, hierarchy)).toBe(1);
    // Adding one already there changes nothing; removing one that was never there neither.
    expect(opacity.changeFallbacks([outer.id, inner.id], [plain.id, id('never')])).toEqual([
      outer.id,
    ]);
    expect(opacity.refresh(image.id, hierarchy)).toBeCloseTo(0.1);
    expect(opacity.refresh(outer.id, hierarchy)).toBeCloseTo(0.5);
    // An update reads the same fallbacks as a refresh.
    opacity.beginApply();
    expect(opacity.update(labelled, source)).toBeCloseTo(0.2);
    expect(opacity.changeFallbacks([], [outer.id, inner.id, labelled.id])).toEqual([
      outer.id,
      inner.id,
      labelled.id,
    ]);
    expect(opacity.refresh(labelled.id, hierarchy)).toBe(1);
    expect(opacity.recordMultiplierOf(image.id)).toBeCloseTo(0.1);
    // Inside its layers again, the image keeps its own opacity: a borderless image is no layer.
    expect(opacity.refresh(image.id, hierarchy)).toBeCloseTo(0.4);
    opacity.remove(inner.id);
    expect(opacity.changeFallbacks([inner.id], [])).toEqual([]);
  });

  it('keeps no translucent object when layer form is not drawn, and walks no ancestor cycle', () => {
    const multiplied = new SceneOpacity();
    const group = groupObject('g', { opacity: 0.5 });
    multiplied.update(group, sourceOf([group]));
    expect(multiplied.changeFallbacks([group.id], [])).toEqual([]);
    const opacity = new SceneOpacity({ isLayerFormDrawn: true });
    const hierarchy = new SceneHierarchy();
    hierarchy.setParent(id('a'), id('b'));
    hierarchy.setParent(id('b'), id('a'));
    expect(opacity.refresh(id('a'), hierarchy)).toBe(1);
  });
});
