import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { frameObject, shapeObject, zKeyAt } from '../__fixtures__/scene-objects.js';

import { stickyObject, textObject } from './__fixtures__/note-and-text-passes.js';
import {
  board,
  CAMERA,
  changeText,
  currentObjects,
  draw,
  freshDraw,
  install,
  PASSES,
  type Board,
} from './__fixtures__/segment-board.js';
import type { PlannedPass } from './segment-plan.js';
import { compareStacking } from './stacking-order.js';
import type { ZOrderSegments } from './z-order-segments.js';

function tableOf(segments: ZOrderSegments, name: string): PlannedPass {
  const tables = (segments as unknown as { slots: { tables: readonly PlannedPass[] } }).slots
    .tables;
  const table = tables.find((pass) => pass.name === name);
  if (!table) throw new Error(`Missing ${name} slot-owner table`);
  return table;
}

function expectFrame(
  board: Board,
  ids: Iterable<string>,
  builds: number,
  patches: number,
  camera: Camera = CAMERA,
): string[] {
  board.renderer.enqueue(board.document.takeChanges());
  const drawn = draw(board, camera);
  expect(drawn).toEqual(freshDraw(currentObjects(board.document, ids), camera));
  expect(board.segments.counts.slotBuilds).toBe(builds);
  expect(
    (board.segments as ZOrderSegments & { readonly slotPatchCount: number }).slotPatchCount,
  ).toBe(patches);
  expect(Object.keys(board.segments.counts)).toEqual([
    'orderBuilds',
    'orderEdits',
    'slotBuilds',
    'plans',
    'slotCompactions',
  ]);
  return drawn;
}

