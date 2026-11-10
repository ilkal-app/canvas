import type { GpuVertexAttribute, GpuVertexBufferLayout } from '../gpu/vertex-layout.js';
import { resolveVertexBufferLayouts } from '../gpu/vertex-layout.js';

/**
 * The record layout of one pass's persistent instance buffer: the per-instance attributes the
 * pass's shader reads, all `float32…` formats, packed without padding. Every record of the
 * buffer has this layout and stride.
 */
export interface InstanceLayout {
  /** The pipeline's per-instance vertex buffer layout (`stepMode: 'instance'`). */
  readonly vertexBufferLayout: GpuVertexBufferLayout;
  /** Floats per record. */
  readonly floatsPerRecord: number;
  /** Bytes per record: `floatsPerRecord × 4`. */
  readonly byteStride: number;
  /**
   * The float of each record holding its clip index, the one before
   * {@link InstanceLayout.opacityFloat}, for a layout from {@link resolveSceneInstanceLayout}; the
   * scene writes it after the pass prepares the record. Absent for a layout without one, whose
   * records the scene leaves as the pass wrote them.
   */
  readonly clipFloat?: number;
  /**
   * The float of each record holding its layer transparency, the last one, right after
   * {@link InstanceLayout.clipFloat}, for a layout from {@link resolveSceneInstanceLayout}: 1 minus
   * the object's cumulative layer opacity (`SceneOpacity`), so an all-zero record is opaque. The
   * scene writes it after the pass prepares the record; absent for a layout without one.
   */
  readonly opacityFloat?: number;
}

/**
 * The instance attribute location of a scene record's clip index: the slot, in the
 * scene's clip table, of the record's nearest clipping ancestor, 0 for none. Every scene shader
 * reads it (`scripts/clip-shader.ts`).
 */
export const CLIP_INDEX_LOCATION = 14;

/**
 * The instance attribute location of a scene record's layer transparency: 1 minus the
 * cumulative opacity of the object and its ancestors, 0 for an opaque one. Every scene shader
 * reads it and multiplies its coverage by 1 minus it (`scripts/clip-shader.ts`). Location 12 is
 * free in every scene pipeline: the own attributes take 0 to 6, the retained-move index 7, a
 * gradient's paint row or an image fill 8 to 11, the clip index 14 and the SDF corners 15, so the
 * largest pipeline (an image-filled SDF shape that moves) reads 15 of the 16 attributes.
 */
export const LAYER_OPACITY_LOCATION = 12;

/**
 * Resolves the attributes of an instance record into its layout. Instance buffers are
 * `Float32Array`s, so only `float32` to `float32x4` formats are accepted.
 *
 * @param attributes - The per-instance attributes, in memory order.
 * @returns The layout with its stride.
 * @throws {RangeError} When there are no attributes, a location repeats or a format is not
 *   made of 32-bit floats.
 */
export function resolveInstanceLayout(attributes: readonly GpuVertexAttribute[]): InstanceLayout {
  const vertexBufferLayout: GpuVertexBufferLayout = { stepMode: 'instance', attributes };
  const [resolved] = resolveVertexBufferLayouts([vertexBufferLayout]);
  if (!resolved) {
    throw new RangeError('An instance layout needs one vertex buffer layout.');
  }
  for (const attribute of resolved.attributes) {
    if (attribute.componentType !== 'float32') {
      throw new RangeError(
        `Instance attribute at location ${String(attribute.location)} is ${attribute.format}; instance records hold 32-bit floats only.`,
      );
    }
  }
  return {
    vertexBufferLayout,
    floatsPerRecord: resolved.byteStride / Float32Array.BYTES_PER_ELEMENT,
    byteStride: resolved.byteStride,
  };
}

/**
 * Resolves a scene pass's record layout: the pass's own attributes, then a
 * `float32` clip index at {@link CLIP_INDEX_LOCATION} and a trailing `float32` layer transparency
 * at `LAYER_OPACITY_LOCATION`, which the scene writes into every record after the pass
 * prepares it (`InstanceLayout.clipFloat`, `InstanceLayout.opacityFloat`). A pass prepares only
 * its own floats; an all-zero record is unclipped and opaque.
 *
 * @param attributes - The pass's own per-instance attributes, in memory order, without the clip
 *   index or the transparency.
 * @returns The layout, with `opacityFloat` naming its last float and `clipFloat` the one before.
 * @throws {RangeError} When there are no attributes, a location repeats (the clip index's and the
 *   transparency's included) or a format is not made of 32-bit floats.
 */
export function resolveSceneInstanceLayout(
  attributes: readonly GpuVertexAttribute[],
): InstanceLayout {
  if (attributes.length === 0) throw new RangeError('A scene record needs attributes of its own.');
  const layout = resolveInstanceLayout([
    ...attributes,
    { location: CLIP_INDEX_LOCATION, format: 'float32' },
    { location: LAYER_OPACITY_LOCATION, format: 'float32' },
  ]);
  return {
    ...layout,
    clipFloat: layout.floatsPerRecord - 2,
    opacityFloat: layout.floatsPerRecord - 1,
  };
}
