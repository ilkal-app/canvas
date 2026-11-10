// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChangeSet } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type { BoardView, BoardViewChange, BoardViewState } from '../engine/board-view.js';

import { useBoardViewState } from './use-board-view-state.js';

afterEach(cleanup);

/**
 * A board view whose document changes and stepped runs a test drives.
 *
 * @param hasRuns - Whether the view tells when no stepped run holds the board (`whenIdle`).
 * @returns The view and what drives it.
 */
function testView(hasRuns: boolean) {
  const listeners = new Set<(change: BoardViewChange) => void>();
  const idle: (() => void)[] = [];
  let isRunning = false;
  let state: BoardViewState = { documentVersion: 0, selectedIds: [], enteredGroupId: null };
  const tell = (change: BoardViewChange) => {
    for (const listener of listeners) listener(change);
  };
  const view = {
    board: { get: () => undefined },
    state: () => state,
    select: () => undefined,
    subscribe: (listener: (change: BoardViewChange) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...(hasRuns && {
      whenIdle: (callback: () => void) => {
        if (isRunning) idle.push(callback);
        else callback();
      },
    }),
  } as unknown as BoardView;
  return {
    view,
    change: () => {
      state = { ...state, documentVersion: state.documentVersion + 1 };
      tell({ kind: 'document', changes: {} as ChangeSet });
    },
    select: (ids: readonly ObjectId[]) => {
      state = { ...state, selectedIds: ids };
      tell({ kind: 'selection' });
    },
    beginRun: () => {
      isRunning = true;
    },
    endRun: () => {
      isRunning = false;
      for (const callback of idle.splice(0)) callback();
    },
  };
}

/**
 * Renders the hook over a view, counting renders.
 *
 * @param view - The view.
 * @returns The render count and the latest result.
 */
function renderCounted(view: BoardView) {
  let renders = 0;
  const hook = renderHook(() => {
    renders += 1;
    return useBoardViewState(view);
  });
  return { hook, renders: () => renders };
}

describe('useBoardViewState', () => {
  it('reports an empty board with nothing selected while no view is mounted', () => {
    const { result } = renderHook(() => useBoardViewState(undefined));
    const { board, documentVersion, selectedIds } = result.current;
    const id = 'a' as ObjectId;
    expect({ documentVersion, selectedIds }).toEqual({ documentVersion: 0, selectedIds: [] });
    expect(board.get(id)).toBeUndefined();
    expect(board.references.topChildOf(null)).toBeUndefined();
    expect(board.references.childrenOf(null).size).toBe(0);
    expect(board.references.connectorsAttachedTo(id).size).toBe(0);
    expect(board.references.commentsAnchoredTo(id).size).toBe(0);
  });

  it('renders again with each change set while no stepped run holds the board', () => {
    const board = testView(true);
    const { hook, renders } = renderCounted(board.view);
    act(() => {
      board.change();
    });
    act(() => {
      board.change();
    });
    expect(hook.result.current.documentVersion).toBe(2);
    expect(renders()).toBe(3);
  });

  it('renders once after a stepped run, however many change sets it delivered', () => {
    const board = testView(true);
    const { hook, renders } = renderCounted(board.view);
    board.beginRun();
    for (let slice = 0; slice < 5; slice++) {
      act(() => {
        board.change();
      });
    }
    expect(renders()).toBe(1);
    act(() => {
      board.endRun();
    });
    expect(hook.result.current.documentVersion).toBe(5);
    expect(renders()).toBe(2);
  });

  it('renders a selection change at once, even during a stepped run', () => {
    const board = testView(true);
    const { hook } = renderCounted(board.view);
    board.beginRun();
    act(() => {
      board.select(['a' as ObjectId]);
    });
    expect(hook.result.current.selectedIds).toEqual(['a']);
  });

  it('follows every change set of a view without stepped runs', () => {
    const board = testView(false);
    const { hook, renders } = renderCounted(board.view);
    act(() => {
      board.change();
    });
    expect(hook.result.current.documentVersion).toBe(1);
    expect(renders()).toBe(2);
  });

  it('stops waiting for the run once unmounted', () => {
    const board = testView(true);
    const { hook, renders } = renderCounted(board.view);
    board.beginRun();
    act(() => {
      board.change();
    });
    hook.unmount();
    board.endRun();
    expect(renders()).toBe(1);
  });
});
