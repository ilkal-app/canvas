import { expect, it } from 'vitest';

import { IMAGE_PASS } from '../images/image-pass.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { CAMERA, createTextSetUp } from '../text/scene/__fixtures__/text-objects.js';
import { FRAME_TITLE_PASS } from '../text/scene/frame-title-pass.js';
import { TEXT_PASS } from '../text/scene/text-pass.js';

import { FRAME_SHADOW_PASS } from './frame-shadow-pass.js';
import { FRAME_STROKE_PASS } from './frame-stroke-pass.js';
import { RECT_GRADIENT_PASS } from './rect-gradient-pass.js';
import { RECT_IMAGE_PASS } from './rect-image-pass.js';
import { ROUNDED_RECT_PASS } from './rounded-rect-pass.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

it('gives every subtree drawing pass an absolute-placement shader', () => {
  const setup = createTextSetUp(CAMERA, false, false, {
    passes: [
      SOLID_RECT_PASS,
      ROUNDED_RECT_PASS,
      FRAME_STROKE_PASS,
      FRAME_SHADOW_PASS,
      RECT_GRADIENT_PASS,
      RECT_IMAGE_PASS,
      SDF_SHAPE_PASS,
      IMAGE_PASS,
      TEXT_PASS,
      FRAME_TITLE_PASS,
    ],
  });
  for (const pass of setup.renderer.scene.passes) {
    expect(pass.pipelineSpec.moveShader, pass.name).toBeDefined();
  }
  setup.renderer.destroy();
});
