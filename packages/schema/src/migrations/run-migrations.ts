import { SCHEMA_VERSION } from '../version/schema-version.js';

import { MIGRATIONS } from './migration-registry.js';
import type { MigrationRegistry, VersionedDocumentJson } from './migration-step.js';

/**
 * Checks that a value is a JSON object recording a numeric schema version.
 *
 * @param document - The value to check.
 * @returns The value, typed as a versioned document.
 * @throws {TypeError} When the value is not an object or has no numeric `schemaVersion`.
 */
function asVersionedDocument(document: unknown): VersionedDocumentJson {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new TypeError('A stored board document must be a JSON object');
  }
  if (!('schemaVersion' in document) || typeof document.schemaVersion !== 'number') {
    throw new TypeError('A stored board document must record a numeric schemaVersion');
  }
  return document as VersionedDocumentJson;
}

/**
 * Brings a stored document from the schema version it records up to `targetVersion`, applying
 * the step for every version after the document's own, in version order, and stamping each
 * version as it goes. A document already at `targetVersion` is returned as is.
 *
 * @param document - The parsed JSON of a stored document; it is not modified.
 * @param registry - The steps, keyed by the version each produces.
 * @param targetVersion - The version to migrate to.
 * @returns The document at `targetVersion`.
 * @throws {TypeError} When `document` is not an object recording a numeric `schemaVersion`.
 * @throws {RangeError} When the recorded version is not an integer in [1, `targetVersion`], or
 *   when `registry` has no step for a version on the way.
 */
export function runMigrations(
  document: unknown,
  registry: MigrationRegistry,
  targetVersion: number,
): VersionedDocumentJson {
  let current = asVersionedDocument(document);
  const recorded = current.schemaVersion;
  if (!Number.isInteger(recorded) || recorded < 1 || recorded > targetVersion) {
    throw new RangeError(
      `Unknown schema version ${String(recorded)}: this build reads versions 1 to ${String(targetVersion)}`,
    );
  }
  for (let version = recorded + 1; version <= targetVersion; version += 1) {
    const step = registry.get(version);
    if (step === undefined) {
      throw new RangeError(`No migration step produces schema version ${String(version)}`);
    }
    current = { ...step(current), schemaVersion: version };
  }
  return current;
}

/**
 * Brings a stored document up to the current {@link SCHEMA_VERSION} with the steps in
 * `MIGRATIONS`. Loading, importing and syncing an older document all go through here.
 *
 * @param document - The parsed JSON of a stored document; it is not modified.
 * @returns The document at {@link SCHEMA_VERSION}, not yet validated.
 * @throws {TypeError} When `document` is not an object recording a numeric `schemaVersion`.
 * @throws {RangeError} When the recorded version is unknown to this build (newer, or not an
 *   integer of at least 1).
 */
export function migrateToLatest(document: unknown): VersionedDocumentJson {
  return runMigrations(document, MIGRATIONS, SCHEMA_VERSION);
}
