import { describe, expect, it } from 'vitest';

import { createHistory, type ChangeSet } from '@canvas/document';
import type { ObjectId, Point, PrincipalId } from '@canvas/schema';

import { id, indexOf, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import type { SnapSettings } from './drag-snap.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

const SNAPPING: SnapSettings = { isEnabled: true, isGridVisible: false };

/**
 * The camera at a zoom whose view is world −1000 to 2000 each way: the whole board on screen.
 *
 * @param zoom - The zoom.
 * @returns The camera.
 */
function cameraAt(zoom: number) {
  const sidePx = 3000 * zoom;
  return { x: -1000, y: -1000, zoom, viewportWidthPx: sidePx, viewportHeightPx: sidePx, dpr: 1 };
}

function setUp(snap: SnapSettings | undefined = SNAPPING) {
  const store = createSelectStore();
  const history = createHistory(store, 'user:ada' as PrincipalId);
  const index = indexOf(selectBoardObjects());
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    snapIndex: index,
  });
  const at = (
    kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
    point: Point,
    isSnapSuspended = false,
    zoom = 1,
  ) => {
    const input = {
      kind,
      screen: { x: point.x * zoom, y: point.y * zoom },
      world: point,
      isShiftPressed: false,
      isModPressed: false,
      isSnapSuspended,
    };
    controller.handle(input, zoom, cameraAt(zoom), snap);
  };
  return { store, history, controller, changeSets, at };
}

describe('SelectController: snapping', () => {
  it('snaps a moved object’s right edge to its neighbour’s left edge, with a guide, in one command', () => {
    const { store, controller, changeSets, at } = setUp();
    // rect-a is 100 wide at x 0; rect-b, turned, starts at x 150. Dragging 47 puts the right
    // edge 3 short of it.
    at('pointerDown', { x: 50, y: 25 });
    at('pointerMove', { x: 97, y: 25 });
    expect(controller.frame()).toMatchObject({ x: 50, y: 0 });
    expect(controller.overlay().guides).toContainEqual({
      axis: 'x',
      position: 150,
      from: 0,
      to: 100,
    });
    at('pointerUp', { x: 97, y: 25 });
    expect(store.get(id('rect-a'))).toMatchObject({ x: 50, y: 0 });
    expect(changeSets).toHaveLength(1);
    expect(controller.overlay().guides).toBeUndefined();
  });

  it('suspends snapping while the snap modifier is held, to the release', () => {
    const { store, controller, at } = setUp();
    at('pointerDown', { x: 50, y: 25 });
    at('pointerMove', { x: 97, y: 25 }, true);
    expect(controller.overlay().guides).toBeUndefined();
    at('pointerUp', { x: 97, y: 25 }, true);
    expect(store.get(id('rect-a'))).toMatchObject({ x: 47, y: 0 });
  });

  it('does not snap when snapping is off or no view is given', () => {
    const off = setUp({ isEnabled: false, isGridVisible: true });
    off.at('pointerDown', { x: 50, y: 25 });
    off.at('pointerUp', { x: 50, y: 25 });
    off.at('pointerDown', { x: 50, y: 25 });
    off.at('pointerMove', { x: 97, y: 25 });
    off.at('pointerUp', { x: 97, y: 25 });
    expect(off.store.get(id('rect-a'))).toMatchObject({ x: 47 });
  });

  it('snaps to the grid when it shows and no object is near', () => {
    const { store, at } = setUp({ isEnabled: true, isGridVisible: true });
    // rect-a moved by 1006 lies at x 1006–1106, y 1006–1056, far from every object: its left
    // edge snaps to 1008 on the 16-unit grid of 100%, and its bottom already lies on 1056.
    at('pointerDown', { x: 50, y: 25 });
    at('pointerMove', { x: 1056, y: 1031 });
    at('pointerUp', { x: 1056, y: 1031 });
    expect(store.get(id('rect-a'))).toMatchObject({ x: 1008, y: 1006 });
  });

  it('measures the threshold on screen: the same world gap snaps zoomed out, not zoomed in', () => {
    // rect-a moved down by 240 has its bottom at 290, 10 world units above rect-d's top.
    const drag = (zoom: number) => {
      const { store, at } = setUp();
      at('pointerDown', { x: 50, y: 25 }, false, zoom);
      at('pointerMove', { x: 50, y: 265 }, false, zoom);
      at('pointerUp', { x: 50, y: 265 }, false, zoom);
      return store.get(id('rect-a'));
    };
    // 10 world units is 5 px at 50%: it snaps; at 200% it is 20 px: it stays.
    expect(drag(0.5)).toMatchObject({ x: 0, y: 250 });
    expect(drag(2)).toMatchObject({ x: 0, y: 240 });
  });

  it('snaps a resize’s dragged edge and keeps the other, and one undo puts it back', () => {
    const { store, history, at } = setUp();
    // Select rect-a, then drag its right-edge handle (at x 100, y 25) to 147: 3 short of 150.
    at('pointerDown', { x: 50, y: 25 });
    at('pointerUp', { x: 50, y: 25 });
    at('pointerDown', { x: 100, y: 25 });
    at('pointerMove', { x: 147, y: 25 });
    at('pointerUp', { x: 147, y: 25 });
    expect(store.get(id('rect-a'))).toMatchObject({ x: 0, y: 0, width: 150, height: 50 });
    history.undo();
    expect(store.get(id('rect-a'))).toMatchObject({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('shows no guide and moves nothing for a locked selection', () => {
    const { store, controller, at } = setUp();
    // rect-locked, 50 × 50 at (800, 0), is locked: a click selects it, a drag moves nothing.
    at('pointerDown', { x: 820, y: 20 });
    at('pointerMove', { x: 870, y: 20 });
    expect(controller.overlay().guides).toBeUndefined();
    at('pointerUp', { x: 870, y: 20 });
    expect(store.get(id('rect-locked'))).toMatchObject({ x: 800, y: 0 });
  });

  it('snaps a partly locked selection by the frame of what moves', () => {
    const { store, controller, at } = setUp();
    // With rect-locked (800, 0) selected too, the frame round both spans x 0–850, but only
    // rect-a moves, so its own right edge snaps to rect-b's turned left edge at 150.
    controller.select([id('rect-a'), id('rect-locked')]);
    at('pointerDown', { x: 50, y: 25 });
    at('pointerMove', { x: 97, y: 25 });
    expect(controller.overlay().guides).toContainEqual({
      axis: 'x',
      position: 150,
      from: 0,
      to: 100,
    });
    at('pointerUp', { x: 97, y: 25 });
    expect(store.get(id('rect-a'))).toMatchObject({ x: 50, y: 0 });
    expect(store.get(id('rect-locked'))).toMatchObject({ x: 800, y: 0 });
  });
});
