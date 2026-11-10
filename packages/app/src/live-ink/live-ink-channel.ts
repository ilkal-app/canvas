import type { FreehandObject } from '@canvas/schema';
import type { LiveInk } from '@canvas/tools';

import type { LiveInkHandOff } from './live-ink-hand-off.js';

/** What the live ink overlay shows of one stroke, and how far along it is. */
export interface LiveInkModel {
  /** Which stroke: one per press, counting up, so a released stroke and the next differ. */
  readonly strokeId: number;
  /** The stroke's pieces, in world units; none once drawn by the engine or cleared. */
  readonly pieces: readonly FreehandObject[];
  /**
   * `drawing` while the pen is down; `released` once written, kept until the engine shows it;
   * `drawn` once the engine does (its hand-off); `cleared` when it was dropped.
   */
  readonly phase: 'drawing' | 'released' | 'drawn' | 'cleared';
  /**
   * While drawing: when the newest input the pieces take was made, ms on the events' clock, if
   * the draw tool knew it (the ink latency readout times the overlay's paint from it).
   */
  readonly inputMs?: number;
}

/** One paint of the live ink overlay that showed a new input (the ink latency readout). */
export interface LiveInkPaint {
  /** The stroke it showed the input of. */
  readonly strokeId: number;
  /** When that input was made, ms on the events' clock (`performance.now`'s). */
  readonly inputMs: number;
  /** When the overlay had drawn it, ms on the same clock: the end of its page animation frame's draw. */
  readonly paintedMs: number;
}

/**
 * The draw tool's live ink, between the tool and the page overlay that draws it: the
 * tool shows, releases and clears the stroke under way through it, and the overlay listens. The
 * tool draws through it only while an overlay listens (`isAttached`). A released stroke is
 * handed off to the engine (`LiveInkHandOff`) and reported `drawn` once it shows there, while the
 * next stroke may already be drawing. The mount owns one.
 */
export class LiveInkChannel implements LiveInk {
  private readonly listeners = new Set<(model: LiveInkModel) => void>();
  private readonly paintListeners = new Set<(paint: LiveInkPaint) => void>();
  private readonly handOffs = new Map<number, () => void>();
  private strokeId = 0;
  private isOpen = false;
  private pieces: readonly FreehandObject[] = [];

  /**
   * Starts with no stroke.
   *
   * @param handOff - Waits for the engine to show a written stroke; at once when absent.
   */
  constructor(private readonly handOff?: LiveInkHandOff) {}

  /**
   * Listens to the strokes.
   *
   * @param listener - Receives each model.
   * @returns Stops listening.
   */
  attach(listener: (model: LiveInkModel) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Listens to the overlay's paints of new input, for the ink latency readout (`?inkdebug=1`).
   * Unlike {@link attach}, it does not make the draw tool draw through the channel.
   *
   * @param listener - Receives each paint.
   * @returns Stops listening.
   */
  subscribePaints(listener: (paint: LiveInkPaint) => void): () => void {
    this.paintListeners.add(listener);
    return () => {
      this.paintListeners.delete(listener);
    };
  }

  /**
   * The overlay drew a stroke showing a new input: hands it to the paint listeners, if any.
   *
   * @param paint - The stroke, its input's time and the paint's.
   */
  painted(paint: LiveInkPaint): void {
    for (const listener of this.paintListeners) listener(paint);
  }

  isAttached(): boolean {
    return this.listeners.size > 0;
  }

  show(pieces: readonly FreehandObject[], inputMs?: number): void {
    if (!this.isOpen) {
      this.strokeId += 1;
      this.isOpen = true;
    }
    this.pieces = pieces;
    this.send({
      strokeId: this.strokeId,
      pieces,
      phase: 'drawing',
      ...(inputMs === undefined ? {} : { inputMs }),
    });
  }

  release(): void {
    if (!this.isOpen) return;
    const { strokeId, pieces } = this;
    this.close();
    this.send({ strokeId, pieces, phase: 'released' });
    // Set by the hand-off, which may report at once (no engine to wait for).
    const state = { isDrawn: false };
    const drawn = (): void => {
      state.isDrawn = true;
      this.handOffs.delete(strokeId);
      this.send({ strokeId, pieces: [], phase: 'drawn' });
    };
    if (this.handOff === undefined) {
      drawn();
      return;
    }
    const cancel = this.handOff(drawn);
    if (!state.isDrawn) this.handOffs.set(strokeId, cancel);
  }

  clear(): void {
    if (!this.isOpen) return;
    const { strokeId } = this;
    this.close();
    this.send({ strokeId, pieces: [], phase: 'cleared' });
  }

  /** Cancels every hand-off under way: the mount is going. */
  destroy(): void {
    for (const cancel of this.handOffs.values()) cancel();
    this.handOffs.clear();
  }

  private close(): void {
    this.isOpen = false;
    this.pieces = [];
  }

  private send(model: LiveInkModel): void {
    for (const listener of this.listeners) listener(model);
  }
}