describe('incremental slot owners', () => {
  it('mutates a sufficiently long table in place and preserves an untouched pass', () => {
    const test = board();
    const ids = ['a', 'note'];
    install(test, [textObject('a', { z: 'a0', text: 'abcdefgh' }), stickyObject('note')]);
    const textBefore = tableOf(test.segments, 'text');
    const noteBefore = tableOf(test.segments, 'note');
    const ranksBefore = textBefore.owners.rankOfSlot;
    const recordsBefore = textBefore.owners.recordOfSlot;
    changeText(test.document, 'a', 'abc');
    expectFrame(test, ids, 1, 1);
    expect(tableOf(test.segments, 'text')).toBe(textBefore);
    expect(tableOf(test.segments, 'text').owners.rankOfSlot).toBe(ranksBefore);
    expect(tableOf(test.segments, 'text').owners.recordOfSlot).toBe(recordsBefore);
    expect(tableOf(test.segments, 'note')).toBe(noteBefore);
    const textSlots = new Set(test.renderer.scene.slotsOf('a' as ObjectId, 'text'));
    for (let slot = 0; slot < ranksBefore.length; slot += 1) {
      if (!textSlots.has(slot)) expect(ranksBefore[slot]).toBe(-1);
    }
  });

  it('reallocates only when the record count exceeds its table, leaving the grown tail unowned', () => {
    const test = board();
    const ids = ['a'];
    install(test, [textObject('a', { text: 'a' })]);
    const before = tableOf(test.segments, 'text');
    changeText(test.document, 'a', 'abcdefghijklmnop');
    expectFrame(test, ids, 1, 1);
    const after = tableOf(test.segments, 'text');
    const count = test.renderer.scene.instanceBufferOf('text').recordCount;
    expect(after).not.toBe(before);
    expect(after.owners.rankOfSlot.length).toBeGreaterThanOrEqual(count);
    expect(after.owners.recordOfSlot.length).toBe(after.owners.rankOfSlot.length);
    const owned = new Set(test.renderer.scene.slotsOf('a' as ObjectId, 'text'));
    for (let slot = 0; slot < after.owners.rankOfSlot.length; slot += 1) {
      if (!owned.has(slot)) expect(after.owners.rankOfSlot[slot]).toBe(-1);
    }
  });

  it('matches fresh stages through seeded count edits and alternating visible sets', () => {
    let seed = 0x5242a;
    const random = (limit: number): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % limit;
    };
    const test = board();
    const ids = ['a', 'b', 'c', 'note'];
    install(test, [
      textObject('a', { z: 'a0', text: 'a' }),
      textObject('b', { z: 'a1', text: 'bb' }),
      textObject('c', { z: 'a2', text: 'ccc' }),
      stickyObject('note', { z: 'a3' }),
    ]);
    const lengths = [1, 2, 3];
    for (let step = 0; step < 48; step += 1) {
      const index = random(3);
      const length = lengths[index];
      const id = ids[index];
      if (length === undefined || id === undefined)
        throw new RangeError(`No text ${String(index)}.`);
      const nextLength = 1 + ((length + random(8)) % 9);
      lengths[index] = nextLength;
      changeText(test.document, id, 'x'.repeat(nextLength));
      const camera = {
        ...CAMERA,
        x: step % 3 === 0 ? 10_000 : random(200),
        zoom: step % 2 ? 2 : 1,
      };
      expectFrame(test, ids, 1, step + 1, camera);
      // The following camera-only frame reuses the patched owners and may change visibility.
      expect(draw(test, { ...CAMERA, x: step % 2 ? 10_000 : 0 })).toEqual(
        freshDraw(currentObjects(test.document, ids), { ...CAMERA, x: step % 2 ? 10_000 : 0 }),
      );
    }
  });
  it('patches a growing text, including growth beyond the old buffer record count', () => {
    const test = board();
    const ids = ['a', 'note', 'b'];
    install(test, [
      textObject('a', { z: 'a0', text: 'a' }),
      stickyObject('note', { z: 'a1' }),
      textObject('b', { z: 'a2', text: 'b' }),
    ]);
    changeText(test.document, 'a', 'abcdefgh');
    const drawn = expectFrame(test, ids, 1, 1);
    expect(drawn.filter((entry) => entry === 'text:a')).toHaveLength(8);
    expect(test.segments.counts.orderBuilds).toBe(1);
  });

  it('patches released slots, zero records and growth back in consecutive frames', () => {
    const test = board();
    const ids = ['a', 'note', 'b'];
    install(test, [
      textObject('a', { z: 'a0', text: 'abcdef' }),
      stickyObject('note', { z: 'a1' }),
      textObject('b', { z: 'a2' }),
    ]);
    changeText(test.document, 'a', 'ab');
    expectFrame(test, ids, 1, 1);
    changeText(test.document, 'a', '');
    expect(expectFrame(test, ids, 1, 2)).not.toContain('text:a');
    changeText(test.document, 'a', 'xyz');
    expect(expectFrame(test, ids, 1, 3).filter((entry) => entry === 'text:a')).toHaveLength(3);
  });

  it('patches several changed owners once per frame and reuses released slots', () => {
    const test = board();
    const ids = ['a', 'note', 'b', 'c'];
    install(test, [
      textObject('a', { z: 'a0', text: 'abcdef' }),
      stickyObject('note', { z: 'a1' }),
      textObject('b', { z: 'a2', text: 'a' }),
      textObject('c', { z: 'a3', text: 'a' }),
    ]);
    const formerSlots = new Set(
      test.renderer.scene
        .slotEntriesOf('text')
        .get('a' as ObjectId)
        ?.slice(1),
    );
    changeText(test.document, 'a', 'a');
    changeText(test.document, 'b', 'abcde');
    changeText(test.document, 'c', 'xyz');
    const drawn = expectFrame(test, ids, 1, 1);
    expect(drawn.filter((entry) => entry === 'text:b')).toHaveLength(5);
    expect(drawn.filter((entry) => entry === 'text:c')).toHaveLength(3);
    expect(
      test.renderer.scene
        .slotEntriesOf('text')
        .get('b' as ObjectId)
        ?.some((slot) => formerSlots.has(slot)),
    ).toBe(true);
    changeText(test.document, 'b', 'ab');
    changeText(test.document, 'a', 'abcd');
    expectFrame(test, ids, 1, 2);
  });

  it('patches a pass drawn at a frame closing rank without moving it before descendants', () => {
    const test = board();
    const ids = ['frame', 'child', 'above'];
    install(test, [
      frameObject('frame', { z: 'a0', name: 'one', stroke: { color: [0, 0, 0, 1], width: 2 } }),
      shapeObject('child', { parentId: 'frame', z: 'a0' }),
      shapeObject('above', { z: 'a1' }),
    ]);
    test.document.update('frame', { name: 'longer' });
    const drawn = expectFrame(test, ids, 1, 1);
    expect(drawn.indexOf('frame-stroke:frame')).toBeGreaterThan(drawn.indexOf('shape:child'));
    expect(drawn.filter((entry) => entry === 'frame-stroke:frame')).toHaveLength(6);
  });

  it('patches an addition on top and leaf additions, removals, z and parent moves anywhere; rebuilds for closing-rank changes', () => {
    const test = board();
    const ids = new Set(['frame', 'child', 'a']);
    install(test, [
      frameObject('frame', { z: 'a0' }),
      shapeObject('child', { parentId: 'frame', z: 'a0' }),
      textObject('a', { z: 'a1' }),
    ]);
    test.document.create(textObject('b', { z: 'a2' }));
    ids.add('b');
    expectFrame(test, ids, 1, 1);
    expect(test.segments.counts.orderBuilds).toBe(1);
    test.document.create(textObject('low', { z: 'a0' }));
    ids.add('low');
    expectFrame(test, ids, 1, 2);
    test.document.update('b', { z: 'a0' });
    expectFrame(test, ids, 1, 3);
    test.document.update('b', { parentId: 'frame' as ObjectId });
    expectFrame(test, ids, 1, 4);
    test.document.update('frame', { stroke: { color: [0, 0, 0, 1], width: 2 } });
    expectFrame(test, ids, 2, 4);
    test.document.update('frame', { stroke: undefined });
    expectFrame(test, ids, 3, 4);
    test.document.delete('b');
    ids.delete('b');
    expectFrame(test, ids, 3, 5);
    expect(test.segments.counts.orderEdits).toBe(4);
  });
});

