// The select tool's overlay model for large selections: above the outline cap it
// carries the selection's count instead of an outline per object, so neither building it on the
// page nor drawing it at each zoom where the engine runs grows with the selection. In Chrome, on
// a real GPU: the golden scene `selection-overlay-capped` (tooling/golden).
import { describe, expect, it } from 'vitest';

import type { ChangeSet } from '@canvas/document';
import type { BoardObject, Point } from '@canvas/schema';

import { indexOf, rect } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { countBadgeLayout } from './count-badge.js';
import { boxCentreOf } from './oriented-box.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';
import { MAX_OUTLINED_OBJECTS } from './selection-outlines.js';

/**
 * A controller over `count` loose 10 × 10 rectangles, 10 to a row on a 20-unit grid.
 *
 * @param count - How many rectangles.
 * @returns The controller.
 */
function controllerOver(count: number): SelectController {
  return setUp(count).controller;
}

/**
 * A controller over `count` loose rectangles (`controllerOver`), with the change sets it writes
 * and a pointer that presses, drags and releases at 100%.
 *
 * @param count - How many rectangles.
 * @returns The controller, its change sets and the gesture helpers.
 */
function setUp(count: number) {
  const objects: BoardObject[] = [...Array(count).keys()].map((index) =>
    rect(`r${String(index)}`, null, {
      x: (index % 10) * 20,
      y: Math.floor(index / 10) * 20,
      width: 10,
      height: 10,
    }),
  );
  const store = createSelectStore(objects);
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(indexOf(objects), storeSource(store)),
  });
  const at = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', point: Point) => {
    const input = { kind, screen: point, world: point, isShiftPressed: false, isModPressed: false };
    controller.handle(input, 1);
  };
  const drag = (from: Point, to: Point) => {
    at('pointerDown', from);
    at('pointerMove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    at('pointerMove', to);
    at('pointerUp', to);
  };
  return { controller, changeSets, at, drag };
}

describe('SelectController: the overlay of a large selection', () => {
  it('outlines every object of a selection at the outline cap', () => {
    const controller = controllerOver(MAX_OUTLINED_OBJECTS);
    controller.selectAll();
    const { outlines, countBadge } = controller.overlay();
    expect([outlines.length, countBadge]).toEqual([MAX_OUTLINED_OBJECTS, undefined]);
  });

  it('shows select all beyond the cap as the frame round everything and its count', () => {
    const count = MAX_OUTLINED_OBJECTS + 1;
    const controller = controllerOver(count);
    controller.selectAll();
    const model = controller.overlay();
    expect(model).toMatchObject({ outlines: [], countBadge: count, canResize: true });
    // 51 rows of 10: the last row holds one rectangle, at (0, 1000).
    expect(model.frame).toEqual({ x: 0, y: 0, width: 190, height: 1010, rotation: 0 });
  });

  it('resizes a selection above the cap from its handle in exactly one transform command', () => {
    const { controller, changeSets, drag } = setUp(MAX_OUTLINED_OBJECTS + 1);
    controller.selectAll();
    // The bottom-right handle sits on the frame's corner, (190, 1010).
    drag({ x: 190, y: 1010 }, { x: 380, y: 2020 });
    expect(changeSets).toHaveLength(1);
    expect(changeSets[0]?.updated).toHaveLength(MAX_OUTLINED_OBJECTS + 1);
    expect(controller.overlay()).toMatchObject({ countBadge: MAX_OUTLINED_OBJECTS + 1 });
    expect(controller.frame()).toMatchObject({ x: 0, y: 0, width: 380, height: 2020 });
  });

  it('takes a press on the count badge as inert: no rotation, marquee, move or deselect', () => {
    const { controller, changeSets, at, drag } = setUp(MAX_OUTLINED_OBJECTS + 1);
    controller.selectAll();
    const frame = controller.frame();
    if (frame === undefined) throw new Error('Nothing is selected.');
    const { badge } = countBadgeLayout(frame, MAX_OUTLINED_OBJECTS + 1, 1);
    const centre = boxCentreOf(badge);
    at('pointerMove', centre);
    expect(controller.cursor).toBe('default');
    drag(centre, { x: centre.x + 80, y: centre.y + 40 });
    at('pointerDown', centre);
    at('pointerUp', centre);
    expect(controller.selection.ids).toHaveLength(MAX_OUTLINED_OBJECTS + 1);
    expect(controller.overlay().marquee).toBeUndefined();
    expect(controller.frame()).toEqual(frame);
    expect(changeSets).toEqual([]);
  });

  it('finds the badge where the viewport keeps it, as the overlay draws it', () => {
    const { controller } = setUp(MAX_OUTLINED_OBJECTS + 1);
    controller.selectAll();
    // Zoomed in on the middle of the board: the badge is pinned to the view's bottom edge.
    const camera = { x: 50, y: 400, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
    const visible = { minX: 50, minY: 400, maxX: 150, maxY: 500 };
    const frame = controller.frame();
    if (frame === undefined) throw new Error('Nothing is selected.');
    const { badge } = countBadgeLayout(frame, MAX_OUTLINED_OBJECTS + 1, 1, visible);
    const centre = boxCentreOf(badge);
    const press = { screen: centre, world: centre, isShiftPressed: false, isModPressed: false };
    controller.handle({ kind: 'pointerDown', ...press }, 1, camera);
    controller.handle({ kind: 'pointerUp', ...press }, 1, camera);
    // Elsewhere inside the frame a click clears the selection; on the badge it keeps it.
    expect(controller.selection.ids).toHaveLength(MAX_OUTLINED_OBJECTS + 1);
  });
});
