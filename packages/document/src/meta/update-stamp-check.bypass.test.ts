import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import { encodeHandUpdate, type HandItem } from './__fixtures__/hand-encoded-update.js';
import {
  guardProblemAfter,
  guardProblemOf,
  OLD_BUILD,
  oldBuildOn,
  relayHolding,
  updateOf,
} from './__fixtures__/stamp-check-fixtures.js';
import { createDocumentMeta, DOCUMENT_META_KEY, META_MAP_NAME } from './document-meta.js';
import { stampDocument } from './stamp-document.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// The bypasses of's second review: updates that hold a stamp Yjs never adds to the
// board, or an object entry the check did not see, which the relay accepted and which left a
// board no store opens. Each asserts the verdict, and that Yjs would indeed leave the board
// unversioned (`guardProblemAfter`), so the test fails if the update stops being dangerous.

/** The verdict of an update the relay must refuse for good: the old build never stamped. */
const UNSTAMPED = { kind: 'unstamped', writers: [OLD_BUILD] };

/**
 * A relay's copy of a board a stamped writer (client 1) made: one object, `a`, holding one
 * nested value.
 *
 * @returns The relay's document.
 */
function stampedBoard(): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = 1;
  doc.transact(() => {
    stampDocument(doc);
    const object = new Y.Map<unknown>();
    doc.getMap(OBJECTS_MAP_NAME).set('a', object);
    object.set('x', 1);
  });
  return relayHolding(Y.encodeStateAsUpdate(doc));
}

/**
 * The id of the board's current stamp item.
 *
 * @param doc - The board.
 * @returns The id.
 * @throws {Error} When the board has no stamp.
 */
function stampId(doc: Y.Doc): Y.ID {
  const item = doc.getMap(META_MAP_NAME)._map.get(DOCUMENT_META_KEY);
  if (item === undefined) throw new Error('the board has no stamp');
  return Y.createID(item.id.client, item.id.clock + item.length - 1);
}

/** A new `Y.Map` under key `evil` of `objects`, carrying its own parent. */
const EVIL_MAP: HandItem = {
  parent: OBJECTS_MAP_NAME,
  parentSub: 'evil',
  content: { kind: 'map' },
};

/**
 * A stamp item that replaces the board's current one, with a chosen right neighbour.
 *
 * @param doc - The board.
 * @param rightOrigin - The right neighbour it names.
 * @returns The item.
 */
function stampReplacing(doc: Y.Doc, rightOrigin: Y.ID): HandItem {
  return {
    origin: stampId(doc),
    rightOrigin,
    content: { kind: 'any', values: [createDocumentMeta()] },
  };
}

