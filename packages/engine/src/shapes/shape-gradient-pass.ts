import { paintAverageColor, type BoardObject } from '@canvas/schema';

import { SDF_SHAPE_GRADIENT_MOVE_SHADER } from '../gpu/shaders/sdf-shape-gradient-move.generated.js';
import { SDF_SHAPE_GRADIENT_SHADER } from '../gpu/shaders/sdf-shape-gradient.generated.js';
import { paletteOf } from '../paint/color-palette.js';
import { GRADIENT_LEVEL_OF_DETAIL } from '../paint/gradient-detail.js';
import {
  GradientRecords,
  markPaintTablePass,
  PAINT_TABLE_BINDINGS,
} from '../paint/gradient-records.js';
import { readGradient } from '../paint/paint-reading.js';
import { resolveSceneInstanceLayout } from '../scene/instance-layout.js';
import type { ScenePass, ScenePassEnvironment, ScenePassFactory } from '../scene/scene-pass.js';

import {
  SHAPE_INSTANCE_FLOATS,
  SHAPE_INSTANCE_VERTEX_LAYOUT,
  SHAPE_QUAD_VERTEX_LAYOUT,
} from './shape-instance-layout.js';
import { isPaintedGradientShape, writeShapeRecord } from './shape-object-record.js';
import { SHAPE_QUAD_VERTEX_COUNT, SHAPE_QUAD_VERTICES } from './shape-pipeline.js';

/** The gradient shape pass's name. */
export const SDF_SHAPE_GRADIENT_PASS_NAME = 'sdf-shape-gradient';

/**
 * The gradient shape pass's record: the SDF shape record (`SHAPE_INSTANCE_FLOATS`) and one float,
 * the paint table record its fill reads (`@location(8)`; 0 draws floats 4–7, its average colour),
 * then the clip index the scene writes (`resolveSceneInstanceLayout`).
 */
export const SHAPE_GRADIENT_INSTANCE_LAYOUT = resolveSceneInstanceLayout([
  ...SHAPE_INSTANCE_VERTEX_LAYOUT.attributes,
  { location: 8, format: 'float32' },
]);

/**
 * Builds the pass for one renderer.
 *
 * @param environment - The renderer's environment: its backend and level of detail.
 * @returns The pass.
 */
function createShapeGradientPass(environment: ScenePassEnvironment): ScenePass {
  const records = new GradientRecords(SDF_SHAPE_GRADIENT_PASS_NAME, environment, 'average-color');
  return markPaintTablePass({
    isRootMoveOrderStable: true,
    name: SDF_SHAPE_GRADIENT_PASS_NAME,
    layout: SHAPE_GRADIENT_INSTANCE_LAYOUT,
    pipelineSpec: {
      shader: SDF_SHAPE_GRADIENT_SHADER,
      moveShader: SDF_SHAPE_GRADIENT_MOVE_SHADER,
      vertexLayout: SHAPE_QUAD_VERTEX_LAYOUT,
      vertices: new Float32Array(SHAPE_QUAD_VERTICES),
      vertexCount: SHAPE_QUAD_VERTEX_COUNT,
      blend: 'premultiplied',
      pageBindings: PAINT_TABLE_BINDINGS,
    },
    recordCount: (object: BoardObject) => (isPaintedGradientShape(object) ? 1 : 0),
    // As the SDF shape pass: anything a shape paints lands over later-pass content below it.
    isOccluder: isPaintedGradientShape,
    levelOfDetail: GRADIENT_LEVEL_OF_DETAIL,
    prepare(record, target) {
      const { object, transform } = target;
      if (object.type !== 'shape') return;
      const gradient = readGradient(object.fill);
      if (gradient === undefined) return;
      writeShapeRecord(record, object, transform, paletteOf(target));
      const row = records.rowOf(target, gradient);
      record[SHAPE_INSTANCE_FLOATS] = row;
      if (row === 0) record.set(paintAverageColor(gradient), 4);
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
 * The gradient variant of the SDF shape pass: shapes whose fill is a gradient
 * the schema accepts, each one record of the SDF shape record and its paint table record, drawn
 * by `sdf-shape-gradient` (the solid shader's SDF and coverage, with the fill's colour from the
 * paint at the fragment's point of the shape's unit box); the outline as the solid pass draws
 * it. Below the level-of-detail threshold a shape draws its paint's average colour
 * (`GRADIENT_LEVEL_OF_DETAIL`). Flagged to the z-order segments as the solid pass flags a
 * painted shape, so it is ordered against every other pass's content by z. List it right after
 * `SDF_SHAPE_PASS`; a board without a gradient gives it no record and allocates no table.
 */
export const SDF_SHAPE_GRADIENT_PASS: ScenePassFactory = {
  name: SDF_SHAPE_GRADIENT_PASS_NAME,
  create: createShapeGradientPass,
};
