import { describe, expect, it, vi } from 'vitest';

import { runCommand, setColorTokenCommand, setStyleCommand } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { DocumentBoardView } from './document-board-view.js';

const MARKER = 'section-0-rect-0-0' as ObjectId;

function setUp() {
  const store = createDemoDocument();
  let ids: readonly ObjectId[] = [];
  let entered: ObjectId | null = null;
  const view = new DocumentBoardView(store, {
    ids: () => ids,
    select: (next) => {
      ids = [...next];
    },
    enteredGroupId: () => entered,
  });
  const restyle = () =>
    runCommand(
      store,
      LOCAL_USER_ORIGIN,
      setStyleCommand,
      { changes: [{ id: MARKER, style: { fill: null } }] },
      { clock: () => 1_790_000_000_000, createId: () => 'unused' as ObjectId },
    );
  const setIds = (next: readonly ObjectId[]) => {
    ids = next;
  };
  const enter = (groupId: ObjectId | null) => {
    entered = groupId;
  };
  return { store, view, restyle, setIds, enter };
}

describe('DocumentBoardView', () => {
  it('answers objectsIn from the search it was given, and nothing without one', () => {
    const { store, view } = setUp();
    expect(view.objectsIn({ minX: 0, minY: 0, maxX: 10, maxY: 10 })).toEqual([]);
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const objectsIn = vi.fn(() => [{ id: MARKER, bounds }]);
    const searched = new DocumentBoardView(
      store,
      { ids: () => [], select: vi.fn() },
      {
        search: { objectsIn },
      },
    );
    expect(searched.objectsIn(bounds)).toEqual([{ id: MARKER, bounds }]);
    expect(objectsIn).toHaveBeenCalledWith(bounds);
  });

  it('starts at version 0 with nothing selected and reads the document', () => {
    const { view } = setUp();
    expect(view.state()).toEqual({ documentVersion: 0, selectedIds: [], enteredGroupId: null });
    expect(view.board.get(MARKER)?.type).toBe('shape');
  });

  it('counts change sets and tells listeners what changed', () => {
    const { view, restyle } = setUp();
    const listener = vi.fn();
    view.subscribe(listener);
    const before = view.state();
    restyle();
    expect(view.state().documentVersion).toBe(1);
    expect(view.state()).not.toBe(before);
    expect(listener).toHaveBeenCalledWith({
      kind: 'document',
      changes: expect.objectContaining({ updated: [MARKER] }) as unknown,
    });
  });

  it('selects through the selection and reports it once', () => {
    const { view } = setUp();
    const listener = vi.fn();
    view.subscribe(listener);
    view.select([MARKER]);
    expect(view.state().selectedIds).toEqual([MARKER]);
    view.selectionChanged();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ kind: 'selection' });
  });

  it('reports the group the select tool entered and left, keeping the selection array', () => {
    const { view, setIds, enter } = setUp();
    const listener = vi.fn();
    view.subscribe(listener);
    const group = 'group-a' as ObjectId;
    setIds([MARKER]);
    view.selectionChanged();
    const { selectedIds } = view.state();
    enter(group);
    view.selectionChanged();
    expect(view.state()).toMatchObject({ enteredGroupId: group });
    expect(view.state().selectedIds).toBe(selectedIds);
    enter(null);
    view.selectionChanged();
    expect(view.state().enteredGroupId).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('keeps the same state while nothing changes, an empty selection included', () => {
    const { view, setIds } = setUp();
    const listener = vi.fn();
    view.subscribe(listener);
    const state = view.state();
    setIds([]);
    view.selectionChanged();
    expect(view.state()).toBe(state);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops telling a listener that unsubscribed, and everyone after destroy', () => {
    const { view, restyle } = setUp();
    const gone = vi.fn();
    const kept = vi.fn();
    view.subscribe(gone)();
    view.subscribe(kept);
    view.select([MARKER]);
    view.destroy();
    restyle();
    expect(gone).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(view.state().documentVersion).toBe(0);
  });

  it('says an object is moving while the select tool shows it elsewhere', () => {
    const store = createDemoDocument();
    let preview: BoardObject | undefined;
    const view = new DocumentBoardView(store, {
      ids: () => [],
      select: () => undefined,
      shown: (id) => (id === MARKER ? preview : undefined) ?? store.get(id),
    });
    expect(view.isMoving(MARKER)).toBe(false);
    const stored = store.get(MARKER);
    if (!stored) throw new Error('no marker');
    // A press that has not moved yet previews it in place.
    preview = { ...stored };
    expect(view.isMoving(MARKER)).toBe(false);
    preview = { ...stored, x: stored.x + 10 };
    expect(view.isMoving(MARKER)).toBe(true);
    expect(view.isMoving('missing' as ObjectId)).toBe(false);
    view.destroy();
  });

  it("reads the board's colour tokens and tells only token changes", () => {
    const { store, view, restyle } = setUp();
    expect(view.tokens().size).toBe(0);
    const listener = vi.fn();
    const stop = view.subscribeTokens(listener);
    restyle();
    expect(listener).not.toHaveBeenCalled();
    const outcome = runCommand(
      store,
      LOCAL_USER_ORIGIN,
      setColorTokenCommand,
      { id: 'accent', name: 'accent', light: [1, 0, 0, 1], dark: [0, 0, 1, 1] },
      { clock: () => 1_790_000_000_000, createId: () => 'unused' as ObjectId },
    );
    expect(outcome.status).toBe('applied');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(view.tokens().get('accent')?.light).toEqual([1, 0, 0, 1]);
    stop();
    view.destroy();
  });

  it('calls whenIdle at once while idle, and after a stepped run ends', async () => {
    const { store, view } = setUp();
    const idle = vi.fn();
    view.whenIdle(idle);
    expect(idle).toHaveBeenCalledOnce();
    const run = store.beginRun();
    view.whenIdle(idle);
    await Promise.resolve();
    expect(idle).toHaveBeenCalledOnce();
    run.close();
    await vi.waitFor(() => {
      expect(idle).toHaveBeenCalledTimes(2);
    });
    view.destroy();
  });
});
