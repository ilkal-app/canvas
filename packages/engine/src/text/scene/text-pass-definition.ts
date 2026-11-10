import type { BoardObject, ParagraphStyle, StyleRun } from '@canvas/schema';

import type { Camera, WorldBounds } from '../../camera/camera.js';
import type { GpuBindingLayoutEntry } from '../../gpu/gpu-pipeline.js';
import { SCENE_TEXT_MOVE_SHADER } from '../../gpu/shaders/scene-text-move.generated.js';
import { SCENE_TEXT_PAGES_1_SHADER } from '../../gpu/shaders/scene-text-pages-1.generated.js';
import { SCENE_TEXT_PAGES_2_SHADER } from '../../gpu/shaders/scene-text-pages-2.generated.js';
import { SCENE_TEXT_PAGES_4_SHADER } from '../../gpu/shaders/scene-text-pages-4.generated.js';
import { SCENE_TEXT_SHADER } from '../../gpu/shaders/scene-text.generated.js';
import type { PassLevelOfDetail } from '../../lod/level-of-detail.js';
import type { ScenePass, ScenePipelineSpec } from '../../scene/scene-pass.js';
import { TEXT_ATLAS_SHARE } from '../atlas/glyph-atlas-sizing.js';
import { GLYPH_QUAD_CORNERS, GLYPH_QUAD_VERTEX_COUNT } from '../renderer/glyph-instance.js';
import {
  TEXT_BINDINGS,
  TEXT_PAGE_TEXTURE_BINDINGS,
  TEXT_PAGES_PER_GROUP,
} from '../renderer/text-pipeline.js';

import { hasOverflowingText } from './connector-label-box.js';
import { drawnTextBounds } from './drawn-text-bounds.js';
import { TEXT_LEVEL_OF_DETAIL } from './text-detail.js';
import type { TextObjectEntry } from './text-object-entry.js';
import { textPlacementOf, type TextBoxGeometry } from './text-placement.js';
import { drawnParagraphsOf, drawnRunsOf, drawnTextOf } from './text-record-count.js';
import { TEXT_RECORD_LAYOUT } from './text-record.js';

export { textRecordCount } from './text-record-count.js';

/** The text pass's name: the key of its instance buffer and draw list entries. */
export const TEXT_PASS_NAME = 'text';

/**
 * A text pass's page bindings: the group's page uniform, its pages' textures in slot
 * order (`TEXT_PAGE_TEXTURE_BINDINGS`) and the sampler; one texture for a pass that draws a
 * page at a time.
 *
 * @param pagesPerGroup - The pass's pages per group (`TextPassKind.pagesPerGroup`).
 * @returns The bindings.
 */
export function textPageBindings(pagesPerGroup: number): readonly GpuBindingLayoutEntry[] {
  return [
    { binding: TEXT_BINDINGS.page, kind: 'uniform-buffer' },
    ...TEXT_PAGE_TEXTURE_BINDINGS.slice(0, pagesPerGroup).map((binding) => ({
      binding,
      kind: 'texture' as const,
      samplerBinding: TEXT_BINDINGS.sampler,
    })),
    { binding: TEXT_BINDINGS.sampler, kind: 'sampler' },
  ];
}

/**
 * The text pass's pipeline: the scene text shader, one unit quad per glyph, paged by page group:
 * the group's uniform, its {@link TEXT_PAGES_PER_GROUP} page textures and the sampler.
 */
export const TEXT_PIPELINE_SPEC: ScenePipelineSpec = {
  shader: SCENE_TEXT_SHADER,
  moveShader: SCENE_TEXT_MOVE_SHADER,
  vertexLayout: { stepMode: 'vertex', attributes: [{ location: 0, format: 'float32x2' }] },
  vertices: GLYPH_QUAD_CORNERS,
  vertexCount: GLYPH_QUAD_VERTEX_COUNT,
  blend: 'premultiplied',
  pageBindings: textPageBindings(TEXT_PAGES_PER_GROUP),
  // A group whose pages fill only its first slots draws without the rest of the page switch.
  pageShaderVariants: [
    { pageSlots: 1, shader: SCENE_TEXT_PAGES_1_SHADER },
    { pageSlots: 2, shader: SCENE_TEXT_PAGES_2_SHADER },
    { pageSlots: 4, shader: SCENE_TEXT_PAGES_4_SHADER },
  ],
};

/**
 * What makes one pass of the scene's text machinery (layout jobs, glyph atlas, paged glyph
 * records): its name and pipeline, its level of detail, which objects it draws text for and
 * where, and the scale its glyphs are drawn at. The text pass draws text in world units; the
 * frame title pass draws frame names in CSS pixels, scaled on the GPU.
 */
