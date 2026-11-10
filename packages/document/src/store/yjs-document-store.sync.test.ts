import { describe, expect, it } from 'vitest';

import { exportBoard } from '@canvas/schema';

import {
  ADA,
  BOB,
  BODY,
  createFixtureStore,
  createSyncedPair,
  exchange,
  fixtureBoard,
  fixtureObject,
  id,
} from './__fixtures__/store-fixtures.js';
import { DocumentWriteError } from './document-write-error.js';
import { YjsDocumentStore } from './yjs-document-store.js';

// Sync tests for the shared types of this package: two stores exchange
// updates as two clients would and must converge.
// Randomised concurrent commands on N clients are the sync fuzz harness's (tooling/sync-fuzz).
// It edits through the command layer, which has no vector-network member command yet, so merges
// such as a segment ending at a concurrently deleted vertex are not fuzzed until one exists.

describe('the fixture board through the store', () => {
  it('round-trips importBoard → store → read() deep-equal, every object type included', () => {
    // The snapshot's map is a sealed Map subclass; copy it to compare with a plain Map.
    expect(new Map(createFixtureStore().read().objects)).toEqual(fixtureBoard().objects);
  });

  it('reaches a second store through encodeState and applyUpdate intact', () => {
    const [, second] = createSyncedPair();
    expect(new Map(second.read().objects)).toEqual(fixtureBoard().objects);
    expect(exportBoard(second.read())).toEqual(exportBoard(fixtureBoard()));
    expect(second.read().issues).toEqual([]);
  });
});

describe('text outside the basic plane', () => {
  it('refuses runs that split a surrogate pair, which would diverge the peers', () => {
    const [ada, bob] = createSyncedPair();
    // "Ship the beta 😀": the emoji is code units 14 and 15; a run ending at 15 splits it.
    const split = {
      text: 'Ship the beta 😀',
      runs: [
        { length: 15, style: BODY },
        { length: 1, style: { ...BODY, weight: 700 as const } },
      ],
    };
    expect(() => {
      ada.transact(ADA, (transaction) => {
        transaction.patchObject(id('sticky-idea'), split);
      });
    }).toThrow(DocumentWriteError);
    expect(() => {
      ada.transact(ADA, (transaction) => {
        transaction.setObject({ ...fixtureObject('sticky-idea', 'sticky'), ...split });
      });
    }).toThrow(DocumentWriteError);
    exchange(ada, bob);
    expect(ada.get(id('sticky-idea'))).toMatchObject({ text: 'Ship the beta 😀' });
    expect(bob.read().objects).toEqual(ada.read().objects);
  });

  it('converges when the emoji is restyled on a character boundary', () => {
    const [ada, bob] = createSyncedPair();
    const bold = { ...BODY, weight: 700 as const };
    ada.transact(ADA, (transaction) => {
      transaction.patchObject(id('sticky-idea'), {
        runs: [
          { length: 14, style: BODY },
          { length: 2, style: bold },
        ],
      });
    });
    exchange(ada, bob);
    expect(bob.get(id('sticky-idea'))).toMatchObject({
      text: 'Ship the beta 😀',
      runs: [
        { length: 14, style: BODY },
        { length: 2, style: bold },
      ],
    });
    expect(bob.read().objects).toEqual(ada.read().objects);
  });
});

