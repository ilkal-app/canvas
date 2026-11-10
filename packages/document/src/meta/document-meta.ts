import { SCHEMA_VERSION } from '@canvas/schema';

// A board document says which schema and which stored layout it was written in, in
// a top-level `Y.Map` beside its objects, so a client can refuse a document it cannot read
// instead of misreading it. The layout is how the codec lays objects out in Yjs
// (`codec/object-layout.ts`); it changes only with a migration the relay runs.

/**
 * The stored layout this build writes (see the README's "Changing the stored layout"):
 *
 * - 1: the grouped-field layout with one `placement` group, a line's two
 *   points under one `points` key.
 * - 2: as 1, with each line end under its own key, `points.0` and `points.1`.
 * - 3: as 2, with a shape's or path's `fill` and a frame's `background` either an `Rgba` tuple or
 *   a gradient object, and a stroke's or text's `color` either an `Rgba` tuple or
 *   `'ink'`.
 * - 4: as 3 (gradient fills, `ink`), with a root object's page in its `placement` group and the
 *   board's pages in the top-level map `pages`.
 * - 5: component definitions and leaf instances with immutable `mainId`, per-path override
 *   maps, and own-key `retired` and optional `constraints` fields.
 * - 6: as 5, with an override record that may hold `textStyle` (a partial text style) and
 *   `runs` beside `text`. A layout 5 reader ignores such a record whole and refuses to
 *   write one, so it is gated off a board this build has written.
 * - 7: as 6, with a shape's `fill` or a frame's `background` that may be an image paint,
 *   `{ type: 'image', assetId, naturalSize, fit, crop }`. A layout 6 reader would read
 *   one as no fill, so it is gated off a board this build has written.
 * - 8: as 7, with a frame's or main's `autoLayout` in its `style` group, a box's `layoutChild` and
 *   an instance's `isWidthFixed`/`isHeightFixed` in its `size` group, and a text override's
 *   `measuredSize`. No key is added: a layout 7 reader reads such an object, but
 *   decodes only the group fields it knows and rewrites a whole group on a resize or restyle,
 *   which would erase the new fields; so it is gated off a board this build has written.
 * - 9: as 8, with board colour tokens: the top-level map `tokens`
 *   (`<id>.identity|name|light|dark`), a colour that may be a token reference `{ token }` in a
 *   fill, background, stroke, sticky colour, text attribute or override record, and a frame's,
 *   main's or instance's `colorMode` in its `style` group. A layout 8 reader draws a token as no
 *   fill and refuses to write a token reference back, so it is gated off a board this build has
 *   written.
 * - 10: as 9, with a main's `variantAxes` in its `style` group and its `variantPresets` under their
 *   own key (a `Y.Map` from `axis=value` to an override map), an instance's `variant` under its
 *   own key, and a nested selection, `variant`, inside an override record. A layout 9
 *   reader would rewrite a main's style group without the axes and resolve instances without
 *   their presets; so it is gated off a board this build has written.
 * - 11: as 10, with a slot's `swapOptions` under its own key and a swapped-in main, `mainId`,
 *   inside an override record. A layout 10 reader parses each record with its strict
 *   schema and would ignore a swap whole, rendering the slot's stored main, and refuse to write
 *   such a record back; so it is gated off a board this build has written.
 * - 12: as 11, with a path's, line's or connector's stroke style (`strokeDash`, `strokeJoin`,
 *   `strokeMiterLimit`, `strokeCap`) and a shape's or frame's drop `shadow` in its `style` group.
 * No key is added: a layout 11 reader reads such an object, but decodes only the
 *   style fields it knows and rewrites the whole group on a restyle, which would erase them; so it
 *   is gated off a board this build has written. The stroke style first shipped at layout 11;
 * boards no layout 12 build has written may carry it unprotected.
 * - 13: as 12, with a shape's or frame's `strokeAlign` and a frame's `stroke` in its `style` group.
 * No key is added: a layout 12 reader rewrites the whole group on a restyle and
 *   would erase them; so it is gated off a board this build has written.
 * - 14: as 13, with geometry (`x`, `y`, `width`, `height`) and an `autoLayout` patch in override
 *   records (`PRESET_GEOMETRY_LAYOUT_VERSION`); an older reader parses a record strictly
 *   and would drop or refuse them; so it is gated off a board this build has written.
 * - 15: as 14, with any object's layer `name` in its `style` group, as a frame's and a
 *   main's already were; a group gains an optional `style` key the first time it is named. A
 *   layout 14 reader refuses a name on any other type (objects are strict) and rewrites the whole
 *   group on a restyle; so it is gated off a board this build has written.
 * - 16: as 15, with the board's named styles: the top-level maps
 *   `textStyles` and `effectStyles` (`<id>.identity|name|value`), a run's `textStyleId` text
 *   attribute, and a shape's or frame's `effectStyleId` and a `shadow` that may be a list of
 *   layers in its `style` group. A layout 15 reader refuses a list shadow and rewrites the whole
 *   style group and a run's attributes without the ids on a restyle; so it is gated off a board
 *   this build has written.
 * - 17: as 16, with a frame's `cornerRadius` (one radius or four) in its `style` group.
 *   No key is added: a layout 16 reader rewrites the whole group on a restyle and would erase it;
 *   so it is gated off a board this build has written.
 * - 18: as 17, with an auto-layout's `gap` that may be negative, in a frame's or main's
 *   `style` group and in an override record's `autoLayout` patch. A layout 17 reader refuses a
 *   negative gap (its schema floors it at 0); so it is gated off a board this build has written.
 * - 19: as 18, with an instance's content `scale` in its `size` group. No key is added:
 *   a layout 18 reader refuses it (objects are strict) and rewrites the whole group on a resize,
 *   which would erase it; so it is gated off a board this build has written.
 * - 20: as 19, with a layer `opacity` in the `style` group of text, a sticky, shape, line,
 *   connector, path, group, frame, main or instance, and an `opacity` in an override
 *   record; a group or instance gains an optional `style` key the first time it is given one. A
 *   layout 19 reader refuses the field (objects and records are strict) and rewrites the whole
 *   group on a restyle, erasing it; so it is gated off a board this build has written.
 * - 21: as 20, with a layer's `isHidden` in its `style` group, on every type but a comment;
 * an image or video gains an optional `style` key the first time it is hidden. A
 *   layout 20 reader refuses the field (objects are strict) and rewrites the whole group on a
 *   restyle, erasing it; so it is gated off a board this build has written.
 * - 22: as 21, with a text's or sticky's `direction` in its `style` group and an `align` that may
 *   be `start` or `end`. A layout 21 reader refuses both (objects are strict, and its
 *   align has three values) and rewrites the whole group on a restyle, erasing the direction; so
 *   it is gated off a board this build has written.
 * - 23: as 22, with a run's `fontVariations` text attribute, its variable-font axis coordinates
 *   in one record, and the same field in a board text style's value and a text override's
 *   `textStyle`. A layout 22 reader drops the attribute when it reads a run and
 *   refuses a style that carries it (text styles are strict), so a copy, an override or a board
 *   text style written by it loses the coordinates; so it is gated off a board this build has
 *   written.
 * - 24: as 23, with a run's `lang` attribute in a text's `Y.Text` and in an override record's text
 *   style. A layout 23 reader refuses it (text styles are strict) and drops it when it
 *   rewrites a range's style; so it is gated off a board this build has written.
 * - 25: as 24, with a run's `postScriptName` attribute in a text's `Y.Text`, in an override
 *   record's text style and in a board text style's value. A layout 24 reader refuses it
 *   (text styles are strict) and drops it when it rewrites a range's style; so it is gated off a
 *   board this build has written.
 * - 26: as 25, with an override record that gives a frame child `fill` or `strokeColor`.
 * A layout 25 reader refuses such a record (a frame takes neither there); so it is
 *   gated off a board this build has written.
 * - 27: as 26, with a run's `fontFeatures` attribute in a text's `Y.Text`, in an override record's
 *   text style and in a board text style's value. A layout 26 reader refuses it (text
 *   styles are strict) and drops it when it rewrites a range's style; so it is gated off a board
 *   this build has written.
 * - 28: as 27, with a sticky's `aspect` in its style group. A layout 27 reader refuses
 *   it (a sticky takes no such field there) and erases it on a whole-group rewrite; so it is gated
 *   off a board this build has written.
 * - 29: as 28, with `freehand` objects, the draw tool's strokes, whose `points` and
 *   `pressures` are stored under the keys `strokePoints` and `strokePressures`. A layout 28 reader knows no such type and would
 *   lose the strokes from its view; so it is gated off a board this build has written.
 * - 30: as 29, with a text's, a sticky's and an image's `link` in its style group. A
 *   layout 29 reader refuses it (those types take no such field there) and erases it on a
 *   whole-group rewrite; so it is gated off a board this build has written.
 * - 31: as 30, with a run's `link` attribute in a text's `Y.Text`. A layout 30 reader
 *   drops it on read and does not clear it when it rewrites a range's style, so it is gated off a
 *   board this build has written.
 * - 32: as 31, with an image's `border` in its style group. A layout 31 reader refuses
 *   it (an image takes no such field there) and erases it on a whole-group rewrite; so it is
 *   gated off a board this build has written.
 * - 33: as 32, with a connector's `labelPosition` in its style group. A layout 32 reader
 *   refuses it (a connector takes no such field there) and erases it on a whole-group rewrite; so
 *   it is gated off a board this build has written.
 * - 34: as 33, with a connector's `elbowMiddle` and `curvePoint` in its style group. A
 *   layout 33 reader refuses them (a connector takes no such fields there) and erases them on a
 *   whole-group rewrite; so they are gated off a board this build has written.
 * - 35: as 34, with a run's `underline` and `strikethrough` attributes in a text's `Y.Text`, each
 *   paragraph's list style as a `paragraph` attribute on the `'\n'` that ends it, and the last
 *   paragraph's under `lastParagraph` beside the `Y.Text`. A layout 34 reader drops them
 *   on read and does not clear them when it rewrites a range's style; so they are gated off a
 *   board this build has written.
 * - 36: as 35, with `link` objects, link preview cards, whose preview fields (`title`,
 *   `description`, `siteName`, `imageAssetId`, `faviconAssetId`, `status`, `unfurlKey`) each have
 *   a key of their own. A layout 35 reader knows no such type and would lose the cards from its
 *   view; so it is gated off a board this build has written.
 *
 * Documents from before carry no version at all.
 */
