import { DEFAULT_PAGE } from '../pages/page.js';
import {
  AUTO_LAYOUT_SCHEMA_VERSION,
  FRAME_RADIUS_VERSION,
  INSTANCE_SCALE_VERSION,
  NEGATIVE_GAP_VERSION,
  LAYER_OPACITY_VERSION,
  LAYER_VISIBILITY_VERSION,
  OBJECT_NAME_VERSION,
  SWAP_SCHEMA_VERSION,
  POSTSCRIPT_NAME_VERSION,
  FRAME_PAINT_OVERRIDE_VERSION,
  FONT_FEATURES_VERSION,
  STICKY_ASPECT_VERSION,
  FREEHAND_VERSION,
  LINK_VERSION,
  RUN_LINK_VERSION,
  IMAGE_BORDER_VERSION,
  CONNECTOR_LABEL_POSITION_VERSION,
  CONNECTOR_HANDLES_VERSION,
  TEXT_LISTS_SCHEMA_VERSION,
  LINK_CARD_VERSION,
  RUN_LANGUAGE_VERSION,
  TEXT_DIRECTION_VERSION,
  VARIANTS_SCHEMA_VERSION,
} from '../version/schema-version.js';

import { FONT_VARIATIONS_VERSION, fontVariationsStep } from './font-variations-step.js';
import {
  frameRadiusStep,
  instanceScaleStep,
  layerOpacityStep,
  layerVisibilityStep,
  negativeGapStep,
  fontFeaturesStep,
  stickyAspectStep,
  freehandStep,
  linkStep,
  runLinkStep,
  imageBorderStep,
  connectorLabelPositionStep,
  connectorHandlesStep,
  textListsStep,
  linkCardStep,
  postScriptNameStep,
  framePaintOverrideStep,
  runLanguageStep,
  textDirectionStep,
} from './identity-steps.js';
import type { MigrationRegistry, VersionedDocumentJson } from './migration-step.js';

/** The frame radius version, defined beside `SCHEMA_VERSION`; its step is below. */
export { FRAME_RADIUS_VERSION };

/** The layer opacity version, defined beside `SCHEMA_VERSION`; its step is below. */
export { LAYER_OPACITY_VERSION };

/** The layer visibility version, defined beside `SCHEMA_VERSION`; its step is below. */
export { LAYER_VISIBILITY_VERSION };

/** The text direction version, defined beside `SCHEMA_VERSION`; its step is below. */
export { TEXT_DIRECTION_VERSION };

/** The run language version, defined beside `SCHEMA_VERSION`; its step is below. */
export { RUN_LANGUAGE_VERSION };
/** The PostScript name version, defined beside `SCHEMA_VERSION`; its step is below. */
export {
  POSTSCRIPT_NAME_VERSION,
  FRAME_PAINT_OVERRIDE_VERSION,
  FONT_FEATURES_VERSION,
  STICKY_ASPECT_VERSION,
};

/** The freehand object version, defined beside `SCHEMA_VERSION`; its step is below. */
export { FREEHAND_VERSION };

/** The object link version, defined beside `SCHEMA_VERSION`; its step is below. */
export { LINK_VERSION };

/**
 * The step that produces schema version 1. Version 1 is the first stored shape, so there is
 * nothing to change.
 *
 * @param document - A document to bring to version 1.
 * @returns The same document.
 */
function baselineStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 2. A version 1 fill is a version 2
 * paint (a solid tuple) and a version 1 colour a version 2 inkable colour, so nothing changes.
 *
 * @param document - A version 1 document.
 * @returns The same document.
 */
function paintStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 3: a version 2 board is one
 * page, so the step adds that page (`page-1`, named `Page 1`, at the first key) and names it as
 * the page of every root object (`pageId: 'page-1'`; `null` for an object in a group or frame).
 * Coordinates and ids are unchanged. Pure: entries that are not objects are left as they are.
 *
 * @param document - A version 2 document.
 * @returns A new document with its page and every object's `pageId`.
 */