describe('UpdateStampCheck, stamps Yjs never adds and entries it does', () => {
  it('(a) never counts a stamp at a clock the board already holds from that writer', () => {
    const relay = stampedBoard();
    const check = new UpdateStampCheck(relay);
    const attacker = oldBuildOn(relay);
    const harmless = updateOf(attacker, () => {
      attacker.getText('notes').insert(0, 'x');
    });
    expect(check.check(harmless)).toEqual({ kind: 'accepted' });
    Y.applyUpdate(relay, harmless);
    // A second document under the same client id: clock 0 is a stamp there, clock 1 an object.
    // Yjs skips clock 0, which it holds, and applies the object.
    const forged = oldBuildOn(stampedBoard());
    const overlap = updateOf(forged, () => {
      stampDocument(forged);
      forged.getMap(OBJECTS_MAP_NAME).set('evil', new Y.Map());
    });
    expect(guardProblemAfter(relay, overlap)).toBe('unversioned');
    expect(check.check(overlap)).toEqual(UNSTAMPED);
  });

  it('(b) records a skipped range as a gap: a stamp waiting behind it does not count', () => {
    const relay = stampedBoard();
    const attacker = oldBuildOn(relay);
    const objects = updateOf(attacker, () => {
      attacker.getMap(OBJECTS_MAP_NAME).set('evil', new Y.Map());
    });
    updateOf(attacker, () => {
      attacker.getMap(META_MAP_NAME).set('filler', 1);
    });
    const stamp = updateOf(attacker, () => {
      stampDocument(attacker);
    });
    // Merged without the middle update, the writer's clocks hold a Skip struct.
    const merged = Y.mergeUpdates([objects, stamp]);
    expect(guardProblemAfter(relay, merged)).toBe('unversioned');
    expect(new UpdateStampCheck(relay).check(merged)).toEqual(UNSTAMPED);
  });

  it('(c) never counts a stamp whose right neighbour the board lacks, after its objects', () => {
    const relay = stampedBoard();
    const update = encodeHandUpdate([
      {
        client: OLD_BUILD,
        clock: 0,
        structs: [EVIL_MAP, stampReplacing(relay, Y.createID(999, 5))],
      },
    ]);
    expect(guardProblemAfter(relay, update)).toBe('unversioned');
    expect(new UpdateStampCheck(relay).check(update)).toEqual(UNSTAMPED);
  });

  it('(c) never counts a stamp whose right neighbour is a collected struct, which Yjs drops', () => {
    const relay = stampedBoard();
    // Deleting `a` collects its nested value: that id is now a GC struct on the board.
    relay.getMap(OBJECTS_MAP_NAME).delete('a');
    const collected = relay.store.clients.get(1)?.find((struct) => struct instanceof Y.GC);
    if (collected === undefined) throw new Error('nothing was collected');
    const update = encodeHandUpdate([
      { client: OLD_BUILD, clock: 0, structs: [stampReplacing(relay, collected.id), EVIL_MAP] },
    ]);
    expect(guardProblemAfter(relay, update)).toBe('unversioned');
    expect(new UpdateStampCheck(relay).check(update)).toEqual(UNSTAMPED);
  });

  it('(c) holds back a stamp whose right neighbour sits in another list, which may be collected', () => {
    const relay = stampedBoard();
    const nested = relay.getMap(OBJECTS_MAP_NAME).get('a');
    const valueX = nested instanceof Y.Map ? nested._map.get('x') : undefined;
    if (valueX === undefined) throw new Error('the board has no a.x');
    const update = encodeHandUpdate([
      { client: OLD_BUILD, clock: 0, structs: [stampReplacing(relay, valueX.id), EVIL_MAP] },
    ]);
    // The relay's copy keeps the stamp (its left neighbour places it); once `a` is deleted and
    // `a.x` collected, every replica that loads the board places it nowhere.
    const applied = relayHolding(Y.encodeStateAsUpdate(relay), update);
    expect(guardProblemOf(applied)).toBeUndefined();
    applied.getMap(OBJECTS_MAP_NAME).delete('a');
    expect(guardProblemOf(relayHolding(Y.encodeStateAsUpdate(applied)))).toBe('unversioned');
    expect(new UpdateStampCheck(relay).check(update)).toEqual({
      kind: 'unprovable',
      cause: 'unreadable-update',
      writers: [],
    });
  });

  it('holds back, as missing, a stamp whose right neighbour nobody sent, with its objects', () => {
    const relay = stampedBoard();
    const update = encodeHandUpdate([
      {
        client: OLD_BUILD,
        clock: 0,
        structs: [stampReplacing(relay, Y.createID(999, 5)), EVIL_MAP],
      },
    ]);
    expect(new UpdateStampCheck(relay).check(update)).toEqual({
      kind: 'unprovable',
      cause: 'missing-dependency',
      writers: [OLD_BUILD],
    });
  });

  it('never counts a stamp past a gap, which a later filler of the same clocks displaces', () => {
    const relay = stampedBoard();
    const check = new UpdateStampCheck(relay);
    // Clocks 5 and 6: a stamp, then an object. Yjs holds both back until clocks 0 to 4 arrive.
    const pastGap = encodeHandUpdate([
      {
        client: OLD_BUILD,
        clock: 5,
        structs: [stampReplacing(relay, Y.createID(1, 0)), EVIL_MAP],
      },
    ]);
    const filler = encodeHandUpdate([
      {
        client: OLD_BUILD,
        clock: 0,
        structs: [...Array(6).keys()].map((index) => ({
          parent: META_MAP_NAME,
          parentSub: `filler-${String(index)}`,
          content: { kind: 'any' as const, values: [index] },
        })),
      },
    ]);
    for (const update of [pastGap, filler]) {
      if (check.check(update).kind === 'accepted') Y.applyUpdate(relay, update);
    }
    expect(relay.getMap(OBJECTS_MAP_NAME).has('evil')).toBe(false);
    expect(guardProblemOf(relay)).toBeUndefined();
  });

  it('places an entry by the item the board holds at its origin, not the update’s copy', () => {
    const relay = stampedBoard();
    const objectA = relay.getMap(OBJECTS_MAP_NAME)._map.get('a');
    if (objectA === undefined) throw new Error('the board has no a');
    // Client 1's clocks up to `a` again, forged as maps under `meta`: Yjs skips them, and the
    // old build's map, whose origin is `a`, replaces `a`.
    const forgedClocks = [...Array(objectA.id.clock + 1).keys()].map((index) => ({
      parent: META_MAP_NAME,
      parentSub: `forged-${String(index)}`,
      content: { kind: 'map' as const },
    }));
    const update = encodeHandUpdate([
      { client: 1, clock: 0, structs: forgedClocks },
      { client: OLD_BUILD, clock: 0, structs: [{ origin: objectA.id, content: { kind: 'map' } }] },
    ]);
    expect(guardProblemAfter(relay, update)).toBe('unversioned');
    expect(new UpdateStampCheck(relay).check(update)).toEqual(UNSTAMPED);
  });

  it('reads a client listed twice as Yjs does: its last run only', () => {
    const relay = stampedBoard();
    const update = encodeHandUpdate([
      { client: OLD_BUILD, clock: 0, structs: [stampReplacing(relay, Y.createID(1, 0))] },
      { client: OLD_BUILD, clock: 0, structs: [EVIL_MAP] },
    ]);
    expect(guardProblemAfter(relay, update)).toBe('unversioned');
    expect(new UpdateStampCheck(relay).check(update)).toEqual(UNSTAMPED);
  });

  it('counts a plain value under objects, as the store’s guard does', () => {
    const relay = stampedBoard();
    const attacker = oldBuildOn(relay);
    const plain = updateOf(attacker, () => {
      attacker.getMap(OBJECTS_MAP_NAME).set('p', 5);
    });
    expect(guardProblemAfter(relay, plain)).toBe('unversioned');
    expect(new UpdateStampCheck(relay).check(plain)).toEqual(UNSTAMPED);
    const stamped = oldBuildOn(relay);
    const honest = updateOf(stamped, () => {
      stampDocument(stamped);
      stamped.getMap(OBJECTS_MAP_NAME).set('p', 5);
    });
    expect(new UpdateStampCheck(relay).check(honest)).toEqual({ kind: 'accepted' });
  });
});
