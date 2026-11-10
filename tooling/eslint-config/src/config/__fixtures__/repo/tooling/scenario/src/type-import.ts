import type { HarnessShape } from '@canvas/app';

/**
 * Reads a harness version through a type-only import of the app.
 *
 * @param harness - The harness.
 * @returns Its version.
 */
export function readHarnessVersion(harness: HarnessShape): number {
  return harness.version;
}
