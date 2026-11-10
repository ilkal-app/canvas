/** A fixture of the app's harness shape, for type-only imports. */
export interface HarnessShape {
  /** The harness version. */
  readonly version: number;
}

/** A fixture value export, which a type-only importer may not use. */
export const HARNESS_VERSION = 1;
