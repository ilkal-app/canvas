// Drop shadows in z order, through a SceneRenderer with the frame shadow, solid-rect,
// SDF shape and text stand-in passes in the standard order and its default R-tree culler, whose
// index gives every object's box, the shadow taken in. A frame's shadow is drawn by the first
// pass, so it lands under the frame's own background; a shadowed object starts a segment where
// its shadow covers content of the segment below it that a later pass draws, so the shadow lands
// over that content; and content above a shadowed object lands over its shadow.
import { describe, expect, it } from 'vitest';

import type { BoardObject, Shadow } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { SDF_SHAPE_PASS } from '../../shapes/shape-pass.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, frameObject, shapeObject } from '../__fixtures__/scene-objects.js';
import { FRAME_SHADOW_PASS } from '../frame-shadow-pass.js';
import { SceneRenderer } from '../scene-renderer.js';
import { SOLID_RECT_PASS } from '../solid-rect-pass.js';

import { TEXT_PASS, textObject } from './__fixtures__/note-and-text-passes.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/** A shadow dropped 60 world units right and down, so it reaches past its box on its own. */
const DROPPED: Shadow = { x: 60, y: 60, blur: 4, spread: 0, color: [0, 0, 0, 0.5] };

const PASS_NAMES = ['frame-shadow', 'solid-rect', 'sdf-shape', 'text'] as const;

/**
 * Renders one frame and names the pass of each run of draws, in order, by its pipeline.
 *
 * @param objects - The board.
 * @returns One pass name per run of draws.
 */
function drawnPasses(...objects: BoardObject[]): string[] {
  const document = new FakeSceneDocument();
  document.create(...objects);
  const backend = new FakeGpuBackend();
  const passes = [FRAME_SHADOW_PASS, SOLID_RECT_PASS, SDF_SHAPE_PASS, TEXT_PASS];
  const renderer = new SceneRenderer(backend, { passes });
  renderer.enqueue(document.takeChanges());
  backend.resetCalls();
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  const drawn: string[] = [];
  let pipeline = '';
  for (const call of backend.calls) {
    if (call.method === 'setPipeline') pipeline = call.label;
    if (call.method !== 'draw') continue;
    const pass = PASS_NAMES.find((name) => pipeline === name) ?? pipeline;
    if (drawn.at(-1) !== pass) drawn.push(pass);
  }
  renderer.destroy();
  return drawn;
}

/**
 * A 100 × 100 frame at (x, 0) with the dropped shadow.
 *
 * @param id - Its id.
 * @param z - Its z key.
 * @param x - Its left edge.
 * @returns The frame.
 */
function shadowedFrame(id: string, z: string, x = 0): BoardObject {
  return frameObject(id, { z, x, y: 0, shadow: DROPPED });
}

/**
 * A 100 × 100 filled square at (x, 0) with the dropped shadow.
 *
 * @param id - Its id.
 * @param z - Its z key.
 * @param x - Its left edge.
 * @returns The shape.
 */
function shadowedShape(id: string, z: string, x = 0): BoardObject {
  return shapeObject(id, { z, x, y: 0, width: 100, height: 100, shadow: DROPPED });
}

/**
 * A text whose box lies only under the dropped shadow of an object at the origin.
 *
 * @param z - Its z key.
 * @returns The text.
 */
function textUnderShadow(z: string): BoardObject {
  return textObject('label', { z, x: 120, y: 120 });
}

describe('a frame’s drop shadow in z order', () => {
  it('draws under the frame’s own background', () => {
    expect(drawnPasses(shadowedFrame('f', 'a0'))).toEqual(['frame-shadow', 'solid-rect']);
  });

  it('draws nothing for a frame without a visible background, and no pass for none', () => {
    expect(drawnPasses(frameObject('f', { background: null, shadow: DROPPED }))).toEqual([]);
    expect(drawnPasses(frameObject('f', { shadow: null }))).toEqual(['solid-rect']);
  });

  it('draws over later-pass content below it that only its shadow covers', () => {
    expect(drawnPasses(textUnderShadow('a0'), shadowedFrame('f', 'a1'))).toEqual([
      'text',
      'frame-shadow',
      'solid-rect',
    ]);
  });

  it('shares the segment of content its shadow does not reach', () => {
    expect(drawnPasses(textUnderShadow('a0'), shadowedFrame('f', 'a1', 400))).toEqual([
      'frame-shadow',
      'solid-rect',
      'text',
    ]);
  });

  it('lands under its children and under objects above it', () => {
    const child = shapeObject('child', { parentId: 'f', z: 'a0', x: 10, y: 10 });
    expect(drawnPasses(shadowedFrame('f', 'a0'), child)).toEqual([
      'frame-shadow',
      'solid-rect',
      'sdf-shape',
    ]);
    expect(drawnPasses(shadowedFrame('f', 'a0'), textUnderShadow('a1'))).toEqual([
      'frame-shadow',
      'solid-rect',
      'text',
    ]);
  });

  it('draws over an overlapping shadowed frame below it, each over the one before', () => {
    expect(drawnPasses(shadowedFrame('f1', 'a0'), shadowedFrame('f2', 'a1', 50))).toEqual([
      'frame-shadow',
      'solid-rect',
      'frame-shadow',
      'solid-rect',
    ]);
  });
});

describe('a shape’s drop shadow in z order', () => {
  it('draws over a frame below it, in the shape pass', () => {
    expect(drawnPasses(frameObject('f', { z: 'a0' }), shadowedShape('s', 'a1'))).toEqual([
      'solid-rect',
      'sdf-shape',
    ]);
  });

  it('draws over later-pass content below it that only its shadow covers', () => {
    expect(drawnPasses(textUnderShadow('a0'), shadowedShape('s', 'a1'))).toEqual([
      'text',
      'sdf-shape',
    ]);
    // Without the shadow, the shape's box meets nothing below it: one segment.
    const plain = shapeObject('s', { z: 'a1', x: 0, y: 0, width: 100, height: 100 });
    expect(drawnPasses(textUnderShadow('a0'), plain)).toEqual(['sdf-shape', 'text']);
  });

  it('draws under content above it', () => {
    expect(drawnPasses(shadowedShape('s', 'a0'), textUnderShadow('a1'))).toEqual([
      'sdf-shape',
      'text',
    ]);
  });
});
