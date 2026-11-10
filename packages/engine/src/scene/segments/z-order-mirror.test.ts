import { describe, expect, it } from 'vitest';

import { FILLED_RECT_PASS } from '../__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from '../__fixtures__/scene-objects.js';
import type { ScenePass } from '../scene-pass.js';

import { ZOrderMirror } from './z-order-mirror.js';

const PASSES = [FILLED_RECT_PASS];

function loadedMirror(): { mirror: ZOrderMirror; document: FakeSceneDocument } {
  const mirror = new ZOrderMirror();
  const document = new FakeSceneDocument();
  document.create(frameObject('f'), shapeObject('s', { parentId: 'f', z: 'a1' }), groupObject('g'));
  mirror.observe(document.takeChanges(), PASSES);
  mirror.clearDirty();
  return { mirror, document };
}

function dirtiness(mirror: ZOrderMirror): string[] {
  return [
    ...(mirror.isOrderDirty ? ['order'] : []),
    ...(mirror.isOccludersDirty ? ['occluders'] : []),
    ...(mirror.isSlotsDirty ? ['slots'] : []),
  ];
}

describe('ZOrderMirror', () => {
  it('mirrors every object, drawn or not, and marks the slots dirty when objects arrive', () => {
    const mirror = new ZOrderMirror();
    const document = new FakeSceneDocument();
    document.create(frameObject('f'), groupObject('g'));
    mirror.observe(document.takeChanges(), PASSES);
    expect(mirror.objectCount).toBe(2);
    expect([...mirror.objects()].map(({ id }) => id)).toEqual(['f', 'g']);
    // Childless roots at the end of the root list: appended, the order otherwise unchanged.
    expect(dirtiness(mirror)).toEqual(['slots']);
    expect(mirror.appendedIds).toEqual(['f', 'g']);
    mirror.clearDirty();
    expect(dirtiness(mirror)).toEqual([]);
    expect(mirror.appendedIds).toEqual([]);
  });

  it('records objects created above every other as appended, their slots new', () => {
    const { mirror, document } = loadedMirror();
    document.create(shapeObject('top', { z: 'a5' }), shapeObject('upper', { z: 'a6' }));
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual(['slots']);
    expect(mirror.appendedIds).toEqual(['top', 'upper']);
    expect([...mirror.slotChangedIds]).toEqual(['top', 'upper']);
  });

  it('records any other leaf arrival as an edit: below the top, a child, or after a reorder', () => {
    const below = loadedMirror();
    below.document.create(shapeObject('b', { z: 'a0' }));
    below.mirror.observe(below.document.takeChanges(), PASSES);
    expect(dirtiness(below.mirror)).toEqual(['slots']);
    expect(below.mirror.appendedIds).toEqual([]);
    expect([...below.mirror.editedIds]).toEqual(['b']);
    const child = loadedMirror();
    child.document.create(shapeObject('c', { parentId: 'g', z: 'a5' }));
    child.mirror.observe(child.document.takeChanges(), PASSES);
    expect(dirtiness(child.mirror)).toEqual(['slots']);
    expect([...child.mirror.editedIds]).toEqual(['c']);
    const reordered = loadedMirror();
    reordered.document.update('g', { z: 'Zz' });
    reordered.mirror.observe(reordered.document.takeChanges(), PASSES);
    reordered.document.create(shapeObject('top', { z: 'a5' }));
    reordered.mirror.observe(reordered.document.takeChanges(), PASSES);
    expect(dirtiness(reordered.mirror)).toEqual(['slots']);
    expect(reordered.mirror.appendedIds).toEqual([]);
    expect([...reordered.mirror.editedIds]).toEqual(['g', 'top']);
    // A parent arriving with its child is no leaf: the order is walked again.
    const parent = loadedMirror();
    parent.document.create(
      groupObject('h', { z: 'a0' }),
      shapeObject('member', { parentId: 'h', z: 'a0' }),
    );
    parent.mirror.observe(parent.document.takeChanges(), PASSES);
    expect(dirtiness(parent.mirror)).toEqual(['order', 'slots']);
    expect([...parent.mirror.editedIds]).toEqual([]);
  });

  it('keeps the order when a lone new z key keeps the object between the same siblings', () => {
    const { mirror, document } = loadedMirror();
    // `s`, the only child of `f`, and `g` the last root: each keeps its place.
    document.update('s', { z: 'a2' });
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual([]);
    document.update('g', { z: 'a5' });
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual([]);
    expect(mirror.siblings.childrenOf(null).map(({ id, z }) => [id, z])).toEqual([
      ['f', 'a0'],
      ['g', 'a5'],
    ]);
    // A restack beside an arrival on top (a stroke committed as the next one's preview arrives).
    document.update('g', { z: 'a7' });
    document.create(shapeObject('next', { z: '~' }));
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual(['slots']);
    expect(mirror.appendedIds).toEqual(['next']);
    mirror.clearDirty();
    // Two restacks in one batch are not judged one by one: leaves, they edit the order.
    document.update('s', { z: 'a3' });
    document.update('g', { z: 'a6' });
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual(['slots']);
    expect([...mirror.editedIds]).toEqual(['s', 'g']);
  });

  it('records the end of the root list deleted as trimmed, and a stroke in place of its preview', () => {
    const { mirror, document } = loadedMirror();
    document.create(shapeObject('preview', { z: '~' }));
    mirror.observe(document.takeChanges(), PASSES);
    mirror.clearDirty();
    // The stroke committed: its preview goes, the stroke arrives on top, in one change set.
    document.delete('preview');
    document.create(shapeObject('stroke', { z: 'a5' }));
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual(['slots']);
    expect(mirror.trimmedIds).toEqual(['preview']);
    expect(mirror.appendedIds).toEqual(['stroke']);
    expect([...mirror.slotChangedIds].sort()).toEqual(['preview', 'stroke']);
  });

  it('cancels an append deleted again in the same frame, and refuses a deletion below the top', () => {
    const { mirror, document } = loadedMirror();
    document.create(shapeObject('top', { z: 'a5' }));
    mirror.observe(document.takeChanges(), PASSES);
    document.delete('top');
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual(['slots']);
    expect(mirror.appendedIds).toEqual([]);
    expect(mirror.trimmedIds).toEqual([]);
    const below = loadedMirror();
    below.document.delete('f');
    below.mirror.observe(below.document.takeChanges(), PASSES);
    expect(dirtiness(below.mirror)).toEqual(['order', 'slots']);
    expect(below.mirror.trimmedIds).toEqual([]);
  });

  it('takes earlier appends into the edits when a later arrival in the same frame is below the top', () => {
    const { mirror, document } = loadedMirror();
    document.create(shapeObject('top', { z: 'a5' }));
    mirror.observe(document.takeChanges(), PASSES);
    document.create(shapeObject('low', { z: 'a0' }));
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual(['slots']);
    expect(mirror.appendedIds).toEqual([]);
    expect([...mirror.editedIds]).toEqual(['top', 'low']);
    mirror.clearDirty();
    expect([...mirror.editedIds]).toEqual([]);
  });

  it('stays clean when an object moves, resizes or recolours', () => {
    const { mirror, document } = loadedMirror();
    document.update('s', { x: 40, width: 3, fill: [0, 1, 0, 1] });
    document.update('f', { rotation: 1 });
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual([]);
  });

  it('edits the order when a leaf is restacked or reparented, and marks it dirty when a parent is', () => {
    const { mirror, document } = loadedMirror();
    // `g` below `f` (z a0, ids f < g): a reorder of the root list, `g` a leaf.
    document.update('g', { z: 'Zz' });
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual(['slots']);
    expect([...mirror.editedIds]).toEqual(['g']);
    expect([...mirror.slotChangedIds]).toEqual(['g']);
    mirror.clearDirty();
    document.update('s', { parentId: 'g' as never });
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual(['slots']);
    expect([...mirror.editedIds]).toEqual(['s']);
    mirror.clearDirty();
    // `g` holds `s` now: restacking it moves its subtree.
    document.update('g', { z: 'a5' });
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual(['order', 'slots']);
    expect([...mirror.editedIds]).toEqual([]);
  });

  it('marks occluders and slots dirty when a pass starts or stops drawing an object', () => {
    const { mirror, document } = loadedMirror();
    document.update('s', { fill: null });
    mirror.observe(document.takeChanges(), PASSES);
    expect(dirtiness(mirror)).toEqual(['occluders', 'slots']);
  });

  it('records a leaf deleted below the top as an edit, and forgets it', () => {
    const { mirror, document } = loadedMirror();
    document.delete('s');
    mirror.observe(document.takeChanges(), PASSES);
    expect(mirror.objectCount).toBe(2);
    expect(dirtiness(mirror)).toEqual(['slots']);
    expect([...mirror.editedIds]).toEqual(['s']);
  });

  it('ignores the deletion of an object it never saw', () => {
    const { mirror, document } = loadedMirror();
    document.create(shapeObject('brief'));
    document.delete('brief');
    mirror.observe(document.takeChanges(), PASSES);
    expect(mirror.objectCount).toBe(3);
    expect(dirtiness(mirror)).toEqual([]);
  });

  it('treats a pass without an occluder flag as occluding nothing', () => {
    const mirror = new ZOrderMirror();
    const document = new FakeSceneDocument();
    const plainPass: ScenePass = {
      name: FILLED_RECT_PASS.name,
      layout: FILLED_RECT_PASS.layout,
      pipelineSpec: FILLED_RECT_PASS.pipelineSpec,
      recordCount: (object) => FILLED_RECT_PASS.recordCount(object),
      prepare: (record, target, recordIndex) => {
        FILLED_RECT_PASS.prepare(record, target, recordIndex);
      },
    };
    document.create(shapeObject('s'));
    mirror.observe(document.takeChanges(), [plainPass]);
    expect(mirror.isOccluder(shapeObject('s'), [plainPass])).toBe(false);
    expect(mirror.isOccluder(shapeObject('s'), PASSES)).toBe(true);
  });
});

