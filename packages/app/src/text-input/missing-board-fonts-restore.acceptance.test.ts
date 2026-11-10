import { expect, it, vi } from 'vitest';

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

function textIn(id: string, family: string): TextObject {
  return {
    id: id as ObjectId,
    type: 'text',
    parentId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    rotation: 0,
    z: id === 'a' ? 'a0' : id === 'b' ? 'a1' : id === 'c' ? 'a2' : 'a3',
    locked: false,
    createdBy: ORIGIN.principalId,
    createdAt: 1,
    updatedAt: 1,
    text: 'ab',
    runs: [{ length: 2, style: { ...STYLE, fontFamily: family } }],
    autoWidth: false,
    align: 'left',
    verticalAlign: 'top',
  };
}

function fakeSources(restoreLocal?: MissingFontSources['restoreLocal']) {
  const statuses = new Map<string, FontLoadStatus>();
  const listeners = new Set<() => void>();
  const sources: MissingFontSources = {
    status: (family) => statuses.get(family) ?? 'ready',
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ensure: vi.fn(() => Promise.resolve(true)),
    ...(restoreLocal === undefined ? {} : { restoreLocal }),
  };
  const setStatus = (family: string, status: FontLoadStatus) => {
    statuses.set(family, status);
    for (const listener of listeners) listener();
  };
  return { sources, statuses, setStatus };
}

it('restores a newly missing set once, drops restored families, and never retries or restores failed ones', async () => {
  const store = new YjsDocumentStore();
  store.transact(ORIGIN, (tx) => {
    tx.setObject(textIn('a', 'Private A'));
    tx.setObject(textIn('b', 'Private B'));
    tx.setObject(textIn('c', 'Broken C'));
  });
  const restored: string[][] = [];
  const restoreLocal = vi.fn(async (families: readonly string[]) => {
    restored.push([...families]);
    await Promise.resolve();
    sourcesState.setStatus('Private A', 'ready');
    return ['Private A'];
  });
  const sourcesState = fakeSources(restoreLocal);
  sourcesState.statuses.set('Private A', 'missing');
  sourcesState.statuses.set('Private B', 'missing');
  sourcesState.statuses.set('Broken C', 'failed');
  const onChange = vi.fn<(families: readonly string[]) => void>();
  const stop = followMissingBoardFonts(store, onChange, sourcesState.sources);
  await vi.waitFor(() => {
    expect(restoreLocal).toHaveBeenCalledOnce();
  });
  expect(restored).toEqual([['Private A', 'Private B']]);
  await vi.waitFor(() => {
    expect(onChange.mock.lastCall).toEqual([['Broken C', 'Private B']]);
  });

  sourcesState.setStatus('Private B', 'loading');
  sourcesState.setStatus('Private B', 'missing');
  sourcesState.setStatus('Private A', 'missing');
  sourcesState.setStatus('Broken C', 'failed');
  expect(restoreLocal).toHaveBeenCalledOnce();
  sourcesState.statuses.set('Private D', 'missing');
  store.transact(ORIGIN, (tx) => {
    tx.setObject(textIn('d', 'Private D'));
  });
  await vi.waitFor(() => {
    expect(restoreLocal).toHaveBeenCalledTimes(2);
  });
  expect(restored[1]).toEqual(['Private D']);
  stop();
});

it('does not attempt restore when the source has no restoreLocal', () => {
  const store = new YjsDocumentStore();
  store.transact(ORIGIN, (tx) => {
    tx.setObject(textIn('a', 'Private A'));
  });
  const { sources, statuses } = fakeSources();
  statuses.set('Private A', 'missing');
  const onChange = vi.fn<(families: readonly string[]) => void>();
  const stop = followMissingBoardFonts(store, onChange, sources);
  expect(onChange).toHaveBeenCalledWith(['Private A']);
  stop();
});
