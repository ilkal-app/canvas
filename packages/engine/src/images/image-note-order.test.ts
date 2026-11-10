// Images with sticky notes and lines in z order (with and), through a
// SceneRenderer with the real SDF shape, image and path passes, in the standard order, and its
// default R-tree culler, whose index gives every object's box. Within a segment passes draw in
// order (notes, then images, then lines), so an occluder later in paint order than content of a
// later pass starts a segment of its own where it covers it: a note over an image, and an opaque
// image over a line. The rest draws in its segment in pass order.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { INLINE_MESH_BUILDER } from '../paths/path-mesh-builder.js';
import { createPathPass } from '../paths/path-pass.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { stickyObject } from '../scene/segments/__fixtures__/note-and-text-passes.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { lineObject } from '../spatial/__fixtures__/spatial-objects.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { IMAGE_PASS } from './image-pass.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/**
 * An image at (20, 20), 100 × 75, opaque: an occluder.
 *
 * @param z - Its paint key.
 * @returns The image.
 */
function photo(z: string) {
  return imageObject({ id: 'photo' as ObjectId, z, x: 20, y: 20, width: 100, height: 75 });
}

/**
 * A line across the photo, from (0, 50) to (150, 50).
 *
 * @param z - Its paint key.
 * @returns The line.
 */
function crossing(z: string) {
  return lineObject('line', {
    z,
    points: [
      { x: 0, y: 50 },
      { x: 150, y: 50 },
    ],
  });
}

/**
 * Renders one frame and names the pass of each draw, in order, by its pipeline.
 *
 * @param document - The board.
 * @returns One pass name per run of draws: `note`, `image` or `line`.
 */
function drawnPasses(document: FakeSceneDocument): string[] {
  const backend = new FakeGpuBackend();
  const passes = [SDF_SHAPE_PASS, IMAGE_PASS, createPathPass({ meshBuilder: INLINE_MESH_BUILDER })];
  const renderer = new SceneRenderer(backend, { passes });
  renderer.enqueue(document.takeChanges());
  backend.resetCalls();
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  const drawn: string[] = [];
  let pipeline = '';
  for (const call of backend.calls) {
    if (call.method === 'setPipeline') pipeline = call.label;
    if (call.method !== 'draw') continue;
    const pass = pipeline.includes('image') ? 'image' : pipeline.includes('path') ? 'line' : 'note';
    // A pass may draw in several calls (a path's stencil and cover): one name per run.
    if (drawn.at(-1) !== pass) drawn.push(pass);
  }
  renderer.destroy();
  return drawn;
}

describe('images and sticky notes in z order', () => {
  it('hides an image under a sticky note that covers it: the note draws after it', () => {
    const document = new FakeSceneDocument();
    document.create(photo('a0'), stickyObject('note', { z: 'a1', width: 200, height: 200 }));

    expect(drawnPasses(document)).toEqual(['image', 'note']);
  });

  it('draws an image over a sticky note it lies on, in the note segment', () => {
    const document = new FakeSceneDocument();
    document.create(stickyObject('note', { z: 'a0', width: 200, height: 200 }), photo('a1'));

    expect(drawnPasses(document)).toEqual(['note', 'image']);
  });

  it('keeps a note clear of every image in the images segment: one draw per pass', () => {
    const document = new FakeSceneDocument();
    document.create(
      photo('a0'),
      stickyObject('beside', { z: 'a1', x: 400, y: 0, width: 200, height: 200 }),
      imageObject({ id: 'later' as ObjectId, z: 'a2', x: 20, y: 300, width: 100, height: 75 }),
    );

    // The note covers no image drawn before it, so it shares their segment: notes, then images.
    expect(drawnPasses(document)).toEqual(['note', 'image']);
  });
});

describe('images and lines in z order', () => {
  it('draws a line over an image under it, in the image segment', () => {
    const document = new FakeSceneDocument();
    document.create(photo('a0'), crossing('a1'));

    expect(drawnPasses(document)).toEqual(['image', 'line']);
  });

  it('draws an opaque image over a line it covers: the image starts a segment', () => {
    const document = new FakeSceneDocument();
    document.create(crossing('a0'), photo('a1'));

    expect(drawnPasses(document)).toEqual(['line', 'image']);
  });

  it('keeps a line clear of the image in one segment, drawn in pass order', () => {
    const document = new FakeSceneDocument();
    document.create(
      crossing('a0'),
      imageObject({ id: 'far' as ObjectId, z: 'a1', x: 400, y: 300, width: 100, height: 75 }),
    );

    // The image covers no line: it shares the line's segment, and images draw before lines.
    expect(drawnPasses(document)).toEqual(['image', 'line']);
  });
});