export const DOCUMENT_LAYOUT_VERSION = 36;

/** The stored layout that introduced component variants. */
export const VARIANTS_LAYOUT_VERSION = 10;

/** The stored layout that introduced instance swap. */
export const SWAP_LAYOUT_VERSION = 11;

/** The stored layout that gates stroke styles and drop shadows. */
export const STROKE_STYLE_SHADOW_LAYOUT_VERSION = 12;

/** The stored layout that gates stroke alignment and a frame's stroke. */
export const STROKE_ALIGN_LAYOUT_VERSION = 13;

/** The stored layout that gates named text and effect styles. */
export const NAMED_STYLES_LAYOUT_VERSION = 16;

/**
 * The stored layout that gates geometry in override records: an older reader parses a
 * record strictly, so it would drop or refuse a preset's `x`, `y`, `width`, `height` or
 * `autoLayout`; the relay keeps such readers off a board written at this layout.
 */
export const PRESET_GEOMETRY_LAYOUT_VERSION = 14;

/** The stored layout that gates a layer `name` on every object type. */
export const OBJECT_NAME_LAYOUT_VERSION = 15;

/** The stored layout that gates a frame's corner radius. */
export const FRAME_RADIUS_LAYOUT_VERSION = 17;

/** The stored layout that gates a negative auto-layout gap. */
export const NEGATIVE_GAP_LAYOUT_VERSION = 18;

