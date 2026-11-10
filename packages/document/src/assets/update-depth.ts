/** Maximum plain array/object nesting accepted before lib0's recursive value decoder runs. */
export const MAX_UPDATE_VALUE_DEPTH = 128;

/** A structurally readable update whose plain values exceed the supported nesting bound. */
export class UpdateDepthError extends Error {
  /** Creates the deterministic refusal; no peer-controlled value is included. */
  constructor() {
    super(`update value nesting exceeds ${String(MAX_UPDATE_VALUE_DEPTH)}`);
    this.name = 'UpdateDepthError';
  }
}
