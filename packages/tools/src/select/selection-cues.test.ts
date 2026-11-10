import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId, Point } from '@canvas/schema';

import { id, indexOf, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import type { SnapSettings } from './drag-snap.js';
import { LOCKED_LABEL_TEXT } from './overlay-label.js';
import { SelectController } from './select-controller.js';
import type { SelectGesture } from './select-gesture.js';
import { createSelectHitTester, type SelectHitTester } from './select-hit-tester.js';
import { SelectionCues } from './selection-cues.js';
import type { SelectionFrameCache } from './selection-frame-cache.js';
import type { SelectionState } from './selection-state.js';

// The select tool's editing cues (Figma "States" E2): the hover outline, the gap runs and
// their lengths during a snapped drag, the size readout during a resize, and the locked notice.

const SNAPPING: SnapSettings = { isEnabled: true, isGridVisible: false };

/** The camera at 100% over world −1000 to 2000 each way: the whole board on screen. */
const CAMERA = {
  x: -1000,
  y: -1000,
  zoom: 1,
  viewportWidthPx: 3000,
  viewportHeightPx: 3000,
  dpr: 1,
};

/**
 * Left, 100 × 50 at (0, 0); right, 100 × 50 at (200, 0); locked, 50 × 50 at (0, 200).
 *
 * @returns The board.
 */
function board(): BoardObject[] {
  return [
    rect('left', null, { x: 0, y: 0, width: 100, height: 50 }),
    rect('right', null, { x: 200, y: 0, width: 100, height: 50 }),
    rect('locked', null, { x: 0, y: 200, width: 50, height: 50, isLocked: true }),
  ];
}

function setUp(snapping: SnapSettings = SNAPPING) {
  const objects = board();
  const store = createSelectStore(objects);
  const index = indexOf(objects);
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  let changes = 0;
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    snapIndex: index,
    onChange: () => {
      changes += 1;
    },
  });
  const at = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', point: Point) => {
    const input = { kind, screen: point, world: point, isShiftPressed: false, isModPressed: false };
    controller.handle(input, 1, CAMERA, snapping);
  };
  return { store, controller, at, changes: () => changes };
}

