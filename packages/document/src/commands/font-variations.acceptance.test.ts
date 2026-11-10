import { describe, expect, it } from 'vitest';

import { resolveInstance } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { boardOf } from '../repair/__fixtures__/repair-fixtures.js';
import { ADA, createFixtureStore, id } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedMainWithChildren } from './__fixtures__/component-boards.js';
import { mustFindCommand, overridesOf } from './__fixtures__/component-fixtures.js';
import { setStyleCommand } from './set-style.js';

describe('font variation commands', () => {
  it('merges one axis per stored run in one command and one undo step', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA.principalId);
    try {
      // The fixture title has a bold run of 12 and a red run of 2, so opsz 24 covers two runs.
      store.transact(ADA, (transaction) => {
        transaction.formatText(id('text-title'), 0, 7, { fontVariations: { opsz: 18 } });
        transaction.formatText(id('text-title'), 7, 7, { fontVariations: { opsz: 24 } });
      });
      const before = mustGet(store, 'text-title');
      const written = applyCommand(store, setStyleCommand, {
        changes: [
          { id: 'text-title', style: { textStyle: { fontVariationsAxes: { wght: 650 } } } },
        ],
      });
      expect(written.changes.updated).toEqual(['text-title']);
      const merged = mustGet(store, 'text-title');
      expect(
        merged.type === 'text' && merged.runs.map(({ style }) => style.fontVariations),
      ).toEqual([
        { opsz: 18, wght: 650 },
        { opsz: 24, wght: 650 },
        { opsz: 24, wght: 650 },
      ]);
      expect(history.undo()).toBe(true);
      expect(mustGet(store, 'text-title')).toEqual(before);
    } finally {
      history.destroy();
      store.destroy();
    }
  });

  it('removes only a requested axis and drops a record emptied by removal', () => {
    const store = createFixtureStore();
    try {
      store.transact(ADA, (transaction) => {
        transaction.formatText(id('text-title'), 0, 7, { fontVariations: { opsz: 18 } });
        transaction.formatText(id('text-title'), 7, 7, {
          fontVariations: { opsz: 24, wght: 600 },
        });
      });
      applyCommand(store, setStyleCommand, {
        changes: [
          { id: 'text-title', style: { textStyle: { fontVariationsAxes: { opsz: null } } } },
        ],
      });
      const object = mustGet(store, 'text-title');
      expect(object.type).toBe('text');
      if (object.type === 'text') {
        expect(object.runs[0]?.style).not.toHaveProperty('fontVariations');
        expect(object.runs[1]?.style.fontVariations).toEqual({ wght: 600 });
      }
    } finally {
      store.destroy();
    }
  });

  it('gives a whole coordinate record precedence over an axis merge in one patch', () => {
    const store = createFixtureStore();
    try {
      applyCommand(store, setStyleCommand, {
        changes: [
          {
            id: 'text-title',
            style: {
              textStyle: {
                fontVariations: { wght: 700 },
                fontVariationsAxes: { opsz: 24 },
              },
            },
          },
        ],
      });
      const object = mustGet(store, 'text-title');
      expect(object.type).toBe('text');
      if (object.type === 'text') {
        expect(object.runs.map((run) => run.style.fontVariations)).toEqual([
          { wght: 700 },
          { wght: 700 },
        ]);
      }
    } finally {
      store.destroy();
    }
  });

  it.each([{ bad: 650 }, { 'w\u0001ht': 650 }, { wght: 100_001 }, { wght: Number.NaN }])(
    'rejects an invalid axis patch without writing: %j',
    (axes) => {
      const store = createFixtureStore();
      try {
        expectRejected(store, setStyleCommand, {
          changes: [{ id: 'text-title', style: { textStyle: { fontVariationsAxes: axes } } }],
        });
      } finally {
        store.destroy();
      }
    },
  );
  it('refuses the whole style command when one run would exceed 16 axes', () => {
    const store = createFixtureStore();
    try {
      const sixteen = Object.fromEntries(
        Array.from({ length: 16 }, (unused, index) => [
          `a${String(index).padStart(3, '0')}`,
          index,
        ]),
      );
      store.transact(ADA, (transaction) => {
        transaction.formatText(id('text-title'), 0, 7, { fontVariations: sixteen });
      });
      const before = mustGet(store, 'text-title');
      expectRejected(store, setStyleCommand, {
        changes: [
          { id: 'text-title', style: { textStyle: { fontVariationsAxes: { wght: 650 } } } },
        ],
      });
      expect(mustGet(store, 'text-title')).toEqual(before);
    } finally {
      store.destroy();
    }
  });
  it('sets and clears coordinates on a text range through the style command', () => {
    const store = createFixtureStore();
    try {
      applyCommand(store, setStyleCommand, {
        changes: [
          { id: 'text-title', style: { textStyle: { fontVariations: { wght: 650, wdth: 90 } } } },
        ],
      });
      // The fixture's title has two runs (bold, then red); the style command sets every run.
      const styled = mustGet(store, 'text-title');
      expect(styled.type).toBe('text');
      if (styled.type === 'text') {
        expect(styled.runs.map((run) => run.style.fontVariations)).toEqual([
          { wght: 650, wdth: 90 },
          { wght: 650, wdth: 90 },
        ]);
      }
      applyCommand(store, setStyleCommand, {
        changes: [{ id: 'text-title', style: { textStyle: { fontVariations: null } } }],
      });
      const text = mustGet(store, 'text-title');
      expect(text.type).toBe('text');
      if (text.type === 'text') {
        for (const run of text.runs) expect(run.style).not.toHaveProperty('fontVariations');
      }
    } finally {
      store.destroy();
    }
  });

  it('carries coordinates through a component text style override', () => {
    const store = new YjsDocumentStore();
    try {
      const { mainId, noteId } = seedMainWithChildren(store);
      const instanceId = placeInstance(store, mainId, { instanceId: 'inst-1' });
      applyCommand(store, mustFindCommand('setInstanceOverride'), {
        id: instanceId,
        path: noteId,
        override: { textStyle: { fontVariations: { wght: 650 } } },
      });
      expect(overridesOf(store, instanceId)[noteId]).toEqual({
        textStyle: { fontVariations: { wght: 650 } },
      });
      const resolved = resolveInstance(boardOf(store), mustGet(store, instanceId) as never);
      expect(
        resolved.objects.find((object) => object.id === `${instanceId}/${noteId}`),
      ).toMatchObject({
        runs: [{ style: { fontVariations: { wght: 650 } } }],
      });
    } finally {
      store.destroy();
    }
  });
});
