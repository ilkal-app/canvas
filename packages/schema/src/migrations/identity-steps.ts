// The identity migration steps from schema 20 on (onward): each lets an object store an
// optional field whose absence is the old behaviour, so nothing is written. Kept apart from the
// registry (`migration-registry.ts`), which lists them, to keep that file short.

import type { VersionedDocumentJson } from './migration-step.js';

/**
 * The step that produces the frame radius version: a frame may store `cornerRadius`,
 * one radius or four. A frame without one keeps sharp corners, so nothing is written. Registered
 * under `FRAME_RADIUS_VERSION`, so a rebase onto another step renumbers it in one place.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function frameRadiusStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the negative gap version: an auto-layout's `gap` may be
 * negative, overlapping its children. Every gap of the version before is zero or more, so nothing
 * is written. Registered under `NEGATIVE_GAP_VERSION`, so a rebase renumbers it in one place.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function negativeGapStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the instance scale version: an instance may store a content
 * `scale`. An instance without one draws its content at its main's size, so nothing is written.
 * Registered under `INSTANCE_SCALE_VERSION`, so a rebase renumbers it in one place.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function instanceScaleStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the layer opacity version: text, a sticky, shape, line,
 * connector, path, group, frame, main or instance may store `opacity`, and an override record a
 * child's. An object without one is opaque, so nothing is written. Registered under
 * `LAYER_OPACITY_VERSION`, so a rebase onto another step renumbers it in one place.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function layerOpacityStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the layer visibility version: every layer but a comment may
 * store `isHidden`. An object without one is shown, so nothing is written. Registered under
 * `LAYER_VISIBILITY_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function layerVisibilityStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the text direction version: a text object or sticky may store
 * `direction`, and `align` may be `start` or `end`. Without a direction a text is `auto`, which
 * is how every earlier text laid out, so nothing is written. Registered under
 * `TEXT_DIRECTION_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function textDirectionStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the run language version: a run's text style, and an override
 * record's, may store `lang`. A run without one has no language, as every earlier run, so nothing
 * is written. Registered under `RUN_LANGUAGE_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function runLanguageStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the PostScript name version: a run's text style, a board text
 * style's value and an override record's text style may store `postScriptName`. A run without one
 * chooses its face by family, weight and italic, as every earlier run, so nothing is written.
 * Registered under `POSTSCRIPT_NAME_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function postScriptNameStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the frame paint override version: an override record may give a
 * frame child `fill` and `strokeColor`. A record without them leaves the frame as its main draws
 * it, as every earlier record, so nothing is written. Registered under
 * `FRAME_PAINT_OVERRIDE_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function framePaintOverrideStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the font features version: a run's text style, a board text
 * style's value and an override record's text style may store `fontFeatures`. A run without them
 * shapes with the defaults, as every earlier run, so nothing is written. Registered under
 * `FONT_FEATURES_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function fontFeaturesStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces the sticky aspect version: a sticky may store `aspect`. A
 * sticky without one is square, as every earlier sticky, so nothing is written. Registered under
 * `STICKY_ASPECT_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function stickyAspectStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 32: a board may hold `freehand` objects, the
 * draw tool's strokes. A version 31 board holds none, so nothing is written. Registered under
 * `FREEHAND_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function freehandStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 33: a text, a sticky and an image may store a
 * `link`. A version 32 object has none, so every one is valid as it is. Registered under
 * `LINK_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function linkStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 34: a run's text style may store a `link`. A
 * version 33 run has none, so every one is valid as it is. Registered under `RUN_LINK_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function runLinkStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 35: an image may store a `border`. A version 34
 * image has none, so every one is valid as it is. Registered under `IMAGE_BORDER_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function imageBorderStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 36: a connector may store a `labelPosition`. A
 * version 35 connector has none, its label at the midpoint, so every one is valid as it is.
 * Registered under `CONNECTOR_LABEL_POSITION_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function connectorLabelPositionStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 37: a connector may store an `elbowMiddle` and a
 * `curvePoint`. A version 36 connector has neither and routes automatically, so every one is valid
 * as it is. Registered under `CONNECTOR_HANDLES_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function connectorHandlesStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 38: a run's style may store `underline` and
 * `strikethrough`, and a text, sticky or label may store `paragraphs`. A version 37 text has
 * none of them, so every one is valid as it is, every paragraph plain. Registered under
 * `TEXT_LISTS_SCHEMA_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function textListsStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}

/**
 * The step that produces schema version 39: a board may hold `link` objects, link
 * preview cards. A version 38 board holds none, so nothing is written. Registered under
 * `LINK_CARD_VERSION`.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function linkCardStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}
