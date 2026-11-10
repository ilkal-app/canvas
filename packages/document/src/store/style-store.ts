import type { EffectStyleTable, StyleId, TextStyleTable } from '@canvas/schema';

import type { StyleCreation, StyleKind, StyleTable, StyleWrite } from '../styles/style-map.js';

// The named styles' part of the store's interfaces: what a store reads,
// what a transaction writes and what a change set reports. `DocumentStore`, `DocumentTransaction`
// and `ChangeSet` extend these.

/** A store's reads of its named styles. */
export interface NamedStyleReads {
  /**
   * The board's named text styles, as of the last completed transaction: `read().textStyles`,
   * without building the snapshot of the objects.
   *
   * @returns The entries by id, sorted.
   */
  readTextStyles(): TextStyleTable;
  /**
   * The board's named effect styles, as of the last completed transaction:
   * `read().effectStyles`, without building the snapshot of the objects.
   *
   * @returns The entries by id, sorted.
   */
  readEffectStyles(): EffectStyleTable;
}

/** A transaction's reads and writes of the named styles. */
export interface NamedStyleWrites {
  /**
   * A kind's named style table as of now inside this transaction (its own style writes
   * included).
   *
   * @param kind - Text or effect styles.
   * @returns The entries by id.
   */
  namedStyles<Kind extends StyleKind>(kind: Kind): StyleTable<Kind>;
  /**
   * Writes a named style: creates its identity when it is not stored, then writes its name and
   * value where they differ. Objects naming it are not touched here: the style commands rewrite
   * them.
   *
   * @param kind - Text or effect styles.
   * @param style - The style as it should read; validated.
   * @param creation - Who creates it and when, recorded for a new entry.
   */
  setNamedStyle<Kind extends StyleKind>(
    kind: Kind,
    style: StyleWrite<Kind>,
    creation: StyleCreation,
  ): void;
  /**
   * Deletes a named style's keys. Objects naming it are not touched here: the delete commands
   * detach them first.
   *
   * @param kind - Text or effect styles.
   * @param styleId - The style.
   * @returns `true` when the style had a stored key.
   */
  deleteNamedStyle(kind: StyleKind, styleId: StyleId): boolean;
}

/** What a change set reports of the named styles. */
export interface NamedStyleChanges {
  /** The text styles whose stored keys the transaction changed, sorted, if any. */
  readonly textStyles?: readonly StyleId[];
  /** The effect styles whose stored keys the transaction changed, sorted, if any. */
  readonly effectStyles?: readonly StyleId[];
}
