/**
 * The version of the board schema this build reads and writes. Every stored document records
 * the version it was written with, and migrations bring older documents up to this one.
 * Increment it whenever the stored shape of an object changes.
 *
 * - 1: the first stored shape.
 * - 2: a shape's or path's `fill` and a frame's `background` may be a gradient, and a
 *   stroke's or text style's `color` may be `'ink'`; every version 1 value is valid.
 * - 3: a board has ordered pages, and a root object names its page in `pageId`;
 *   a version 2 board is one page, `page-1`.
 * - 4: board-local component definitions, instances and optional child constraints.
 * - 5: an instance override record may restyle text (`textStyle`) and carry its own `runs`
 *   beside `text`; every version 4 record is valid.
 * - 6: a frame may say whether its name is shown, `showName`; every version 5 frame
 *   is valid and keeps its default.
 * - 7: a text style may store `letterSpacing` and `lineHeight`; every version 6 run
 *   is valid and keeps no spacing and an auto line-height.
 * - 8: a text style's weight may be any of the nine CSS weights, 100 to 900; a family
 *   draws one it lacks with its nearest face. Every version 7 weight is one of them.
 * - 9: a shape's `fill` and a frame's `background` may be an image paint, `{ type: 'image',
 *   assetId, naturalSize, fit, crop }`; every version 8 paint is valid.
 * - 10: a frame or main may store a live `autoLayout`, any object how it sits in one
 *   (`layoutChild`), an instance whether it keeps its own width or height (`isWidthFixed`,
 *   `isHeightFixed`), and a text override its measured size (`measuredSize`); every
 *   version 9 object is valid and keeps no auto-layout.
 * - 11: board colour tokens: a colour may name a token `{ token }`, a
 *   frame, main or instance may set `colorMode`, and a portable board may carry its `tokens`;
 *   every version 10 value is valid.
 * - 12: a main may define variant axes and presets (`variantAxes`, `variantPresets`), an instance
 *   select a value per axis (`variant`), and an override record select a nested instance's
 *   (`variant`); every version 11 object is valid and has no variants.
 * - 13: an override record may swap a nested instance's main (`mainId`), and an instance inside
 *   a main may list the mains its slot allows (`swapOptions`); every version 12
 *   object is valid and swaps nothing.
 * - 14: a path, line or connector may carry a stroke style beside its stroke: `strokeDash`,
 *   `strokeJoin`, `strokeMiterLimit` and `strokeCap`; every version 13 object is valid
 *   and draws as before.
 * - 15: a shape or frame may store a drop `shadow`; every version 14 object is valid
 *   and draws no shadow.
 * - 16: a shape or frame may store `strokeAlign` (inside, center or outside), and a frame a
 *   `stroke`; every version 15 object is valid, its outline inside its edge, and a
 *   frame without a stroke draws none.
 * - 17: an override record may carry a child's `x`, `y`, `width` and `height`, an auto-layout
 *   container's `autoLayout` patch, and at the main's own id a variant's size; every
 *   version 16 record is valid and changes no geometry.
 * - 18: every object may store a layer `name` of up to 200 characters; every version 17
 *   object is valid, unnamed unless it is a frame or main.
 * - 19: a board may hold named text and effect styles (`textStyles`, `effectStyles`), a run may
 *   name a text style (`textStyleId`), a shape or frame an effect style (`effectStyleId`), and a
 *   shape's or frame's `shadow` may be a list of 1 to 8 layers; every
 *   version 18 value is valid and names no style.
 * - 20: a frame may store `cornerRadius`, one radius or four from the top-left corner clockwise;
 * every version 19 frame is valid and keeps sharp corners.
 * - 21: an auto-layout's `gap` may be negative, overlapping the children; every version
 *   20 auto-layout is valid and lays out as before.
 * - 22: an instance may store a content `scale`, 0.05 to 20; every version 21 instance
 *   is valid and draws its content at its main's size.
 * - 23: text, a sticky, shape, line, connector, path, group, frame, main or instance may store a
 *   layer `opacity` from 0 to 1, and an override record a child's; every version 22
 *   object is valid and opaque.
 * - 24: every layer but a comment may store `isHidden`: hidden, it and everything inside
 *   it is not drawn, not hit and takes no space in an auto-layout; every version 23 object is
 *   valid and shown.
 * - 25: a text object or sticky may store `direction` (auto, ltr or rtl) and `align` may be
 *   `start` or `end`; every version 24 object is valid and lays out as before.
 * - 26: a run's text style, and a board text style's value, may store `fontVariations`, its
 *   variable-font axis coordinates; every version 25 run is valid and draws the font's
 *   defaults.
 * - 27: a run's text style may store `lang`, a BCP 47 tag, and an override record's text
 *   style too; every version 26 run is valid and has no language.
 * - 28: a run's text style, a board text style's value and an override record's text style may
 *   store `postScriptName`, the face's PostScript name; every version 27 run is valid
 *   and chooses its face by family, weight and italic.
 * - 29: an override record may give a frame child `fill` (its background) and `strokeColor` (its
 *   stroke's colour); every version 28 record is valid and leaves frames as their main
 *   draws them.
 * - 30: a run's text style, a board text style's value and an override record's text style may
 *   store `fontFeatures`, OpenType features by tag; every version 29 run is valid and
 *   shapes with the defaults.
 * - 31: a sticky may store `aspect`, square or wide; every version 30 sticky is valid and
 *   square.
 * - 32: a board may hold `freehand` objects, the draw tool's strokes; a version 31
 *   board has none, so every one is valid as it is.
 * - 33: a text, a sticky and an image may store a `link`, an http, https or mailto URL;
 *   every version 32 object is valid and has none.
 * - 34: a run's text style may store a `link`, under the same rules; every version 33
 *   run is valid and has none.
 * - 35: an image may store a `border`, a stroke drawn inside its box; every version 34
 *   image is valid and has none.
 * - 36: a connector may store a `labelPosition`, the fraction of its route its label sits at;
 * every version 35 connector is valid, its label at the midpoint.
 * - 37: a connector may store `elbowMiddle`, where an elbow route's middle piece runs, and
 *   `curvePoint`, the point a curved route passes through halfway; every version 36
 *   connector is valid and routes automatically.
 * - 38: a run's text style may store `underline` and `strikethrough`, and a text, sticky or label
 *   may store `paragraphs`, each paragraph's list style; every version 37 text is valid,
 *   with neither and every paragraph plain.
 */
