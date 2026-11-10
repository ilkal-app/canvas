import type { FreehandSample, Point } from '@canvas/schema';

import type { SelectPointer } from '../select/select-input.js';

/** How close, in screen px, a sample may come to the one before it and still be dropped. */
export const STROKE_SPACING_PX = 0.5;

/**
 * A stroke's samples as the draw tool records them: the press, then each move's
 * coalesced samples (its `trail`) and its own point, then the release, in world units with the
 * pen's pressure. A sample closer than {@link STROKE_SPACING_PX} on screen to the one kept
 * before it is dropped, so a still pointer adds nothing. Palm rejection: once a pen has been
 * seen (pressed or hovering), a finger's press draws nothing for the rest of the capture's life,
 * since a hand resting on the screen while the pen writes is not drawing. No DOM.
 */
export class StrokeCapture {
  private isPenSeen = false;
  private current: FreehandSample[] | undefined;

  /**
   * Whether a stroke is being captured: a press was taken and not yet released or cancelled.
   *
   * @returns True while one is.
   */
  get isCapturing(): boolean {
    return this.current !== undefined;
  }

  /**
   * The stroke's samples so far.
   *
   * @returns Them in order; empty when none is being captured.
   */
  get samples(): readonly FreehandSample[] {
    return this.current ?? [];
  }

  /**
   * Notes a pointer's kind, so a pen hovering before its first press already rejects a palm.
   *
   * @param pointer - Any pointer input.
   */
  note(pointer: Pick<SelectPointer, 'pointerType'>): void {
    if (pointer.pointerType === 'pen') this.isPenSeen = true;
  }

  /**
   * Starts a stroke at a press, unless it is a finger's after a pen was seen.
   *
   * @param pointer - The press.
   * @returns Whether the press started a stroke.
   */
  press(pointer: SelectPointer): boolean {
    this.note(pointer);
    if (pointer.pointerType === 'touch' && this.isPenSeen) return false;
    this.current = [sampleOf(pointer.world, pointer.pressure)];
    return true;
  }

  /**
   * Adds a pressed move's coalesced samples and its own point, those far enough apart.
   *
   * @param pointer - The move.
   * @param zoom - The camera zoom, CSS px per world unit, which spaces samples on screen.
   * @returns Whether a sample was added.
   */
  extend(pointer: SelectPointer, zoom: number): boolean {
    this.note(pointer);
    const { current } = this;
    if (current === undefined) return false;
    const before = current.length;
    const trail = pointer.trail ?? [];
    for (const sample of trail) this.add(current, sampleOf(sample.world, sample.pressure), zoom);
    // The raw samples end where the pen was; the event's own point is the browser's aggregate of
    // them, used only when it coalesced none.
    if (trail.length === 0) this.add(current, sampleOf(pointer.world, pointer.pressure), zoom);
    return current.length > before;
  }

  /**
   * Ends the stroke at a release: its point is added as a move's would be, but with the last
   * sample's pressure, since a pen reports none (0) as it lifts.
   *
   * @param pointer - The release.
   * @param zoom - The camera zoom.
   * @returns The stroke's samples, or undefined when no stroke was under way.
   */
  release(pointer: SelectPointer, zoom: number): FreehandSample[] | undefined {
    const { current } = this;
    if (current === undefined) return undefined;
    this.current = undefined;
    this.add(current, sampleOf(pointer.world, current.at(-1)?.pressure), zoom);
    return current;
  }

  /** Drops the stroke under way, if any. */
  cancel(): void {
    this.current = undefined;
  }

  /**
   * Appends a sample unless it is closer than {@link STROKE_SPACING_PX} on screen to the last.
   *
   * @param samples - The stroke's samples, appended to.
   * @param sample - The new sample.
   * @param zoom - The camera zoom.
   */
  private add(samples: FreehandSample[], sample: FreehandSample, zoom: number): void {
    const last = samples.at(-1);
    if (last && Math.hypot(sample.x - last.x, sample.y - last.y) * zoom < STROKE_SPACING_PX) {
      return;
    }
    samples.push(sample);
  }
}

/**
 * A sample at a point, with its pressure when there is one.
 *
 * @param point - The point, world units.
 * @param pressure - The pressure, if any.
 * @returns The sample.
 */
function sampleOf(point: Point, pressure: number | undefined): FreehandSample {
  return pressure === undefined ? { x: point.x, y: point.y } : { x: point.x, y: point.y, pressure };
}
