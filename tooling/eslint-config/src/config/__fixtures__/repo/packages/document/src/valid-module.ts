import { SCHEMA_VERSION } from '@canvas/schema';

/**
 * Reads the schema version a document is written with.
 *
 * @returns The schema version number.
 */
export function readSchemaVersion(): number {
  return SCHEMA_VERSION;
}
