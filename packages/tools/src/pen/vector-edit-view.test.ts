// What vector edit shows while the pointer rests and the camera moves (fix round 2): a
// change is signalled only when the hovered segment, the cursor, the zoom or the culled region
// changed, and every pointer step is one the mode showed itself, so the router does not rebuild
// the overlay after each move. The test path sits at (100, 100): v1 (0, 0), v2 (100, 0), v3
// (200, 0), so world = local + (100, 100).
import { describe, expect, it } from 'vitest';

import type { Camera } from '@canvas/engine';

import { createPenModeContext, pointer, testPath } from './__fixtures__/pen-mode-context.js';
import { createVectorEditMode } from './vector-modes.js';

/**
 * A camera at zoom 1 with a 100 × 100 px view from a world point.
 *
 * @param x - The view's left edge, world units.
 * @param y - Its top edge.
 * @returns The camera.
 */
function cameraAt(x: number, y: number): Camera {
  return { x, y, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
}

/**
 * Vector edit of the test path, counting the change signals.
 *
 * @returns The mode and a reader of the signals so far.
 */
function setUp() {
  const { context } = createPenModeContext([testPath()]);
  let changes = 0;
  const mode = createVectorEditMode(
    {
      ...context,
      onChange: () => {
        changes += 1;
      },
    },
    testPath().id,
  );
  return { mode, changes: () => changes };
}

describe('VectorEditMode: change signals', () => {
  it('signals a hover only when the hovered segment or the cursor changes', () => {
    const { mode, changes } = setUp();
    const move = (x: number, y: number) => mode.onPointer(pointer('pointerMove', { x, y }));
    expect(move(150, 300)).toEqual({ isDone: false, isShown: true });
    expect(changes()).toBe(0);
    move(150, 102);
    move(151, 102);
    expect(changes()).toBe(1);
    move(200, 101);
    expect(mode.cursor).toBe('pointer');
    expect(changes()).toBe(2);
    mode.onZoom(1);
    expect(changes()).toBe(2);
    mode.onZoom(2);
    expect(changes()).toBe(3);
  });

  it('culls the vertices to the region round the camera, and rebuilds once the view leaves it', () => {
    const { mode, changes } = setUp();
    // A view of world x 100 to 200: the region reaches x 250, so v3 (world 300) is left out.
    mode.onPointer({ ...pointer('pointerMove', { x: 150, y: 300 }), camera: cameraAt(100, 50) });
    const vertexSquares = () =>
      (mode.overlay().toolRects ?? [])
        .filter(({ box }) => box.width === 8)
        .map(({ box }) => box.x + 4);
    expect(vertexSquares()).toEqual([100, 200]);
    const before = changes();
    mode.refreshCursor({ x: 150, y: 300 }, cameraAt(120, 50));
    expect(changes()).toBe(before);
    mode.refreshCursor({ x: 150, y: 300 }, cameraAt(200, 50));
    expect(changes()).toBe(before + 1);
    // The view is now x 200 to 300: v1 (world 100) is past the new region's edge at 150.
    expect(vertexSquares()).toEqual([200, 300]);
  });

  it('follows what lies under a still pointer when the camera moves', () => {
    const { mode, changes } = setUp();
    mode.onPointer(pointer('pointerMove', { x: 150, y: 300 }));
    expect(mode.cursor).toBe('default');
    mode.refreshCursor({ x: 150, y: 102 }, cameraAt(0, 0));
    expect(mode.cursor).toBe('move');
    expect(changes()).toBe(1);
  });
});
