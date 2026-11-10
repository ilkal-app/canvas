import { deleteObjectsCommand, runCommand } from '@canvas/document';
import type { FreehandObject, ObjectId, Point } from '@canvas/schema';

import type { SelectPointer } from '../select/select-input.js';

import type { DrawModeContext } from './draw-context.js';
import {
  eraserRadius,
  erasedStrokes,
  isErasable,
  sweepBounds,
  type EraserSweep,
} from './eraser-hits.js';

/** How much of its opacity a stroke the eraser touched keeps while the drag lasts. */
export const ERASER_FADE = 0.25;

/**
 * One eraser drag: from the press, every move sweeps the eraser from where it was to
 * where it is (through the samples the browser coalesced into the move), and each freehand
 * stroke it comes within reach of fades to {@link ERASER_FADE} of its opacity, a preview under
 * the stroke's own id; nothing is written while dragging. The release deletes the touched strokes
 * still on the board as one `deleteObjects`, one undo step; a cancel restores them. A stroke a
 * peer deleted meanwhile is dropped, and one a peer changed is faded as it is now. Main thread.
 */
export class EraserGesture {
  private readonly context: DrawModeContext;
  private last: Point | undefined;
  /** The touched strokes, each as stored when faded. */
  private readonly touched = new Map<ObjectId, FreehandObject>();

  /**
   * An eraser at rest.
   *
   * @param context - The draw tool's context.
   */
  constructor(context: DrawModeContext) {
    this.context = context;
  }

  /**
   * Whether a drag is under way.
   *
   * @returns True between a press and its release or cancel.
   */
  get isActive(): boolean {
    return this.last !== undefined;
  }

  /**
   * The strokes touched so far.
   *
   * @returns Their ids, in the order they were touched.
   */
  get touchedIds(): readonly ObjectId[] {
    return [...this.touched.keys()];
  }

  /**
   * Starts a drag at a press: what lies under the eraser there is touched.
   *
   * @param press - The press.
   * @param zoom - The camera zoom.
   */
  press(press: SelectPointer, zoom: number): void {
    this.cancel();
    this.last = press.world;
    this.sweep([press.world], zoom);
  }

  /**
   * Sweeps the eraser along a move: through its coalesced samples, then to its point.
   *
   * @param move - The move.
   * @param zoom - The camera zoom.
   */
  move(move: SelectPointer, zoom: number): void {
    if (!this.isActive) return;
    this.sweep([...(move.trail ?? []).map((sample) => sample.world), move.world], zoom);
  }

  /**
   * Ends a drag at a release: sweeps to it, then deletes the touched strokes still on the board
   * as one command, its own undo step; a refusal goes to `onCommandRefused`.
   *
   * @param release - The release.
   * @param zoom - The camera zoom.
   */
  release(release: SelectPointer, zoom: number): void {
    if (!this.isActive) return;
    this.sweep([release.world], zoom);
    const { context } = this;
    // A stroke a peer deleted, hid or locked meanwhile is left out.
    const source = context.source ?? context.store;
    const ids = this.touchedIds.filter((id) => isErasable(id, source));
    // Previews go first: a deletion read through a preview would leave the faded copy drawn.
    this.cancel();
    if (ids.length === 0) return;
    const erase = () => {
      const outcome = runCommand(
        context.store,
        context.origin,
        deleteObjectsCommand,
        { ids },
        context.environment,
      );
      if (outcome.status === 'rejected') context.onCommandRefused?.(outcome.errors);
    };
    if (context.capture) context.capture.command(erase);
    else erase();
  }

  /** Ends a drag writing nothing: the touched strokes show as stored again. */
  cancel(): void {
    this.last = undefined;
    for (const id of this.touched.keys()) this.context.setPreview(id, undefined);
    this.touched.clear();
  }

  /**
   * Sweeps the eraser from where it was through points, fading each stroke it touches, after
   * dropping the strokes a peer deleted and refreshing those a peer changed.
   *
   * @param points - The points, world units, in order.
   * @param zoom - The camera zoom.
   */
  private sweep(points: readonly Point[], zoom: number): void {
    this.refresh();
    const { context } = this;
    const source = context.source ?? context.store;
    const radius = eraserRadius(zoom);
    for (const point of points) {
      const sweep: EraserSweep = { from: this.last ?? point, to: point, radius };
      this.last = point;
      const candidates =
        context.hitIndex?.searchRect(sweepBounds(sweep)) ?? context.store.read().objects.keys();
      for (const id of erasedStrokes(sweep, candidates, source)) {
        const object = context.store.get(id);
        if (object?.type === 'freehand' && !this.touched.has(id)) this.fade(object);
      }
    }
  }

  /** Drops the touched strokes no longer on the board, and fades again those changed. */
  private refresh(): void {
    for (const [id, faded] of this.touched) {
      const object = this.context.store.get(id);
      if (object?.type !== 'freehand') {
        this.touched.delete(id);
        this.context.setPreview(id, undefined);
      } else if (object !== faded) this.fade(object);
    }
  }

  /**
   * Fades a stroke: previews it under its own id at {@link ERASER_FADE} of its opacity.
   *
   * @param object - The stroke, as stored.
   */
  private fade(object: FreehandObject): void {
    this.touched.set(object.id, object);
    this.context.setPreview(object.id, { ...object, opacity: (object.opacity ?? 1) * ERASER_FADE });
    this.context.onChange();
  }
}
