import { describe, expect, it } from 'vitest';

import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';

describe('run language style commands', () => {
  it.each(['text-title', 'sticky-idea', 'shape-box'])(
    'sets and removes the language of text on %s',
    (id) => {
      const store = createFixtureStore();
      try {
        applyCommand(store, setStyleCommand, {
          changes: [{ id, style: { textStyle: { lang: 'ja' } } }],
        });
        const styled = mustGet(store, id);
        if (id === 'shape-box') {
          expect(styled).toMatchObject({ label: { runs: [{ style: { lang: 'ja' } }] } });
        } else {
          // Every run of the text takes the language (the text fixture has several runs).
          const { runs } = styled as unknown as { runs: readonly { style: { lang?: string } }[] };
          expect(runs.length).toBeGreaterThan(0);
          for (const run of runs) expect(run.style.lang).toBe('ja');
        }
        applyCommand(store, setStyleCommand, {
          changes: [{ id, style: { textStyle: { lang: null } } }],
        });
        const cleared = mustGet(store, id);
        if (id === 'shape-box') {
          expect(cleared).not.toHaveProperty('label.runs.0.style.lang');
        } else {
          expect(cleared).not.toHaveProperty('runs.0.style.lang');
        }
      } finally {
        store.destroy();
      }
    },
  );

  it('stores a range language as its own Y.Text formatting attribute', () => {
    const store = createFixtureStore();
    try {
      const original = mustGet(store, 'text-title');
      if (original.type !== 'text') throw new Error('Missing text fixture');
      store.transact({ kind: 'user', principalId: original.createdBy }, (transaction) => {
        transaction.formatText(original.id, 0, 2, { lang: 'ja' });
      });
      const text = mustGet(store, 'text-title');
      const runs = (
        text as unknown as { runs: readonly { length: number; style: { lang?: string } }[] }
      ).runs;
      expect(runs[0]).toMatchObject({ length: 2, style: { lang: 'ja' } });
      expect(runs[1]?.style.lang).toBeUndefined();
    } finally {
      store.destroy();
    }
  });
});