/** The stored layout that gates an instance's content scale. */
export const INSTANCE_SCALE_LAYOUT_VERSION = 19;

/** The stored layout that gates a layer's opacity. */
export const LAYER_OPACITY_LAYOUT_VERSION = 20;

/** The stored layout that gates a layer's visibility. */
export const LAYER_VISIBILITY_LAYOUT_VERSION = 21;

/** The stored layout that gates a text's direction and start/end alignment. */
export const TEXT_DIRECTION_LAYOUT_VERSION = 22;

/** The stored layout that gates a run's variable-font coordinates. */
export const FONT_VARIATIONS_LAYOUT_VERSION = 23;
/** The stored layout that gates a run's language tag. */
export const RUN_LANGUAGE_LAYOUT_VERSION = 24;
/** The stored layout that gates a run's PostScript face name. */
export const POSTSCRIPT_NAME_LAYOUT_VERSION = 25;
/** The stored layout that gates a frame child's paint overrides. */
export const FRAME_PAINT_OVERRIDE_LAYOUT_VERSION = 26;
/** The stored layout that gates a run's OpenType features. */
export const FONT_FEATURES_LAYOUT_VERSION = 27;
/** The stored layout that gates a sticky's aspect, square or wide. */
export const STICKY_ASPECT_LAYOUT_VERSION = 28;
/** The stored layout that introduced the `freehand` object, the draw tool's stroke. */
export const FREEHAND_LAYOUT_VERSION = 29;