export interface TextPassKind {
  /** The pass's name: the key of its instance buffer, draw list entries and level of detail. */
  readonly name: string;
  /** The pipeline its glyph records draw with. */
  readonly pipelineSpec: ScenePipelineSpec;
  /** Its level of detail. */
  readonly levelOfDetail: PassLevelOfDetail;
  /**
   * Where an object's text box sits, in the pass's layout units.
   *
   * @param object - The object.
   * @returns The box, or `undefined` for an object the pass draws no text for.
   */
  readonly placementOf: (object: BoardObject) => TextBoxGeometry | undefined;
  /**
   * The text the pass draws for an object, which its records are counted from.
   *
   * @param object - The object.
   * @returns The text, or `undefined`.
   */
  readonly textOf: (object: BoardObject) => string | undefined;
  /**
   * The runs of that text, whose links add underline records; a pass that draws no
   * link leaves it out.
   *
   * @param object - The object.
   * @returns The runs, or `undefined`.
   */
  readonly runsOf?: (object: BoardObject) => readonly StyleRun[] | undefined;
  /**
   * The paragraph styles of that text, whose list markers add records; a pass that
   * draws no list leaves it out.
   *
   * @param object - The object.
   * @returns The styles, or `undefined`.
   */
  readonly paragraphsOf?: (object: BoardObject) => readonly ParagraphStyle[] | undefined;
  /**
   * What a record holds at `@location(6)` in place of its glyph page's index in its group, which
   * the pass's own shader reads: only for a pass of one page per group, whose index is always 0
   * (the frame title pass: the frame's width, where its name ends). The page's index
   * when absent.
   *
   * @param object - The object.
   * @returns The value.
   */
  readonly recordValueOf?: (object: BoardObject) => number;
  /**
   * How many device pixels one layout unit covers under a camera, which picks the glyphs' tier.
   *
   * @param camera - The camera.
   * @returns Device px per layout unit.
   */
  readonly scaleOf: (camera: Camera) => number;
  /**
   * Whether the pass publishes where an object's text draws to the spatial index
   * (`ScenePassEnvironment.setTextBounds`): text that can draw outside its object's box.
   */
  readonly hasDrawingBounds: (object: BoardObject) => boolean;
  /**
   * Where an object's text draws on the board, for the spatial index's culling and z-order
   * segments.
   *
   * @param entry - The object's entry, its quads built.
   * @param scale - The pass's scale now (`scaleOf`).
   * @returns The bounds, or `undefined` while nothing draws.
   */
  readonly drawingBoundsOf: (entry: TextObjectEntry, scale: number) => WorldBounds | undefined;
  /** Whether the bounds depend on the scale, so a new scale publishes them again. */
  readonly isBoundsScaled?: boolean;
  /** Whether the pass draws on the canvas, never inside a layer (`ScenePass.isOutsideLayers`). */
  readonly isOutsideLayers?: boolean;
  /**
   * The pass's share of the device budget's `atlases` bytes: the scene's text
   * `TEXT_ATLAS_SHARE`, the frame titles `FRAME_TITLE_ATLAS_SHARE`.
   */
  readonly atlasShare: number;
  /**
   * Atlas pages bound together, one draw for glyphs on any of them: the scene's text
   * {@link TEXT_PAGES_PER_GROUP}, whose shader picks a page per glyph; the frame titles 1, whose
   * shader samples one page per draw.
   */
  readonly pagesPerGroup: number;
}

/** The text pass: text, sticky notes and labels, in world units. */
export const TEXT_PASS_KIND: TextPassKind = {
  name: TEXT_PASS_NAME,
  atlasShare: TEXT_ATLAS_SHARE,
  pagesPerGroup: TEXT_PAGES_PER_GROUP,
  pipelineSpec: TEXT_PIPELINE_SPEC,
  levelOfDetail: TEXT_LEVEL_OF_DETAIL,
  placementOf: textPlacementOf,
  textOf: drawnTextOf,
  runsOf: drawnRunsOf,
  paragraphsOf: drawnParagraphsOf,
  scaleOf: (camera) => camera.zoom * camera.dpr,
  hasDrawingBounds: hasOverflowingText,
  drawingBoundsOf: (entry) => drawnTextBounds(entry),
};

/**
 * The pass a kind of text gets without text resources in the environment (fonts and a job
 * pool): one that draws nothing.
 *
 * @param kind - The kind.
 * @returns The pass.
 */
export function inertTextPass(kind: TextPassKind): ScenePass {
  return {
    name: kind.name,
    layout: TEXT_RECORD_LAYOUT,
    pipelineSpec: kind.pipelineSpec,
    recordCount: () => 0,
    prepare: () => undefined,
    pageOf: () => 0,
    pageEntries: () => [],
  };
}