function pagesStep(document: VersionedDocumentJson): VersionedDocumentJson {
  const objects = Array.isArray(document.objects) ? (document.objects as unknown[]) : undefined;
  return {
    ...document,
    pages: [{ ...DEFAULT_PAGE }],
    ...(objects === undefined
      ? {}
      : {
          objects: objects.map((object) => {
            if (typeof object !== 'object' || object === null || Array.isArray(object)) {
              return object;
            }
            const { parentId } = object as { readonly parentId?: unknown };
            return { ...object, pageId: parentId === null ? DEFAULT_PAGE.id : null };
          }),
        }),
  };
}

/**
 * Adds the component vocabulary without rewriting existing objects or adding default keys.
 *
 * @param document - A version 3 document.
 * @returns The same document; every old object remains valid in version 4.
 */
function componentsStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 5: override records gain the optional
 * `textStyle` and `runs`, and every version 4 record keeps its meaning, so nothing changes.
 *
 * @param document - A version 4 document.
 * @returns The same document.
 */
function textOverrideStyleStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 6: a frame may store `showName`. A frame
 * without it keeps the default (`isFrameNameShown`), so nothing is written.
 *
 * @param document - A version 5 document.
 * @returns The same document.
 */
function frameNameStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 7: a text style may store `letterSpacing` and
 * `lineHeight`. A run without them keeps none and auto, so nothing is written.
 *
 * @param document - A version 6 document.
 * @returns The same document.
 */
function textSpacingStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 8: a text style's weight may be any of the nine
 * CSS weights, not only 400 and 700. Every version 7 weight is one of them, so nothing changes.
 *
 * @param document - A version 7 document.
 * @returns The same document.
 */
function fontWeightsStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 9: a shape's fill and a frame's background may
 * be an image paint. Every version 8 paint keeps its meaning, so nothing changes.
 *
 * @param document - A version 8 document.
 * @returns The same document.
 */
function imagePaintStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the auto-layout schema version: frames and mains may store a
 * live `autoLayout`, objects a `layoutChild`, instances `isWidthFixed` and `isHeightFixed`, and
 * text overrides a `measuredSize`. A document without them keeps no auto-layout, so nothing is
 * written.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
function autoLayoutStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 11: colours may name tokens, containers may set
 * `colorMode`, and a board may carry a token table. Every version 10 value keeps its meaning and
 * no table means the built-ins at their defaults, so nothing is written.
 *
 * @param document - A version 10 document.
 * @returns The same document.
 */
function colorTokensStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the variants schema version: a main may define variant axes
 * and presets, and an instance or a nested instance's override record a selection. A document
 * without them has no variants, so nothing is written.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
function variantsStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the swap schema version: an override record may swap a nested
 * instance's main, and an instance inside a main may list its slot's allowed mains. A document
 * without them swaps nothing, so nothing is written.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
function swapStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the stroke style version: a path, line or connector may
 * store `strokeDash`, `strokeJoin`, `strokeMiterLimit` and `strokeCap`. An object without them
 * draws as before (solid, round joins and ends), so nothing is written. Registered under
 * {@link STROKE_STYLE_VERSION}, so a rebase onto another step renumbers it in one place.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
function strokeStyleStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/** The schema version {@link strokeStyleStep} produces. */
export const STROKE_STYLE_VERSION = 14;

/**
 * The step that produces the drop shadow version: a shape or frame may store a drop
 * `shadow`. An object without one draws none, so nothing is written. Registered under
 * {@link DROP_SHADOW_VERSION}, so a rebase onto another step renumbers it in one place.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
function dropShadowStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/** The schema version {@link dropShadowStep} produces. */
export const DROP_SHADOW_VERSION = 15;

/**
 * The step that produces the stroke alignment version: a shape or frame may store
 * `strokeAlign`, and a frame a `stroke`. A shape without an alignment keeps its outline inside
 * its edge and a frame without a stroke draws none, so nothing is written. Registered under
 * {@link STROKE_ALIGN_VERSION}, so a rebase onto another step renumbers it in one place.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
function strokeAlignStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/** The schema version {@link strokeAlignStep} produces. */
export const STROKE_ALIGN_VERSION = 16;