describe('SelectController: editing cues', () => {
  it('outlines the unselected object under a resting pointer, and only when that changes', () => {
    const { controller, at, changes } = setUp();
    controller.select([id('left')]);
    at('pointerMove', { x: 250, y: 25 });
    expect(controller.overlay().hover).toEqual({
      x: 200,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
    });
    const before = changes();
    at('pointerMove', { x: 260, y: 30 });
    expect(changes()).toBe(before);
    // The selected object is not hovered, nor is empty board.
    at('pointerMove', { x: 50, y: 25 });
    expect(controller.overlay().hover).toBeUndefined();
    at('pointerMove', { x: 250, y: 25 });
    at('pointerMove', { x: 600, y: 600 });
    expect(controller.overlay().hover).toBeUndefined();
    // A press drops it.
    at('pointerMove', { x: 250, y: 25 });
    at('pointerDown', { x: 250, y: 25 });
    expect(controller.overlay().hover).toBeUndefined();
  });

  it('does not hover with a finger', () => {
    const { controller } = setUp();
    controller.handle(
      {
        kind: 'pointerMove',
        screen: { x: 250, y: 25 },
        world: { x: 250, y: 25 },
        isShiftPressed: false,
        isModPressed: false,
        pointerType: 'touch',
      },
      1,
      CAMERA,
      SNAPPING,
    );
    expect(controller.overlay().hover).toBeUndefined();
  });

  it('shows the gap run to the neighbour and its length while a move snaps to an object', () => {
    const { controller, at } = setUp();
    // Left's top edge lands 3 below right's and snaps up to it; 88 units are left between them,
    // and 150 between left and the locked square below, which faces it over x 12–50.
    at('pointerDown', { x: 50, y: 25 });
    at('pointerMove', { x: 62, y: 28 });
    const overlay = controller.overlay();
    expect(overlay.guides?.length).toBeGreaterThan(0);
    expect(overlay.gaps).toEqual([
      { axis: 'x', from: 112, to: 200, position: 25 },
      { axis: 'y', from: 50, to: 200, position: 31 },
    ]);
    expect(overlay.labels).toEqual([
      { kind: 'gap', text: '88', at: { x: 156, y: 25 }, axis: 'x' },
      { kind: 'gap', text: '150', at: { x: 31, y: 125 }, axis: 'y' },
    ]);
    at('pointerUp', { x: 62, y: 28 });
    expect(controller.overlay().gaps).toBeUndefined();
    expect(controller.overlay().labels).toBeUndefined();
  });

  it('shows no gap run on a drag that snapped to nothing', () => {
    const { controller, at } = setUp();
    at('pointerDown', { x: 50, y: 25 });
    at('pointerMove', { x: 450, y: 440 });
    expect(controller.overlay().guides).toBeUndefined();
    expect(controller.overlay().gaps).toBeUndefined();
  });

  it('reads the resized frame’s size while resizing, in whole units, at its bottom-right', () => {
    const { controller, at } = setUp({ isEnabled: false, isGridVisible: false });
    controller.select([id('left')]);
    at('pointerDown', { x: 100, y: 50 });
    at('pointerMove', { x: 130.4, y: 69.6 });
    expect(controller.overlay().labels).toEqual([
      { kind: 'size', text: '130 × 70', at: { x: 130.4, y: 69.6 } },
    ]);
    at('pointerUp', { x: 130.4, y: 69.6 });
    expect(controller.overlay().labels).toBeUndefined();
  });

  it('says a locked selection cannot move once a person tries, until the selection changes', () => {
    const { store, controller, at } = setUp();
    at('pointerDown', { x: 25, y: 225 });
    at('pointerUp', { x: 25, y: 225 });
    expect(controller.selection.ids).toEqual([id('locked')]);
    expect(controller.overlay().labels).toBeUndefined();
    at('pointerDown', { x: 25, y: 225 });
    at('pointerMove', { x: 85, y: 265 });
    const notice = { kind: 'locked', text: LOCKED_LABEL_TEXT, at: { x: 0, y: 250 } };
    expect(controller.overlay()).toMatchObject({ isLocked: true, labels: [notice] });
    at('pointerUp', { x: 85, y: 265 });
    expect(store.get(id('locked'))).toMatchObject({ x: 0, y: 200 });
    expect(controller.overlay().labels).toEqual([notice]);
    controller.select([id('left')]);
    expect(controller.overlay().labels).toBeUndefined();
  });

  it('drops the locked notice at the next press', () => {
    const { controller, at } = setUp();
    controller.select([id('locked')]);
    at('pointerDown', { x: 25, y: 225 });
    at('pointerMove', { x: 85, y: 265 });
    at('pointerUp', { x: 85, y: 265 });
    expect(controller.overlay().labels).toHaveLength(1);
    at('pointerDown', { x: 25, y: 225 });
    expect(controller.overlay().labels).toBeUndefined();
  });

  it('tests membership in a set made once per selection: a resting move does not scan it', () => {
    const ids = [...Array(50_000).keys()].map((index) => id(`r${String(index)}`));
    const iterations = vi.spyOn(ids, Symbol.iterator);
    const includes = vi.spyOn(ids, 'includes');
    const selection = { ids, primaryId: ids[0] ?? null } as unknown as SelectionState;
    const hitTester = {
      hitPoint: () => ({ id: id('r1'), scope: null, part: 'object' as const }),
    } as unknown as SelectHitTester;
    const cues = new SelectionCues({
      hitTester,
      source: { get: () => undefined, childrenOf: () => [] },
      gesture: {} as SelectGesture,
      cache: {} as SelectionFrameCache,
    });
    const resting = { phase: 'idle', enteredGroupId: null, cursor: 'default' } as const;
    for (let move = 0; move < 100; move += 1) {
      const point = { x: move, y: move };
      const input = {
        kind: 'pointerMove',
        screen: point,
        world: point,
        isShiftPressed: false,
        isModPressed: false,
      } as const;
      cues.follow(input, 1, resting, selection);
    }
    expect(includes).not.toHaveBeenCalled();
    expect(iterations).toHaveBeenCalledTimes(1);
  });

  it('rebuilds only the hover outline when the hover changes', () => {
    // 100 selected boxes in a row, and two unselected ones below to hover.
    const objects = [
      ...[...Array(100).keys()].map((index) =>
        rect(`s${String(index)}`, null, { x: index * 20, y: 0, width: 10, height: 10 }),
      ),
      rect('h1', null, { x: 0, y: 100, width: 50, height: 50 }),
      rect('h2', null, { x: 100, y: 100, width: 50, height: 50 }),
    ];
    const store = createSelectStore(objects);
    const controller = new SelectController({
      store,
      origin: ADA,
      environment: ENVIRONMENT,
      hitTester: createSelectHitTester(indexOf(objects), storeSource(store)),
    });
    const at = (point: Point) => {
      const input = {
        kind: 'pointerMove',
        screen: point,
        world: point,
        isShiftPressed: false,
        isModPressed: false,
      } as const;
      controller.handle(input, 1, CAMERA, SNAPPING);
    };
    controller.select(objects.slice(0, 100).map(({ id: objectId }) => objectId));
    const outlines = controller.overlay();
    at({ x: 25, y: 125 });
    const first = controller.overlay();
    const reads = vi.spyOn(store, 'get');
    at({ x: 125, y: 125 });
    const second = controller.overlay();
    expect([first.hover?.x, second.hover?.x]).toEqual([0, 100]);
    // No selected box was measured again: the outlines are the ones already made.
    const selectedReads = reads.mock.calls.filter(([key]) => String(key).startsWith('s'));
    expect(selectedReads).toEqual([]);
    expect(first.outlines).toBe(outlines.outlines);
    expect(second.outlines).toBe(outlines.outlines);
    // A change to a selected object measures them again.
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('s0'), { x: -40 });
    });
    expect(controller.overlay().outlines[0]?.x).toBe(-40);
  });

  it('hit-tests nothing when only the camera moves under a still pointer', () => {
    const objects = board();
    const store = createSelectStore(objects);
    const tester = createSelectHitTester(indexOf(objects), storeSource(store));
    const hitPoint = vi.spyOn(tester, 'hitPoint');
    let changes = 0;
    const controller = new SelectController({
      store,
      origin: ADA,
      environment: ENVIRONMENT,
      hitTester: tester,
      onChange: () => {
        changes += 1;
      },
    });
    // A zoom sweep and a pan: the shell brings the resting cursor up to date at each step.
    for (let step = 1; step <= 100; step += 1) {
      const zoom = 0.05 + step * 0.3;
      controller.refreshCursor({ x: 250, y: 25 }, zoom, { ...CAMERA, x: step, zoom });
    }
    expect([hitPoint.mock.calls.length, changes, controller.overlay().hover]).toEqual([
      0,
      0,
      undefined,
    ]);
  });
});
