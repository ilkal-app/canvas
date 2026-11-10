import {
  isPaintVisible,
  paintAverageColor,
  type BoardObject,
  type Gradient,
  type Rgba,
} from '@canvas/schema';

import { RECT_GRADIENT_MOVE_SHADER } from '../gpu/shaders/rect-gradient-move.generated.js';
import { RECT_GRADIENT_SHADER } from '../gpu/shaders/rect-gradient.generated.js';
import { GRADIENT_LEVEL_OF_DETAIL } from '../paint/gradient-detail.js';
import {
  GradientRecords,
  markPaintTablePass,
  PAINT_TABLE_BINDINGS,
} from '../paint/gradient-records.js';
import { readGradient } from '../paint/paint-reading.js';

import { isRoundedFrame } from './frame-shape-record.js';
import { resolveInstanceLayout, resolveSceneInstanceLayout } from './instance-layout.js';
import type { ScenePass, ScenePassEnvironment, ScenePassFactory } from './scene-pass.js';
import { SOLID_RECT_ATTRIBUTES, SOLID_RECT_PASS, writeRectRecord } from './solid-rect-pass.js';

/** The frame-background gradient pass's name. */
export const RECT_GRADIENT_PASS_NAME = 'rect-gradient';

/** No colour: a gradient record's solid colour, unread. */
const CLEAR: Rgba = [0, 0, 0, 0];

/** Floats of the solid-rect record the gradient record starts with. */
const SOLID_RECT_FLOATS = resolveInstanceLayout(SOLID_RECT_ATTRIBUTES).floatsPerRecord;

/**
 * A sharp frame's gradient background, or undefined when the object is not a frame with one the
 * schema accepts, or its corners are rounded (the rounded-rect gradient pass's).
 *
 * @param object - The object.
 * @returns The gradient, or undefined.
 */
function backgroundGradientOf(object: BoardObject): Gradient | undefined {
  return object.type === 'frame' && !isRoundedFrame(object)
    ? readGradient(object.background)
    : undefined;
}

/**
 * Builds the pass for one renderer.
 *
 * @param environment - The renderer's environment: its backend and level of detail.
 * @returns The pass.
 */
function createRectGradientPass(environment: ScenePassEnvironment): ScenePass {
  const records = new GradientRecords(RECT_GRADIENT_PASS_NAME, environment, 'average-color');
  return markPaintTablePass({
    isRootMoveOrderStable: true,
    isRootMoveEmpty: true,
    name: RECT_GRADIENT_PASS_NAME,
    layout: resolveSceneInstanceLayout([
      ...SOLID_RECT_ATTRIBUTES,
      { location: 8, format: 'float32' },
    ]),
    pipelineSpec: {
      ...SOLID_RECT_PASS.pipelineSpec,
      shader: RECT_GRADIENT_SHADER,
      moveShader: RECT_GRADIENT_MOVE_SHADER,
      pageBindings: PAINT_TABLE_BINDINGS,
    },
    recordCount: (object) => (backgroundGradientOf(object) === undefined ? 0 : 1),
    // As the solid-rect pass flags a background, with "any stop's alpha above 0" for a gradient.
    isOccluder: (object) => isPaintVisible(backgroundGradientOf(object) ?? null),
    levelOfDetail: GRADIENT_LEVEL_OF_DETAIL,
    prepare(record, target) {
      const { object, transform } = target;
      const gradient = backgroundGradientOf(object);
      if (object.type !== 'frame' || gradient === undefined) return;
      const row = records.rowOf(target, gradient);
      // The solid record, its colour read only at record 0: the average colour.
      writeRectRecord(record, object, transform, row === 0 ? paintAverageColor(gradient) : CLEAR);
      record[SOLID_RECT_FLOATS] = row;
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
 * The gradient variant of the solid-rect pass: frame backgrounds that are a
 * gradient the schema accepts, the solid-rect quad and record plus its paint table record, drawn
 * by `rect-gradient` (the colour from the paint at the quad's point of the frame's unit box).
 * Below the level-of-detail threshold a background draws its paint's average colour. List it
 * right after `SOLID_RECT_PASS`; a board without a gradient gives it no record.
 */
export const RECT_GRADIENT_PASS: ScenePassFactory = {
  name: RECT_GRADIENT_PASS_NAME,
  create: createRectGradientPass,
};
