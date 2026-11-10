// Outline-only and half-transparent shapes in z order with images, lines and text (fix
// round 1), through a SceneRenderer with the real SDF shape, image and path passes and the text
// stand-in, in the standard order, and its default R-tree culler, whose index gives every
// object's box. A shape paints whatever its alpha, so one above content a later pass draws must
// start a segment where it covers that content, or it would draw under it (an annotation
// outline hidden by the screenshot it marks, a highlight under the text it marks).
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId, Rgba } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { imageObject } from '../../images/__fixtures__/image-objects.js';
import { IMAGE_PASS } from '../../images/image-pass.js';
import { INLINE_MESH_BUILDER } from '../../paths/path-mesh-builder.js';
import { createPathPass } from '../../paths/path-pass.js';
import { SDF_SHAPE_PASS } from '../../shapes/shape-pass.js';
import { lineObject } from '../../spatial/__fixtures__/spatial-objects.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene-renderer.js';

import { TEXT_PASS, textObject } from './__fixtures__/note-and-text-passes.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const RED: Rgba = [1, 0, 0, 1];
const HALF_YELLOW: Rgba = [1, 0.9, 0, 0.5];

/** The two shapes that do not hide what is under them, but still paint over it. */
const SHAPES = {
  'an outline-only shape': { fill: null, stroke: { color: RED, width: 4 } },
  'a half-transparent shape': { fill: HALF_YELLOW, stroke: null },
} as const;

/** Content drawn by a later pass than the shape pass, each under the 200 × 200 shape's box. */
const CONTENT = {
  image: {
    pass: 'image',
    make: (z) => imageObject({ id: 'photo' as ObjectId, z, x: 20, y: 20, width: 100, height: 75 }),
  },
  line: {
    pass: 'path',
    make: (z) =>
      lineObject('line', {
        z,
        points: [
          { x: 0, y: 50 },
          { x: 150, y: 50 },
        ],
      }),
  },
  text: { pass: 'text', make: (z) => textObject('label', { z, x: 20, y: 20 }) },
} satisfies Readonly<Record<string, { pass: string; make: (z: string) => BoardObject }>>;

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

describe.each(Object.entries(SHAPES))('%s in z order', (name, fields) => {
  const shape = (z: string, x = 0) =>
    shapeObject(name, { ...fields, z, x, y: 0, width: 200, height: 200 });

  it.each(Object.values(CONTENT))('draws over the $pass content below it', (content) => {
    expect(drawnPasses(content.make('a0'), shape('a1'))).toEqual([content.pass, 'sdf-shape']);
  });

  it.each(Object.values(CONTENT))('draws under the $pass content above it', (content) => {
    expect(drawnPasses(shape('a0'), content.make('a1'))).toEqual(['sdf-shape', content.pass]);
  });

  it('shares the segment of content its box does not meet: one draw per pass', () => {
    // Beside the text, the shape covers nothing a later pass drew before it.
    expect(drawnPasses(CONTENT.text.make('a0'), shape('a1', 400))).toEqual(['sdf-shape', 'text']);
  });
});

describe('a half-transparent image in z order', () => {
  it('draws over the text below it', () => {
    const faded = imageObject({ id: 'photo' as ObjectId, z: 'a1', width: 200, height: 200 });
    const image = { ...faded, opacity: 0.5 };
    expect(drawnPasses(textObject('label', { z: 'a0', x: 20, y: 20 }), image)).toEqual([
      'text',
      'image',
    ]);
  });
});
