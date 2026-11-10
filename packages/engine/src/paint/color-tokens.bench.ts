import { bench, describe } from 'vitest';

import type { Rgba } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject, zKeyAt } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

import type { ColorTokenValues } from './color-palette.js';

// CPU cost of colour tokens (resolving on the CPU costs nothing per
// frame; the coverage owed: a theme switch and a token edit on 50k objects where most colours are
// tokens), through a fake backend. Of the 50k shapes, 45k name tokens: a third fill with `surface`
// and outline with `border`, a third fill with a custom token, a third outline with `accent`;
// every tenth is a fixed colour. A third of the token shapes sit in a frame set dark, which a
// theme switch leaves alone. The GPU side is the color-tokens golden scenes'.

const COUNT = 50_000;
const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1600,
  viewportHeightPx: 1000,
  dpr: 2,
};

const table = (light: Rgba, dark: Rgba): ColorTokenValues =>
  new Map([
    ['brand', { light, dark }],
    ['accent', { light: [0.9, 0.5, 0.1, 1], dark: [0.5, 0.35, 0.85, 1] }],
  ]);

/**
 * A renderer over `COUNT` shapes, most of them naming tokens, rendered once so every buffer is
 * clean.
 *
 * @returns The backend and renderer.
 */
function loaded() {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [SDF_SHAPE_PASS],
    colorTokens: table([1, 0, 0, 1], [0, 0, 1, 1]),
  });
  const document = new FakeSceneDocument();
  document.create({
    ...shapeObject('dark-frame'),
    type: 'frame',
    name: 'Dark',
    clip: false,
    background: null,
    colorMode: 'dark',
    width: 100_000,
    height: 100_000,
  } as never);
  for (let index = 0; index < COUNT; index += 1) {
    const kind = index % 3;
    const isFixed = index % 10 === 0;
    document.create(
      shapeObject(`s${String(index)}`, {
        x: (index % 250) * 20,
        y: Math.floor(index / 250) * 20,
        z: zKeyAt(index),
        width: 16,
        height: 16,
        ...(index % 3 === 1 && !isFixed ? { parentId: 'dark-frame' } : {}),
        ...(isFixed
          ? { fill: [0.2, 0.4, 0.6, 1], stroke: null }
          : kind === 0
            ? {
                fill: { token: 'surface' } as never,
                stroke: { color: { token: 'border' } as never, width: 2 },
              }
            : kind === 1
              ? { fill: { token: 'brand' } as never, stroke: null }
              : { fill: null, stroke: { color: { token: 'accent' } as never, width: 2 } }),
      }),
    );
  }
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  backend.resetCalls();
  return { backend, renderer };
}

describe(`colour tokens, ${String(COUNT)} shapes, 45k naming tokens`, () => {
  const themed = loaded();
  let isDark = false;
  let themeTimeMs = 0;
  bench('switch the theme and upload the token records', () => {
    isDark = !isDark;
    themeTimeMs += 16;
    themed.renderer.setTheme(isDark ? 'dark' : 'light');
    themed.renderer.renderFrame({ timeMs: themeTimeMs, camera: CAMERA });
    themed.backend.resetCalls();
  });

  const edited = loaded();
  let editTimeMs = 0;
  bench('edit one token (15k records) and upload', () => {
    editTimeMs += 16;
    const red = (editTimeMs / 16) % 2;
    edited.renderer.setColorTokens(table([red, 0, 0, 1], [0, 0, 1 - red, 1]));
    edited.renderer.renderFrame({ timeMs: editTimeMs, camera: CAMERA });
    edited.backend.resetCalls();
  });

  const unrelated = loaded();
  let unrelatedTimeMs = 0;
  bench('edit a token nothing names (no record rewritten)', () => {
    unrelatedTimeMs += 16;
    const value = (unrelatedTimeMs / 16) % 2;
    unrelated.renderer.setColorTokens(
      new Map([
        ...table([1, 0, 0, 1], [0, 0, 1, 1]),
        ['unused', { light: [value, 0, 0, 1], dark: [0, value, 0, 1] }],
      ]),
    );
    unrelated.renderer.renderFrame({ timeMs: unrelatedTimeMs, camera: CAMERA });
    unrelated.backend.resetCalls();
  });
});
