// A board without a gradient pays nothing for the gradient variants.
import { describe, expect, it, vi } from 'vitest';

import { PATH_CAMERA, squarePath } from '../paths/__fixtures__/path-scene.js';
import { INLINE_MESH_BUILDER } from '../paths/path-mesh-builder.js';
import { createGradientPathPass, createPathPass } from '../paths/path-pass.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import { RECT_GRADIENT_PASS } from '../scene/rect-gradient-pass.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';
import { SDF_SHAPE_GRADIENT_PASS } from '../shapes/shape-gradient-pass.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

/**
 * A renderer with the solid passes and their gradient variants over a document.
 *
 * @returns The renderer, its backend, the document and the gradient path pass's frame reports.
 */
function renderer() {
  const backend = new FakeGpuBackend();
  const onGradientFrame = vi.fn();
  const scene = new SceneRenderer(backend, {
    passes: [
      SOLID_RECT_PASS,
      RECT_GRADIENT_PASS,
      SDF_SHAPE_PASS,
      SDF_SHAPE_GRADIENT_PASS,
      createPathPass({ meshBuilder: INLINE_MESH_BUILDER }),
      createGradientPathPass({ meshBuilder: INLINE_MESH_BUILDER, onFrame: onGradientFrame }),
    ],
  });
  return { backend, scene, document: new FakeSceneDocument(), onGradientFrame };
}

describe('a board with no gradient', () => {
  it('gives the gradient passes no record, creates no paint table and prepares no gradient path', () => {
    const { backend, scene, document, onGradientFrame } = renderer();
    document.create(shapeObject('solid', { fill: [1, 0, 0, 1] }));
    document.create(frameObject('frame', { background: [0, 0, 1, 1] }));
    document.create(squarePath('path', 0));
    scene.enqueue(document.takeChanges());
    for (let frame = 0; frame < 3; frame += 1) {
      scene.renderFrame({ timeMs: frame * 16, camera: { ...PATH_CAMERA, zoom: 1 + frame } });
    }
    for (const pass of ['sdf-shape-gradient', 'rect-gradient', 'path-gradient']) {
      expect(scene.scene.instanceBuffers.get(pass)?.liveCount ?? 0, pass).toBe(0);
    }
    expect(backend.textures.some(({ label }) => label === 'paint-table')).toBe(false);
    expect(onGradientFrame).not.toHaveBeenCalled();
    scene.destroy();
  });

  it('prepares the gradient path pass once a gradient path is on the board', () => {
    const { scene, document, onGradientFrame } = renderer();
    const path = squarePath('path', 0);
    document.create({
      ...path,
      fill: {
        type: 'linear',
        angle: 0,
        stops: [
          { offset: 0, color: [1, 0, 0, 1] },
          { offset: 1, color: [0, 0, 1, 1] },
        ],
      },
    });
    scene.enqueue(document.takeChanges());
    scene.renderFrame({ timeMs: 0, camera: PATH_CAMERA });
    expect(scene.scene.instanceBuffers.get('path-gradient')?.liveCount).toBeGreaterThan(0);
    expect(onGradientFrame).toHaveBeenCalled();
    scene.destroy();
  });
});
