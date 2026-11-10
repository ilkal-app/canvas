import { describe, expect, it } from 'vitest';

import { textStyleSchema, type TextStyle } from '@canvas/schema';

import { ADA, BODY, createFixtureStore, id } from './__fixtures__/store-fixtures.js';
import { DocumentWriteError } from './document-write-error.js';
import type { YjsDocumentStore } from './yjs-document-store.js';

const RED: TextStyle = { ...BODY, color: [0.8, 0.1, 0.1, 1] };

/**
 * Runs one write in its own transaction.
 *
 * @param store - The store.
 * @param write - The write.
 */
function write(store: YjsDocumentStore, write: Parameters<YjsDocumentStore['transact']>[1]): void {
  store.transact(ADA, write);
}

describe('text edits', () => {
  it('merges and removes one variable axis on each Y.Text run', () => {
    const store = createFixtureStore();
    write(store, (transaction) => {
      transaction.formatText(id('text-title'), 0, 7, { fontVariations: { opsz: 18 } });
      transaction.formatText(id('text-title'), 7, 7, { fontVariations: { opsz: 24 } });
    });
    write(store, (transaction) => {
      transaction.formatText(id('text-title'), 0, 14, { fontVariationsAxes: { wght: 650 } });
    });
    // The fixture title has a bold run of 12 and a red run of 2, so opsz 24 covers two runs.
    const merged = store.get(id('text-title'));
    expect(merged?.type === 'text' && merged.runs.map(({ style }) => style.fontVariations)).toEqual(
      [
        { opsz: 18, wght: 650 },
        { opsz: 24, wght: 650 },
        { opsz: 24, wght: 650 },
      ],
    );
    write(store, (transaction) => {
      transaction.formatText(id('text-title'), 0, 14, { fontVariationsAxes: { opsz: null } });
    });
    const object = store.get(id('text-title'));
    expect(object?.type).toBe('text');
    if (object?.type === 'text') {
      // With opsz gone the two bold runs are one again: bold and red remain.
      expect(object.runs.map((run) => run.style.fontVariations)).toEqual([
        { wght: 650 },
        { wght: 650 },
      ]);
    }
    store.destroy();
  });

  it('insert characters in one style, merging with an equal neighbouring run', () => {
    const store = createFixtureStore();
    write(store, (transaction) => {
      transaction.insertText(id('sticky-idea'), 0, 'Now: ', RED);
      transaction.insertText(id('sticky-idea'), 21, '!', BODY);
    });
    expect(store.get(id('sticky-idea'))).toMatchObject({
      text: 'Now: Ship the beta 😀!',
      runs: [
        { length: 5, style: RED },
        { length: 17, style: BODY },
      ],
    });
  });

  it('edit a shape or connector label, and refuse objects without text', () => {
    const store = createFixtureStore();
    write(store, (transaction) => {
      transaction.insertText(id('shape-box'), 3, ' v2', BODY);
      transaction.deleteText(id('connector-flow'), 0, 2);
    });
    expect(store.get(id('shape-box'))).toMatchObject({ label: { text: 'API v2' } });
    expect(store.get(id('connector-flow'))).toMatchObject({ label: { text: 'comes' } });
    expect(() => {
      write(store, (transaction) => {
        transaction.insertText(id('shape-star'), 0, 'x', BODY);
      });
    }).toThrow(RangeError);
    expect(() => {
      write(store, (transaction) => {
        transaction.insertText(id('image-photo'), 0, 'x', BODY);
      });
    }).toThrow(RangeError);
  });

  it('keep the style of the first deleted character when the text is emptied', () => {
    const store = createFixtureStore();
    const bold = { ...BODY, weight: 700 as const };
    write(store, (transaction) => {
      transaction.deleteText(id('text-title'), 0, 14);
    });
    expect(store.get(id('text-title'))).toMatchObject({
      text: '',
      runs: [{ length: 0, style: bold }],
    });
    write(store, (transaction) => {
      transaction.formatText(id('text-title'), 0, 0, { italic: true });
    });
    expect(store.get(id('text-title'))).toMatchObject({
      runs: [{ length: 0, style: { ...bold, italic: true } }],
    });
  });

  it('set, keep and clear the coordinates of emptied text', () => {
    const store = createFixtureStore();
    const emptied = (): TextStyle | undefined => {
      const text = store.get(id('text-title'));
      return text?.type === 'text' ? text.runs[0]?.style : undefined;
    };
    write(store, (transaction) => {
      transaction.deleteText(id('text-title'), 0, 14);
      transaction.formatText(id('text-title'), 0, 0, { fontVariations: { wght: 650 } });
    });
    expect(emptied()?.fontVariations).toEqual({ wght: 650 });
    write(store, (transaction) => {
      transaction.formatText(id('text-title'), 0, 0, { italic: true });
    });
    expect(emptied()).toMatchObject({ italic: true, fontVariations: { wght: 650 } });
    write(store, (transaction) => {
      transaction.formatText(id('text-title'), 0, 0, { fontVariations: null });
    });
    expect(emptied()).not.toHaveProperty('fontVariations');
    write(store, (transaction) => {
      transaction.formatText(id('text-title'), 0, 0, { fontVariations: {} });
    });
    expect(emptied()).not.toHaveProperty('fontVariations');
  });

  it('stores an axis merge on empty text as a valid whole style', () => {
    const store = createFixtureStore();
    write(store, (transaction) => {
      transaction.deleteText(id('text-title'), 0, 14);
      transaction.formatText(id('text-title'), 0, 0, { fontVariationsAxes: { wght: 650 } });
    });
    const object = store.get(id('text-title'));
    expect(object?.type).toBe('text');
    if (object?.type === 'text') {
      const style = object.runs[0]?.style;
      expect(style?.fontVariations).toEqual({ wght: 650 });
      expect(style).not.toHaveProperty('fontVariationsAxes');
      expect(textStyleSchema.safeParse(style).success).toBe(true);
    }
    store.destroy();
  });

  it('refuses an axis merge that would exceed 16 axes without changing any run', () => {
    const store = createFixtureStore();
    const sixteen = Object.fromEntries(
      Array.from({ length: 16 }, (unused, index) => [`a${String(index).padStart(3, '0')}`, index]),
    );
    write(store, (transaction) => {
      transaction.formatText(id('text-title'), 0, 7, { fontVariations: sixteen });
    });
    const before = store.get(id('text-title'));
    const state = store.encodeState();
    expect(() => {
      write(store, (transaction) => {
        transaction.formatText(id('text-title'), 0, 14, { fontVariationsAxes: { wght: 650 } });
      });
    }).toThrow(DocumentWriteError);
    expect(store.get(id('text-title'))).toEqual(before);
    expect(store.encodeState()).toEqual(state);
    store.destroy();
  });

  it('writes no Y.Text change for a run whose merged axes already equal the patch', () => {
    const store = createFixtureStore();
    write(store, (transaction) => {
      transaction.formatText(id('text-title'), 0, 7, { fontVariations: { wght: 650 } });
    });
    const state = store.encodeState();
    let changes = 0;
    const stop = store.subscribe(() => {
      changes += 1;
    });
    write(store, (transaction) => {
      transaction.formatText(id('text-title'), 0, 7, { fontVariationsAxes: { wght: 650 } });
    });
    stop();
    expect(changes).toBe(0);
    expect(store.encodeState()).toEqual(state);
    store.destroy();
  });

  it('restyle only the given fields over a range', () => {
    const store = createFixtureStore();
    write(store, (transaction) => {
      transaction.formatText(id('text-title'), 7, 7, { fontSize: 32 });
    });
    const title = store.get(id('text-title'));
    expect(
      title?.type === 'text' && title.runs.map((run) => [run.length, run.style.fontSize]),
    ).toEqual([
      [7, 24],
      [5, 32],
      [2, 32],
    ]);
  });

  it('refuse invalid styles and ranges without writing', () => {
    const store = createFixtureStore();
    const before = store.get(id('sticky-idea'));
    const invalidWrites = [
      () => {
        write(store, (transaction) => {
          transaction.insertText(id('sticky-idea'), 0, 'x', { ...BODY, fontSize: 1 });
        });
      },
      () => {
        write(store, (transaction) => {
          transaction.formatText(id('sticky-idea'), 0, 1, { weight: 450 as 400 });
        });
      },
    ];
    const badRanges = [
      () => {
        write(store, (transaction) => {
          transaction.deleteText(id('sticky-idea'), 10, 10);
        });
      },
      () => {
        write(store, (transaction) => {
          transaction.insertText(id('sticky-idea'), -1, 'x', BODY);
        });
      },
      () => {
        write(store, (transaction) => {
          transaction.formatText(id('sticky-idea'), 0.5, 1, { italic: true });
        });
      },
      () => {
        // "Ship the beta 😀": the emoji's surrogate pair spans code units 14 and 15.
        write(store, (transaction) => {
          transaction.insertText(id('sticky-idea'), 15, 'x', BODY);
        });
      },
      () => {
        write(store, (transaction) => {
          transaction.deleteText(id('sticky-idea'), 13, 2);
        });
      },
    ];
    for (const attempt of invalidWrites) expect(attempt).toThrow(DocumentWriteError);
    for (const attempt of badRanges) expect(attempt).toThrow(RangeError);
    expect(store.get(id('sticky-idea'))).toBe(before);
  });

  it('do nothing for an empty insert or delete', () => {
    const store = createFixtureStore();
    const before = store.read();
    write(store, (transaction) => {
      transaction.insertText(id('sticky-idea'), 0, '', BODY);
      transaction.deleteText(id('sticky-idea'), 0, 0);
      transaction.formatText(id('sticky-idea'), 3, 0, { italic: true });
    });
    expect(store.read()).toBe(before);
  });
});
