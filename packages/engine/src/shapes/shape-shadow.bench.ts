import { bench, describe } from 'vitest';

import type { Shadow } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
  zKeyAt,
} from '../scene/__fixtures__/scene-objects.js';
import { FRAME_SHADOW_PASS } from '../scene/frame-shadow-pass.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { TEXT_PASS, textObject } from '../scene/segments/__fixtures__/note-and-text-passes.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';

import { SDF_SHAPE_PASS } from './shape-pass.js';

// CPU cost of drop shadows through a fake backend: the same 10k-object board with no
// shadow, and with every tenth shape and every frame shadowed. A shape's shadow is an extra
// record in the shape pass; a frame's one in the frame shadow pass, flagged to the z-order
// segments, whose bounds take every shadow in. The board: a 100 × 100 grid of 16 × 16 squares,
// a text box after every 50th object and a 120 × 120 frame behind every 100 objects, so shadows
// meet later-pass content. The GPU side is the drop-shadows golden scenes
// (tooling/golden/scenes); the frame-time suite's `zoom-sweep-shadowed` the 50k board.

const OBJECT_COUNT = 10_000;
const CHANGE_COUNT = 100;
const SHADOW: Shadow = { x: 0, y: 4, blur: 8, spread: 0, color: [0, 0, 0, 0.25] };
const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1600,
  viewportHeightPx: 1000,
  dpr: 2,
};

/**
 * The board, rendered once so every buffer is uploaded and clean.
 *
 * @param isShadowed - Whether every tenth shape and every frame has a shadow.
 * @returns The backend, the renderer and the document behind it.
 */
function loadedBoard(isShadowed: boolean): {
  backend: FakeGpuBackend;
  renderer: SceneRenderer;
  document: FakeSceneDocument;
} {
  const backend = new FakeGpuBackend();
  const passes = [FRAME_SHADOW_PASS, SOLID_RECT_PASS, SDF_SHAPE_PASS, TEXT_PASS];
  const renderer = new SceneRenderer(backend, { passes });
  const document = new FakeSceneDocument();
  for (let index = 0; index < OBJECT_COUNT; index += 1) {
    const x = (index % 100) * 20;
    const y = Math.floor(index / 100) * 20;
    const z = zKeyAt(index);
    const id = String(index);
    if (index % 100 === 0) {
      const shadow = isShadowed ? SHADOW : null;
      document.create(frameObject(`f${id}`, { x, y, z, width: 120, height: 120, shadow }));
    } else if (index % 50 === 25) {
      document.create(textObject(`t${id}`, { x, y, z }));
    } else {
      const shadow = isShadowed && index % 10 === 0 ? SHADOW : null;
      document.create(shapeObject(`s${id}`, { x, y, z, width: 16, height: 16, shadow }));
    }
  }
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  backend.resetCalls();
  return { backend, renderer, document };
}

describe.each([
  { label: 'no shadows', isShadowed: false },
  { label: 'shadows', isShadowed: true },
])(`drop shadows, ${String(OBJECT_COUNT)} objects: $label`, ({ isShadowed }) => {
  const panning = loadedBoard(isShadowed);
  let panTimeMs = 0;
  bench('camera move across the board (re-culls and re-plans the segments)', () => {
    panTimeMs += 16;
    const camera = { ...CAMERA, x: (panTimeMs * 7) % 1200 };
    panning.renderer.renderFrame({ timeMs: panTimeMs, camera });
    panning.backend.resetCalls();
  });

  const changing = loadedBoard(isShadowed);
  let changeTimeMs = 0;
  bench(`apply and upload a ${String(CHANGE_COUNT)}-shape move`, () => {
    changeTimeMs += 16;
    for (let index = 1; index <= CHANGE_COUNT; index += 1) {
      const shape = (index * 97) % OBJECT_COUNT;
      if (shape % 100 === 0 || shape % 50 === 25) continue;
      changing.document.update(`s${String(shape)}`, { x: (shape % 100) * 20 + (changeTimeMs % 8) });
    }
    changing.renderer.enqueue(changing.document.takeChanges());
    changing.renderer.renderFrame({ timeMs: changeTimeMs, camera: CAMERA });
    changing.backend.resetCalls();
  });
});
