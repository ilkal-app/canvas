import type { BoardObject } from '@canvas/schema';

import { LAYER_COMPOSITE_SHADER } from '../../gpu/shaders/layer-composite.generated.js';
import { resolveInstanceLayout } from '../instance-layout.js';
import type { ScenePass, SceneObject } from '../scene-pass.js';

import { LAYER_COMPOSITE_PASS_NAME } from './layer-composite-pass-name.js';
import { LayerCompositor, type LayerCompositorOptions } from './layer-compositor.js';
import { isLayerForm, ownOpacityOf } from './layer-form.js';

/** The unit square as two triangles, as `layer-composite.wgsl` reads it; the drawer's own. */
const QUAD_CORNERS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

/**
 * The layer composite pass: one record per object in layer form (`isLayerForm`:
 * a translucent group, frame, main or instance, or a translucent multi-part leaf), holding its
 * opacity. Its records paint after the object's descendants (`isDrawnAfterDescendants`), at the
 * object's closing rank, and are occluders, so the z-order segments order each composite over
 * everything below the layer and under everything above it; they plan each layer's subtree as a
 * window of its own (`planLayeredDraws`), drawn by the `layers` stage into the layer's target,
 * and this pass's drawer (`LayerCompositor`) draws each composite record as that target at the
 * layer's opacity, premultiplied source-over, into its parent layer's target or the canvas.
 * Registered after the frame outlines and before the shapes: content above a layer in an earlier
 * pass is an occluder that starts its own segment where it meets the composite, and text above
 * a layer, which occludes nothing, draws after it in pass order. A board with nothing translucent
 * gives the pass no record and the frame no layer. Stateless; the drawer holds the targets.
 */
export const LAYER_COMPOSITE_PASS: ScenePass = {
  isRootMoveOrderStable: true,
  name: LAYER_COMPOSITE_PASS_NAME,
  layout: resolveInstanceLayout([{ location: 0, format: 'float32' }]),
  pipelineSpec: {
    shader: LAYER_COMPOSITE_SHADER,
    // The drawer places composites from layer boxes, never from records: a retained root move
    // needs no other variant, and its no-op placement keeps translucent drags on that path.
    moveShader: LAYER_COMPOSITE_SHADER,
    vertexLayout: { stepMode: 'vertex', attributes: [{ location: 0, format: 'float32x2' }] },
    vertices: QUAD_CORNERS,
    vertexCount: 6,
    blend: 'premultiplied',
    isDeferred: true,
  },
  isDrawnAfterDescendants: true,
  recordCount(object: BoardObject): number {
    return isLayerForm(object) ? 1 : 0;
  },
  // A composite paints its whole layer over what lies below it, whatever pass drew that.
  isOccluder: isLayerForm,
  prepare(record: Float32Array, { object }: SceneObject): void {
    record[0] = ownOpacityOf(object);
  },
  createDrawer: (setup) => new LayerCompositor(setup),
};

/** Every layer composite pass, the built one and those {@link createLayerCompositePass} made. */
const COMPOSITE_PASSES = new WeakSet<ScenePass>([LAYER_COMPOSITE_PASS]);

/**
 * A layer composite pass whose drawer bounds its layers by a budget and a limit:
 * {@link LAYER_COMPOSITE_PASS} with `LayerCompositorOptions`; the engine hosts pass the `layers`
 * share of the device's budget (`budgetForDevice`). Stateless; each renderer's drawer holds the
 * targets and the fallback bands.
 *
 * @param options - The layers budget and limit; default the desktop's 48 MiB and 16 layers.
 * @returns The pass.
 */
export function createLayerCompositePass(options: LayerCompositorOptions = {}): ScenePass {
  const pass: ScenePass = {
    ...LAYER_COMPOSITE_PASS,
    createDrawer: (setup) => new LayerCompositor(setup, options),
  };
  COMPOSITE_PASSES.add(pass);
  return pass;
}

/**
 * Whether a pass is the layer composite pass: {@link LAYER_COMPOSITE_PASS} or one made by
 * {@link createLayerCompositePass}.
 *
 * @param pass - The pass.
 * @returns True for a layer composite pass.
 */
export function isLayerCompositePass(pass: ScenePass): boolean {
  return COMPOSITE_PASSES.has(pass);
}
