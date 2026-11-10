// What the engine's document side gives the shell's panels: the board view, and restyles as
// one command. In Chrome: tooling/scenario/specs/app/style-panel.spec.ts.
import { describe, expect, it, vi } from 'vitest';

import { createHistory } from '@canvas/document';
import type { Camera } from '@canvas/engine';
import { DEFAULT_AUTO_LAYOUT, type ObjectId, type Rgba } from '@canvas/schema';

import type { BoardViewChange } from './board-view.js';
import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument } from './engine-document.js';

const MARKER = 'section-0-rect-0-0' as ObjectId;
const NEIGHBOUR = 'section-0-rect-1-0' as ObjectId;
const SECTION = 'section-0' as ObjectId;
const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const RED: Rgba = [1, 0, 0, 1];

function setUp() {
  const store = createDemoDocument();
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  const onCommandRefused = vi.fn();
  const onNotice = vi.fn();
  const document = new EngineDocument({
    store,
    history,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: vi.fn(),
    onCommandRefused,
    onNotice,
  });
  const press = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) => {
    const screen = { x, y };
    document.handlePointer({ kind, screen, isShiftPressed: false, isModPressed: false }, CAMERA);
  };
  return { store, history, document, onCommandRefused, onNotice, press };
}

describe('EngineDocument for the panels', () => {
  it('tells the panels which group the select tool entered, and when it leaves', () => {
    const { document } = setUp();
    document.panels.board.select([MARKER, NEIGHBOUR]);
    document.runCanvasAction({ type: 'arrange', command: 'group' }, 1);
    const [groupId] = document.inspect().selectedIds;
    const listener = vi.fn();
    document.panels.board.subscribe(listener);
    // A double press on the marker enters the group.
    for (const timeStamp of [100, 200]) {
      for (const kind of ['pointerDown', 'pointerUp'] as const) {
        const input = {
          kind,
          screen: { x: 60, y: 60 },
          isShiftPressed: false,
          isModPressed: false,
        };
        document.handlePointer({ ...input, timeStamp }, CAMERA);
      }
    }
    expect(document.panels.board.state()).toMatchObject({
      enteredGroupId: groupId,
      selectedIds: [MARKER],
    });
    expect(listener).toHaveBeenCalledWith({ kind: 'selection' });
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    expect(document.panels.board.state().enteredGroupId).toBeNull();
  });

  it('restyles every object of a style action in one change set, one undo step', () => {
    const { store, document, history } = setUp();
    const isHandled = document.runCanvasAction(
      {
        type: 'style',
        changes: [
          { id: MARKER, style: { fill: RED } },
          { id: NEIGHBOUR, style: { fill: RED } },
        ],
      },
      1,
    );
    expect(isHandled).toBe(true);
    expect(store.get(MARKER)).toMatchObject({ fill: RED });
    expect(store.get(NEIGHBOUR)).toMatchObject({ fill: RED });
    expect(document.inspect().changeSets).toEqual([
      { originKind: 'user', created: [], updated: [MARKER, NEIGHBOUR], deleted: [] },
    ]);
    history.undo();
    expect(store.get(MARKER)).not.toMatchObject({ fill: RED });
    expect(store.get(NEIGHBOUR)).not.toMatchObject({ fill: RED });
  });

  it('reports a refused restyle and writes nothing', () => {
    const { store, document, onCommandRefused } = setUp();
    const before = store.encodeState();
    document.runCanvasAction(
      { type: 'style', changes: [{ id: SECTION, style: { fill: RED } }] },
      1,
    );
    expect(onCommandRefused).toHaveBeenCalledWith([
      expect.objectContaining({ code: 'unsupported-type', objectId: SECTION }),
    ]);
    expect(store.encodeState()).toEqual(before);
  });

  it('writes nothing for a refused restyle when nobody listens for refusals', () => {
    const store = createDemoDocument();
    const document = new EngineDocument({
      store,
      history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
      origin: LOCAL_USER_ORIGIN,
      environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
      onChange: vi.fn(),
    });
    document.runCanvasAction(
      { type: 'style', changes: [{ id: SECTION, style: { fill: RED } }] },
      1,
    );
    expect(document.inspect().changeSets).toEqual([]);
  });

  it('runs no restyle for no changes, and holds one made mid-drag until the drag ends', () => {
    const { store, document, press } = setUp();
    document.runCanvasAction({ type: 'style', changes: [] }, 1);
    press('pointerDown', 60, 60);
    press('pointerMove', 90, 90);
    document.runCanvasAction({ type: 'style', changes: [{ id: MARKER, style: { fill: RED } }] }, 1);
    expect(document.inspect().changeSets).toEqual([]);
    press('pointerUp', 90, 90);
    const fill = store.get(MARKER);
    expect(fill?.type === 'shape' ? fill.fill : undefined).toEqual(RED);
  });

  it('applies a colour committed during a press on the board when the press ends', () => {
    // The colour input's `change` fires when it loses focus, which a press on the board takes:
    // the restyle arrives between that press and its release.
    const { store, document, history, press } = setUp();
    press('pointerDown', 60, 60);
    press('pointerUp', 60, 60);
    const before = store.get(MARKER);
    press('pointerDown', 60, 60);
    document.runCanvasAction({ type: 'style', changes: [{ id: MARKER, style: { fill: RED } }] }, 1);
    press('pointerUp', 60, 60);
    const after = store.get(MARKER);
    expect(after?.type === 'shape' ? after.fill : undefined).toEqual(RED);
    expect(document.inspect().changeSets).toHaveLength(1);
    history.undo();
    expect(store.get(MARKER)).toEqual(before);
  });

  it('applies a held panel action when Escape cancels the drag, and drops it for a viewer', () => {
    const { store, document, press } = setUp();
    press('pointerDown', 60, 60);
    press('pointerMove', 90, 90);
    document.runCanvasAction({ type: 'toggleLockOf', ids: [NEIGHBOUR] }, 1);
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    expect(store.get(NEIGHBOUR)?.locked).toBe(true);
    press('pointerDown', 60, 60);
    document.runCanvasAction({ type: 'toggleLockOf', ids: [NEIGHBOUR] }, 1);
    document.setEditable(false);
    press('pointerUp', 60, 60);
    expect(store.get(NEIGHBOUR)?.locked).toBe(true);
  });

  it('reports clicks, panel selections and edits to the board view', async () => {
    const { store, document, press } = setUp();
    const listener = vi.fn<(change: BoardViewChange) => void>();
    document.panels.board.subscribe(listener);
    press('pointerDown', 60, 60);
    press('pointerUp', 60, 60);
    expect(document.panels.board.state().selectedIds).toEqual([MARKER]);
    document.panels.board.select([NEIGHBOUR, SECTION]);
    expect(document.inspect().selectedIds).toEqual([NEIGHBOUR, SECTION]);
    expect(document.panels.board.state().selectedIds).toEqual([NEIGHBOUR, SECTION]);
    document.runCanvasAction({ type: 'selection', command: 'delete' }, 1);
    // The frame and its children take several parts, a task each: seen once it ends.
    await store.whenIdle();
    await vi.waitFor(() => {
      expect(document.panels.board.state().selectedIds).toEqual([]);
    });
    expect(listener.mock.calls.map(([change]) => change.kind)).toEqual([
      'selection',
      'selection',
      'document',
      'selection',
    ]);
  });

  it('locks given objects as one undo step, leaving the selection as it is', () => {
    const { store, document, history } = setUp();
    document.panels.board.select([MARKER]);
    document.runCanvasAction({ type: 'toggleLockOf', ids: [NEIGHBOUR] }, 1);
    expect(store.get(NEIGHBOUR)?.locked).toBe(true);
    expect(store.get(MARKER)?.locked).toBe(false);
    expect(document.inspect().selectedIds).toEqual([MARKER]);
    document.runCanvasAction({ type: 'toggleLockOf', ids: [NEIGHBOUR] }, 1);
    expect(store.get(NEIGHBOUR)?.locked).toBe(false);
    history.undo();
    expect(store.get(NEIGHBOUR)?.locked).toBe(true);
  });

  it('places objects from the layers panel as one undo step, leaving the selection', () => {
    const { store, document, history } = setUp();
    document.panels.board.select([NEIGHBOUR]);
    expect(store.get(MARKER)?.parentId).toBe(SECTION);
    document.runCanvasAction({ type: 'placeLayers', ids: [MARKER], parentId: null }, 1);
    expect(store.get(MARKER)?.parentId).toBeNull();
    expect(document.inspect().selectedIds).toEqual([NEIGHBOUR]);
    history.undo();
    expect(store.get(MARKER)?.parentId).toBe(SECTION);
  });

  it('lays a frame out from the inspector as one undo step per edit', () => {
    const { store, document, history } = setUp();
    expect(store.get(SECTION)?.type).toBe('frame');
    const before = { marker: store.get(MARKER), section: store.get(SECTION) };
    const autoLayout = { ...DEFAULT_AUTO_LAYOUT, gap: 4 };
    document.runCanvasAction(
      { type: 'autoLayout', ids: [SECTION], change: { kind: 'set', autoLayout } },
      1,
    );
    expect(store.get(SECTION)).toMatchObject({ autoLayout });
    expect(store.get(MARKER)).toMatchObject({ x: 0, y: 0 });
    document.runCanvasAction(
      {
        type: 'autoLayout',
        ids: [SECTION],
        change: { kind: 'patch', patch: { padding: { left: 9 } } },
      },
      1,
    );
    expect(store.get(MARKER)).toMatchObject({ x: 9, y: 0 });
    document.runCanvasAction(
      { type: 'autoLayout', ids: [MARKER], change: { kind: 'child', layoutChild: { fill: true } } },
      1,
    );
    expect(store.get(MARKER)).toMatchObject({ layoutChild: { fill: true } });
    for (let step = 0; step < 3; step += 1) expect(history.undo()).toBe(true);
    expect(store.get(MARKER)).toEqual(before.marker);
    expect(store.get(SECTION)).toEqual(before.section);
  });

  it('reports an auto-layout a shape cannot take and writes nothing', () => {
    const { store, document, onCommandRefused } = setUp();
    const before = store.read();
    document.runCanvasAction(
      {
        type: 'autoLayout',
        ids: [MARKER],
        change: { kind: 'set', autoLayout: DEFAULT_AUTO_LAYOUT },
      },
      1,
    );
    expect(store.read()).toBe(before);
    expect(onCommandRefused).toHaveBeenCalledOnce();
  });

  it('reports a drop into a locked frame and writes nothing', () => {
    const { store, document, onCommandRefused } = setUp();
    document.runCanvasAction({ type: 'toggleLockOf', ids: [SECTION] }, 1);
    const before = store.read();
    document.runCanvasAction(
      { type: 'placeLayers', ids: [MARKER], parentId: SECTION, belowId: NEIGHBOUR },
      1,
    );
    expect(store.read()).toBe(before);
    expect(onCommandRefused).toHaveBeenCalledOnce();
  });

  it('locks nothing by id in the middle of a drag, but once it ends', () => {
    const { store, document, press } = setUp();
    press('pointerDown', 60, 60);
    press('pointerMove', 90, 90);
    document.runCanvasAction({ type: 'toggleLockOf', ids: [NEIGHBOUR] }, 1);
    expect(store.get(NEIGHBOUR)?.locked).toBe(false);
    press('pointerUp', 90, 90);
    expect(store.get(NEIGHBOUR)?.locked).toBe(true);
  });

  it('edits a colour token as one undo step, held mid-drag, refused for a viewer', () => {
    const { store, document, history, press } = setUp();
    const accent = {
      type: 'colorToken',
      command: 'set',
      id: 'accent',
      name: 'accent',
      light: RED,
      dark: RED,
    } as const;
    press('pointerDown', 60, 60);
    press('pointerMove', 90, 90);
    document.runCanvasAction(accent, 1);
    expect(store.readTokens().has('accent')).toBe(false);
    press('pointerUp', 90, 90);
    expect(store.readTokens().get('accent')?.light).toEqual(RED);
    history.undo();
    expect(store.readTokens().has('accent')).toBe(false);
    document.setEditable(false);
    document.runCanvasAction(accent, 1);
    expect(store.readTokens().has('accent')).toBe(false);
  });

  it('says how many selected objects an order command left where they were', () => {
    const { document, onNotice } = setUp();
    document.panels.board.select([MARKER, NEIGHBOUR, SECTION]);
    document.runCanvasAction({ type: 'arrange', command: 'bringToFront' }, 1);
    expect(onNotice).toHaveBeenCalledExactlyOnceWith(
      '1 object was left where it was: only objects in the same frame or group move together.',
    );
    document.panels.board.select([MARKER]);
    document.runCanvasAction({ type: 'arrange', command: 'bringToFront' }, 1);
    expect(onNotice).toHaveBeenCalledTimes(1);
  });

  it("keeps each creation tool's style for its mode to read", () => {
    const { document } = setUp();
    expect(document.panels.toolStyle('shape')).toEqual({});
    document.panels.setToolStyle('shape', { fill: RED });
    expect(document.panels.toolStyle('shape')).toEqual({ fill: RED });
  });

  it('stops reporting to the board view once destroyed', () => {
    const { document, store } = setUp();
    const listener = vi.fn();
    document.panels.board.subscribe(listener);
    document.destroy();
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(MARKER, { x: 1 });
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
