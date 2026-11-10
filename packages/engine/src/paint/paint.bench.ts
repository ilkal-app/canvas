import { bench, describe } from 'vitest';

import type { Gradient } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject, zKeyAt } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SDF_SHAPE_GRADIENT_PASS } from '../shapes/shape-gradient-pass.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

// CPU cost of gradient fills and theme-aware ink (the coverage owed: "an entry with 10k gradient
// shapes beside the unchanged solid ones, and a theme switch on 10k ink strokes"), through a fake
// backend. The GPU side is the golden scenes' (gradient-geometry, gradient-over-content,
// gradient-paths, ink-themes).

const COUNT = 10_000;
const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1600,
  viewportHeightPx: 1000,
  dpr: 2,
};

const GRADIENT: Gradient = {
  type: 'linear',
  angle: Math.PI / 4,
  stops: [
    { offset: 0, color: [1, 0, 0, 1] },
    { offset: 0.5, color: [0, 1, 0, 1] },
    { offset: 1, color: [0, 0, 1, 1] },
  ],
};

/**
 * A renderer over `COUNT` solid shapes and, when asked, `COUNT` gradient shapes beside them (or
 * `COUNT` ink-outlined shapes), rendered once so every buffer and the paint table are clean.
 *
 * @param extra - What the second half of the board is: gradient shapes, ink outlines or none.
 * @returns The backend, renderer and document.
 */
function loaded(extra: 'gradient' | 'ink' | 'none') {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [SDF_SHAPE_PASS, SDF_SHAPE_GRADIENT_PASS],
  });
  const document = new FakeSceneDocument();
  const total = extra === 'none' ? COUNT : 2 * COUNT;
  for (let index = 0; index < total; index += 1) {
    const isExtra = index >= COUNT;
    document.create(
      shapeObject(`s${String(index)}`, {
        x: (index % 200) * 20,
        y: Math.floor(index / 200) * 20,
        z: zKeyAt(index),
        width: 16,
        height: 16,
        ...(isExtra && extra === 'gradient' ? { fill: GRADIENT } : {}),
        ...(isExtra && extra === 'ink' ? { stroke: { color: 'ink' as const, width: 2 } } : {}),
      }),
    );
  }
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  backend.resetCalls();
  return { backend, renderer, document };
}

describe(`gradient fills, ${String(COUNT)} gradient shapes beside ${String(COUNT)} solid`, () => {
  const solid = loaded('none');
  let solidTimeMs = 0;
  bench('camera-only frame, solid shapes alone (the reference)', () => {
    solidTimeMs += 16;
    const camera = { ...CAMERA, x: solidTimeMs % 500 };
    solid.renderer.renderFrame({ timeMs: solidTimeMs, camera });
    solid.backend.resetCalls();
  });

  const mixed = loaded('gradient');
  let mixedTimeMs = 0;
  bench('camera-only frame, gradient beside solid (uploads the camera only)', () => {
    mixedTimeMs += 16;
    const camera = { ...CAMERA, x: mixedTimeMs % 500 };
    mixed.renderer.renderFrame({ timeMs: mixedTimeMs, camera });
    mixed.backend.resetCalls();
  });

  const recoloured = loaded('gradient');
  let recolourTimeMs = 0;
  bench('apply and upload a 100-gradient paint change', () => {
    recolourTimeMs += 16;
    const angle = ((recolourTimeMs / 16) % 6) / 2 - 1.5;
    for (let index = 0; index < 100; index += 1) {
      const id = `s${String(COUNT + ((index * 97 + recolourTimeMs) % COUNT))}`;
      recoloured.document.update(id, { fill: { ...GRADIENT, angle } });
    }
    recoloured.renderer.enqueue(recoloured.document.takeChanges());
    recoloured.renderer.renderFrame({ timeMs: recolourTimeMs, camera: CAMERA });
    recoloured.backend.resetCalls();
  });
});

describe(`theme switch, ${String(COUNT)} ink strokes beside ${String(COUNT)} fixed`, () => {
  const inked = loaded('ink');
  let isDark = false;
  let timeMs = 0;
  bench('switch the theme and upload the ink records', () => {
    isDark = !isDark;
    timeMs += 16;
    inked.renderer.setTheme(isDark ? 'dark' : 'light');
    inked.renderer.renderFrame({ timeMs, camera: CAMERA });
    inked.backend.resetCalls();
  });
});
