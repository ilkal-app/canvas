import { LINK_ICON_PASS, LINK_PREVIEW_PASS } from '../shapes/link-card-image-pass.js';
import { SDF_SHAPE_GRADIENT_PASS } from '../shapes/shape-gradient-pass.js';
import { SDF_SHAPE_IMAGE_PASS } from '../shapes/shape-image-pass.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

import { RECT_GRADIENT_PASS } from './rect-gradient-pass.js';
import { RECT_IMAGE_PASS } from './rect-image-pass.js';
import { ROUNDED_RECT_GRADIENT_PASS, ROUNDED_RECT_PASS } from './rounded-rect-pass.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

/**
 * The passes a `SceneRenderer` draws with when given none: frame backgrounds and shapes, each with
 * its gradient variant and its image variant, and rounded frames'
 * solid and gradient backgrounds after the flat ones, and a link card's preview and
 * icon.
 */
export const DEFAULT_SCENE_PASSES = [
  SOLID_RECT_PASS,
  RECT_GRADIENT_PASS,
  RECT_IMAGE_PASS,
  ROUNDED_RECT_PASS,
  ROUNDED_RECT_GRADIENT_PASS,
  SDF_SHAPE_PASS,
  SDF_SHAPE_GRADIENT_PASS,
  SDF_SHAPE_IMAGE_PASS,
  LINK_PREVIEW_PASS,
  LINK_ICON_PASS,
] as const;
