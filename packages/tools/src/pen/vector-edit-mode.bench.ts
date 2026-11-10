import { bench, describe } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { BoardObjectOf, ObjectId, Point } from '@canvas/schema';

import type { ToolMode } from '../modes/tool-mode.js';

import { createPenModeContext, pointer, testPath } from './__fixtures__/pen-mode-context.js';
import { createVectorEditMode } from './vector-modes.js';

// The tools' side of vector edit on a 1,000-segment path. A drag move (fix round 1): the
// selected vertices move (`moveVertices` over the whole network), the path is previewed whole,
// and the overlay the app rebuilds on the change draws every segment as a thin line
// (`networkOverlayRects`). The engine's side, re-meshing the whole previewed path, is
// `packages/engine/src/paths/mesh-cache.bench.ts` ("vector-edit preview"). A hover move with no
// button down and the overlay rebuilds a hover or a zoom asks for (fix round 2), each as the app
// runs it: the router asks for the overlay after a step the mode has not shown itself, and the
// mode's own change signal asks for it too; the camera shows 160 of the segments.

const SEGMENTS = 1_000;

/**
 * An open chain of curved segments, 10 world units apart, at (100, 100).
 *
 * @returns The path.
 */
function longPath(): BoardObjectOf<'path'> {
  const vertices = Array.from({ length: SEGMENTS + 1 }, (unused, index) => ({
    id: `v${String(index)}`,
    x: index * 10,
    y: (index % 2) * 25,
    mirror: 'none' as const,
  }));
  const segments = vertices.slice(1).map((vertex, index) => ({
    id: `s${String(index)}`,
    a: `v${String(index)}`,
    b: vertex.id,
    ha: { x: 3, y: 8 },
    hb: { x: -3, y: -8 },
  }));
  return testPath({ id: 'long' as ObjectId, vertices, segments });
}

describe(`vector-edit drag on a ${String(SEGMENTS)}-segment path`, () => {
  const { context } = createPenModeContext([longPath()]);
  const mode = createVectorEditMode(context, 'long' as ObjectId);
  // Press on the middle vertex (world 5100, 100) and leave the dead zone.
  mode.onPointer(pointer('pointerDown', { x: 5100, y: 100 }));
  mode.onPointer(pointer('pointerMove', { x: 5100, y: 120 }));
  let step = 0;
  bench('one preview move: move, preview and rebuild the overlay', () => {
    step += 1;
    mode.onPointer(pointer('pointerMove', { x: 5100, y: 120 + (step % 2) * 10 }));
    mode.overlay();
  });
});

/** A 1,600 × 1,000 px view at zoom 1 over the path's middle (world x 4,300 to 5,900). */
const CAMERA: Camera = {
  x: 4300,
  y: -400,
  zoom: 1,
  viewportWidthPx: 1600,
  viewportHeightPx: 1000,
  dpr: 1,
};

/**
 * Vector edit of the long path as the app drives it: every change signal rebuilds the overlay,
 * and so does every pointer step the mode has not shown itself.
 *
 * @returns A pointer move with the camera, and the mode.
 */
function drivenMode(): { readonly move: (point: Point) => void; readonly mode: ToolMode } {
  const { context } = createPenModeContext([longPath()]);
  // The mode never signals a change while it is built, so the closure reads it built.
  const mode: ToolMode = createVectorEditMode(
    { ...context, onChange: () => mode.overlay() },
    'long' as ObjectId,
  );
  const move = (point: Point) => {
    const step = mode.onPointer({ ...pointer('pointerMove', point), camera: CAMERA });
    if (step.isShown !== true) mode.overlay();
  };
  return { move, mode };
}

describe(`vector-edit hover on a ${String(SEGMENTS)}-segment path`, () => {
  const still = drivenMode();
  let step = 0;
  bench('a hover move that changes nothing', () => {
    step += 1;
    // Below the path, off every member: nothing to highlight, the cursor stays.
    still.move({ x: 5100 + (step % 2), y: 400 });
  });
  const hovering = drivenMode();
  bench('an overlay rebuild: the hovered segment changes', () => {
    step += 1;
    // Between the vertices of two neighbouring segments, on their curves' middles.
    hovering.move({ x: 5055 + (step % 2) * 10, y: 112.5 });
  });
  const zooming = drivenMode();
  bench('an overlay rebuild: the zoom changes', () => {
    step += 1;
    zooming.mode.onZoom?.(1 + (step % 2) * 0.01);
  });
});
