import { bench, describe } from 'vitest';

import type { Rgba } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
  zKeyAt,
} from './__fixtures__/scene-objects.js';
import { FRAME_FILL_LUMINANCE, type ColorModeFallbackOption } from './color-mode-fallback.js';
import { SceneRenderer } from './scene-renderer.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

// CPU cost of the frame-fill rule, through a fake backend: 50k shapes outlined in ink
// in 50 outer frames of 1,000, each holding an inner frame with half of them. Outer frames
// alternate a dark fill and the `surface` token (whose mode follows the viewer's theme); inner
// frames are light. Measured: a frame's fill edit (its 1,000 descendants re-resolve), a theme
// switch (the token-filled frames' content works its mode out again) and an edit of the token,
// each against the same board without the rule.

const FRAMES = 50;
const PER_FRAME = 1_000;
const DARK: Rgba = [0.08, 0.1, 0.2, 1];
const LIGHT: Rgba = [0.97, 0.96, 0.92, 1];
const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 0.1,
  viewportWidthPx: 1600,
  viewportHeightPx: 1000,
  dpr: 2,
};

/**
 * A renderer over the board, rendered once so every buffer is clean.
 *
 * @param fallback - The colour mode fallback, if any.
 * @returns The backend, document and renderer.
 */
function loaded(fallback?: ColorModeFallbackOption) {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [SOLID_RECT_PASS, SDF_SHAPE_PASS],
    ...(fallback && { colorModeFallback: fallback }),
  });
  const document = new FakeSceneDocument();
  for (let frame = 0; frame < FRAMES; frame += 1) {
    const outer = `f${String(frame)}`;
    const inner = `${outer}-in`;
    document.create(
      frameObject(outer, {
        x: (frame % 10) * 2_000,
        y: Math.floor(frame / 10) * 2_000,
        width: 1_600,
        height: 1_600,
        z: zKeyAt(frame),
        background: frame % 2 === 0 ? DARK : { token: 'surface' },
      }),
      frameObject(inner, {
        parentId: outer,
        width: 800,
        height: 1_600,
        background: LIGHT,
      }),
    );
    for (let index = 0; index < PER_FRAME; index += 1) {
      document.create(
        shapeObject(`${outer}-s${String(index)}`, {
          parentId: index % 2 === 0 ? inner : outer,
          x: (index % 40) * 40,
          y: Math.floor(index / 40) * 40,
          z: zKeyAt(index + 1),
          width: 30,
          height: 30,
          fill: null,
          stroke: { color: 'ink', width: 2 },
        }),
      );
    }
  }
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  backend.resetCalls();
  return { backend, document, renderer };
}

for (const fallback of [FRAME_FILL_LUMINANCE, undefined] as const) {
  const label = fallback === undefined ? 'no fallback' : 'frame-fill rule';
  describe(`ink in ${String(FRAMES)} nested filled frames, 50k shapes, ${label}`, () => {
    const edited = loaded(fallback);
    let editTimeMs = 0;
    bench(`edit a frame's fill (1,000 descendants re-applied), ${label}`, () => {
      editTimeMs += 16;
      const isDark = (editTimeMs / 16) % 2 === 1;
      edited.document.update('f0', { background: isDark ? LIGHT : DARK });
      edited.renderer.enqueue(edited.document.takeChanges());
      edited.renderer.renderFrame({ timeMs: editTimeMs, camera: CAMERA });
      edited.backend.resetCalls();
    });

    const themed = loaded(fallback);
    let isThemeDark = false;
    let themeTimeMs = 0;
    bench(`switch the theme, ${label}`, () => {
      isThemeDark = !isThemeDark;
      themeTimeMs += 16;
      themed.renderer.setTheme(isThemeDark ? 'dark' : 'light');
      themed.renderer.renderFrame({ timeMs: themeTimeMs, camera: CAMERA });
      themed.backend.resetCalls();
    });

    const tokened = loaded(fallback);
    let tokenTimeMs = 0;
    bench(`edit the frames' fill token, ${label}`, () => {
      tokenTimeMs += 16;
      const isDark = (tokenTimeMs / 16) % 2 === 1;
      const value = isDark ? DARK : LIGHT;
      tokened.renderer.setColorTokens(new Map([['surface', { light: value, dark: value }]]));
      tokened.renderer.renderFrame({ timeMs: tokenTimeMs, camera: CAMERA });
      tokened.backend.resetCalls();
    });
  });
}
