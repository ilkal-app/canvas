// @vitest-environment jsdom
// Comments in the floating whiteboard: one thread at a time with the selection, the
// keyboard back to the canvas on Escape, and resolved pins hidden unless the menu shows them.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { BoardViewChange } from '../engine/board-view.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { shellBoardModeContext, type ShellBoardMode } from '../shell/shell-board-mode.js';

import { FAKE_PERSON } from './__fixtures__/fake-member-directory.js';
import type { Thread } from './comment-api.js';
import { commentContext, type CommentMode } from './comment-context.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { CommentOverlay } from './comment-overlay.js';
import { placeThreadPin } from './comment-placement.js';

beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The floating whiteboard's shell mode: no drawers. */
const FLOATING: ShellBoardMode = {
  mode: 'whiteboard',
  changeMode: () => undefined,
  drawers: { hasLayersDrawer: false, hasInspector: false },
};

/**
 * A thread with one message.
 *
 * @param id - Its id; its pin is `pin-<id>`.
 * @param text - Its message.
 * @param isResolved - Whether it is resolved.
 * @returns The thread.
 */
function thread(id: string, text: string, isResolved = false): Thread {
  return {
    id,
    pinId: `pin-${id}`,
    isResolved,
    messages: [
      {
        id: `m-${id}`,
        authorId: 'other',
        authorName: 'Other',
        text,
        mentions: [],
        createdAt: new Date(0).toISOString(),
      },
    ],
  };
}

/**
 * Comment data over a fake board with an open thread "Open one" and a resolved one "Done one",
 * both pinned.
 *
 * @param fields - What differs.
 * @returns The data.
 */
function data(fields: Partial<CommentData> = {}): CommentData {
  const connection = new FakeBoardConnection('board');
  const threads = [thread('open', 'Open one'), thread('done', 'Done one', true)];
  threads.forEach((entry, index) => {
    placeThreadPin(
      connection,
      {
        id: entry.pinId as ObjectId,
        point: { x: 40 + index * 100, y: 80 },
        anchor: { kind: 'point' },
      },
      entry.id,
    );
  });
  return {
    connection,
    user: FAKE_PERSON,
    members: [],
    threads,
    selectedId: undefined,
    placement: undefined,
    error: '',
    isBusy: false,
    canEditBoard: false,
    deleteThread: vi.fn(),
    change: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    select: vi.fn(),
    place: vi.fn(),
    ...fields,
  };
}

/**
 * An engine whose board view's selection a test sets, and its subscribers.
 *
 * @returns The engine, a selection setter that notifies, and a document change.
 */
function engineWithSelection() {
  let selectedIds: readonly ObjectId[] = [];
  const listeners = new Set<(change: BoardViewChange) => void>();
  const engine = {
    camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 }),
    board: {
      state: () => ({ documentVersion: 0, selectedIds, enteredGroupId: null }),
      subscribe: (listener: (change: BoardViewChange) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  } as unknown as MountedEngine;
  const notify = (change: BoardViewChange): void => {
    act(() => {
      for (const listener of listeners) listener(change);
    });
  };
  return {
    engine,
    listeners,
    select: (ids: readonly string[]) => {
      selectedIds = ids as ObjectId[];
      notify({ kind: 'selection' });
    },
    notify,
  };
}

/**
 * The overlay under a comment mode and, if given, the shell's mode.
 *
 * @param comments - The data.
 * @param options - The engine, the shell's mode and what differs in the comment mode.
 * @param options.engine - The engine.
 * @param options.shell - The shell's mode; outside a shell if absent.
 * @param options.mode - What differs in the comment mode.
 * @returns The rendered view.
 */
function show(
  comments: CommentData,
  options: {
    readonly engine: MountedEngine;
    readonly shell?: ShellBoardMode;
    readonly mode?: Partial<CommentMode>;
  },
) {
  const mode: CommentMode = {
    canWrite: true,
    isPlacing: false,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
    ...options.mode,
  };
  const tree = (
    <commentContext.Provider value={mode}>
      <commentDataContext.Provider value={comments}>
        <div>
          <canvas />
          <CommentOverlay engine={options.engine} />
        </div>
      </commentDataContext.Provider>
    </commentContext.Provider>
  );
  return render(
    options.shell === undefined ? (
      tree
    ) : (
      <shellBoardModeContext.Provider value={options.shell}>{tree}</shellBoardModeContext.Provider>
    ),
  );
}

describe('resolved pins under the floating whiteboard chrome', () => {
  it('hide unless the board menu shows them', () => {
    const { engine } = engineWithSelection();
    const view = show(data(), { engine, shell: FLOATING });
    expect(screen.getByRole('button', { name: 'Comment thread: Open one' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Comment thread: Done one' })).toBeNull();
    view.unmount();
    show(data(), { engine, shell: FLOATING, mode: { isResolvedShown: true } });
    expect(screen.getByRole('button', { name: 'Comment thread: Done one' })).toBeDefined();
  });

  it('keep the open thread’s pin, and show under the classic chrome as before', () => {
    const { engine } = engineWithSelection();
    const view = show(data({ selectedId: 'done' }), { engine, shell: FLOATING });
    expect(screen.getByRole('button', { name: 'Comment thread: Done one' })).toBeDefined();
    view.unmount();
    show(data(), { engine });
    expect(screen.getByRole('button', { name: 'Comment thread: Done one' })).toBeDefined();
  });
});

describe('one at a time', () => {
  it('closes an open thread when objects are selected, however they are', () => {
    const selection = engineWithSelection();
    const close = vi.fn();
    show(data({ selectedId: 'open', close }), { engine: selection.engine, shell: FLOATING });
    // A document change, or the selection emptied (opening a thread clears it), keeps it open.
    selection.notify({
      kind: 'document',
      changes: { created: [], updated: [], deleted: [] },
    } as never);
    selection.select([]);
    expect(close).not.toHaveBeenCalled();
    selection.select(['note']);
    expect(close).toHaveBeenCalledTimes(1);
    // The same selection reported again closes nothing more.
    selection.select(['note']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes a placement being composed too, and watches nothing without a card', () => {
    const selection = engineWithSelection();
    const close = vi.fn();
    const placing = data({
      close,
      placement: { id: 'new' as ObjectId, point: { x: 10, y: 10 }, anchor: { kind: 'point' } },
    });
    const view = show(placing, { engine: selection.engine });
    selection.select(['note']);
    expect(close).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(selection.listeners.size).toBe(0);
    show(data(), { engine: selection.engine });
    expect(selection.listeners.size).toBe(0);
  });
});

describe('Escape', () => {
  it('closes the card and gives the keyboard back to the canvas', () => {
    const { engine } = engineWithSelection();
    const close = vi.fn();
    show(data({ selectedId: 'open', close }), { engine, shell: FLOATING });
    const card = screen.getByRole('dialog', { name: 'Comment thread' });
    expect(document.activeElement).toBe(card);
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(close).toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });
});
