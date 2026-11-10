// Failure kind 3: an honest client was closed by the relay. It held a width the door
// refuses (2^40, put on the board by stored history), resized only the height, and its command
// kept the width, as let a command keep a value it does not change; but the hub had
// meanwhile repaired the width (another client's resize, or this client was offline), so the door
// judged the kept width as a change and closed the client for good. A size is now judged whole:
// no command, undo or redo writes a size the door refuses, even one the board holds.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import {
  ADA_PRINCIPAL,
  FAR_WIDTH,
  judgedRestore,
  mergeRaw,
  runAsAda,
} from '../history/__fixtures__/door-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { ADA, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { mustGet, testEnvironment } from './__fixtures__/command-fixtures.js';
import { judgedAtDoor } from './__fixtures__/door-judgement.js';
import { poisonedStore } from './__fixtures__/poisoned-board.js';
import { COMMANDS } from './registry.js';
import { runCommand } from './run-command.js';

describe('a size the door refuses, kept by a command that writes the size', () => {
  it.each([
    ['a width past 2^32', { width: FAR_WIDTH }, 'width'],
    ['a NaN height', { height: Number.NaN }, 'height'],
    ['a negative width', { width: -1 }, 'width'],
  ] as const)(
    'refuses a resize of the other dimension around %s, naming it, and writes nothing',
    (name, fields, field) => {
      const store = poisonedStore(undefined);
      mergeRaw(store, 'box', 'size', fields);
      const before = store.encodeState();
      const other = field === 'width' ? { width: 0, height: 10 } : { width: 10, height: 0 };
      const { result, findings } = judgedAtDoor(store, () =>
        runCommand(
          store,
          ADA,
          COMMANDS.resizeObjects,
          { resizes: [{ id: 'box', by: other }] },
          testEnvironment(),
        ),
      );
      expect(result.status === 'rejected' ? result.errors : [], name).toEqual([
        expect.objectContaining({ code: 'invalid-object', objectId: 'box', path: [field] }),
      ]);
      expect(findings).toEqual([]);
      expect(store.encodeState()).toEqual(before);
    },
  );

  it('moves around it, inward, and takes a resize that replaces it', () => {
    const store = poisonedStore(undefined);
    mergeRaw(store, 'box', 'size', { width: FAR_WIDTH });
    const { result, findings } = judgedAtDoor(store, () => [
      runCommand(
        store,
        ADA,
        COMMANDS.moveObjects,
        { moves: [{ id: 'box', by: { x: -5, y: 0 } }] },
        testEnvironment(),
      ).status,
      runCommand(
        store,
        ADA,
        COMMANDS.resizeObjects,
        { resizes: [{ id: 'box', to: { width: 100, height: 60 } }] },
        testEnvironment(),
      ).status,
    ]);
    expect(result).toEqual(['applied', 'applied']);
    expect(findings).toEqual([]);
    expect(mustGet(store, 'box')).toMatchObject({ width: 100, height: 60 });
  });

  it.each([
    ['a NaN height', { height: Number.NaN }, 'height'],
    ['an infinite height', { height: Number.POSITIVE_INFINITY }, 'height'],
    ['a width past 2^32', { width: FAR_WIDTH }, 'width'],
  ] as const)(
    "refuses a group's resize scaling %s it holds, naming that object's size",
    (name, fields, field) => {
      const store = poisonedStore(undefined);
      runAsAda(store, 'group', { ids: ['box', 'top'], groupId: 'g1' });
      mergeRaw(store, 'box', 'size', fields);
      const before = store.encodeState();
      const outcome = runCommand(
        store,
        ADA,
        COMMANDS.resizeObjects,
        { resizes: [{ id: 'g1', by: { width: 0, height: 10 } }] },
        testEnvironment(),
      );
      // Before, a size that is not finite left the group's box unscalable and the resize was
      // refused as invalid input, which no model of the board's bound explains.
      expect(outcome.status === 'rejected' ? outcome.errors : [], name).toEqual([
        expect.objectContaining({ code: 'invalid-object', objectId: 'box', path: [field] }),
      ]);
      expect(store.encodeState()).toEqual(before);
    },
  );
});

describe("a group's resize that scales a refused size into range", () => {
  it('applies: an honest repair stays possible (review of)', () => {
    const store = poisonedStore(undefined);
    runAsAda(store, 'group', { ids: ['box', 'top'], groupId: 'g1' });
    mergeRaw(store, 'box', 'size', { width: FAR_WIDTH });
    const { result, findings } = judgedAtDoor(store, () =>
      runCommand(
        store,
        ADA,
        COMMANDS.resizeObjects,
        { resizes: [{ id: 'g1', to: { width: 100, height: 60 } }] },
        testEnvironment(),
      ),
    );
    expect(result.status).toBe('applied');
    expect(findings).toEqual([]);
    const box = mustGet(store, 'box') as unknown as { readonly width: number };
    expect(box.width).toBeLessThanOrEqual(100);
  });
});

describe('a crop of an image whose size is not finite', () => {
  // Failure kind 2: the crop derives the image's box from its size, and from an infinite
  // height derived a place that is not finite, refused as x and y, which no model of the
  // run explains; it is refused naming the size it derives from. (A finite size past 2^32
  // derives a finite box, which the board's bound judges: `derived-bound.test.ts`.)
  it.each([
    ['an infinite height', { height: Number.POSITIVE_INFINITY }, 'height'],
    ['a NaN width', { width: Number.NaN }, 'width'],
  ] as const)('is refused naming %s, and writes nothing', (name, fields, field) => {
    const store = createFixtureStore();
    mergeRaw(store, 'image-photo', 'size', fields);
    const before = store.encodeState();
    const outcome = runCommand(
      store,
      ADA,
      COMMANDS.setStyle,
      {
        changes: [
          {
            id: 'image-photo',
            style: { opacity: 0.75, crop: { x: 0, y: 0.4, width: 0.5, height: 0.1 } },
          },
        ],
      },
      testEnvironment(),
    );
    expect(outcome.status === 'rejected' ? outcome.errors : [], name).toEqual([
      expect.objectContaining({ code: 'invalid-object', objectId: 'image-photo', path: [field] }),
    ]);
    expect(store.encodeState()).toEqual(before);
  });

  it('restyles its opacity alone, which derives nothing from the size', () => {
    const store = createFixtureStore();
    mergeRaw(store, 'image-photo', 'size', { height: Number.POSITIVE_INFINITY });
    runAsAda(store, 'setStyle', { changes: [{ id: 'image-photo', style: { opacity: 0.5 } }] });
    expect(mustGet(store, 'image-photo')).toMatchObject({ opacity: 0.5 });
  });
});

describe('an undo restoring a size the door refuses that the board holds again', () => {
  it('leaves the restore out, keeps the size the board holds, and says out-of-range', () => {
    const store = poisonedStore(undefined);
    const history = createHistory(store, ADA_PRINCIPAL);
    mergeRaw(store, 'box', 'size', { width: FAR_WIDTH });
    runAsAda(store, 'resizeObjects', { resizes: [{ id: 'box', to: { width: 10, height: 100 } }] });
    // A peer puts the same width back: the restore's width equals what the board holds, which
    //'s guard let through, and the hub may hold another by the time it arrives.
    mergeRaw(store, 'box', 'size', { width: FAR_WIDTH });
    const undone = judgedRestore(store, history, 'undo');
    expect(undone).toMatchObject({ omission: 'out-of-range', findings: [] });
    expect(store.get('box' as ObjectId)).toMatchObject({ width: FAR_WIDTH, height: 100 });
    history.destroy();
  });
});
