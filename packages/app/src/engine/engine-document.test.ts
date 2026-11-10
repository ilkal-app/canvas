// The engine's document side over the demo document, with a fake GPU. In Chrome, on a real GPU:
// tooling/scenario/specs/tools/select.spec.ts.
import { describe, expect, it, vi } from 'vitest';

import {
  createHistory,
  groupCommand,
  runCommand,
  sortedSiblings,
  type YjsDocumentStore,
} from '@canvas/document';
import type { Camera, SceneChangeSet } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';
import { EMPTY_OVERLAY, type SelectionOverlayModel } from '@canvas/tools';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument, type EngineDocumentView } from './engine-document.js';
import type { ScreenPointerInput } from './select-input-binding.js';

/** The demo board's first rectangle: world (50, 50), 70 × 60. */
const MARKER = 'section-0-rect-0-0' as ObjectId;
const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

function setUp(store: YjsDocumentStore = createDemoDocument()) {
  const onChange = vi.fn();
  const release = vi.fn();
  const notices: string[] = [];
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  const document = new EngineDocument({
    store,
    history,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange,
    release,
    onNotice: (message) => notices.push(message),
  });
  const press = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) => {
    const input: ScreenPointerInput = {
      kind,
      screen: { x, y },
      isShiftPressed: false,
      isModPressed: false,
    };
    document.handlePointer(input, CAMERA);
  };
  const dragMarker = (dx: number, dy: number) => {
    press('pointerDown', 60, 60);
    press('pointerMove', 60 + dx / 2, 60 + dy / 2);
    press('pointerMove', 60 + dx, 60 + dy);
  };
  /**
   * Clicks at the centre of an object inside a section (a frame at the root), adding it to the
   * selection with Shift.
   *
   * @param objectId - The object.
   * @param isShiftPressed - Whether Shift is held.
   * @throws {Error} When the object has no box or no parent.
   */
  const clickOn = (objectId: ObjectId, isShiftPressed: boolean) => {
    const object = store.get(objectId);
    const parent = object?.parentId ? store.get(object.parentId) : undefined;
    if (!object || !('width' in object) || !parent) throw new Error(`no box "${objectId}"`);
    const screen = {
      x: parent.x + object.x + object.width / 2,
      y: parent.y + object.y + object.height / 2,
    };
    for (const kind of ['pointerDown', 'pointerUp'] as const) {
      document.handlePointer({ kind, screen, isShiftPressed, isModPressed: false }, CAMERA);
    }
  };
  return { store, document, onChange, release, press, dragMarker, notices, clickOn };
}

