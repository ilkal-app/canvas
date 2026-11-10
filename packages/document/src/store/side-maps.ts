import type * as Y from 'yjs';

import { BoardTimerEvents } from '../facilitation/board-timer-events.js';
import { StickyAuthorsEvents } from '../facilitation/sticky-authors-events.js';
import { FACILITATION_MAP_NAME } from '../facilitation/timer-map.js';
import { PAGES_MAP_NAME } from '../pages/page-map.js';
import { TOKENS_MAP_NAME } from '../tokens/token-map.js';

import { StyleTables } from './style-tables.js';

// The top-level maps of a store's document beside its objects: pages, colour tokens,
// named styles and facilitation, opened once and handed together to the store's cache,
// transactions and change events.

/** The document and the maps beside its objects that a store's page events observe. */
export interface SideMaps {
  /** The document. */
  readonly doc: Y.Doc;
  /** The pages map. */
  readonly pages: Y.Map<unknown>;
  /** The colour tokens map. */
  readonly tokens: Y.Map<unknown>;
  /** The text styles map. */
  readonly textStyles: Y.Map<unknown>;
  /** The effect styles map. */
  readonly effectStyles: Y.Map<unknown>;
  /** The facilitation map: the board timer and the sticky author setting. */
  readonly facilitation: Y.Map<unknown>;
}

/** A store's side maps, with the named styles' decoded tables. */
export interface StoreSide extends SideMaps {
  /** The named style maps and their decoded tables. */
  readonly styles: StyleTables;
  /** The board timer, decoded, and its listeners. */
  readonly timer: BoardTimerEvents;
  /** The board's sticky author setting and its listeners. */
  readonly stickyAuthors: StickyAuthorsEvents;
}

/**
 * Opens a document's side maps.
 *
 * @param doc - The document.
 * @returns The maps.
 */
export function openSide(doc: Y.Doc): StoreSide {
  const styles = new StyleTables(doc);
  const facilitation = doc.getMap<unknown>(FACILITATION_MAP_NAME);
  return Object.freeze({
    doc,
    pages: doc.getMap<unknown>(PAGES_MAP_NAME),
    tokens: doc.getMap<unknown>(TOKENS_MAP_NAME),
    textStyles: styles.sources.text,
    effectStyles: styles.sources.effect,
    facilitation,
    styles,
    timer: new BoardTimerEvents(facilitation),
    stickyAuthors: new StickyAuthorsEvents(facilitation),
  });
}
