// The board's missing fonts as a document state: which families the tracker reports
// over stubbed font statuses, as objects and text styles change and as fonts load or fail.
import { describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import type { ObjectId, PrincipalId, TextObject, TextStyle } from '@canvas/schema';

import type { FontLoadStatus } from './demand-fonts.js';
import { followMissingBoardFonts, type MissingFontSources } from './missing-board-fonts.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;

const STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 16,
  weight: 400,
  italic: false,
  color: [0, 0, 0, 1],
};

/**
 * A text object in one family.
 *
 * @param id - Its id.
 * @param fontFamily - Its family.
 * @returns The object.
 */
function textIn(id: string, fontFamily: string): TextObject {
  return {
    id: id as ObjectId,
    type: 'text',
    parentId: null,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    z: id === 'a' ? 'a0' : 'a1',
    locked: false,
    createdBy: ORIGIN.principalId,
    createdAt: 1,
    updatedAt: 1,
    text: 'ab',
    runs: [{ length: 2, style: { ...STYLE, fontFamily } }],
    autoWidth: true,
    align: 'left',
    verticalAlign: 'top',
  };
}

/**
 * Font statuses the test sets, with a listener list and the families asked for.
 *
 * @returns The sources, the statuses, the requested families and a status change.
 */
function fakeSources() {
  const statuses = new Map<string, FontLoadStatus>();
  const listeners = new Set<() => void>();
  const ensured: string[] = [];
  const sources: MissingFontSources = {
    status: (family) => statuses.get(family) ?? 'ready',
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ensure: (family) => {
      ensured.push(family);
      return Promise.resolve(true);
    },
  };
  const setStatus = (family: string, status: FontLoadStatus) => {
    statuses.set(family, status);
    for (const listener of listeners) listener();
  };
  return { sources, statuses, ensured, setStatus, listeners };
}

describe('followMissingBoardFonts', () => {
  it('reports the missing and failed families the objects name, sorted, and asks for each once', () => {
    const store = new YjsDocumentStore();
    store.transact(ORIGIN, (tx) => {
      tx.setObject(textIn('a', 'Brand Serif'));
      tx.setObject(textIn('b', 'Brand Grotesk'));
    });
    const { sources, statuses, ensured } = fakeSources();
    statuses.set('Brand Serif', 'missing');
    statuses.set('Brand Grotesk', 'failed');
    const onChange = vi.fn<(families: readonly string[]) => void>();
    const stop = followMissingBoardFonts(store, onChange, sources);
    expect(onChange.mock.calls).toEqual([[['Brand Grotesk', 'Brand Serif']]]);
    expect(ensured.sort()).toEqual(['Brand Grotesk', 'Brand Serif']);
    stop();
  });

  it('follows edits and font loads, calling only when the list changes', () => {
    const store = new YjsDocumentStore();
    store.transact(ORIGIN, (tx) => {
      tx.setObject(textIn('a', 'Brand Serif'));
    });
    const { sources, setStatus, ensured, listeners } = fakeSources();
    const onChange = vi.fn<(families: readonly string[]) => void>();
    const stop = followMissingBoardFonts(store, onChange, sources);
    expect(onChange.mock.calls).toEqual([[[]]]);
    setStatus('Brand Serif', 'loading');
    expect(onChange).toHaveBeenCalledTimes(1);
    setStatus('Brand Serif', 'missing');
    expect(onChange.mock.lastCall).toEqual([['Brand Serif']]);

    // A second object in the same family changes nothing; a new family is asked for.
    store.transact(ORIGIN, (tx) => {
      tx.setObject(textIn('b', 'Brand Serif'));
    });
    expect(onChange).toHaveBeenCalledTimes(2);
    store.transact(ORIGIN, (tx) => {
      tx.patchObject('b' as ObjectId, { runs: [{ length: 2, style: STYLE }] });
    });
    expect(ensured).toEqual(['Brand Serif', 'Inter']);
    // Gone from every object, the family is no longer missing.
    store.transact(ORIGIN, (tx) => {
      tx.deleteObject('a' as ObjectId);
    });
    expect(onChange.mock.lastCall).toEqual([[]]);

    stop();
    expect(listeners.size).toBe(0);
    store.transact(ORIGIN, (tx) => {
      tx.setObject(textIn('a', 'Brand Serif'));
    });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('reports a family only a text style names', () => {
    const store = new YjsDocumentStore();
    const { sources, statuses, ensured } = fakeSources();
    statuses.set('Brand Mono', 'missing');
    const onChange = vi.fn<(families: readonly string[]) => void>();
    const stop = followMissingBoardFonts(store, onChange, sources);
    store.transact(ORIGIN, (tx) => {
      tx.setNamedStyle(
        'text',
        {
          id: 'code',
          name: 'Code',
          value: { fontFamily: 'Brand Mono', fontSize: 16, weight: 400, italic: false },
        },
        { createdBy: ORIGIN.principalId, createdAt: 1 },
      );
    });
    expect(onChange.mock.lastCall).toEqual([['Brand Mono']]);
    expect(ensured).toEqual(['Brand Mono']);
    // Deleted, the style no longer names it.
    store.transact(ORIGIN, (tx) => {
      tx.deleteNamedStyle('text', 'code');
    });
    expect(onChange.mock.lastCall).toEqual([[]]);
    stop();
  });

  it('reads only the objects a change set names, and counts a family until no source names it', () => {
    const store = new YjsDocumentStore();
    store.transact(ORIGIN, (tx) => {
      tx.setObject(textIn('a', 'Brand Serif'));
      tx.setObject(textIn('b', 'Brand Serif'));
    });
    const { sources, statuses } = fakeSources();
    statuses.set('Brand Serif', 'missing');
    const onChange = vi.fn<(families: readonly string[]) => void>();
    const stop = followMissingBoardFonts(store, onChange, sources);
    const reads = vi.spyOn(store, 'get');
    const readAll = vi.spyOn(store, 'read');
    store.transact(ORIGIN, (tx) => {
      tx.deleteObject('a' as ObjectId);
    });
    expect(reads.mock.calls).toEqual([['a']]);
    expect(readAll).not.toHaveBeenCalled();
    // 'b' still names it.
    expect(onChange.mock.calls).toEqual([[['Brand Serif']]]);
    store.transact(ORIGIN, (tx) => {
      tx.deleteObject('b' as ObjectId);
    });
    expect(onChange.mock.lastCall).toEqual([[]]);
    stop();
  });

  it('leaves a family missing when its local restore rejects', async () => {
    const store = new YjsDocumentStore();
    store.transact(ORIGIN, (tx) => {
      tx.setObject(textIn('a', 'Brand Serif'));
    });
    const { sources, statuses } = fakeSources();
    statuses.set('Brand Serif', 'missing');
    const restoreLocal = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    const onChange = vi.fn<(families: readonly string[]) => void>();
    const stop = followMissingBoardFonts(store, onChange, { ...sources, restoreLocal });
    await vi.waitFor(() => {
      expect(restoreLocal).toHaveBeenCalledOnce();
    });
    // Settled without an unhandled rejection (vitest fails the run on one).
    await Promise.resolve();
    expect(onChange.mock.lastCall).toEqual([['Brand Serif']]);
    stop();
  });
});
