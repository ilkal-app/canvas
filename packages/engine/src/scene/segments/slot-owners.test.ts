import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { SDF_SHAPE_PASS } from '../../shapes/shape-pass.js';
import { FakeSceneDocument, shapeObject } from '../__fixtures__/scene-objects.js';
import { Scene } from '../scene.js';

import { slotOwnersOf } from './slot-owners.js';

const id = (value: string): ObjectId => value as ObjectId;

describe('slotOwnersOf', () => {
  it('maps each slot to its owner by rank, walking only the objects a pass draws', () => {
    const scene = new Scene([SDF_SHAPE_PASS]);
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'), shapeObject('b'));
    scene.apply(document.takeChanges());
    const slotsOf = vi.spyOn(scene, 'slotsOf');
    const [pass] = slotOwnersOf(
      scene,
      new Map([
        [id('b'), 0],
        [id('a'), 1],
        [id('only-ranked'), 2],
      ]),
    );
    // No per-object lookup over the whole paint order: the pass's own slot entries are read.
    expect(slotsOf).not.toHaveBeenCalled();
    expect(pass?.name).toBe(SDF_SHAPE_PASS.name);
    slotsOf.mockRestore();
    const [slotA] = scene.slotsOf(id('a'), SDF_SHAPE_PASS.name);
    const [slotB] = scene.slotsOf(id('b'), SDF_SHAPE_PASS.name);
    if (slotA === undefined || slotB === undefined) throw new Error('shapes draw a record');
    expect(pass?.owners.rankOfSlot[slotA]).toBe(1);
    expect(pass?.owners.rankOfSlot[slotB]).toBe(0);
  });
});