it('matches a fresh segment stage after 200 seeded mixed edits over 60 objects', () => {
  let seed = 0x52420;
  const random = (limit: number): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % limit;
  };
  const test = board();
  const ids = new Set<string>();
  const objects: BoardObject[] = [];
  for (let index = 0; index < 60; index += 1) {
    const id = `o${String(index)}`;
    ids.add(id);
    const fields = { z: zKeyAt(index) };
    objects.push(
      index % 6 === 0
        ? frameObject(id, { ...fields, stroke: { color: [0, 0, 0, 1], width: 2 } })
        : index % 3 === 0
          ? shapeObject(id, fields)
          : textObject(id, fields),
    );
  }
  install(test, objects);
  let nextId = 60;
  let builds = 1;
  let patches = 0;
  for (let step = 0; step < 200; step += 1) {
    const active = [...ids];
    const id = active[random(active.length)];
    if (!id) throw new Error('Seeded board unexpectedly has no objects');
    const operation = random(5);
    if (operation === 0 && active.length < 75) {
      // A leaf root: appended on top or edited in below it, its slots patched.
      const added = textObject(`o${String(nextId++)}`, { z: zKeyAt(random(1000)) });
      ids.add(added.id);
      test.document.create(added);
      patches += 1;
    } else if (operation === 1 && active.length > 45) {
      // A stroked frame has a closing rank: its removal walks the order and rebuilds the slots.
      const isFrame = test.document.get(id as ObjectId)?.type === 'frame';
      test.document.delete(id);
      ids.delete(id);
      if (isFrame) builds += 1;
      else patches += 1;
    } else if (operation === 2) {
      const object = test.document.get(id as ObjectId);
      // The topmost root raised again keeps its place: nothing changes.
      const isTop = active.every((other) => {
        const sibling = test.document.get(other as ObjectId);
        return other === id || !sibling || !object || compareStacking(sibling, object) < 0;
      });
      test.document.update(id, { z: zKeyAt(1000 + step) });
      if (object?.type === 'frame') builds += 1;
      else if (!isTop) patches += 1;
    } else {
      let changedId = id;
      if (test.document.get(id as ObjectId)?.type === 'shape') {
        // A shape has a stable one-record pass; use an existing text instead.
        changedId =
          active.find((candidate) => test.document.get(candidate as ObjectId)?.type === 'text') ??
          '';
      }
      const previous = test.document.get(changedId as ObjectId);
      if (!previous) throw new Error(`No object for seeded edit at step ${String(step)}`);
      if (previous.type === 'frame') {
        test.document.update(changedId, { name: 'f'.repeat(1 + random(8)) });
      } else {
        changeText(test.document, changedId, 'x'.repeat(random(9)));
      }
      // Equal record counts are a no-op for the table, yet may still update the object.
      const next = test.document.get(changedId as ObjectId);
      if (!next) throw new Error(`Edited object vanished at step ${String(step)}`);
      const before = PASSES.map((pass) => pass.recordCount(previous));
      const after = PASSES.map((pass) => pass.recordCount(next));
      if (before.some((count, index) => count !== after[index])) patches += 1;
    }
    expectFrame(test, ids, builds, patches);
  }
});