describe('ZOrderMirror occluder state by rank', () => {
  it('keeps flags at an object’s own rank and at its closing rank apart', () => {
    const mirror = new ZOrderMirror();
    const own = { name: 'own', isOccluder: () => true } as unknown as ScenePass;
    const after = {
      name: 'after',
      isOccluder: () => true,
      isDrawnAfterDescendants: true,
    } as unknown as ScenePass;
    const quiet = { name: 'quiet' } as unknown as ScenePass;
    const object = frameObject('frame');
    expect(mirror.occluderState(object, [quiet])).toBe(0);
    expect(mirror.occluderState(object, [own])).toBe(1);
    expect(mirror.occluderState(object, [after])).toBe(2);
    expect(mirror.occluderState(object, [own, after, quiet])).toBe(3);
  });

  it('keeps the objects at opacity 0 and marks their visibility dirty', () => {
    const { mirror, document } = loadedMirror();
    expect(mirror.invisibleIds.size).toBe(0);
    document.update('s', { opacity: 0 });
    mirror.observe(document.takeChanges(), PASSES);
    expect([...mirror.invisibleIds]).toEqual(['s']);
    expect(mirror.isVisibilityDirty).toBe(true);
    mirror.clearDirty();
    expect(mirror.isVisibilityDirty).toBe(false);
    document.update('s', { opacity: 0 });
    mirror.observe(document.takeChanges(), PASSES);
    expect(mirror.isVisibilityDirty).toBe(false);
    document.delete('s');
    mirror.observe(document.takeChanges(), PASSES);
    expect(mirror.invisibleIds.size).toBe(0);
    expect(mirror.isVisibilityDirty).toBe(true);
  });
});
