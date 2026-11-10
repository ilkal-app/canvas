import {
  overlayLayerModel,
  SceneChangeQueue,
  TranslationChangeEncoder,
  type ColorTokenValues,
  type EngineHost,
  type InputMark,
  type PointerInput,
  type StickyAuthors,
} from '@canvas/engine';
import type { SelectionOverlayModel } from '@canvas/tools';

import type { EngineDocumentView } from './engine-document.js';
import { HostMoveQueue } from './host-move-queue.js';
import { enqueueHostScene } from './host-scene-stream.js';

/** A frame-coalesced document view, explicitly flushed before reads and disposed on unmount. */
export interface HostView extends EngineDocumentView {
  /** Sends pending changes before a read that needs the current scene. */
  flush(): void;
  /** Queues timestamps with the scene they describe, so latency cannot precede its preview. */
  pointer(input: PointerInput): void;
  /**
   * Sends a benchmark's input mark after the queued scene, overlay and pointer inputs
   * it measures, or at once when nothing is queued.
   *
   * @param mark - The mark.
   */
  markInput(mark: InputMark): void;
  /**
   * Shows a model on a named layer of the host's layered overlay (`layerOverlays`; the trace
   * tint), sent with the next batch; the latest model per layer wins.
   *
   * @param layer - The layer's name.
   * @param model - Its model, plain data.
   */
  showLayer(layer: string, model: unknown): void;
  /** Releases pacing after a frame report or a fault reported by the mount. */
  releaseFrame(): void;
  /**
   * Tells the engine who wrote each sticky, at once.
   *
   * @param authors - Whether authors show, the members' names and the fallback.
   */
  setStickyAuthors(authors: StickyAuthors): void;
  /** Cancels pending work and releases references to the document. */
  destroy(): void;
}

/** The page's animation-frame scheduler, injectable for deterministic tests. */
interface ViewFrames {
  readonly request: (callback: () => void) => number;
  readonly cancel: (handle: number) => void;
}

/**
 * Coalesces document changes and the latest overlay before serialising once per page frame.
 * Explicit frame acknowledgements permit two retained move batches in flight; ordinary
 * batches and hosts without acknowledgements keep one. Later changes remain coalesced.
 * All queued changes read through the latest source, so a superseded preview is never cloned.
 * Explicit flushes bypass pacing so reads and lifecycle transitions see the current scene.
 *
 * @param host - The running host.
 * @param frames - The page frame scheduler.
 * @returns The disposable view, with explicit flushing for scene reads.
 */
export function hostView(
  host: EngineHost,
  frames: ViewFrames = {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => {
      cancelAnimationFrame(handle);
    },
  },
): HostView {
  return new QueuedHostView(host, frames);
}

/** Per-mount frame pacing and ordered scene/placement delivery. */
class QueuedHostView implements HostView {
  private readonly changes = new SceneChangeQueue();
  private readonly encoder = new TranslationChangeEncoder();
  private readonly moves = new HostMoveQueue();
  private readonly inputs: PointerInput[] = [];
  private readonly marks: InputMark[] = [];
  private overlay: SelectionOverlayModel | undefined;
  private readonly layers = new Map<string, unknown>();
  private pending: number | undefined;
  private isDestroyed = false;
  private isWaitingForFrame = false;
  private readonly credits = new Set<object>();
  private hasPendingMove = false;
  private isSending = false;
  private readonly stopFrame: () => void;

  constructor(
    private readonly host: EngineHost,
    private readonly frames: ViewFrames,
  ) {
    this.stopFrame = host.onFrame(() => {
      if (!this.host.requestFrameAcknowledgement) this.releaseFrame();
    });
  }

  enqueue(next: Parameters<HostView['enqueue']>[0]): void {
    if (this.isDestroyed) return;
    this.moves.stop();
    this.hasPendingMove = false;
    this.changes.push(next);
    this.schedule();
  }

  showMovePreview(model: Parameters<NonNullable<HostView['showMovePreview']>>[0]): void {
    if (this.isDestroyed) return;
    this.moves.show(model);
    this.hasPendingMove = model !== undefined;
    this.schedule();
  }

  setColorTokens(tokens: ColorTokenValues): void {
    // Straight to the host, ahead of queued changes: a record resolves the table it lands with.
    if (!this.isDestroyed) this.host.setColorTokens(tokens);
  }

  /**
   * Tells the engine who wrote each sticky, straight to the host as the colour tokens
   * are: the engine re-lays just the labels that change. Nothing once destroyed.
   *
   * @param authors - Whether authors show, the members' names and the fallback.
   */
  setStickyAuthors(authors: StickyAuthors): void {
    if (!this.isDestroyed) this.host.setStickyAuthors(authors);
  }