export const SCHEMA_VERSION = 39;

/** The schema version that introduced live auto-layout. */
export const AUTO_LAYOUT_SCHEMA_VERSION = 10;

/** The schema version that introduced component variants. */
export const VARIANTS_SCHEMA_VERSION = 12;

/** The schema version that introduced instance swap. */
export const SWAP_SCHEMA_VERSION = 13;

/** The schema version that introduced a layer name on every object. */
export const OBJECT_NAME_VERSION = 18;

/** The schema version that introduced a frame's corner radius. */
export const FRAME_RADIUS_VERSION = 20;

/** The schema version whose auto-layout gap may be negative. */
export const NEGATIVE_GAP_VERSION = 21;

/** The schema version that introduced an instance's content scale. */
export const INSTANCE_SCALE_VERSION = 22;

/** The schema version that introduced layer opacity. */
export const LAYER_OPACITY_VERSION = 23;

/** The schema version that introduced layer visibility. */
export const LAYER_VISIBILITY_VERSION = 24;

/** The schema version that introduced text direction and start/end alignment. */
export const TEXT_DIRECTION_VERSION = 25;

/** The schema version that introduced a run's variable-font coordinates. */
export const FONT_VARIATIONS_VERSION = 26;
/** The schema version that introduced a run's language tag. */
export const RUN_LANGUAGE_VERSION = 27;
/** The schema version that introduced a run's PostScript face name. */
export const POSTSCRIPT_NAME_VERSION = 28;
/** The schema version that introduced a frame child's paint overrides. */
export const FRAME_PAINT_OVERRIDE_VERSION = 29;
/** The schema version that introduced a run's OpenType features. */
export const FONT_FEATURES_VERSION = 30;
/** The schema version that introduced a sticky's aspect, square or wide. */
export const STICKY_ASPECT_VERSION = 31;

/** The schema version that introduced the `freehand` object, the draw tool's stroke. */
export const FREEHAND_VERSION = 32;

/** The schema version that introduced an object's `link` on texts, stickies and images. */
export const LINK_VERSION = 33;

/** The schema version that introduced a run's `link`, a link on a range of text. */
export const RUN_LINK_VERSION = 34;

/** The schema version that introduced an image's `border`. */
export const IMAGE_BORDER_VERSION = 35;

/** The schema version that introduced a connector's `labelPosition`. */
export const CONNECTOR_LABEL_POSITION_VERSION = 36;

/** The schema version that introduced a connector's `elbowMiddle` and `curvePoint`. */
export const CONNECTOR_HANDLES_VERSION = 37;

/**
 * The schema version that introduced a run's `underline` and `strikethrough` and a text's
 * `paragraphs` list styles.
 */
export const TEXT_LISTS_SCHEMA_VERSION = 38;

/**
 * The schema version from which a board may hold `link` objects, link preview cards. No
 * earlier object changes, so its step is the identity.
 */
export const LINK_CARD_VERSION = 39;

/**
 * Tells whether this build can load a document written with a given schema version: any
 * version from 1 up to {@link SCHEMA_VERSION}. Older documents are migrated forward; newer ones
 * come from a newer build and cannot be read.
 *
 * @param version - The schema version recorded in a stored document.
 * @returns `true` when `version` is an integer in [1, {@link SCHEMA_VERSION}].
 */
export function isSupportedSchemaVersion(version: number): boolean {
  return Number.isInteger(version) && version >= 1 && version <= SCHEMA_VERSION;
}
