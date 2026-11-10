import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { toYjs } from '../codec/object-codec.js';
import { createFixtureStore, fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import { alternatingListChain, alternatingTextChain } from './__fixtures__/long-chains.js';
import {
  OLD_BUILD,
  oldBuildOn,
  relayHolding,
  updateOf,
} from './__fixtures__/stamp-check-fixtures.js';
import { stampDocument } from './stamp-document.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// What the relay's stamp check will not accept without proof (fix round 1): the relay
// applies only what it can prove, so an update it cannot place is held back, and a long update
// costs one step per item.

/** The verdict of an update the relay may apply. */
const ACCEPTED = { kind: 'accepted' };

/**
 * An update whose one struct is a `Y.Map` inserted before an existing item and after nothing:
 * Yjs takes its parent and key from that right neighbour (bytes of update format v1).
 *
 * @param client - The writer's client id.
 * @param right - The right neighbour's id.
 * @returns The update.
 */
function mapBeforeItem(client: number, right: Y.ID): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1); // one client
  encoding.writeVarUint(encoder, 1); // one struct
  encoding.writeVarUint(encoder, client);
  encoding.writeVarUint(encoder, 0); // first clock
  encoding.writeUint8(encoder, 0b0100_0111); // a right origin, ContentType
  encoding.writeVarUint(encoder, right.client);
  encoding.writeVarUint(encoder, right.clock);
  encoding.writeVarUint(encoder, 1); // Y.Map
  encoding.writeVarUint(encoder, 0); // an empty delete set
  return encoding.toUint8Array(encoder);
}

describe('UpdateStampCheck, what it cannot prove', () => {
  it('checks a 20,000-item chain in one step per item, within a generous bound', () => {
    // Building the chains takes longer than checking them; only the check is timed.
    for (const update of [alternatingTextChain(20_000), alternatingListChain(20_000)]) {
      const started = performance.now();
      expect(new UpdateStampCheck(new Y.Doc()).check(update)).toEqual(ACCEPTED);
      // Linear, this is a few milliseconds (a few hundred on a machine loaded far beyond its
      // cores); the quadratic walk of the review took 10 to 20 s at this length.
      expect(performance.now() - started).toBeLessThan(5_000);
    }
  }, 60_000);

  it('holds back an update past its work ceiling', () => {
    const check = new UpdateStampCheck(new Y.Doc(), 1_000);
    expect(check.check(alternatingListChain(2_000))).toEqual({
      kind: 'unprovable',
      cause: 'work-ceiling',
      writers: [],
    });
  });

  it('holds back bytes it cannot read rather than letting Yjs have them', () => {
    expect(new UpdateStampCheck(new Y.Doc()).check(Uint8Array.of(1, 1, 5))).toEqual({
      kind: 'unprovable',
      cause: 'unreadable-update',
      writers: [],
    });
  });

  it('never lets objects past a clock gap: the gap update is held back, the filler passes', () => {
    const relay = relayHolding(createFixtureStore().encodeState());
    const attacker = oldBuildOn(relay);
    const filler = updateOf(attacker, () => {
      attacker.getText('notes').insert(0, 'harmless');
    });
    const objects = updateOf(attacker, () => {
      attacker.getMap(OBJECTS_MAP_NAME).set('smuggled', toYjs(fixtureObject('shape-box', 'shape')));
    });
    const check = new UpdateStampCheck(relay);
    expect(check.check(objects)).toEqual({
      kind: 'unprovable',
      cause: 'clock-gap',
      writers: [OLD_BUILD],
    });
    // The relay applied nothing of the first; the second alone holds no object.
    expect(check.check(filler)).toEqual(ACCEPTED);
    Y.applyUpdate(relay, filler);
    expect(relay.getMap(OBJECTS_MAP_NAME).has('smuggled')).toBe(false);
    // Once the gap is filled, the same objects are provably unstamped.
    expect(check.check(objects)).toEqual({ kind: 'unstamped', writers: [OLD_BUILD] });
  });

  it('places a stamped client’s object deleted and created again under the same id', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      stampDocument(doc);
      doc.getMap(OBJECTS_MAP_NAME).set('shape-box', new Y.Map());
    });
    doc.getMap(OBJECTS_MAP_NAME).delete('shape-box');
    doc.getMap(OBJECTS_MAP_NAME).set('shape-box', new Y.Map());
    expect(new UpdateStampCheck(new Y.Doc()).check(Y.encodeStateAsUpdate(doc))).toEqual(ACCEPTED);
  });

  it('accepts an edit inside an object another writer deleted, whose values the relay dropped', () => {
    const board = new Y.Doc();
    board.transact(() => {
      stampDocument(board);
      const label = new Y.Map<unknown>();
      const shape = new Y.Map<unknown>([['label', label]]);
      board.getMap(OBJECTS_MAP_NAME).set('shape-box', shape);
    });
    const relay = relayHolding(Y.encodeStateAsUpdate(board));
    const writer = oldBuildOn(relay);
    // The relay deletes the object meanwhile: Yjs collects its nested values.
    relay.getMap(OBJECTS_MAP_NAME).delete('shape-box');
    const edit = updateOf(writer, () => {
      const shape = writer.getMap(OBJECTS_MAP_NAME).get('shape-box');
      if (!(shape instanceof Y.Map)) throw new Error('shape-box is not a map');
      shape.set('label', new Y.Map());
    });
    expect(new UpdateStampCheck(relay).check(edit)).toEqual(ACCEPTED);
  });

  it('counts a map that takes its key from its right neighbour, as Yjs places it', () => {
    const relay = relayHolding(createFixtureStore().encodeState());
    const entry = relay.getMap(OBJECTS_MAP_NAME)._map.get('frame-plan');
    if (entry === undefined) throw new Error('the fixture board has no frame-plan');
    expect(new UpdateStampCheck(relay).check(mapBeforeItem(OLD_BUILD, entry.id))).toEqual({
      kind: 'unstamped',
      writers: [OLD_BUILD],
    });
  });
});
