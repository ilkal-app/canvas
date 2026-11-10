import { bench, describe } from 'vitest';

import type { Camera } from '@canvas/engine';

import { applyCameraOperation } from './camera-controller.js';
import { cameraOperationFor } from './camera-input.js';
import { TwoFingerGesture } from './two-finger-gesture.js';

// CPU cost of turning input into the next camera, which runs on every wheel and pointer event
// before a camera-only frame (the budget: a camera-only frame under 1 ms of CPU; the frame itself
// is benchmarked in packages/engine, scene-renderer.bench.ts).
// Gated by `pnpm bench:ci` (its micro-benchmark suite).

const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1600,
  viewportHeightPx: 1000,
  dpr: 2,
};
const CONTEXT = { camera: CAMERA, contentBounds: undefined, selectionBounds: undefined };

describe('camera input to camera', () => {
  bench('a Control-wheel event: map and zoom about the cursor', () => {
    const operation = cameraOperationFor(
      {
        kind: 'wheel',
        point: { x: 400, y: 300 },
        deltaXPx: 0,
        deltaYPx: -4,
        isZoomModifierPressed: true,
      },
      CONTEXT,
    );
    if (operation !== undefined) applyCameraOperation(CAMERA, operation);
  });

  bench('a two-finger move: track, map and apply the pan and the pinch', () => {
    const gesture = new TwoFingerGesture();
    gesture.pointerDown(1, { x: 100, y: 100 });
    gesture.pointerDown(2, { x: 200, y: 100 });
    let camera = CAMERA;
    for (const input of gesture.pointerMove(2, { x: 230, y: 110 })) {
      const operation = cameraOperationFor(input, { ...CONTEXT, camera });
      if (operation !== undefined) camera = applyCameraOperation(camera, operation);
    }
  });
});