/** The stored layout that gates a text's, a sticky's and an image's `link`. */
export const LINK_LAYOUT_VERSION = 30;

/** The stored layout that gates a run's `link`, a link on a range of text. */
export const RUN_LINK_LAYOUT_VERSION = 31;

/** The stored layout that gates an image's `border`. */
export const IMAGE_BORDER_LAYOUT_VERSION = 32;

/** The stored layout that gates a connector's `labelPosition`. */
export const CONNECTOR_LABEL_POSITION_LAYOUT_VERSION = 33;

/** The stored layout that gates a connector's `elbowMiddle` and `curvePoint`. */
export const CONNECTOR_HANDLES_LAYOUT_VERSION = 34;

/**
 * The stored layout that gates a run's `underline` and `strikethrough` and a text's paragraph
 * list styles.
 */
export const TEXT_LISTS_LAYOUT_VERSION = 35;

/** The stored layout that introduced the `link` object, the link preview card. */
export const LINK_CARD_LAYOUT_VERSION = 36;

/**
 * The first stored layout that reads an image paint: the relay admits one
 * only on a board whose layout after the update is at least this, so every reader still
 * connected reads it.
 */
export const IMAGE_PAINT_LAYOUT_VERSION = 7;

/**
 * The stored layouts this build reads; a document in any other is refused on load. It reads 1
 * too: a line end without its own key is read from the old `points` pair (`codec/pair-codec.ts`).
 * It reads 2 unchanged: a stored tuple is a solid paint and a plain colour. It reads 3 unchanged:
 * a placement without `pageId` is on `page-1` (a root object) or its parent's page, and a board
 * without stored pages has the virtual Page 1 (`codec/placement-page.ts`, `pages/page-map.ts`).
 * Layout 4 objects remain unchanged: absent constraints mean start/start. It reads 5 unchanged:
 * every layout 5 override record is a layout 6 record. It reads 6 unchanged: every layout 6 paint
 * is a layout 7 paint. It reads 7 unchanged: a layout 7 object is a layout 8 object without the
 * auto-layout fields. It reads 8 unchanged: a board without a `tokens` map has the
 * built-ins at their defaults, and no colour of it names a token. It reads 9 unchanged:
 * a layout 9 object is a layout 10 object without variants. It reads 10 unchanged: a
 * layout 10 object is a layout 11 object that swaps nothing. It reads 11 unchanged: a
 * layout 11 object is a layout 12 object whose style group may lack a stroke style or a shadow.
 * It reads 12 unchanged: a layout 12 object is a layout 13 object without a stroke
 * alignment or a frame stroke. It reads 13 unchanged: a layout 13 record is a layout
 * 14 record without geometry. It reads 14 unchanged: a layout 14 object is a layout 15
 * object without a layer name unless it is a frame or main. It reads 15
 * unchanged: a board without the style maps has no named styles, and no object of it names one.
 * It reads 16 unchanged: a layout 16 object is a layout 17 object whose frames have
 * sharp corners. It reads 17 unchanged: every layout 17 gap is zero or more.
 * It reads 18 unchanged: a layout 18 instance is a layout 19 instance at its main's size.
 * It reads 19 unchanged: a layout 19 object is a layout 20 object whose layers are opaque.
 * It reads 20 unchanged: a layout 20 object is a layout 21 object whose layers are shown.
 * It reads 21 unchanged: a layout 21 text is a layout 22 text of auto direction.
 * It reads 22 unchanged: a layout 22 run is a layout 23 run at its font's default
 * coordinates. It reads 23 unchanged: a layout 23 run is a layout 24 run without a
 * language. It reads 24 unchanged: a layout 24 run is a layout 25 run that names no face.
 * It reads 25 unchanged: a layout 25 record is a layout 26 record that leaves its frames'
 * paint alone. It reads 26 unchanged: a layout 26 run is a layout 27 run with the default
 * features. It reads 27 unchanged: a layout 27 sticky is a layout 28 sticky that is
 * square. It reads 28 unchanged: a layout 28 board is a layout 29
 * board without freehand strokes. It reads 29 unchanged: a layout 29 object is a layout
 * 30 object without a link. It reads 30 unchanged: a layout 30 run is a layout 31 run
 * without a link. It reads 31 unchanged: a layout 31 image is a layout 32 image without
 * a border. It reads 32 unchanged: a layout 32 connector is a layout 33 connector with
 * its label at the midpoint. It reads 33 unchanged: a layout 33 connector is a layout 34
 * connector routed automatically. It reads 34 unchanged: a layout 34 text is a layout 35
 * text with no underline, strikethrough or list. It reads 35 unchanged: a layout 35 board
 * is a layout 36 board without link cards. The first write of this build stamps an older board with {@link DOCUMENT_LAYOUT_VERSION},
 * after which the relay refuses builds that do not read it.
 */
