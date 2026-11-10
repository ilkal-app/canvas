import type { SceneRenderer } from '../scene/scene-renderer.js';

import type { EngineOverlay } from './engine-overlay.js';
import { overlayLayerOf } from './layered-overlay.js';
import type { SceneStamp } from './scene-certificate.js';
import { SceneSourceMirror } from './scene-source-mirror.js';
import { isSerializableChangeSet, type SerializableChangeSet } from './serializable-change-set.js';

/**
 * What reached the engine for its scene since the last frame: the page's change sets, in order,
 * and the latest overlay model of each overlay layer. The frame's first stage (`applyChanges`)
 * applies them together, so a drag's preview and its selection overlay land in the same frame,
 * and their cost is timed with the frame's. Owns the scene's mirror of the document
 * (`SceneSourceMirror`). Runs on the thread that renders.
 */
export class SceneArrivals {
  private readonly mirror: SceneSourceMirror;
  private overlay: EngineOverlay | undefined;
  private changes: { changes: unknown; stamp: SceneStamp | undefined }[] = [];

  /**
   * The overlay models that arrived since the last frame, the latest per layer (a peer's
   * selection box and the person's own drag overlay sent in one frame both land; one slot for
   * all lost the first).
   */
  private overlayModels = new Map<string, unknown>();
  /** The last overlay model shown per layer, for a rebuilt overlay. */
  private readonly shownModels = new Map<string, unknown>();

  /**
   * Creates the pending arrivals owned by one runtime.
   *
   * @param hasExclusiveRetainedPositions - Internal worker-only ownership, never a wire option.
   * @param onApplied - Observes each batch after mirroring and enqueueing at the frame stage.
   */
  constructor(
    hasExclusiveRetainedPositions = false,
    private readonly onApplied?: (stamp: SceneStamp | undefined) => void,
  ) {
    this.mirror = new SceneSourceMirror(hasExclusiveRetainedPositions);
  }

  /**
   * Whether document arrivals still await the frame's apply stage.
   *
   * @returns Whether queued batches remain.
   */
  get hasPendingChanges(): boolean {
    return this.changes.length > 0;
  }

  /**
   * Shows overlay models on a layer from now on: the engine's, or a new one after a device loss,
   * which then shows the last model shown on the old one. Without a layer a model is a fault.
   *
   * @param overlay - The layer, or undefined.
   */
  useOverlay(overlay: EngineOverlay | undefined): void {
    this.overlay = overlay;
    for (const [layer, model] of this.shownModels) {
      if (!this.overlayModels.has(layer)) this.overlayModels.set(layer, model);
    }
  }

  /**
   * Queues the whole mirrored document for a new renderer, as one change set creating every
   * object: after a device loss.
   *
   * @param renderer - The new renderer.
   */
  replay(renderer: SceneRenderer): void {
    renderer.enqueue(this.mirror.everything());
  }

  /**
   * Keeps a change set for the next frame; its shape is checked when it is applied.
   *
   * @param changes - The change set as received.
   * @param stamp - Optional contiguous mount revision.
   */
  addChangeSet(changes: SerializableChangeSet, stamp?: SceneStamp): void {
    this.changes.push({ changes, stamp: stamp === undefined ? undefined : { ...stamp } });
  }

  /**
   * Keeps an overlay model for the next frame, replacing one that has not been shown yet.
   *
   * @param model - The model as received.
   */
  setOverlay(model: unknown): void {
    this.overlayModels.set(overlayLayerOf(model), model);
  }

  /**
   * Applies everything that arrived: mirrors each change set, queues their final state once for
   * the renderer (including its drawable checks), then hands the overlay the latest model of
   * each layer. A malformed change set or a model the overlay refuses (from another thread) is
   * reported and skipped, so the rest still draws.
   *
   * @param renderer - The scene renderer, whose next `collectChanges` takes the change sets.
   * @param onFault - Receives what could not be applied.
   */
  apply(renderer: SceneRenderer, onFault: (error: Error) => void): void {
    const queued: SerializableChangeSet[] = [];
    const stamps: (SceneStamp | undefined)[] = [];
    const flush = (): void => {
      const coalesced = this.mirror.applyBatch(queued.splice(0));
      if (coalesced !== undefined) renderer.enqueue(coalesced);
      for (const stamp of stamps.splice(0)) this.onApplied?.(stamp);
    };
    for (const { changes, stamp } of this.changes.splice(0)) {
      if (!isSerializableChangeSet(changes)) {
        this.onApplied?.(undefined);
        onFault(new TypeError('The engine received a malformed change set.'));
      } else if (changes.retainedMove === undefined) {
        queued.push(changes);
        stamps.push(stamp);
      } else {
        flush();
        const moved = this.mirror.applyMove(changes.retainedMove);
        if (moved) {
          const retained = this.mirror.retainedMove;
          if (retained) renderer.enqueueRetainedMove(moved, retained.ids);
          else renderer.enqueue(moved);
          this.onApplied?.(stamp);
        } else {
          this.onApplied?.(undefined);
          onFault(new TypeError('The engine received an obsolete retained move.'));
        }
      }
    }
    flush();
    const pending = this.overlayModels;
    if (pending.size === 0) return;
    this.overlayModels = new Map();
    if (this.overlay === undefined) {
      onFault(new Error('The engine has no overlay layer to show a model on.'));
      return;
    }
    for (const [layer, model] of pending) {
      if (this.overlay.setModel(model)) this.shownModels.set(layer, model);
      else onFault(new TypeError('The engine received a malformed overlay model.'));
    }
  }
}
