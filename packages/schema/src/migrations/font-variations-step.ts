import { FONT_VARIATIONS_VERSION } from '../version/schema-version.js';

import type { VersionedDocumentJson } from './migration-step.js';

/** The font variations version, defined beside `SCHEMA_VERSION`; its step is below. */
export { FONT_VARIATIONS_VERSION };

/**
 * The step that produces the font variations version: a run's text style, and a board
 * text style's value, may store `fontVariations`. Without one a run draws its font's defaults,
 * which is how every earlier run drew, so nothing is written. Registered under
 * {@link FONT_VARIATIONS_VERSION}.
 *
 * @param document - A document of the version before.
 * @returns The same document.
 */
export function fontVariationsStep(document: VersionedDocumentJson): VersionedDocumentJson {
  return document;
}
