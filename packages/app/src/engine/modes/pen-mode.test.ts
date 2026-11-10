// The pen tool's registration through the engine document: the toolbar's pen draws
// paths, V and P switch between vector editing's two sub-tools on one path with the toolbar
// following, activation enters vector editing, Escape leaves it, Shift+Delete heals, and pen
// points snap. The pen in Chrome: tooling/scenario/specs/tools/pen*.spec.ts.
import { describe, expect, it, vi } from 'vitest';

import { createHistory, YjsDocumentStore } from '@canvas/document';
import type { Camera } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';
import { PenMode, VectorEditMode } from '@canvas/tools';

import { LOCAL_USER_ORIGIN } from '../demo-document.js';
import { EngineDocument } from '../engine-document.js';
import type { ScreenPointerInput } from '../select-input-binding.js';

import { SelectToolMode } from './select-mode.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/** A 100 × 50 rectangle at the origin, for snapping. */
const BOX: BoardObject = {
  id: 'box' as ObjectId,
  type: 'shape',
  parentId: null,
  x: 0,
  y: 0,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: LOCAL_USER_ORIGIN.principalId,
  createdAt: 1,
  updatedAt: 1,
  kind: 'rectangle',
  width: 100,
  height: 50,
  stroke: null,
  fill: [1, 0, 0, 1],
  cornerRadius: 0,
  sides: 4,
  label: null,
};

function setUp(objects: readonly BoardObject[] = []) {
  const store = new YjsDocumentStore();
  store.transact(LOCAL_USER_ORIGIN, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  const onToolChange = vi.fn();
  const notices: string[] = [];
  let next = 0;
  const document = new EngineDocument({
    store,
    history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
    origin: LOCAL_USER_ORIGIN,
    environment: {
      clock: () => 1_790_000_000_000,
      createId: () => `id-${String((next += 1))}` as ObjectId,
    },
    onChange: () => undefined,
    onToolChange,
    onNotice: (message) => notices.push(message),
  });
  const at = (
    kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
    x: number,
    y: number,
    extra: Partial<Pick<ScreenPointerInput & { kind: 'pointerDown' }, 'isSnapSuspended'>> = {},
    timeStamp = 0,
  ) => {
    const input: ScreenPointerInput = {
      kind,
      screen: { x, y },
      isShiftPressed: false,
      isModPressed: false,
      timeStamp,
      ...extra,
    };
    document.handlePointer(input, CAMERA);
  };
  const click = (x: number, y: number, timeStamp = 0) => {
    at('pointerDown', x, y, {}, timeStamp);
    at('pointerUp', x, y, {}, timeStamp);
  };
  const paths = () => [...store.read().objects.values()].filter((object) => object.type === 'path');
  return { store, document, onToolChange, notices, click, at, paths };
}

describe('the pen tool through the engine document', () => {
  it('draws a path with the pen style, one command per click', () => {
    const { document, click, paths } = setUp();
    document.setActiveTool('pen');
    expect(document.tools.router.activeMode).toBeInstanceOf(PenMode);
    click(100, 100);
    click(200, 100);
    const [path] = paths();
    expect(path).toMatchObject({ x: 100, y: 100, stroke: { width: 2 }, fill: null });
    expect(path?.type === 'path' && path.segments).toHaveLength(1);
    expect(document.cursor()).toBe('crosshair');
  });

  it('switches to vector editing on V and back on P, the toolbar following', () => {
    const { document, onToolChange, click } = setUp();
    document.setActiveTool('pen');
    click(100, 100);
    // A lone point: V keeps the pen and the shell is told.
    document.setActiveTool('select');
    expect(document.tools.router.activeMode).toBeInstanceOf(PenMode);
    expect(onToolChange).toHaveBeenLastCalledWith('pen');
    click(200, 100);
    document.setActiveTool('select');
    expect(document.tools.router.activeMode).toBeInstanceOf(VectorEditMode);
    expect(document.tools.router.activeTool).toBe('select');
    document.setActiveTool('pen');
    expect(document.tools.router.activeMode).toBeInstanceOf(PenMode);
    expect(document.tools.router.activeTool).toBe('pen');
  });

  it('enters vector editing on Enter with a path selected, and leaves it on Escape', () => {
    const { document, click, paths } = setUp();
    document.setActiveTool('pen');
    click(100, 100);
    click(200, 100);
    document.setActiveTool('text');
    document.setActiveTool('select');
    const id = paths()[0]?.id;
    expect(document.inspect().selectedIds).toEqual([id]);
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(document.tools.router.activeMode).toBeInstanceOf(VectorEditMode);
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    expect(document.tools.router.activeMode).toBeInstanceOf(SelectToolMode);
    expect(document.inspect().selectedIds).toEqual([id]);
  });

  it('drops a path under way on a downgrade, writing nothing', () => {
    const { store, document, click, at, paths } = setUp();
    let writes = 0;
    store.subscribeUpdates(() => {
      writes += 1;
    });
    document.setActiveTool('pen');
    click(100, 100);
    click(200, 100);
    // Mid-stroke: a third point pressed and dragged.
    at('pointerDown', 300, 150);
    at('pointerMove', 340, 180);
    const before = writes;
    document.setEditable(false);
    expect(writes).toBe(before);
    expect(paths()[0]?.type === 'path' && paths()[0]).toMatchObject({ vertices: [{}, {}] });
    expect(document.tools.router.activeTool).toBe('select');
  });

  it('keeps a path left with no segment on a downgrade, which leaving it would delete', () => {
    const { store, document, click, paths } = setUp();
    document.setActiveTool('pen');
    click(100, 100);
    click(200, 100);
    const id = paths()[0]?.id ?? ('' as ObjectId);
    // A collaborator takes the segment away while the path is being drawn.
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(id, { segments: [] });
    });
    let writes = 0;
    store.subscribeUpdates(() => {
      writes += 1;
    });
    document.setEditable(false);
    expect(writes).toBe(0);
    expect(store.get(id)).toMatchObject({ segments: [] });
  });

  it('heals on Shift+Delete in vector editing', () => {
    const { document, click, paths } = setUp();
    document.setActiveTool('pen');
    click(100, 100);
    click(200, 100);
    click(300, 100);
    document.setActiveTool('select');
    click(200, 100);
    document.runCanvasAction({ type: 'selection', command: 'deleteAndHeal' }, 1);
    const [path] = paths();
    expect(path?.type === 'path' && path.vertices).toHaveLength(2);
    expect(path?.type === 'path' && path.segments).toHaveLength(1);
  });

  it('declines to edit a locked path, and tells the person when one is locked mid-edit', () => {
    const { store, document, notices, click, paths } = setUp();
    document.setActiveTool('pen');
    click(100, 100);
    click(200, 100);
    document.setActiveTool('select');
    const id = paths()[0]?.id;
    if (id === undefined) throw new Error('no path');
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(id, { locked: true });
    });
    click(200, 100);
    expect(notices).toHaveLength(1);
    expect(document.tools.router.activeMode).toBeInstanceOf(SelectToolMode);
    expect(document.tools.router.canActivate(id)).toBe(false);
  });

  it('snaps a new point to a nearby edge while snapping is on', () => {
    const { document, click, paths } = setUp([BOX]);
    document.setSnapping({ isEnabled: true, isGridVisible: false });
    document.setActiveTool('pen');
    click(104, 80);
    // The path is created with its first segment.
    click(40, 80);
    expect(paths()[0]).toMatchObject({ x: 100, y: 80 });
  });
});
