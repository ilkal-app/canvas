import { IMAGE_PASS } from '../images/image-pass.js';
import { createPooledMeshBuilder, type MeshJobSubmitter } from '../paths/path-mesh-builder.js';
import {
  CONNECTOR_MESH_BYTE_BUDGET,
  createGradientPathPass,
  createPathPass,
} from '../paths/path-pass.js';
import { LINK_ICON_PASS, LINK_PREVIEW_PASS } from '../shapes/link-card-image-pass.js';
import { SDF_SHAPE_GRADIENT_PASS } from '../shapes/shape-gradient-pass.js';
import { SDF_SHAPE_IMAGE_PASS } from '../shapes/shape-image-pass.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { FRAME_TITLE_PASS } from '../text/scene/frame-title-pass.js';
import { LINK_CARD_BODY_PASS, LINK_CARD_FOOTER_PASS } from '../text/scene/link-card-text-pass.js';
import { STICKY_AUTHOR_PASS } from '../text/scene/sticky-author-pass.js';
import { TEXT_PASS } from '../text/scene/text-pass.js';
import { TEXT_VECTOR_PASS } from '../text/scene/text-vector-pass.js';

import { FRAME_SHADOW_PASS } from './frame-shadow-pass.js';
import { FRAME_STROKE_PASS } from './frame-stroke-pass.js';
import { IMAGE_BORDER_PASS } from './image-border-pass.js';
import { createLayerCompositePass } from './layers/layer-composite-pass.js';
import { RECT_GRADIENT_PASS } from './rect-gradient-pass.js';
import { RECT_IMAGE_PASS } from './rect-image-pass.js';
import { ROUNDED_RECT_GRADIENT_PASS, ROUNDED_RECT_PASS } from './rounded-rect-pass.js';
import type { ScenePassEntry } from './scene-pass.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

/** What the standard passes need from the renderer's thread. */
export interface StandardScenePassesOptions {
  /** The job pool path meshes are built through (a `WorkerPool`). */
  readonly jobs: MeshJobSubmitter;
  /** Receives mesh builds that failed or timed out (each then made inline once). */
  readonly onFault?: (error: Error) => void;
  /**
   * The path mesh cache's cap, bytes: the `meshes` share of the device's budget
   * (`budgetForDevice`). Default the path pass's `DEFAULT_MESH_BYTE_BUDGET`.
   */
  readonly meshByteBudget?: number;
  /**
   * The offscreen layers' cap, bytes: the `layers` share of the device's budget
   * (`budgetForDevice`). Default the desktop's share, `DEFAULT_LAYER_BYTE_BUDGET`.
   */
  readonly layerByteBudget?: number;
}

/**
 * The passes every engine host (worker and main-thread) draws the board with, in registered
 * order (within a z-order segment, earlier passes draw first): frames' drop shadows (`FRAME_SHADOW_PASS`: first, so a frame's shadow lands
 * under its own background), frame backgrounds, frames' outlines (`FRAME_STROKE_PASS`:
 * drawn after the frame's descendants, at a closing paint rank, so over its whole subtree as in
 * Figma), then SDF shapes (sticky notes with their shadows, and every shape
 * object), then images, a factory built per renderer around its texture manager, then
 * paths, whose meshes are `mesh` jobs on the given pool at `visible` priority, then text,
 * laid out and rasterised with the fonts and job pool of the renderer's environment
 * (`ScenePassEnvironment.text`). Passes cannot cross to a worker, so each host builds its own on
 * its rendering thread; each rendering task adds its pass at its place in the final order:
 * `FRAME_SHADOW_PASS`, `SOLID_RECT_PASS`, `RECT_GRADIENT_PASS`, `RECT_IMAGE_PASS`,
 * `ROUNDED_RECT_PASS`, `ROUNDED_RECT_GRADIENT_PASS` (the solid and gradient backgrounds
 * of frames with a rounded corner, as SDF rounded boxes), `FRAME_STROKE_PASS`,
 * `LAYER_COMPOSITE_PASS` (each translucent group, frame, instance or multi-part
 * leaf composited once from its offscreen layer), `SDF_SHAPE_PASS`, `SDF_SHAPE_GRADIENT_PASS`, `SDF_SHAPE_IMAGE_PASS`,
 * `LINK_PREVIEW_PASS` and `LINK_ICON_PASS` (a link card's preview and site icon),
 * `IMAGE_PASS`, `IMAGE_BORDER_PASS` (an image's border, one stroke-only SDF record over
 * it), `PATH_PASS`, the gradient path pass (`createGradientPathPass`), the connector pass
 * (a path pass drawing connectors, with their own level of detail and a small mesh
 * budget, `CONNECTOR_MESH_BYTE_BUDGET`), `TEXT_PASS`, `TEXT_VECTOR_PASS` (text runs above 512 device px per em, from their outlines, when the text resources ask for vector glyphs), `STICKY_AUTHOR_PASS` (a sticky's author
 * label, the scene text's pipeline with its own instances), `LINK_CARD_BODY_PASS` and
 * `LINK_CARD_FOOTER_PASS` (a link card's title and description, and its domain),
 * `FRAME_TITLE_PASS` (frame names at
 * a constant size on screen, the text machinery with its own shader). Each gradient variant
 * follows its solid pass; the z-order segments order the two by z, and a board
 * without a gradient gives the variants no record; so does each image variant, which
 * draws from the image pass's texture manager. A pass with state or GPU resources of its own
 * is listed as a factory (`ScenePassFactory`), built per renderer.
 *
 * @param options - The job pool and where mesh faults go.
 * @returns The passes and pass factories, in draw order.
 */
export function createStandardScenePasses(options: StandardScenePassesOptions): ScenePassEntry[] {
  const meshes = {
    meshBuilder: createPooledMeshBuilder(options.jobs),
    // Runs of opaque strokes draw batched; the gradient variant never batches.
    isBatched: true,
    ...(options.onFault ? { onFault: options.onFault } : {}),
  };
  const pathMeshes = {
    ...meshes,
    ...(options.meshByteBudget === undefined ? {} : { meshByteBudget: options.meshByteBudget }),
  };
  return [
    FRAME_SHADOW_PASS,
    SOLID_RECT_PASS,
    RECT_GRADIENT_PASS,
    RECT_IMAGE_PASS,
    ROUNDED_RECT_PASS,
    ROUNDED_RECT_GRADIENT_PASS,
    FRAME_STROKE_PASS,
    createLayerCompositePass(
      options.layerByteBudget === undefined ? {} : { byteBudget: options.layerByteBudget },
    ),
    SDF_SHAPE_PASS,
    SDF_SHAPE_GRADIENT_PASS,
    SDF_SHAPE_IMAGE_PASS,
    LINK_PREVIEW_PASS,
    LINK_ICON_PASS,
    IMAGE_PASS,
    IMAGE_BORDER_PASS,
    createPathPass(pathMeshes),
    createGradientPathPass(pathMeshes),
    createPathPass({ ...meshes, draws: 'connectors', meshByteBudget: CONNECTOR_MESH_BYTE_BUDGET }),
    TEXT_PASS,
    TEXT_VECTOR_PASS,
    STICKY_AUTHOR_PASS,
    LINK_CARD_BODY_PASS,
    LINK_CARD_FOOTER_PASS,
    FRAME_TITLE_PASS,
  ];
}
