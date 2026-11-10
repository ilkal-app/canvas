import type { Point } from '@canvas/schema';

import { gapLabelOf, type SnapGap } from '../snap/snap-gap.js';

import { worldBoundsOfBox, type OrientedBox } from './oriented-box.js';

/**
 * What an overlay label says, which decides its pill and where it sits by its anchor: `size`, a
 * resize's readout beside the frame; `extent`, a shape being drawn's size below it; `gap`, a gap
 * run's length; `locked`, the locked notice; `connect`, "Release to connect" by a connector's end.
 */
export type OverlayLabelKind = 'size' | 'extent' | 'gap' | 'locked' | 'connect';

/**
 * A text label of the editing states: the size readout while resizing, the length of a
 * gap run, the locked notice. The overlay's rectangles cannot draw type, so the shell draws these
 * as pills over the canvas (in Geist Mono for numbers), placing each by its world anchor at the
 * camera of the moment; the engine host ignores them. Plain data.
 */
export interface OverlayLabel {
  /** What it is. */
  readonly kind: OverlayLabelKind;
  /** What it says. */
  readonly text: string;
  /**
   * Its anchor, world units: the frame's bottom-right corner for `size`, the box's bottom-centre
   * for `extent`, the middle of the run for `gap`, the frame's bottom-left corner for `locked`,
   * the connector's end for `connect`.
   */
  readonly at: Point;
  /** For a `gap`, the axis the run is measured along, which side of the run the pill takes. */
  readonly axis?: 'x' | 'y';
}

/** The locked notice: shown when a person tries to move or resize a locked selection. */
export const LOCKED_LABEL_TEXT = 'Locked · can’t move or resize';

/** What a connector's end says over an object it would attach to. */
export const CONNECT_LABEL_TEXT = 'Release to connect';

/**
 * The size of a box, in whole world units, as `176 × 130`.
 *
 * @param box - The box.
 * @returns The text.
 */
function sizeTextOf(box: Pick<OrientedBox, 'width' | 'height'>): string {
  return `${String(Math.round(box.width))} × ${String(Math.round(box.height))}`;
}

/**
 * The size of a shape being drawn, anchored at its box's bottom-centre. Pure.
 *
 * @param box - The upright box being drawn, world units.
 * @returns The label.
 */
export function extentLabelOf(
  box: Pick<OrientedBox, 'x' | 'y' | 'width' | 'height'>,
): OverlayLabel {
  const at = { x: box.x + box.width / 2, y: box.y + box.height };
  return { kind: 'extent', text: sizeTextOf(box), at };
}

/**
 * "Release to connect" by a connector's end over an object it would attach to. Pure.
 *
 * @param point - The end, world units.
 * @returns The label.
 */
export function connectLabelOf(point: Point): OverlayLabel {
  return { kind: 'connect', text: CONNECT_LABEL_TEXT, at: point };
}

/**
 * The size readout of a frame being resized: its width and height in whole world units, as
 * `176 × 130`, anchored at its bounds' bottom-right corner. Pure.
 *
 * @param frame - The resized frame, world units.
 * @returns The label.
 */
export function sizeLabelOf(frame: OrientedBox): OverlayLabel {
  const bounds = worldBoundsOfBox(frame);
  return { kind: 'size', text: sizeTextOf(frame), at: { x: bounds.maxX, y: bounds.maxY } };
}

/**
 * The label of each gap run: its length, at the run's middle. Pure.
 *
 * @param gaps - The runs.
 * @returns One label per run, in order.
 */
export function gapLabelsOf(gaps: readonly SnapGap[]): OverlayLabel[] {
  return gaps.map((gap) => {
    const middle = (gap.from + gap.to) / 2;
    const at = gap.axis === 'x' ? { x: middle, y: gap.position } : { x: gap.position, y: middle };
    return { kind: 'gap', text: gapLabelOf(gap), at, axis: gap.axis };
  });
}

/**
 * The locked notice under a locked frame, anchored at its bounds' bottom-left corner. Pure.
 *
 * @param frame - The locked selection's frame, world units.
 * @returns The label.
 */
export function lockedLabelOf(frame: OrientedBox): OverlayLabel {
  const bounds = worldBoundsOfBox(frame);
  return { kind: 'locked', text: LOCKED_LABEL_TEXT, at: { x: bounds.minX, y: bounds.maxY } };
}
