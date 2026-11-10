import {
  isPaintVisible,
  paintAverageColor,
  type BoardObject,
  type Gradient,
  type Rgba,
} from '@canvas/schema';

import { SDF_SHAPE_GRADIENT_MOVE_SHADER } from '../gpu/shaders/sdf-shape-gradient-move.generated.js';
import { SDF_SHAPE_GRADIENT_SHADER } from '../gpu/shaders/sdf-shape-gradient.generated.js';
import { SDF_SHAPE_MOVE_SHADER } from '../gpu/shaders/sdf-shape-move.generated.js';
import { SDF_SHAPE_SHADER } from '../gpu/shaders/sdf-shape.generated.js';
import { paletteOf, type ColorPalette } from '../paint/color-palette.js';
import { GRADIENT_LEVEL_OF_DETAIL } from '../paint/gradient-detail.js';
import {
  GradientRecords,
  markPaintTablePass,
  PAINT_TABLE_BINDINGS,
} from '../paint/gradient-records.js';
import { readFill, readGradient } from '../paint/paint-reading.js';
import { SHAPE_QUAD_CORNER_VERTEX_LAYOUT } from '../shapes/shape-instance-layout.js';
import { SHAPE_QUAD_CORNERS, SHAPE_QUAD_VERTEX_COUNT } from '../shapes/shape-pipeline.js';

import {
  FRAME_SHAPE_ATTRIBUTES,
  FRAME_SHAPE_FLOATS,
  FRAME_SHAPE_INSTANCE_LAYOUT,
  isRoundedFrame,
  writeFrameBackgroundRecord,
} from './frame-shape-record.js';
import { resolveSceneInstanceLayout } from './instance-layout.js';
import type {
  ScenePass,
  SceneObject,
  ScenePassEnvironment,
  ScenePassFactory,
} from './scene-pass.js';

// The backgrounds of frames with a rounded corner: solid and gradient, each an SDF
// rounded box of the shape shaders. A sharp frame's stay the flat-quad passes'.

/** The rounded frame background pass's name. */
export const ROUNDED_RECT_PASS_NAME = 'rounded-rect';

/**
 * The colour a rounded frame's solid background draws with, or null when this pass does not draw
 * the object: a frame with a rounded corner (`isRoundedFrame`) whose background is a colour (a
 * colour token's value in the palette). A gradient is the rounded-rect gradient pass's,
 * an image the rect-image pass's.
 *
 * @param object - The object.
 * @param palette - What tokens draw as; default the light theme's built-ins.
 * @returns The straight-alpha colour, or null.
 */
function roundedColorOf(object: BoardObject, palette?: ColorPalette): Rgba | null {
  if (object.type !== 'frame' || !isRoundedFrame(object)) return null;
  const paint = readFill(object.background, palette);
  return Array.isArray(paint) ? paint : null;
}

/**
 * The rounded frame background pass: the solid background of a frame with a rounded
 * corner, one SDF rounded-box record (`writeFrameBackgroundRecord`, the frame SDF record with its
 * four capped corner radii) drawn by the shape shader (`sdf-shape.wgsl`), antialiased as a
 * shape's edge is. A sharp frame's background stays the solid-rect pass's flat quad, exactly as
 * before. Registered right after the frame-background passes, it is an occluder as they are; a
 * board without a rounded frame gives it no record, and its pipeline waits for its first record
 * (`isDeferred`), so it costs nothing at engine start. Stateless.
 */
export const ROUNDED_RECT_PASS: ScenePass = {
  isRootMoveOrderStable: true,
  isRootMoveEmpty: true,
  name: ROUNDED_RECT_PASS_NAME,
  layout: FRAME_SHAPE_INSTANCE_LAYOUT,
  pipelineSpec: {
    shader: SDF_SHAPE_SHADER,
    moveShader: SDF_SHAPE_MOVE_SHADER,
    vertexLayout: SHAPE_QUAD_CORNER_VERTEX_LAYOUT,
    vertices: new Float32Array(SHAPE_QUAD_CORNERS),
    vertexCount: SHAPE_QUAD_VERTEX_COUNT,
    blend: 'premultiplied',
    isDeferred: true,
  },
  recordCount(object: BoardObject): number {
    return roundedColorOf(object) === null ? 0 : 1;
  },
  // A frame background hides what is below it, as the solid-rect pass flags one.
  isOccluder(object: BoardObject): boolean {
    return roundedColorOf(object) !== null;
  },
  prepare(record: Float32Array, target: SceneObject): void {
    const { object, transform } = target;
    const color = roundedColorOf(object, paletteOf(target));
    if (object.type !== 'frame' || color === null) return;
    writeFrameBackgroundRecord(record, object, transform, color);
  },
};

