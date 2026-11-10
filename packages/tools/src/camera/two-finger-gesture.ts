import type { CameraInput } from './camera-input.js';
import type { ScreenPoint } from './camera-moves.js';

/**
 * Tracks touch pointers and turns two fingers into camera input: a two-finger pan and pinch.
 * Browsers report each finger's move separately, so every move of one of the two fingers compares
 * the pair before and after it: the midpoint's shift is a `drag`, and the span's ratio a `pinch`
 * about the new midpoint. Applied in that order, the world point that was under the fingers stays
 * under them. One finger, or a third, produces nothing: single-finger touch belongs to the active
 * tool. Holds only pointer positions; no DOM.
 */
export class TwoFingerGesture {
  private readonly pointers = new Map<number, ScreenPoint>();

  /**
   * Whether exactly two fingers are down, so moves pan and zoom.
   *
   * @returns True with two fingers down.
   */
  get isActive(): boolean {
    return this.pointers.size === 2;
  }

  /**
   * A finger touched down.
   *
   * @param pointerId - The pointer's id.
   * @param point - Where, CSS px on the viewport.
   */
  pointerDown(pointerId: number, point: ScreenPoint): void {
    this.pointers.set(pointerId, point);
  }

  /**
   * A finger moved.
   *
   * @param pointerId - The pointer's id.
   * @param point - Where it is now, CSS px on the viewport.
   * @returns The camera input the move means: a `drag` and a `pinch` while two fingers are down,
   *   else nothing. A step that neither moves the midpoint nor changes the span is left out.
   */
  pointerMove(pointerId: number, point: ScreenPoint): CameraInput[] {
    if (!this.pointers.has(pointerId)) return [];
    const before = this.pair();
    this.pointers.set(pointerId, point);
    const after = this.pair();
    if (before === undefined || after === undefined) return [];
    const inputs: CameraInput[] = [];
    const deltaXPx = after.midpoint.x - before.midpoint.x;
    const deltaYPx = after.midpoint.y - before.midpoint.y;
    if (deltaXPx !== 0 || deltaYPx !== 0) inputs.push({ kind: 'drag', deltaXPx, deltaYPx });
    if (before.spanPx > 0 && after.spanPx > 0 && after.spanPx !== before.spanPx) {
      inputs.push({ kind: 'pinch', center: after.midpoint, scale: after.spanPx / before.spanPx });
    }
    return inputs;
  }

  /**
   * A finger lifted or was cancelled.
   *
   * @param pointerId - The pointer's id.
   */
  pointerUp(pointerId: number): void {
    this.pointers.delete(pointerId);
  }

  private pair(): { midpoint: ScreenPoint; spanPx: number } | undefined {
    if (this.pointers.size !== 2) return undefined;
    const [first, second] = [...this.pointers.values()];
    if (first === undefined || second === undefined) return undefined;
    return {
      midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      spanPx: Math.hypot(second.x - first.x, second.y - first.y),
    };
  }
}