describe('two stores converge', () => {
  it('when two clients edit different objects concurrently', () => {
    const [ada, bob] = createSyncedPair();
    ada.transact(ADA, (transaction) => {
      transaction.patchObject(id('image-photo'), { opacity: 0.5 });
    });
    bob.transact(BOB, (transaction) => {
      transaction.patchObject(id('frame-plan'), { name: 'Launch plan (final)' });
      transaction.deleteObject(id('comment-free'));
    });
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.get(id('image-photo'))).toMatchObject({ opacity: 0.5 });
    expect(ada.get(id('frame-plan'))).toMatchObject({ name: 'Launch plan (final)' });
    expect(ada.get(id('comment-free'))).toBeUndefined();
  });

  it('when two clients edit different fields of one object concurrently', () => {
    const [ada, bob] = createSyncedPair();
    ada.transact(ADA, (transaction) => {
      transaction.patchObject(id('shape-box'), { x: 120, y: 80 });
    });
    bob.transact(BOB, (transaction) => {
      transaction.patchObject(id('shape-box'), { fill: [1, 0, 0, 1], cornerRadius: 4 });
    });
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.get(id('shape-box'))).toMatchObject({
      x: 120,
      y: 80,
      fill: [1, 0, 0, 1],
      cornerRadius: 4,
    });
  });

  it('when two clients edit different runs of one text concurrently', () => {
    const [ada, bob] = createSyncedPair();
    // "Launch plan v2": run 0 is "Launch plan " (bold), run 1 is "v2" (red).
    ada.transact(ADA, (transaction) => {
      transaction.insertText(id('text-title'), 7, 'beta ', { ...BODY, weight: 700 });
    });
    bob.transact(BOB, (transaction) => {
      transaction.formatText(id('text-title'), 12, 2, { italic: true });
      transaction.insertText(id('text-title'), 14, '!', { ...BODY, italic: true });
    });
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    const title = ada.get(id('text-title'));
    expect(title).toMatchObject({ text: 'Launch beta plan v2!' });
    expect(title?.type === 'text' && title.runs.map((run) => run.length)).toEqual([17, 2, 1]);
    expect(title?.type === 'text' && title.runs[1]?.style).toMatchObject({
      color: [0.8, 0.1, 0.1, 1],
      italic: true,
    });
  });

  it('when two clients restyle the same range with different style fields', () => {
    const [ada, bob] = createSyncedPair();
    ada.transact(ADA, (transaction) => {
      transaction.formatText(id('sticky-idea'), 0, 4, { weight: 700 });
    });
    bob.transact(BOB, (transaction) => {
      transaction.formatText(id('sticky-idea'), 0, 4, { color: [0, 0, 1, 1] });
    });
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    const sticky = ada.get(id('sticky-idea'));
    expect(sticky?.type === 'sticky' && sticky.runs[0]).toEqual({
      length: 4,
      style: { ...BODY, weight: 700, color: [0, 0, 1, 1] },
    });
  });

  it('when two clients edit different vertices of one path concurrently', () => {
    const [ada, bob] = createSyncedPair();
    ada.transact(ADA, (transaction) => {
      transaction.setVertex(id('path-squiggle'), { id: 'v1', x: -10, y: -10, mirror: 'none' });
    });
    bob.transact(BOB, (transaction) => {
      transaction.setVertex(id('path-squiggle'), { id: 'v3', x: 250, y: 60, mirror: 'angle' });
      transaction.setVertex(id('path-squiggle'), { id: 'v4', x: 300, y: 0, mirror: 'none' });
      transaction.setSegment(id('path-squiggle'), {
        id: 's3',
        a: 'v3',
        b: 'v4',
        ha: { x: 0, y: 0 },
        hb: { x: 0, y: 0 },
      });
    });
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    const path = ada.get(id('path-squiggle'));
    expect(path?.type === 'path' && path.vertices).toEqual([
      { id: 'v1', x: -10, y: -10, mirror: 'none' },
      { id: 'v2', x: 100, y: 0, mirror: 'both' },
      { id: 'v3', x: 250, y: 60, mirror: 'angle' },
      { id: 'v4', x: 300, y: 0, mirror: 'none' },
    ]);
    expect(path?.type === 'path' && path.segments.map((segment) => segment.id)).toEqual([
      's1',
      's2',
      's3',
    ]);
  });

  it('on one value when two clients set the same field concurrently', () => {
    const [ada, bob] = createSyncedPair();
    ada.transact(ADA, (transaction) => {
      transaction.patchObject(id('video-demo'), { loop: false });
    });
    bob.transact(BOB, (transaction) => {
      transaction.patchObject(id('video-demo'), { loop: true, muted: false });
    });
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
  });

  it('when updates arrive in any order, through a third store', () => {
    const [ada, bob] = createSyncedPair();
    const carol = new YjsDocumentStore();
    ada.transact(ADA, (transaction) => {
      transaction.patchObject(id('line-divider'), { route: 'elbow' });
    });
    bob.transact(BOB, (transaction) => {
      transaction.deleteText(id('text-title'), 0, 7);
    });
    exchange(bob, carol);
    exchange(ada, carol);
    exchange(ada, bob);
    expect(carol.read().objects).toEqual(ada.read().objects);
    expect(bob.read().objects).toEqual(ada.read().objects);
    expect(ada.get(id('text-title'))).toMatchObject({ text: 'plan v2' });
  });
});
