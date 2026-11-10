import type { DocumentStore } from '@canvas/document';
import { hitPaletteOf, type HitPointOptions, type SpatialSearch } from '@canvas/engine';
import { createSelectHitTester, type SelectHitTester, type SelectionSource } from '@canvas/tools';

import { windowPixelRatio } from '../canvas/window-pixel-ratio.js';

import type { EngineDocumentOptions } from './engine-document-types.js';

/** The select tool's hit tester and the palettes its picks resolve colour tokens in. */
export interface DocumentHitTesting {
  /** The select tool's hit tester over the document. */
  readonly hitTester: SelectHitTester;
  /** What an object's colour tokens resolve in, for other picks (a connector's target). */
  readonly paletteOf: NonNullable<HitPointOptions['paletteOf']>;
}

/**
 * The select tool's hit tester over the document, at the window's pixel ratio, picking colour
 * tokens as the renderer draws them: the board's token values in each object's
 * effective mode, else the viewer's theme, so a token fill transparent in its mode is no fill.
 *
 * @param hits - The hit-test index.
 * @param hits.index - The spatial index over the objects' world boxes.
 * @param hits.usePalette - Takes the palettes for the index's own point lookup (`idsAt`).
 * @param source - The document as the index holds it (connectors placed).
 * @param store - The document, for its token values.
 * @param options - The viewer's theme (`creationInk`); the light theme when absent.
 * @returns The hit tester and the palettes.
 */
export function documentHitTester(
  hits: {
    readonly index: SpatialSearch;
    readonly usePalette?: (paletteOf: NonNullable<HitPointOptions['paletteOf']>) => void;
  },
  source: SelectionSource,
  store: Pick<DocumentStore, 'readTokens'>,
  options: Pick<EngineDocumentOptions, 'creationInk'>,
): DocumentHitTesting {
  const paletteOf = hitPaletteOf(source, {
    tokens: () => store.readTokens(),
    theme: () => options.creationInk?.theme() ?? 'light',
  });
  const hitTester = createSelectHitTester(hits.index, source, windowPixelRatio, paletteOf);
  // The index's own point lookup (`idsAt`, a ⌘-click's link) reads the same colours.
  hits.usePalette?.(paletteOf);
  return { hitTester, paletteOf };
}
