import { expect, it } from 'vitest';

import { imageObject } from '../images/__fixtures__/image-objects.js';
import { IMAGE_PASS } from '../images/image-pass.js';
import { squarePath } from '../paths/__fixtures__/path-scene.js';
import { INLINE_MESH_BUILDER } from '../paths/path-mesh-builder.js';
import { createPathPass } from '../paths/path-pass.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { CAMERA, createTextSetUp, textObject } from '../text/scene/__fixtures__/text-objects.js';
import { TEXT_PASS } from '../text/scene/text-pass.js';

import { frameObject, shapeObject } from './__fixtures__/scene-objects.js';
import { stickyObject } from './segments/__fixtures__/note-and-text-passes.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

it('built-in pass order inputs are invariant under exact root-position replacement', () => {
  const setup = createTextSetUp(CAMERA, false, false, {
    passes: [
      SOLID_RECT_PASS,
      SDF_SHAPE_PASS,
      TEXT_PASS,
      IMAGE_PASS,
      createPathPass({ meshBuilder: INLINE_MESH_BUILDER }),
    ],
  });
  const objects = [
    frameObject('frame'),
    shapeObject('shape'),
    shapeObject('empty', { fill: null, stroke: null }),
    stickyObject('note'),
    textObject('text', 'A😀 B'),
    imageObject(),
    imageObject({ opacity: 0 }),
    squarePath('path', 0),
  ];
  for (const pass of setup.renderer.scene.passes) {
    expect(pass.isRootMoveOrderStable).toBe(true);
    for (const object of objects) {
      const count = pass.recordCount(object);
      const isOccluding = pass.isOccluder?.(object);
      for (const x of [-0, 0.1, -1e12, 1e12]) {
        const moved = { ...object, x, y: -x };
        expect(pass.recordCount(moved)).toBe(count);
        expect(pass.isOccluder?.(moved)).toBe(isOccluding);
      }
    }
  }
  setup.renderer.destroy();
});
