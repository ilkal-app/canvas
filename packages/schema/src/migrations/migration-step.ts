/**
 * A stored board document as plain JSON, of any schema version: an object that records the
 * version it was written with. Its other fields are whatever that version stored, so they are
 * `unknown` until the document is migrated and validated.
 */
export interface VersionedDocumentJson {
  /** The schema version the document was written with. */
  readonly schemaVersion: number;
  /** The document's other fields, in the shape of its schema version. */
  readonly [field: string]: unknown;
}

/**
 * One migration step: turns a document of version N − 1 into the same document at version N.
 * A step is pure: it returns a new document and never mutates its input. It need not update
 * `schemaVersion`; the runner stamps it.
 */
export type MigrationStep = (document: VersionedDocumentJson) => VersionedDocumentJson;

/**
 * The migration steps, keyed by the schema version each step produces. Every version from 1 up
 * to the current `SCHEMA_VERSION` has exactly one step.
 */
export type MigrationRegistry = ReadonlyMap<number, MigrationStep>;
