import { HARNESS_VERSION } from '@canvas/app';

/**
 * Reads the app's harness version through a value import, which loads the app's code.
 *
 * @returns The version.
 */
export function readAppHarnessVersion(): number {
  return HARNESS_VERSION;
}
