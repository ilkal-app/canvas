import { LINE_HEIGHT_EM } from '@canvas/text';

import type { PassLevelOfDetail } from '../../lod/level-of-detail.js';
import { STICKY_AUTHOR_LOD_RULE } from '../../lod/lod-thresholds.js';
import type { ScenePassFactory } from '../../scene/scene-pass.js';
import { STICKY_AUTHOR_ATLAS_SHARE } from '../atlas/glyph-atlas-sizing.js';
import { TEXT_PAGES_PER_GROUP } from '../renderer/text-pipeline.js';

import {
  resolvedStickyAuthorOf,
  STICKY_AUTHOR_STYLE,
  stickyAuthorPlacement,
} from './sticky-author-box.js';
import { TEXT_PIPELINE_SPEC, type TextPassKind } from './text-pass-definition.js';
import { textPassFactory } from './text-pass.js';

/** The sticky author pass's name: the key of its instance buffer and draw list entries. */
export const STICKY_AUTHOR_PASS_NAME = 'sticky-author';

/** A sticky's label line height, world units: the same for every sticky. */
const LABEL_LINE = STICKY_AUTHOR_STYLE.fontSize * LINE_HEIGHT_EM;

/** The label's level of detail: its caption line on screen, hidden where unreadable. */
export const STICKY_AUTHOR_LEVEL_OF_DETAIL: PassLevelOfDetail = {
  rule: STICKY_AUTHOR_LOD_RULE,
  sizeOf: (object) => (object.type === 'sticky' ? LABEL_LINE : 0),
  isSameSize: (previous, next) => previous.type === 'sticky' && next.type === 'sticky',
};

/**
 * The sticky author pass kind: the label the scene resolved onto each sticky
 * (`StickyAuthorLabels`), laid out and drawn with the scene text's pipeline in the sticky's frame
 * and world units, so it pans, zooms and turns with the paper. Its own instances, layouts and
 * atlas: the note's own text is never laid out again for it.
 */
export const STICKY_AUTHOR_PASS_KIND: TextPassKind = {
  name: STICKY_AUTHOR_PASS_NAME,
  pipelineSpec: TEXT_PIPELINE_SPEC,
  levelOfDetail: STICKY_AUTHOR_LEVEL_OF_DETAIL,
  placementOf: (object) => {
    const label = resolvedStickyAuthorOf(object);
    return label === undefined ? undefined : stickyAuthorPlacement(object, label);
  },
  textOf: resolvedStickyAuthorOf,
  scaleOf: (camera) => camera.zoom * camera.dpr,
  // The label lies inside the paper: it reaches nowhere the sticky's box does not.
  hasDrawingBounds: () => false,
  drawingBoundsOf: () => undefined,
  atlasShare: STICKY_AUTHOR_ATLAS_SHARE,
  pagesPerGroup: TEXT_PAGES_PER_GROUP,
};

/** The sticky author pass factory, registered after the scene text. */
export const STICKY_AUTHOR_PASS: ScenePassFactory = textPassFactory(STICKY_AUTHOR_PASS_KIND);