  showOverlay(model: SelectionOverlayModel): void {
    if (this.isDestroyed) return;
    this.overlay = model;
    this.schedule();
  }

  showLayer(layer: string, model: unknown): void {
    if (this.isDestroyed) return;
    this.layers.set(layer, model);
    this.schedule();
  }

  pointer(input: PointerInput): void {
    if (this.isDestroyed) return;
    this.inputs.push(input);
    this.schedule();
  }

  markInput(mark: InputMark): void {
    if (this.isDestroyed) return;
    if (!this.hasQueued()) {
      this.host.markInput?.(mark);
      return;
    }
    this.marks.push(mark);
    this.schedule();
  }

  flush(): void {
    if (this.isDestroyed) return;
    if (this.pending !== undefined) this.frames.cancel(this.pending);
    this.pending = undefined;
    const ends = this.moves.takeEnds();
    const next = this.changes.drain();
    const moved = this.moves.takeMove();
    this.hasPendingMove = false;
    const model = this.overlay;
    const pointers = this.inputs.splice(0);
    const marks = this.marks.splice(0);
    this.overlay = undefined;
    const layers = [...this.layers];
    this.layers.clear();
    if (
      next === undefined &&
      model === undefined &&
      layers.length === 0 &&
      pointers.length === 0 &&
      marks.length === 0 &&
      ends.length === 0 &&
      moved.length === 0
    )
      return;
    const credit = this.host.requestFrameAcknowledgement ? {} : undefined;
    if (credit) this.credits.add(credit);
    this.isWaitingForFrame = true;
    this.isSending = true;
    try {
      if (ends.length > 0 || moved.length > 0) this.encoder.clear();
      for (const retainedMove of ends)
        enqueueHostScene(this.host, {
          created: [],
          updated: [],
          deleted: [],
          objects: {},
          retainedMove,
        });
      if (next !== undefined) enqueueHostScene(this.host, this.encoder.encode(next));
      for (const retainedMove of moved)
        enqueueHostScene(this.host, {
          created: [],
          updated: [],
          deleted: [],
          objects: {},
          retainedMove,
        });
      for (const [layer, layerModel] of layers) {
        this.host.setOverlay(overlayLayerModel(layer, layerModel));
      }
      if (model !== undefined) this.host.setOverlay(model);
      for (const input of pointers) this.host.pointer(input);
      for (const mark of marks) this.host.markInput?.(mark);
      if (credit) this.requestAcknowledgement(credit);
    } catch (error) {
      if (credit) this.credits.delete(credit);
      throw error;
    } finally {
      this.isSending = false;
    }
  }

  releaseFrame(): void {
    if (this.isDestroyed) return;
    this.isWaitingForFrame = false;
    this.credits.clear();
    this.resume();
  }

  private resume(): void {
    if (!this.canSend()) return;
    if (this.hasQueued()) {
      // Synchronous reports cannot interleave a new scene with this batch's pointer inputs.
      if (this.isSending) this.schedule();
      else this.flush();
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    this.stopFrame();
    if (this.pending !== undefined) this.frames.cancel(this.pending);
    this.pending = undefined;
    this.inputs.length = 0;
    this.marks.length = 0;
    this.changes.drain();
    this.encoder.clear();
    this.moves.clear();
    this.credits.clear();
    this.hasPendingMove = false;
    this.overlay = undefined;
    this.layers.clear();
  }

  private hasQueued(): boolean {
    return (
      this.changes.size > 0 ||
      this.overlay !== undefined ||
      this.layers.size > 0 ||
      this.inputs.length > 0 ||
      this.marks.length > 0 ||
      this.moves.hasPending
    );
  }

  private canSend(): boolean {
    if (this.isDestroyed) return false;
    if (!this.host.requestFrameAcknowledgement) return !this.isWaitingForFrame;
    const limit = this.hasPendingMove && this.changes.size === 0 ? 2 : 1;
    return this.credits.size < limit;
  }

  private requestAcknowledgement(credit: object): void {
    const settle = () => {
      if (!this.credits.delete(credit) || this.isDestroyed) return;
      this.resume();
    };
    try {
      void this.host.requestFrameAcknowledgement?.().then(settle, settle);
    } catch {
      settle();
    }
  }

  private schedule(): void {
    if (!this.canSend()) return;
    this.pending ??= this.frames.request(() => {
      this.pending = undefined;
      if (this.canSend()) this.flush();
    });
  }
}

/**
 * Waits for the host's next frame report.
 *
 * @param host - The running host.
 * @returns Settles after the next frame the host draws.
 */
export function nextFrame(host: EngineHost): Promise<void> {
  return new Promise((resolve) => {
    const stop = host.onFrame(() => {
      stop();
      resolve();
    });
  });
}
