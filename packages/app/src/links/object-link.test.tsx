// @vitest-environment jsdom
// Links to an object (item 2): copying one says so, and opening one goes to the object
// once it is on the board.
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { BoardView, BoardViewChange } from '../engine/board-view.js';

import {
  copyObjectLink,
  OBJECT_LINK_COPIED_MESSAGE,
  OBJECT_LINK_FAILED_MESSAGE,
  useObjectLinkOpen,
} from './object-link.js';

afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('copyObjectLink', () => {
  it('writes the link without the fragment and says it copied', async () => {
    history.replaceState(null, '', '/board/abc?page=one#secret');
    const writeText = vi.fn(() => Promise.resolve());
    const notify = vi.fn();
    await copyObjectLink('shape-1' as ObjectId, notify, writeText);
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/board/abc?page=one&object=shape-1`);
    expect(notify).toHaveBeenCalledWith(OBJECT_LINK_COPIED_MESSAGE);
  });

  it('says so when the clipboard refuses', async () => {
    const notify = vi.fn();
    await copyObjectLink('shape-1' as ObjectId, notify, () => Promise.reject(new Error('no')));
    expect(notify).toHaveBeenCalledWith(OBJECT_LINK_FAILED_MESSAGE);
  });
});

/**
 * A board view over a map of objects, whose feed the test fires.
 *
 * @param objects - The objects on the board.
 * @returns The view, and a function that tells its listeners of a change.
 */
function viewOf(objects: Map<ObjectId, BoardObject>) {
  const listeners = new Set<(change: BoardViewChange) => void>();
  const view = {
    board: { get: (id: ObjectId) => objects.get(id) },
    subscribe: (listener: (change: BoardViewChange) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as BoardView;
  const change = () => {
    for (const listener of [...listeners]) listener({ kind: 'selection' });
  };
  return { view, change, listeners };
}

describe('useObjectLinkOpen', () => {
  it('goes to the linked object once it is on the board, and only once', () => {
    history.replaceState(null, '', '/board/abc?object=shape-1');
    const objects = new Map<ObjectId, BoardObject>();
    const { view, change, listeners } = viewOf(objects);
    const dispatch = vi.fn();
    renderHook(() => {
      useObjectLinkOpen(view, dispatch);
    });
    expect(dispatch).not.toHaveBeenCalled();
    objects.set('shape-1' as ObjectId, { id: 'shape-1' } as BoardObject);
    change();
    change();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'component',
      command: 'goToMain',
      id: 'shape-1',
    });
    expect(listeners.size).toBe(0);
  });

  it('does nothing without a link, or before the engine mounts', () => {
    const dispatch = vi.fn();
    const { view } = viewOf(new Map());
    renderHook(() => {
      useObjectLinkOpen(view, dispatch);
    });
    history.replaceState(null, '', '/board/abc?object=shape-1');
    renderHook(() => {
      useObjectLinkOpen(undefined, dispatch);
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
