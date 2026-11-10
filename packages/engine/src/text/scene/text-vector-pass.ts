import type { BoardObject } from '@canvas/schema';

import { PATH_MOVE_SHADER } from '../../gpu/shaders/path-move.generated.js';
import { PATH_SHADER } from '../../gpu/shaders/path.generated.js';
import type { PassLevelOfDetail } from '../../lod/level-of-detail.js';
import { textPaletteOf } from '../../paint/color-palette.js';
import { resolveSceneInstanceLayout } from '../../scene/instance-layout.js';
import type { SceneObject, ScenePass, ScenePassFactory } from '../../scene/scene-pass.js';
import { VECTOR_COVER_VERTEX_LAYOUT } from '../vector/vector-text-pipelines.js';

import { isSameTextSize, textLineHeightOf } from './text-detail.js';
import { TEXT_PASS_KIND } from './text-pass-definition.js';
import { TextVectorDrawer } from './text-vector-drawer.js';
import { TEXT_VECTOR_PASS_NAME } from './text-vector-names.js';
import { textVectorOf, type TextVectorState } from './text-vector-state.js';

export { TEXT_VECTOR_PASS_NAME } from './text-vector-names.js';

/**
 * A run's record, as the path pass's: the world rotation axis and origin (`float32x4`, location
 * 1) and the run's straight-alpha colour (`float32x4`, location 2), then what the scene writes.
 */
const TEXT_VECTOR_RECORD_LAYOUT = resolveSceneInstanceLayout([
  { location: 1, format: 'float32x4' },
  { location: 2, format: 'float32x4' },
]);

/**
 * Below this many device pixels of its tallest line an object's runs are left out of the
 * companion's draws (and so its z-order segments). A run draws from its outlines only above
 * 512 px per em, and keeps doing so down to 460.8 (the tier's hysteresis): a line of at least
 * 553 px (`LINE_HEIGHT_EM` 1.2). Shown again from 480 px with the 20% band, so text that can
 * draw from its outlines is never left out, while at every ordinary zoom the companion's records
 * (one per style run of every text) cost the segments nothing.
 */
const VECTOR_HIDDEN_LINE_PX = 400;

/**
 * The companion's level of detail: text whose tallest line is under {@link VECTOR_HIDDEN_LINE_PX}
 * device pixels is left out, measured as the text pass measures it.
 */
const TEXT_VECTOR_LEVEL_OF_DETAIL: PassLevelOfDetail = {
  rule: { kind: 'text-vector', levels: [{ form: 'hidden', belowPx: VECTOR_HIDDEN_LINE_PX }] },
  sizeOf: textLineHeightOf,
  isSameSize: isSameTextSize,
};

/** The unused per-vertex data of the spec: the drawer draws each run's own mesh at slot 0. */
const NO_VERTICES = new Float32Array(0);

/**
 * Builds the companion for a scene's text vector state; without one (the resources do not ask
 * for vector glyphs) it holds no records, so a board pays nothing for it.
 *
 * @param state - The text pass's vector state, if any.
 * @returns The pass.
 */
function createTextVectorPass(state: TextVectorState | undefined): ScenePass {
  const pass: ScenePass = {
    isRootMoveOrderStable: true,
    name: TEXT_VECTOR_PASS_NAME,
    layout: TEXT_VECTOR_RECORD_LAYOUT,
    pipelineSpec: {
      shader: PATH_SHADER,
      moveShader: PATH_MOVE_SHADER,
      vertexLayout: VECTOR_COVER_VERTEX_LAYOUT,
      vertices: NO_VERTICES,
      vertexCount: 0,
      blend: 'premultiplied',
      // Its drawer draws; without one (no vector glyphs) it has no record to build a pipeline for.
      isDeferred: true,
    },
    recordCount(object: BoardObject): number {
      if (state === undefined) return 0;
      return TEXT_PASS_KIND.placementOf(object)?.runs.length ?? 0;
    },
    prepare(record: Float32Array, target: SceneObject, recordIndex: number): void {
      const style = TEXT_PASS_KIND.placementOf(target.object)?.runs[recordIndex]?.style;
      if (style === undefined) return;
      // Field by field: prepare runs for every changed object, so it allocates nothing more.
      const { transform } = target;
      record[0] = transform.cos;
      record[1] = transform.sin;
      record[2] = transform.x;
      record[3] = transform.y;
      // A linked run draws in its own colour at every tier, as its glyphs do.
      const color = textPaletteOf(target).resolve(style.color);
      record[4] = color[0];
      record[5] = color[1];
      record[6] = color[2];
      record[7] = color[3];
    },
  };
  if (state === undefined) {
    // No records: nothing a preview could wait for.
    PREVIEW_READERS.set(pass, () => true);
    return pass;
  }
  const drawn: ScenePass = {
    ...pass,
    levelOfDetail: TEXT_VECTOR_LEVEL_OF_DETAIL,
    createDrawer: (setup) => new TextVectorDrawer(setup, pass, state),
  };
  PREVIEW_READERS.set(drawn, () => state.isIdle);
  return drawn;
}

/** The companion passes' preview readiness, by pass (`isTextVectorPreviewReady`). */
const PREVIEW_READERS = new WeakMap<ScenePass, () => boolean>();

/**
 * Whether a pass is the text vector companion and has nothing in flight a preview of its frame
 * would miss: without vector glyphs it holds no records; with them, every glyph's geometry asked
 * for has landed and no text waits for it (the text pass's own readiness refuses while a run
 * waits too). A preview (`readScenePreviewResources`) admits only passes it recognises.
 *
 * @param pass - A pass owned by the current renderer.
 * @returns False for any other pass, or while geometry is in flight.
 */
export function isTextVectorPreviewReady(pass: ScenePass): boolean {
  return PREVIEW_READERS.get(pass)?.() ?? false;
}

/**
 * The text pass's vector companion, listed right after it: text runs shown above 512
 * device px per em, drawn from their glyphs' outlines so they stay sharp at any zoom, while the
 * text pass's records of those runs draw nothing. One record per style run of every text the text
 * kind draws, in the path pass's layout, written whatever the run's tier: the object's world
 * placement and the run's colour, so clipping, layer opacity, z-order and
 * retained moves hold for it as for a path, and a zoom never rewrites them. Its drawer draws each
 * run the text pass draws from its outlines: the run's glyph triangles counted into the stencil,
 * non-zero, then a cover quad of their bounds. Only when the text resources ask for vector glyphs
 * (`TextPassResources.hasVectorGlyphs`); otherwise it holds no records.
 */
export const TEXT_VECTOR_PASS: ScenePassFactory = {
  name: TEXT_VECTOR_PASS_NAME,
  create: (environment) => createTextVectorPass(textVectorOf(environment)),
};
