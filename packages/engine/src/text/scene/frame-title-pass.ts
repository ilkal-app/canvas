import { FRAME_TITLE_MOVE_SHADER } from '../../gpu/shaders/frame-title-move.generated.js';
import { FRAME_TITLE_SHADER } from '../../gpu/shaders/frame-title.generated.js';
import type { PassLevelOfDetail } from '../../lod/level-of-detail.js';
import { FRAME_TITLE_LOD_RULE } from '../../lod/lod-thresholds.js';
import type { ScenePassFactory } from '../../scene/scene-pass.js';
import { FRAME_TITLE_ATLAS_SHARE } from '../atlas/glyph-atlas-sizing.js';

import { frameTitleBounds } from './frame-title-bounds.js';
import { frameTitlePlacement, frameTitleTextOf, hasFrameTitle } from './frame-title-box.js';
import { TEXT_PIPELINE_SPEC, textPageBindings, type TextPassKind } from './text-pass-definition.js';
import { textPassFactory } from './text-pass.js';

/** The frame title pass's name: the key of its instance buffer and draw list entries. */
export const FRAME_TITLE_PASS_NAME = 'frame-title';

/**
 * The frame title pass's level of detail: a frame's name is hidden while the frame is under
 * `FRAME_TITLE_HIDDEN_WIDTH_PX` device pixels wide on screen, measured by the frame's width.
 */
export const FRAME_TITLE_LEVEL_OF_DETAIL: PassLevelOfDetail = {
  rule: FRAME_TITLE_LOD_RULE,
  sizeOf: (object) => (object.type === 'frame' ? object.width : 0),
  isSameSize: (previous, next) =>
    previous.type === 'frame' && next.type === 'frame' && previous.width === next.width,
};

/** The frame title pass: frame names in CSS pixels from each frame's top-left corner. */
export const FRAME_TITLE_PASS_KIND: TextPassKind = {
  name: FRAME_TITLE_PASS_NAME,
  pipelineSpec: {
    ...TEXT_PIPELINE_SPEC,
    shader: FRAME_TITLE_SHADER,
    moveShader: FRAME_TITLE_MOVE_SHADER,
    // One page per draw: the frame title shader samples a single page texture, with no switch
    // for the scene text's page-count variants to cut.
    pageBindings: textPageBindings(1),
    pageShaderVariants: [],
  },
  levelOfDetail: FRAME_TITLE_LEVEL_OF_DETAIL,
  placementOf: frameTitlePlacement,
  textOf: frameTitleTextOf,
  // Where the name must end: its frame's width, where the shader cuts the name.
  recordValueOf: (object) => (object.type === 'frame' ? object.width : 0),
  // A layout unit is a CSS pixel at every zoom: dpr device pixels.
  scaleOf: (camera) => camera.dpr,
  // A name draws above its frame's box: its zoom-independent reach goes to the index. A hidden
  // name reaches nowhere.
  hasDrawingBounds: hasFrameTitle,
  drawingBoundsOf: frameTitleBounds,
  isBoundsScaled: true,
  // A frame's name never fades with it: it draws on the canvas, outside layers;
  // at opacity 0, the frame's or an ancestor's, it is hidden with the frame.
  isOutsideLayers: true,
  atlasShare: FRAME_TITLE_ATLAS_SHARE,
  pagesPerGroup: 1,
};

/**
 * The scene's frame title pass: each frame's name in its title band above its top edge
 * (`frameTitlePlacement`), drawn by the text machinery (layout jobs, the glyph atlas, paged MSDF
 * records) with the frame title shader, which scales a glyph's CSS-pixel rectangle by the camera's
 * CSS pixel, so the name keeps one size on screen at every zoom and turns with its frame, and a
 * zoom uploads nothing. Records sit at the frame's place in the paint order, so the frame's
 * children draw over a name they cover. Hidden while the frame is under 40 device pixels wide on
 * screen (`FRAME_TITLE_LEVEL_OF_DETAIL`). Its reach above the frame goes to the spatial index as
 * zoom-independent drawing bounds (`frameTitleBounds`), so the name is culled and z-ordered by
 * where it can draw. Without text resources in the environment the pass draws nothing. A frame
 * whose name is hidden (`showName: false`, or by default a frame inside another frame or a
 * component) draws no name and publishes no drawing bounds. The scene resolves the default over the
 * frame's ancestors once per change set (`withResolvedFrameNames`), re-reading the frames below
 * an object that moves to another parent, so the pass reads the frame alone and never resolves
 * per drawn frame.
 */
export const FRAME_TITLE_PASS: ScenePassFactory = textPassFactory(FRAME_TITLE_PASS_KIND);