/**
 * The step that produces the preset geometry version: an override record may carry a
 * child's `x`, `y`, `width` and `height`, an auto-layout container's `autoLayout` patch, and at the
 * main's own id a variant's size. A record without them changes no geometry, so nothing is
 * written. Registered under {@link PRESET_GEOMETRY_SCHEMA_VERSION}, so a rebase renumbers it in
 * one place.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
function presetGeometryStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The schema version whose override records may carry geometry and an auto-layout patch;
 * its migration step is the identity.
 */
export const PRESET_GEOMETRY_SCHEMA_VERSION = 17;

/**
 * The step that produces the object name version: every object may store a layer
 * `name`. An object without one is unnamed, as every non-frame object was, so nothing is written.
 * Registered under {@link OBJECT_NAME_VERSION}, so a rebase onto another step renumbers it in one
 * place.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
function objectNameStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the named styles version: a board may hold
 * text and effect styles, a run may name a text style (`textStyleId`), a shape or frame an
 * effect style (`effectStyleId`), and a shape's or frame's `shadow` may be a list of layers. An
 * object of the version before names no style and has one shadow at most, so nothing is written.
 * Registered under {@link NAMED_STYLES_VERSION}, so a rebase onto another step renumbers it in
 * one place.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
function namedStylesStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/** The schema version {@link namedStylesStep} produces. */
export const NAMED_STYLES_VERSION = 19;

/**
 * The migration steps of this build, keyed by the schema version each produces (see
 * `SCHEMA_VERSION`). Version 1's step is the identity; it is there so that every version from 1
 * to `SCHEMA_VERSION` has a step, which a test enforces. When the stored shape changes:
 * increment `SCHEMA_VERSION`, add the step that produces the new version here, and test it on a
 * fixture document of the previous version.
 */
export const MIGRATIONS: MigrationRegistry = new Map([
  [1, baselineStep],
  [2, paintStep],
  [3, pagesStep],
  [4, componentsStep],
  [5, textOverrideStyleStep],
  [6, frameNameStep],
  [7, textSpacingStep],
  [8, fontWeightsStep],
  [9, imagePaintStep],
  [AUTO_LAYOUT_SCHEMA_VERSION, autoLayoutStep],
  [11, colorTokensStep],
  [VARIANTS_SCHEMA_VERSION, variantsStep],
  [SWAP_SCHEMA_VERSION, swapStep],
  [STROKE_STYLE_VERSION, strokeStyleStep],
  [DROP_SHADOW_VERSION, dropShadowStep],
  [STROKE_ALIGN_VERSION, strokeAlignStep],
  [PRESET_GEOMETRY_SCHEMA_VERSION, presetGeometryStep],
  [OBJECT_NAME_VERSION, objectNameStep],
  [NAMED_STYLES_VERSION, namedStylesStep],
  [FRAME_RADIUS_VERSION, frameRadiusStep],
  [NEGATIVE_GAP_VERSION, negativeGapStep],
  [INSTANCE_SCALE_VERSION, instanceScaleStep],
  [LAYER_OPACITY_VERSION, layerOpacityStep],
  [LAYER_VISIBILITY_VERSION, layerVisibilityStep],
  [TEXT_DIRECTION_VERSION, textDirectionStep],
  [FONT_VARIATIONS_VERSION, fontVariationsStep],
  [RUN_LANGUAGE_VERSION, runLanguageStep],
  [POSTSCRIPT_NAME_VERSION, postScriptNameStep],
  [FRAME_PAINT_OVERRIDE_VERSION, framePaintOverrideStep],
  [FONT_FEATURES_VERSION, fontFeaturesStep],
  [STICKY_ASPECT_VERSION, stickyAspectStep],
  [FREEHAND_VERSION, freehandStep],
  [LINK_VERSION, linkStep],
  [RUN_LINK_VERSION, runLinkStep],
  [IMAGE_BORDER_VERSION, imageBorderStep],
  [CONNECTOR_LABEL_POSITION_VERSION, connectorLabelPositionStep],
  [CONNECTOR_HANDLES_VERSION, connectorHandlesStep],
  [TEXT_LISTS_SCHEMA_VERSION, textListsStep],
  [LINK_CARD_VERSION, linkCardStep],
]);
