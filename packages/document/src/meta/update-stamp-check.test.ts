import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { toYjs } from '../codec/object-codec.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  fixtureBoard,
  fixtureObject,
} from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  oldBuildOn,
  OLD_BUILD,
  relayHolding,
  updateOf,
} from './__fixtures__/stamp-check-fixtures.js';
import { stampDocument } from './stamp-document.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// The relay's reading of the per-writer rule: an update may give object entries only
// to writers that stamped, in the board's document already or in the update itself.

/** The verdict of an update the relay may apply. */
const ACCEPTED = { kind: 'accepted' };

describe('UpdateStampCheck', () => {
  it('passes a store’s first update, whose stamp travels with its objects', () => {
    const store = createFixtureStore();
    const check = new UpdateStampCheck(new Y.Doc());
    expect(check.check(store.encodeState())).toEqual(ACCEPTED);
  });

  it('passes later creations by a writer whose stamp the board already holds', () => {
    const store = createFixtureStore();
    const relay = relayHolding(store.encodeState());
    const before = store.encodeStateVector();
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...fixtureObject('frame-plan', 'frame'), id: 'rect-new' } as never);
    });
    expect(new UpdateStampCheck(relay).check(store.encodeState(before))).toEqual(ACCEPTED);
  });

  it('names a writer that creates objects without a stamp, on an empty or a stamped board', () => {
    const object = fixtureBoard().objects.values().next().value;
    if (object === undefined) throw new Error('the fixture board is empty');
    const empty = new Y.Doc();
    const writer = oldBuildOn(empty);
    const creation = updateOf(writer, () => {
      writer.getMap(OBJECTS_MAP_NAME).set('old-object', toYjs(object));
    });
    expect(new UpdateStampCheck(empty).check(creation)).toEqual({
      kind: 'unstamped',
      writers: [OLD_BUILD],
    });

    const stamped = relayHolding(createFixtureStore().encodeState());
    const onStamped = oldBuildOn(stamped);
    const later = updateOf(onStamped, () => {
      onStamped.getMap(OBJECTS_MAP_NAME).set('old-object', toYjs(object));
    });
    expect(new UpdateStampCheck(stamped).check(later)).toEqual({
      kind: 'unstamped',
      writers: [OLD_BUILD],
    });
  });

  it('names a writer that replaces an existing object entry without a stamp', () => {
    const relay = relayHolding(createFixtureStore().encodeState());
    const writer = oldBuildOn(relay);
    const replacement = updateOf(writer, () => {
      writer.getMap(OBJECTS_MAP_NAME).set('frame-plan', toYjs(fixtureObject('shape-box', 'shape')));
    });
    expect(new UpdateStampCheck(relay).check(replacement)).toEqual({
      kind: 'unstamped',
      writers: [OLD_BUILD],
    });
  });

  it('passes an unstamped writer that stamps in the same update, as stampDocument writers do', () => {
    const relay = relayHolding(createFixtureStore().encodeState());
    const writer = oldBuildOn(relay);
    const stampedCreation = updateOf(writer, () => {
      stampDocument(writer);
      writer.getMap(OBJECTS_MAP_NAME).set('import', toYjs(fixtureObject('shape-box', 'shape')));
    });
    expect(new UpdateStampCheck(relay).check(stampedCreation)).toEqual(ACCEPTED);
  });

  it('counts a writer whose stamp lost to a concurrent one and is held only as deleted', () => {
    const ada = new YjsDocumentStore({ clientId: 1 });
    const bob = new YjsDocumentStore({ clientId: 2 });
    ada.transact(ADA, (transaction) => {
      transaction.setObject(fixtureObject('frame-plan', 'frame'));
    });
    bob.transact(BOB, (transaction) => {
      transaction.setObject(fixtureObject('shape-box', 'shape'));
    });
    const relay = relayHolding(ada.encodeState(), bob.encodeState());
    const check = new UpdateStampCheck(relay);
    const before = ada.encodeStateVector();
    ada.transact(ADA, (transaction) => {
      transaction.setObject({ ...fixtureObject('frame-plan', 'frame'), id: 'rect-later' } as never);
    });
    expect(check.check(ada.encodeState(before))).toEqual(ACCEPTED);
    const beforeBob = bob.encodeStateVector();
    bob.transact(BOB, (transaction) => {
      transaction.setObject({ ...fixtureObject('shape-box', 'shape'), id: 'rect-bob' } as never);
    });
    expect(check.check(bob.encodeState(beforeBob))).toEqual(ACCEPTED);
  });

  it('holds back, unapplied, a writer whose earlier update, with its stamp, was lost', () => {
    const store = new YjsDocumentStore();
    store.transact(ADA, (transaction) => {
      transaction.setObject(fixtureObject('frame-plan', 'frame'));
    });
    const lost = store.encodeStateVector();
    store.transact(ADA, (transaction) => {
      transaction.setObject({
        ...fixtureObject('frame-plan', 'frame'),
        id: 'frame-later',
      } as never);
    });
    // The relay never received the first update (a dropped frame): the second one leaves a gap
    // in the writer's clocks, which may hold its stamp. The relay does not apply it; the
    // client's next sync, after it reconnects, carries the whole range, stamp included.
    const relay = new Y.Doc();
    const second = store.encodeState(lost);
    expect(new UpdateStampCheck(relay).check(second)).toEqual({
      kind: 'unprovable',
      cause: 'clock-gap',
      writers: [internalsOf(store).doc.clientID],
    });
    expect(new UpdateStampCheck(relay).check(store.encodeState())).toEqual(ACCEPTED);
  });

  it('ignores edits inside existing objects, which the store’s guard does not check either', () => {
    const relay = relayHolding(createFixtureStore().encodeState());
    const writer = oldBuildOn(relay);
    const edit = updateOf(writer, () => {
      const entry = writer.getMap(OBJECTS_MAP_NAME).get('frame-plan');
      if (!(entry instanceof Y.Map)) throw new Error('frame-plan is not a map');
      entry.set('locked', true);
    });
    expect(new UpdateStampCheck(relay).check(edit)).toEqual(ACCEPTED);
  });

  it('holds back an object entry whose origin neither side holds, which Yjs keeps pending', () => {
    const source = relayHolding(createFixtureStore().encodeState());
    const writer = oldBuildOn(source);
    const replacement = updateOf(writer, () => {
      writer.getMap(OBJECTS_MAP_NAME).set('frame-plan', toYjs(fixtureObject('shape-box', 'shape')));
    });
    expect(new UpdateStampCheck(new Y.Doc()).check(replacement)).toEqual({
      kind: 'unprovable',
      cause: 'missing-dependency',
      writers: [OLD_BUILD],
    });
  });

  it('checks the same bytes a store refuses', () => {
    const relay = relayHolding(createFixtureStore().encodeState());
    const writer = oldBuildOn(relay);
    const creation = updateOf(writer, () => {
      writer.getMap(OBJECTS_MAP_NAME).set('old', toYjs(fixtureObject('shape-box', 'shape')));
    });
    const reader = new YjsDocumentStore();
    reader.applyUpdate(Y.encodeStateAsUpdate(relay), ADA);
    expect(() => {
      reader.applyUpdate(creation, ADA);
    }).toThrow(/client 77/);
    expect(internalsOf(reader).doc.getMap(OBJECTS_MAP_NAME).has('old')).toBe(true);
    expect(new UpdateStampCheck(relay).check(creation)).toEqual({
      kind: 'unstamped',
      writers: [OLD_BUILD],
    });
  });
});
