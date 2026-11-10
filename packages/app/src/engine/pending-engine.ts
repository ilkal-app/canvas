import type { CanvasBackingSize } from '../canvas/backing-store-size.js';

import type { MountedEngine, MountEngineOptions } from './mounted-engine.js';

/** One cancellable canvas startup, possibly showing an inert projection before hydration. */
export interface PendingEngine {
  /** Resolves only after the live document has replaced the preview and drawn its first frame. */
  readonly ready: Promise<MountedEngine>;
  /** Whether its owner cancelled startup before the canvas unmounted. */
  readonly isCancelled?: boolean;
  /** Updates or invalidates a preview when its certified viewport no longer matches. */
  readonly resize: (size: CanvasBackingSize) => void;
  /** Cancels startup and destroys its preview or live engine; idempotent after handoff too. */
  readonly destroy: () => void;
}

/** Starts on the existing shell canvas, without exposing a pretend live board during loading. */
export type StartPendingEngine = (
  canvas: HTMLCanvasElement,
  options: MountEngineOptions,
) => PendingEngine;