describe('EngineDocument', () => {
  it('selects the object under a click and moves it in one change set on release', () => {
    const { store, document, press, dragMarker } = setUp();
    dragMarker(30, 20);
    expect(store.get(MARKER)).toMatchObject({ x: 10, y: 10 });
    press('pointerUp', 90, 80);
    expect(store.get(MARKER)).toMatchObject({ x: 40, y: 30 });
    const inspection = document.inspect();
    expect(inspection.selectedIds).toEqual([MARKER]);
    expect(inspection.selectedObjects).toEqual([store.get(MARKER)]);
    expect(inspection.changeSets).toEqual([
      { originKind: 'user', created: [], updated: [MARKER], deleted: [] },
    ]);
  });

  it('undoes and redoes the whole drag as one step, but not in the middle of another', () => {
    const { store, document, press, dragMarker } = setUp();
    dragMarker(30, 20);
    press('pointerUp', 90, 80);
    dragMarker(5, 5);
    expect(document.runCanvasAction({ type: 'history', command: 'undo' }, 1)).toBe(true);
    expect(store.get(MARKER)).toMatchObject({ x: 40, y: 30 });
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    document.runCanvasAction({ type: 'history', command: 'undo' }, 1);
    expect(store.get(MARKER)).toMatchObject({ x: 10, y: 10 });
    document.runCanvasAction({ type: 'history', command: 'redo' }, 1);
    expect(store.get(MARKER)).toMatchObject({ x: 40, y: 30 });
    expect(document.inspect().changeSets.map(({ originKind }) => originKind)).toEqual([
      'user',
      'undo',
      'undo',
    ]);
  });

  it('nudges the selection, and leaves the arrows to the camera when nothing is selected', () => {
    const { store, document, press } = setUp();
    const nudge = { type: 'nudge', direction: 'right', isLarge: true } as const;
    expect(document.runCanvasAction(nudge, 1)).toBe(false);
    press('pointerDown', 60, 60);
    press('pointerUp', 60, 60);
    expect(document.runCanvasAction(nudge, 1)).toBe(true);
    expect(store.get(MARKER)).toMatchObject({ x: 20, y: 10 });
  });

  it('selects all, deletes the selection, and leaves other actions alone', () => {
    const { store, document } = setUp();
    expect(document.runCanvasAction({ type: 'selection', command: 'selectAll' }, 1)).toBe(true);
    expect(document.inspect().selectedIds).toHaveLength(4);
    expect(document.selectionBounds()).toEqual({ minX: 40, minY: 40, maxX: 1900, maxY: 1220 });
    document.runCanvasAction({ type: 'selection', command: 'delete' }, 1);
    expect(store.read().objects.size).toBe(0);
    expect(document.inspect().selectedIds).toEqual([]);
    expect(document.runCanvasAction({ type: 'selection', command: 'duplicate' }, 1)).toBe(false);
    expect(document.runCanvasAction({ type: 'navigate', command: 'zoomIn' }, 1)).toBe(false);
  });

  it('selects the same type as the selection: every rectangle in every section', () => {
    const { store, document, press } = setUp();
    press('pointerDown', 60, 60);
    press('pointerUp', 60, 60);
    const before = store.read().objects.size;
    const selectSameType = { type: 'selection', command: 'selectSameType' } as const;
    expect(document.runCanvasAction(selectSameType, 1)).toBe(true);
    const { selectedIds, changeSets } = document.inspect();
    expect(selectedIds[0]).toBe(MARKER);
    expect(selectedIds).toHaveLength(4 * 70);
    expect(selectedIds.every((id) => store.get(id)?.type === 'shape')).toBe(true);
    expect(changeSets).toEqual([]);
    expect(store.read().objects.size).toBe(before);
  });

  it('aligns the selection in one undo step, not mid-drag', () => {
    const { store, document, press } = setUp();
    const neighbour = 'section-0-rect-1-1' as ObjectId;
    press('pointerDown', 60, 60);
    press('pointerUp', 60, 60);
    const shiftClick: ScreenPointerInput = {
      kind: 'pointerDown',
      screen: { x: 175, y: 160 },
      isShiftPressed: true,
      isModPressed: false,
    };
    document.handlePointer(shiftClick, CAMERA);
    document.handlePointer({ ...shiftClick, kind: 'pointerUp' }, CAMERA);
    expect(document.inspect().selectedIds).toEqual([MARKER, neighbour]);
    const alignLeft = { type: 'arrange', command: 'alignLeft' } as const;
    expect(document.runCanvasAction(alignLeft, 1)).toBe(true);
    expect(store.get(neighbour)).toMatchObject({ x: 10, y: 90 });
    expect(document.inspect().changeSets).toEqual([
      { originKind: 'user', created: [], updated: [neighbour], deleted: [] },
    ]);
    document.runCanvasAction({ type: 'history', command: 'undo' }, 1);
    expect(store.get(neighbour)).toMatchObject({ x: 100, y: 90 });
    press('pointerDown', 60, 60);
    expect(document.runCanvasAction({ type: 'arrange', command: 'alignRight' }, 1)).toBe(true);
    press('pointerUp', 60, 60);
    expect(document.inspect().changeSets).toHaveLength(2);
  });

  it('locks and unlocks the selection, and brings it to front, as one undo step each', () => {
    const { store, document, press } = setUp();
    press('pointerDown', 60, 60);
    press('pointerUp', 60, 60);
    const lock = { type: 'selection', command: 'toggleLock' } as const;
    expect(document.runCanvasAction(lock, 1)).toBe(true);
    expect(store.get(MARKER)?.locked).toBe(true);
    const front = { type: 'arrange', command: 'bringToFront' } as const;
    expect(document.runCanvasAction(front, 1)).toBe(true);
    expect(sortedSiblings(store, 'section-0' as ObjectId).at(-1)).toBe(MARKER);
    document.runCanvasAction({ type: 'history', command: 'undo' }, 1);
    expect(sortedSiblings(store, 'section-0' as ObjectId).at(-1)).not.toBe(MARKER);
    expect(store.get(MARKER)?.locked).toBe(true);
    document.runCanvasAction({ type: 'history', command: 'undo' }, 1);
    expect(store.get(MARKER)?.locked).toBe(false);
  });

  it('neither locks nor reorders in the middle of a drag', () => {
    const { store, document, dragMarker } = setUp();
    dragMarker(30, 20);
    const before = store.read();
    expect(document.runCanvasAction({ type: 'selection', command: 'toggleLock' }, 1)).toBe(true);
    expect(document.runCanvasAction({ type: 'arrange', command: 'sendToBack' }, 1)).toBe(true);
    expect(store.read()).toBe(before);
  });

  it('selects a grouped object’s group, framed by its children', () => {
    const store = createDemoDocument();
    const second = 'section-0-rect-1-0' as ObjectId;
    runCommand(
      store,
      LOCAL_USER_ORIGIN,
      groupCommand,
      { ids: [MARKER, second] },
      {
        clock: () => 1_790_000_000_000,
        createId: () => 'group-1' as ObjectId,
      },
    );
    const { document, press } = setUp(store);
    press('pointerDown', 60, 60);
    press('pointerUp', 60, 60);
    expect(document.inspect().selectedIds).toEqual(['group-1']);
    // The marker spans x 50–120 and its neighbour 140–210, both y 50–110.
    expect(document.selectionBounds()).toEqual({ minX: 50, minY: 50, maxX: 210, maxY: 110 });
    // A marquee touching it takes the group whole, which holds no locked object.
    press('pointerDown', 45, 45);
    press('pointerMove', 60, 60);
    press('pointerMove', 65, 65);
    press('pointerUp', 65, 65);
    expect(document.inspect().selectedIds).toEqual(['group-1']);
  });

  it('takes a group with a leftward marquee only when the marquee encloses all its children', () => {
    const store = createDemoDocument();
    const second = 'section-0-rect-1-0' as ObjectId;
    runCommand(
      store,
      LOCAL_USER_ORIGIN,
      groupCommand,
      { ids: [MARKER, second] },
      {
        clock: () => 1_790_000_000_000,
        createId: () => 'group-1' as ObjectId,
      },
    );
    const { document, press } = setUp(store);
    const marquee = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      press('pointerDown', from.x, from.y);
      press('pointerMove', (from.x + to.x) / 2, (from.y + to.y) / 2);
      press('pointerMove', to.x, to.y);
      press('pointerUp', to.x, to.y);
    };
    // Leftward over the marker only (its neighbour is x 140–210): the group is not enclosed.
    marquee({ x: 130, y: 115 }, { x: 45, y: 45 });
    expect(document.inspect().selectedIds).toEqual([]);
    marquee({ x: 215, y: 115 }, { x: 45, y: 45 });
    expect(document.inspect().selectedIds).toEqual(['group-1']);
  });

  it('groups the selection and ungroups it, one undo step each', () => {
    const { store, document, notices, clickOn } = setUp();
    const second = 'section-0-rect-1-0' as ObjectId;
    clickOn(MARKER, false);
    clickOn(second, true);
    expect(document.runCanvasAction({ type: 'arrange', command: 'group' }, 1)).toBe(true);
    const groupId = 'new' as ObjectId;
    expect(store.get(groupId)).toMatchObject({ type: 'group', parentId: 'section-0' });
    expect(store.get(MARKER)?.parentId).toBe(groupId);
    expect(document.inspect().selectedIds).toEqual([groupId]);
    document.runCanvasAction({ type: 'arrange', command: 'ungroup' }, 1);
    expect(store.get(groupId)).toBeUndefined();
    expect([...document.inspect().selectedIds].sort()).toEqual([MARKER, second].sort());
    document.runCanvasAction({ type: 'history', command: 'undo' }, 1);
    expect(store.get(groupId)?.type).toBe('group');
    document.runCanvasAction({ type: 'history', command: 'undo' }, 1);
    expect(store.get(groupId)).toBeUndefined();
    expect(store.get(MARKER)?.parentId).toBe('section-0');
    expect(notices).toEqual([]);
  });

  it('leaves a group holding a locked object on Delete, and says why', () => {
    const { store, document, notices, clickOn } = setUp();
    const second = 'section-0-rect-1-0' as ObjectId;
    clickOn(MARKER, false);
    clickOn(second, true);
    document.runCanvasAction({ type: 'arrange', command: 'group' }, 1);
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(second, { locked: true });
    });
    document.runCanvasAction({ type: 'selection', command: 'delete' }, 1);
    expect(store.get('new' as ObjectId)?.type).toBe('group');
    expect(notices).toEqual(['Not deleted: the group contains a locked object.']);
  });

  it('aligns without a group holding a locked object, and says why', () => {
    const { store, document, notices, clickOn } = setUp();
    const second = 'section-0-rect-1-0' as ObjectId;
    clickOn(MARKER, false);
    clickOn(second, true);
    document.runCanvasAction({ type: 'arrange', command: 'group' }, 1);
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(second, { locked: true });
    });
    clickOn('section-0-rect-2-1' as ObjectId, true);
    const group = store.get('new' as ObjectId);
    document.runCanvasAction({ type: 'arrange', command: 'alignBottom' }, 1);
    expect(store.get('new' as ObjectId)).toEqual(group);
    expect(notices).toEqual(['Not moved: a group contains a locked object.']);
  });

  it('groups nothing across parents, and says why; ungroups nothing without a group', () => {
    const { store, document, notices, clickOn } = setUp();
    clickOn(MARKER, false);
    clickOn('section-1-rect-0-0' as ObjectId, true);
    expect(document.inspect().selectedIds).toHaveLength(2);
    const before = store.read().objects;
    document.runCanvasAction({ type: 'arrange', command: 'group' }, 1);
    expect(store.read().objects).toEqual(before);
    document.runCanvasAction({ type: 'arrange', command: 'ungroup' }, 1);
    expect(notices).toEqual([
      'Only objects in the same frame or group can be grouped.',
      'Nothing to ungroup: select a group.',
    ]);
    // Every arrange command is the document side's now.
    expect(document.runCanvasAction({ type: 'arrange', command: 'bringForward' }, 1)).toBe(true);
  });

  it('knows the board’s bounds from its hit-test index', () => {
    const { document } = setUp();
    expect(document.contentBounds()).toEqual({ minX: 40, minY: 40, maxX: 1900, maxY: 1220 });
  });

  it('shows the document and the overlay once attached, and every change after', () => {
    const { store, document, onChange, press } = setUp();
    const changes: SceneChangeSet[] = [];
    const overlays: SelectionOverlayModel[] = [];
    const view: EngineDocumentView = {
      enqueue: (change) => changes.push(change),
      showOverlay: (model) => overlays.push(model),
    };
    document.attach(view);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.created).toHaveLength(store.read().objects.size);
    expect(overlays).toEqual([EMPTY_OVERLAY]);
    press('pointerDown', 60, 60);
    press('pointerMove', 90, 90);
    expect(onChange).toHaveBeenCalled();
    // The drag's preview: the marker at its dragged place, read through the view's `get`.
    expect(changes.at(-1)?.updated).toEqual([MARKER]);
    // The marker sits at (10, 10) in its section, so the drag's 30 × 30 puts it at (40, 40) there.
    expect(changes.at(-1)?.get(MARKER)).toMatchObject({ x: 40, y: 40 });
    expect(overlays.at(-1)?.frame).toMatchObject({ x: 80, y: 80, width: 70, height: 60 });
  });

  it('releases what its creator handed it on destroy, and stops following the document', () => {
    const { store, document, release, onChange } = setUp();
    document.destroy();
    onChange.mockClear();
    store.transact(LOCAL_USER_ORIGIN, (transaction) => transaction.deleteObject(MARKER));
    expect(release).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('loads board objects as they are, in one change set with the system origin, which it indexes', () => {
    const { store, document } = setUp(createDemoDocument([]));
    const board = createDemoDocument();
    const objects = [...board.read().objects.values()];
    document.load(objects);
    expect(store.get(MARKER)).toEqual(board.get(MARKER));
    const [loaded, ...rest] = document.inspect().changeSets;
    expect(rest).toEqual([]);
    expect(loaded?.originKind).toBe('system');
    expect([...(loaded?.created ?? [])].sort()).toEqual(objects.map(({ id }) => id).sort());
    expect(document.contentBounds()).toEqual({ minX: 40, minY: 40, maxX: 1900, maxY: 1220 });
    board.destroy();
  });
});
