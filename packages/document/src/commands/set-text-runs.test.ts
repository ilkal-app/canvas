import { describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import {
  ADA,
  BOB,
  BODY,
  createFixtureStore,
  createSyncedPair,
  exchange,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { setTextRunsCommand } from './set-text-runs.js';

const BOLD = { ...BODY, weight: 700 as const };

describe('setTextRuns', () => {
  it("replaces a sticky's text and runs, stamping it", () => {
    const store = createFixtureStore();
    const before = store.read();
    const runs = [
      { length: 4, style: BOLD },
      { length: 4, style: BODY },
    ];
    const { result, changes } = applyCommand(store, setTextRunsCommand, {
      id: 'sticky-idea',
      text: 'Ship it!',
      runs,
    });
    expect(result).toEqual({ id: 'sticky-idea' });
    expectDiff(before, store.read(), changes, { updated: ['sticky-idea'] });
    expect(mustGet(store, 'sticky-idea')).toEqual({
      ...fixtureObject('sticky-idea', 'sticky'),
      text: 'Ship it!',
      runs,
      updatedAt: NOW,
    });
  });

  it("removes a run's named text style when the new runs name none", () => {
    const store = createFixtureStore();
    const styled = { ...BODY, textStyleId: 'body' };
    applyCommand(store, setTextRunsCommand, {
      id: 'sticky-idea',
      text: 'Ship it!',
      runs: [{ length: 8, style: styled }],
    });
    expect(mustGet(store, 'sticky-idea')).toMatchObject({ runs: [{ style: styled }] });
    applyCommand(store, setTextRunsCommand, {
      id: 'sticky-idea',
      text: 'Ship it!',
      runs: [
        { length: 4, style: styled },
        { length: 4, style: BODY },
      ],
    });
    const { runs } = mustGet(store, 'sticky-idea') as {
      runs: { style: { textStyleId?: string } }[];
    };
    expect(runs.map(({ style }) => style.textStyleId)).toEqual(['body', undefined]);
  });

  it('sets the label of a shape or connector, creating one where there is none', () => {
    const store = createFixtureStore();
    // The star is locked in the fixture; a locked object's text is refused.
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('shape-star'), { locked: false });
    });
    const label = { text: 'Go', runs: [{ length: 2, style: BODY }] };
    applyCommand(store, setTextRunsCommand, { id: 'shape-star', ...label });
    applyCommand(store, setTextRunsCommand, { id: 'connector-flow', ...label });
    expect(mustGet(store, 'shape-star')).toMatchObject({ label });
    expect(mustGet(store, 'connector-flow')).toMatchObject({ label });
  });

  it('merges with a concurrent edit elsewhere in the same text, never replacing it wholesale', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, setTextRunsCommand, {
      id: 'sticky-idea',
      text: 'Launch the beta 😀',
      runs: [{ length: 18, style: BODY }],
    });
    applyCommand(
      bob,
      setTextRunsCommand,
      { id: 'sticky-idea', text: 'Ship the beta 😀 now', runs: [{ length: 20, style: BODY }] },
      BOB,
    );
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.get(id('sticky-idea'))).toMatchObject({
      text: 'Launch the beta 😀 now',
      runs: [{ length: 22, style: BODY }],
    });
  });

  it('rejects objects without text, missing objects and malformed runs without writing', () => {
    const store = createFixtureStore();
    const content = { text: 'x', runs: [{ length: 1, style: BODY }] };
    expect(expectRejected(store, setTextRunsCommand, { id: 'image-photo', ...content })).toEqual([
      expect.objectContaining({ code: 'unsupported-type', objectId: 'image-photo', path: ['id'] }),
    ]);
    expect(expectRejected(store, setTextRunsCommand, { id: 'gone', ...content })).toEqual([
      expect.objectContaining({ code: 'missing-object', objectId: 'gone', path: ['id'] }),
    ]);
    const tooShort = { id: 'sticky-idea', text: 'xy', runs: [{ length: 1, style: BODY }] };
    expect(expectRejected(store, setTextRunsCommand, tooShort)).toEqual([
      expect.objectContaining({ code: 'invalid-input', path: ['runs'] }),
    ]);
  });

  it('refuses a locked object, as a move or resize does, writing nothing', () => {
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('text-title'), { locked: true });
    });
    const content = { text: 'x', runs: [{ length: 1, style: BODY }] };
    expect(expectRejected(store, setTextRunsCommand, { id: 'text-title', ...content })).toEqual([
      expect.objectContaining({ code: 'locked', objectId: 'text-title', path: ['id'] }),
    ]);
  });

  it('rejects runs that split a surrogate pair as invalid input, in a body and in a label', () => {
    const store = createFixtureStore();
    const split = {
      text: 'a😀',
      runs: [
        { length: 2, style: BODY },
        { length: 1, style: BOLD },
      ],
    };
    // The schema's run invariant refuses the boundary, so the input schema does, before the
    // command reads the board.
    expect(expectRejected(store, setTextRunsCommand, { id: 'text-title', ...split })).toEqual([
      expect.objectContaining({ code: 'invalid-input', path: ['runs', 1] }),
    ]);
    expect(expectRejected(store, setTextRunsCommand, { id: 'shape-box', ...split })).toEqual([
      expect.objectContaining({ code: 'invalid-input', path: ['runs', 1] }),
    ]);
  });

  it('writes the measured size with the text in one change set and one undo step', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA.principalId);
    const before = store.read();
    const original = mustGet(store, 'text-title');
    const { changes } = applyCommand(store, setTextRunsCommand, {
      id: 'text-title',
      text: 'Hello there',
      runs: [{ length: 11, style: BODY }],
      size: { width: 123.5, height: 40 },
    });
    expectDiff(before, store.read(), changes, { updated: ['text-title'] });
    expect(mustGet(store, 'text-title')).toMatchObject({
      text: 'Hello there',
      width: 123.5,
      height: 40,
    });
    expect(history.undo()).toBe(true);
    expect(mustGet(store, 'text-title')).toMatchObject({
      text: original.type === 'text' ? original.text : '',
      width: 'width' in original ? original.width : 0,
      height: 'height' in original ? original.height : 0,
    });
    history.destroy();
  });

  it('refuses a size for a label and sizes that are not positive, writing nothing', () => {
    const store = createFixtureStore();
    const content = { text: 'x', runs: [{ length: 1, style: BODY }] };
    const size = { width: 10, height: 10 };
    expect(
      expectRejected(store, setTextRunsCommand, { id: 'shape-box', ...content, size }),
    ).toEqual([
      expect.objectContaining({ code: 'unsupported-type', objectId: 'shape-box', path: ['size'] }),
    ]);
    for (const bad of [
      { width: 0, height: 10 },
      { width: 10, height: -1 },
      { width: Number.POSITIVE_INFINITY, height: 1 },
    ]) {
      expect(
        expectRejected(store, setTextRunsCommand, { id: 'text-title', ...content, size: bad }),
      ).toEqual([expect.objectContaining({ code: 'invalid-input' })]);
    }
  });
});
