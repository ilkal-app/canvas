import type * as Y from 'yjs';

import type { StyleId } from '@canvas/schema';

import {
  EFFECT_STYLES_MAP_NAME,
  readStyles,
  TEXT_STYLES_MAP_NAME,
  type StyleKind,
  type StyleTable,
} from '../styles/style-map.js';

import { SealedMap } from './sealed-map.js';

// A store's named style maps and their decoded tables: each kind's table
// is read once per change of its map, as the colour tokens are, and the store's snapshot is told
// when one goes stale.

/** The named style maps of a document. */
export interface StyleSources {
  /** The text styles map. */
  readonly text: Y.Map<unknown>;
  /** The effect styles map. */
  readonly effect: Y.Map<unknown>;
}

/** A document's named style maps, and each kind's table as of the last change. */
export class StyleTables {
  /** The document's two style maps. */
  readonly sources: StyleSources;
  readonly #tables: { text?: StyleTable<'text'>; effect?: StyleTable<'effect'> } = {};
  readonly #staleListeners = new Set<() => void>();
  readonly #changed = new Set<StyleId>();

  /**
   * Opens a document's style maps.
   *
   * @param doc - The document.
   */
  constructor(doc: Y.Doc) {
    this.sources = Object.freeze({
      text: doc.getMap<unknown>(TEXT_STYLES_MAP_NAME),
      effect: doc.getMap<unknown>(EFFECT_STYLES_MAP_NAME),
    });
  }

  /**
   * Calls a listener whenever a table goes stale (the snapshot holding it must be rebuilt).
   *
   * @param listener - The listener.
   */
  onStale(listener: () => void): void {
    this.#staleListeners.add(listener);
  }

  /**
   * Marks a kind's table as changed, to be read again on the next read, and remembers the styles
   * changed until the binding repair takes them ({@link StyleTables.takeChanged}).
   *
   * @param kind - Text or effect styles.
   * @param styleIds - The styles whose keys changed.
   */
  markChanged(kind: StyleKind, styleIds: Iterable<StyleId> = []): void {
    for (const id of styleIds) this.#changed.add(id);
    if (kind === 'text') delete this.#tables.text;
    else delete this.#tables.effect;
    for (const listener of this.#staleListeners) listener();
  }

  /**
   * The styles changed since the last call, of either kind: what the binding repair checks every
   * object naming. Clears them.
   *
   * @returns The style ids.
   */
  takeChanged(): ReadonlySet<StyleId> {
    const changed = new Set(this.#changed);
    this.#changed.clear();
    return changed;
  }

  /**
   * A kind's table as of the last completed transaction, read once per change.
   *
   * @param kind - Text or effect styles.
   * @returns The entries by id, sorted.
   */
  table<Kind extends StyleKind>(kind: Kind): StyleTable<Kind> {
    const cached = this.#tables[kind] as StyleTable<Kind> | undefined;
    if (cached !== undefined) return cached;
    const table = new SealedMap(readStyles(this.sources[kind], kind)) as StyleTable<Kind>;
    if (kind === 'text') this.#tables.text = table as StyleTable<'text'>;
    else this.#tables.effect = table as StyleTable<'effect'>;
    return table;
  }
}
