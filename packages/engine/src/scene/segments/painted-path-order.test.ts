// Paths that paint must respect later-pass content below them.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { imageObject } from '../../images/__fixtures__/image-objects.js';
import { IMAGE_PASS } from '../../images/image-pass.js';
import { zigzagPath } from '../../paths/__fixtures__/path-scene.js';
import { INLINE_MESH_BUILDER } from '../../paths/path-mesh-builder.js';
import { createPathPass } from '../../paths/path-pass.js';
import { SDF_SHAPE_PASS } from '../../shapes/shape-pass.js';
import { lineObject } from '../../spatial/__fixtures__/spatial-objects.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene-renderer.js';

import { TEXT_PASS, textObject } from './__fixtures__/note-and-text-passes.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/**
 * Renders one frame and names the pass of each run of draws, in order, by its pipeline.
 *
 * @param objects - The board.
 * @returns One pass name per run of draws: `sdf-shape`, `image`, `path` or `text`.
 */
function drawnPasses(...objects: BoardObject[]): string[] {
  const document = new FakeSceneDocument();
  document.create(...objects);
  const backend = new FakeGpuBackend();
  const passes = [
    SDF_SHAPE_PASS,
    IMAGE_PASS,
    createPathPass({ meshBuilder: INLINE_MESH_BUILDER }),
    TEXT_PASS,
  ];
  const renderer = new SceneRenderer(backend, { passes });
  renderer.enqueue(document.takeChanges());
  backend.resetCalls();
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  const drawn: string[] = [];
  let pipeline = '';
  for (const call of backend.calls) {
    if (call.method === 'setPipeline') pipeline = call.label;
    if (call.method !== 'draw') continue;
    const pass = ['image', 'path', 'text'].find((name) => pipeline.includes(name)) ?? 'sdf-shape';
    // A pass may draw in several calls (a path's stencil and cover): one name per run.
    if (drawn.at(-1) !== pass) drawn.push(pass);
  }
  renderer.destroy();
  return drawn;
}

const PATHS = {
  line: (z: string, x = 0, alpha = 1) =>
    lineObject('line', {
      z,
      x,
      y: 50,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      stroke: { color: [1, 0, 0, alpha], width: 8 },
    }),
  pen: (z: string, x = 0, alpha = 1) =>
    zigzagPath('pen', 0, {
      z,
      x,
      y: 30,
      stroke: { color: [1, 0, 0, alpha], width: 8 },
    }),
};
const CONTENT = {
  text: (z: string) => textObject('text', { z }),
  image: (z: string) => imageObject({ id: 'image' as ObjectId, z, width: 100, height: 100 }),
};

describe.each(Object.entries(PATHS))('%s paint order', (name, path) => {
  it.each([1, 0.5])('draws a stroke with alpha %s over lower text', (alpha) => {
    expect(drawnPasses(CONTENT.text('a0'), path('a1', 0, alpha))).toEqual(['text', 'path']);
  });
  it.each(Object.entries(CONTENT))('draws under higher %s', (name, content) => {
    expect(drawnPasses(path('a0'), content('a1'))).toEqual(['path', name]);
  });
  it('draws over a lower image', () => {
    expect(drawnPasses(CONTENT.image('a0'), path('a1'))).toEqual(['image', 'path']);
  });
  it('keeps separated text and strokes in one segment', () => {
    expect(drawnPasses(CONTENT.text('a0'), path('a1', 400))).toEqual(['path', 'text']);
  });
  it(`preserves alternating text and ${name} strokes`, () => {
    expect(
      drawnPasses(CONTENT.text('a0'), path('a1'), textObject('second-text', { z: 'a2' }), {
        ...path('a3'),
        id: 'second-path' as ObjectId,
      }),
    ).toEqual(['text', 'path', 'text', 'path']);
  });
});
