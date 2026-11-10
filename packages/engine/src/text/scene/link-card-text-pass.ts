import type { BoardObject } from '@canvas/schema';
import { LINE_HEIGHT_EM } from '@canvas/text';

import type { PassLevelOfDetail } from '../../lod/level-of-detail.js';
import { LINK_CARD_TEXT_LOD_RULE } from '../../lod/lod-thresholds.js';
import type { ScenePassFactory } from '../../scene/scene-pass.js';
import { LINK_CARD_LOOK } from '../../shapes/link-card-geometry.js';
import { LINK_CARD_TEXT_ATLAS_SHARE } from '../atlas/glyph-atlas-sizing.js';
import { TEXT_PAGES_PER_GROUP } from '../renderer/text-pipeline.js';

import { linkCardBodyPlacement, linkCardFooterPlacement } from './link-card-text-box.js';
import { TEXT_PIPELINE_SPEC, type TextPassKind } from './text-pass-definition.js';
import { textPassFactory } from './text-pass.js';
import type { TextBoxGeometry } from './text-placement.js';

/** The link card body pass's name: a card's title and description. */
export const LINK_CARD_BODY_PASS_NAME = 'link-card-body';

/** The link card footer pass's name: a card's domain. */
export const LINK_CARD_FOOTER_PASS_NAME = 'link-card-footer';

/**
 * A text pass kind for one of a card's boxes, in the card's frame and world units, so it pans,
 * zooms and turns with the card. The text lies inside the card: it reaches nowhere the card's box
 * does not.
 *
 * @param name - The pass's name.
 * @param placementOf - Where its box is.
 * @param lineSize - Its smallest line's height, world units: the level of detail's size.
 * @returns The kind.
 */
function linkTextKind(
  name: string,
  placementOf: (object: BoardObject) => TextBoxGeometry | undefined,
  lineSize: number,
): TextPassKind {
  const levelOfDetail: PassLevelOfDetail = {
    rule: LINK_CARD_TEXT_LOD_RULE,
    sizeOf: (object) => (object.type === 'link' ? lineSize : 0),
    isSameSize: (previous, next) => previous.type === 'link' && next.type === 'link',
  };
  return {
    name,
    pipelineSpec: TEXT_PIPELINE_SPEC,
    levelOfDetail,
    placementOf,
    textOf: (object) => placementOf(object)?.text,
    scaleOf: (camera) => camera.zoom * camera.dpr,
    hasDrawingBounds: () => false,
    drawingBoundsOf: () => undefined,
    atlasShare: LINK_CARD_TEXT_ATLAS_SHARE,
    pagesPerGroup: TEXT_PAGES_PER_GROUP,
  };
}

/** A link card's title and description, each cut to two lines. */
export const LINK_CARD_BODY_PASS_KIND: TextPassKind = linkTextKind(
  LINK_CARD_BODY_PASS_NAME,
  linkCardBodyPlacement,
  LINK_CARD_LOOK.descriptionSize * LINE_HEIGHT_EM,
);

/** A link card's domain, one line in its footer. */
export const LINK_CARD_FOOTER_PASS_KIND: TextPassKind = linkTextKind(
  LINK_CARD_FOOTER_PASS_NAME,
  linkCardFooterPlacement,
  LINK_CARD_LOOK.footerSize * LINE_HEIGHT_EM,
);

/**
 * The link card body pass factory: a card's title in bold over its description, in
 * the card's text colour tokens, laid out with the scene text's pipeline and its own atlas.
 * Register it after the scene text.
 */
export const LINK_CARD_BODY_PASS: ScenePassFactory = textPassFactory(LINK_CARD_BODY_PASS_KIND);

/** The link card footer pass factory: a card's domain; register it after the body. */
export const LINK_CARD_FOOTER_PASS: ScenePassFactory = textPassFactory(LINK_CARD_FOOTER_PASS_KIND);
