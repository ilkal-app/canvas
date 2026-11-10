// @vitest-environment jsdom
// useBoardTokens: the board view's token table, again after a token change only.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TokenEntry, TokenTable } from '@canvas/schema';

import type { BoardView } from '../engine/board-view.js';

import { useBoardTokens } from './use-board-tokens.js';

const BRAND: TokenEntry = {
  id: 'brand1',
  name: 'Brand',
  light: [1, 0, 0, 1],
  dark: [0, 0, 1, 1],
  builtin: false,
  createdBy: null,
  createdAt: 0,
};

/**
 * A board view with a token table that can be replaced, telling its token listeners.
 *
 * @returns The view and a way to change the table.
 */
function tokenView() {
  let table: TokenTable = new Map();
  const listeners = new Set<() => void>();
  const view = {
    tokens: () => table,
    subscribeTokens: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as BoardView;
  const change = (next: TokenTable) => {
    table = next;
    for (const listener of listeners) listener();
  };
  return { view, change, listeners };
}

describe('useBoardTokens', () => {
  it('is empty without a view or a view without tokens', () => {
    expect(renderHook(() => useBoardTokens(undefined)).result.current.size).toBe(0);
    const bare = {} as BoardView;
    expect(renderHook(() => useBoardTokens(bare)).result.current.size).toBe(0);
  });

  it('follows the view’s table and stops listening when unmounted', () => {
    const { view, change, listeners } = tokenView();
    const { result, unmount } = renderHook(() => useBoardTokens(view));
    expect(result.current.size).toBe(0);
    const next: TokenTable = new Map([['brand1', BRAND]]);
    act(() => {
      change(next);
    });
    expect(result.current).toBe(next);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
