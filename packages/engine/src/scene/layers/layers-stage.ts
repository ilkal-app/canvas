import type { ObjectId } from '@canvas/schema';

import type { FrameContext, FrameStage } from '../frame-context.js';
import type { ScenePassResources } from '../scene-pass-resources.js';

import { LAYER_COMPOSITE_PASS_NAME } from './layer-composite-pass-name.js';
import { LayerCompositor } from './layer-compositor.js';

/** The layers stage's name: it runs last before `draw`. */
export const LAYERS_STAGE_NAME = 'layers';

/**
 * Renders the layer entries that open the draw list: each layer's run of consecutive entries
 * into each of its tiles' targets, with the tile's translated camera, naming the tile to the
 * compositor so its child layers' composites draw there.
 *
 * @param context - The frame.
 * @param compositor - The layer composite pass's drawer, prepared for the frame.
 * @param byName - Each pass's resources by name.
 */
function renderWindows(
  context: FrameContext,
  compositor: LayerCompositor,
  byName: ReadonlyMap<string, ScenePassResources>,
): void {
  const { drawList, backend, cameraUniform } = context;
  let isCameraMoved = false;
  let index = 0;
  while (index < drawList.length) {
    const layer: ObjectId | undefined = drawList[index]?.layer;
    if (layer === undefined) break; // Layer entries come first; the canvas's follow.
    let end = index + 1;
    while (end < drawList.length && drawList[end]?.layer === layer) end += 1;
    const state = compositor.stateOf(layer);
    const entries = drawList.slice(index, end);
    for (const [tileIndex, tile] of (state?.tiles ?? []).entries()) {
      if (cameraUniform.update(tile.camera)) countCameraWrite(context);
      isCameraMoved = true;
      compositor.enterTile(layer, tileIndex);
      const renderPass = backend.beginRenderPass({ target: tile.target });
      try {
        for (const entry of entries) {
          const pass = byName.get(entry.passName);
          if (!pass) throw new RangeError(`The draw list names no scene pass "${entry.passName}".`);
          pass.drawEntry(renderPass, entry, context);
        }
      } finally {
        renderPass.end();
      }
    }
    index = end;
  }
  compositor.enterCanvas();
  // The camera uniform is shared: the canvas pass draws with the frame's own camera again.
  if (isCameraMoved && cameraUniform.update(context.camera)) countCameraWrite(context);
}

/**
 * Counts one camera uniform write in the frame's statistics.
 *
 * @param context - The frame.
 */
function countCameraWrite(context: FrameContext): void {
  context.stats.bufferWrites += 1;
  context.stats.uploadedBytes += context.cameraUniform.buffer.byteLength;
}

/**
 * Creates the `layers` stage: when the z-order segments planned layers this frame
 * (`FrameContext.layers`), it prepares them with the layer composite pass's drawer (rectangles,
 * tiles, targets, cameras and composite uniforms, written before any pass opens), then renders
 * each layer's window, innermost first, into its targets: one target pass per tile (
 * one per layer unless it is larger than a tile), with the frame's camera moved to the tile's
 * rectangle (the camera uniform is shared, so it is written back afterwards). A nested layer's composite is drawn in its parent's window; only outermost
 * composites reach the canvas, in the `draw` stage. A frame without layers costs one length
 * check (and, for two seconds after its last layer, a prepare that frees idle targets), and a
 * renderer without the composite pass has a stage that does nothing. Install it last
 * before `draw`, after every pass drawer's stages, so meshes and glyphs for the layers' content
 * are prepared.
 *
 * @param passes - The renderer's pass resources.
 * @returns The stage.
 */
export function createLayersStage(passes: readonly ScenePassResources[]): FrameStage {
  const composite = passes.find(({ pass }) => pass.name === LAYER_COMPOSITE_PASS_NAME)?.drawer;
  const compositor = composite instanceof LayerCompositor ? composite : undefined;
  const byName = new Map(passes.map((resources) => [resources.pass.name, resources]));
  return {
    name: LAYERS_STAGE_NAME,
    run(context) {
      if (compositor === undefined) return;
      if (context.layers.length === 0 && !compositor.hasPooledLayers) return;
      compositor.prepare(context);
      renderWindows(context, compositor, byName);
    },
  };
}