/** The rounded frame gradient background pass's name. */
export const ROUNDED_RECT_GRADIENT_PASS_NAME = 'rounded-rect-gradient';

/** No colour: a gradient record's fill, read only at paint record 0. */
const CLEAR: Rgba = [0, 0, 0, 0];

/**
 * The rounded frame gradient record: the frame SDF record (box and corner radii,
 * `FRAME_SHAPE_ATTRIBUTES`), then the paint table record its fill reads (`@location(8)`; 0 draws
 * floats 4–7, the average colour), then the clip index the scene writes.
 */
const ROUNDED_RECT_GRADIENT_LAYOUT = resolveSceneInstanceLayout([
  ...FRAME_SHAPE_ATTRIBUTES,
  { location: 8, format: 'float32' },
]);

/**
 * A rounded frame's gradient background, or undefined when the object is not a frame with a
 * rounded corner and a gradient the schema accepts.
 *
 * @param object - The object.
 * @returns The gradient, or undefined.
 */
function roundedGradientOf(object: BoardObject): Gradient | undefined {
  return object.type === 'frame' && isRoundedFrame(object)
    ? readGradient(object.background)
    : undefined;
}

/**
 * Builds the pass for one renderer.
 *
 * @param environment - The renderer's environment: its backend and level of detail.
 * @returns The pass.
 */
function createRoundedRectGradientPass(environment: ScenePassEnvironment): ScenePass {
  const records = new GradientRecords(
    ROUNDED_RECT_GRADIENT_PASS_NAME,
    environment,
    'average-color',
  );
  return markPaintTablePass({
    isRootMoveOrderStable: true,
    isRootMoveEmpty: true,
    name: ROUNDED_RECT_GRADIENT_PASS_NAME,
    layout: ROUNDED_RECT_GRADIENT_LAYOUT,
    pipelineSpec: {
      shader: SDF_SHAPE_GRADIENT_SHADER,
      moveShader: SDF_SHAPE_GRADIENT_MOVE_SHADER,
      vertexLayout: SHAPE_QUAD_CORNER_VERTEX_LAYOUT,
      vertices: new Float32Array(SHAPE_QUAD_CORNERS),
      vertexCount: SHAPE_QUAD_VERTEX_COUNT,
      blend: 'premultiplied',
      pageBindings: PAINT_TABLE_BINDINGS,
      isDeferred: true,
    },
    recordCount: (object) => (roundedGradientOf(object) === undefined ? 0 : 1),
    // As the rect-gradient pass flags a background: any stop's alpha above 0.
    isOccluder: (object) => isPaintVisible(roundedGradientOf(object) ?? null),
    levelOfDetail: GRADIENT_LEVEL_OF_DETAIL,
    prepare(record, target) {
      const { object, transform } = target;
      const gradient = roundedGradientOf(object);
      if (object.type !== 'frame' || gradient === undefined) return;
      const row = records.rowOf(target, gradient);
      writeFrameBackgroundRecord(
        record,
        object,
        transform,
        row === 0 ? paintAverageColor(gradient) : CLEAR,
      );
      record[FRAME_SHAPE_FLOATS] = row;
    },
    pageOf: () => 0,
    pageEntries: () => records.pageEntries(),
    install: (frame) => {
      records.install(frame);
    },
    forget: (id) => {
      records.forget(id);
    },
    reportMemory: (ledger) => {
      records.reportMemory(ledger);
    },
    destroy: () => {
      records.destroy();
    },
  });
}

/**
 * The gradient variant of the rounded frame background pass: the
 * gradient background of a frame with a rounded corner, the frame SDF record plus its paint table
 * record, drawn by `sdf-shape-gradient` (the shape shader's rounded box and coverage, the colour
 * from the paint at the fragment's point of the frame's unit box). Below the level-of-detail
 * threshold it draws its paint's average colour. A sharp frame's gradient stays the rect-gradient
 * pass's. List it right after `ROUNDED_RECT_PASS`; a board without one gives it no record, and
 * its pipeline waits for its first record (`isDeferred`).
 */
export const ROUNDED_RECT_GRADIENT_PASS: ScenePassFactory = {
  name: ROUNDED_RECT_GRADIENT_PASS_NAME,
  create: createRoundedRectGradientPass,
};