export const READABLE_LAYOUT_VERSIONS: readonly number[] = Object.freeze([
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  21,
  22,
  23,
  24,
  25,
  26,
  27,
  28,
  29,
  30,
  31,
  32,
  33,
  34,
  35,
  DOCUMENT_LAYOUT_VERSION,
]);

/** The name of the document's top-level `Y.Map` holding its metadata. */
export const META_MAP_NAME = 'meta';

/** The key of the metadata inside {@link META_MAP_NAME}. */
export const DOCUMENT_META_KEY = 'document';

/** Metadata a board document stores beside its objects. */
export interface DocumentMeta {
  /** The schema version the document's objects are written in. */
  readonly schemaVersion: number;
  /** The stored layout of its objects ({@link DOCUMENT_LAYOUT_VERSION}). */
  readonly layoutVersion: number;
}

/**
 * Creates the metadata of a document written by this build: the current schema version and
 * stored layout.
 *
 * @returns Frozen metadata; a new object on every call.
 */
export function createDocumentMeta(): DocumentMeta {
  return Object.freeze({ schemaVersion: SCHEMA_VERSION, layoutVersion: DOCUMENT_LAYOUT_VERSION });
}

/**
 * Tells whether a stored value is document metadata this build can read.
 *
 * @param value - The value stored under {@link DOCUMENT_META_KEY}, from any peer.
 * @returns `true` for metadata with a readable layout and a schema version no newer than this
 *   build's.
 */
export function isReadableMeta(value: unknown): value is DocumentMeta {
  if (typeof value !== 'object' || value === null) return false;
  const { schemaVersion, layoutVersion } = value as Readonly<Record<string, unknown>>;
  return (
    typeof schemaVersion === 'number' &&
    schemaVersion <= SCHEMA_VERSION &&
    typeof layoutVersion === 'number' &&
    READABLE_LAYOUT_VERSIONS.includes(layoutVersion)
  );
}
