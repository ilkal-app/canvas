import {
  caretPlacement,
  caretRect,
  selectionSpans,
  type TextLayout,
  type WorldTransform,
} from '@canvas/engine';
import type { Point, Rgba } from '@canvas/schema';

import { SELECTION_COLOR, type OverlayRect } from '../select/overlay-rects.js';

import { rectToWorld, type LocalRect } from './text-box-frame.js';

/** The caret's width, CSS px, whatever the zoom. */
export const CARET_WIDTH_PX = 1.5;

/** The selection highlight: the selection colour at about a third. */
export const TEXT_SELECTION_FILL: Rgba = [51 / 255, 128 / 255, 1, 0.3];

/** What the editing overlay shows. */
export interface TextEditingRectsInput {
  /** The laid-out text being shown (the composition included). */
  readonly layout: TextLayout;
  /** The text box, in the object's frame: what is outlined. */
  readonly box: LocalRect;
  /**
   * Where the laid-out text starts in the box (`textOriginIn`): a sticky note's text inside its
   * padding; the box's corner when absent.
   */
  readonly textOrigin?: Point;
  /** The object's frame. */
  readonly transform: WorldTransform;
  /** The selection, start first; equal ends for a collapsed caret. */
  readonly selection: readonly [start: number, end: number];
  /** The caret position. */
  readonly caret: number;
  /** The composition's range, underlined, if an input method is composing. */
  readonly composition: readonly [start: number, end: number] | undefined;
  /**
   * The input method's selection in the composition: collapsed, where the caret is
   * drawn; else the target segment, underlined thick, and no caret. Absent: the caret as given.
   */
  readonly compositionSelection?: readonly [start: number, end: number] | undefined;
  /** The caret's colour: the insert style's. */
  readonly caretColor: Rgba;
  /** The camera zoom, CSS px per world unit. */
  readonly zoom: number;
  /**
   * The outline's colour: the palette's `you` (the design's amber); the selection colour
   * if absent.
   */
  readonly outlineColor?: Rgba;
  /** The selection highlight's colour; {@link TEXT_SELECTION_FILL} if absent. */
  readonly highlightColor?: Rgba;
}

/**
 * The rectangles of a range, in the box's frame: each line's part of `[start, end)`, one per
 * visual run on a line with right-to-left text (`selectionSpans`).
 *
 * @param layout - The laid-out text.
 * @param start - The range's start.
 * @param end - Its end.
 * @returns The rectangles, top to bottom.
 */
function rangeSpans(layout: TextLayout, start: number, end: number): LocalRect[] {
  return selectionSpans(layout, start, end).map(({ line, left, right }) => {
    // `selectionSpans` names only the layout's lines.
    const { y, height } = layout.lines[line] ?? { y: 0, height: 0 };
    return { x: left, y, width: right - left, height };
  });
}

/**
 * The editing overlay of a text box: its outline one pixel outside (in
 * `outlineColor`, the person's amber in the shell), and,
 * from where its text starts in it, the selection highlighted line by line, the composition underlined and the caret, as flat
 * rectangles turned with the object (`toolRects`), sized in CSS px divided by the zoom. Pure.
 *
 * @param input - The layout, box, frame, selection, caret, composition, caret colour and zoom.
 * @returns The rectangles, in draw order.
 */
export function textEditingRects(input: TextEditingRectsInput): OverlayRect[] {
  const { layout, box, transform, zoom } = input;
  const pixel = 1 / zoom;
  const place = (rect: LocalRect, color: Rgba): OverlayRect => ({
    box: rectToWorld(transform, { ...rect, x: box.x + rect.x, y: box.y + rect.y }),
    color,
  });
  const origin = input.textOrigin ?? { x: 0, y: 0 };
  const placeText = (rect: LocalRect, color: Rgba): OverlayRect =>
    place({ ...rect, x: origin.x + rect.x, y: origin.y + rect.y }, color);
  const outline: LocalRect[] = [
    { x: -pixel, y: -pixel, width: box.width + 2 * pixel, height: pixel },
    { x: -pixel, y: box.height, width: box.width + 2 * pixel, height: pixel },
    { x: -pixel, y: 0, width: pixel, height: box.height },
    { x: box.width, y: 0, width: pixel, height: box.height },
  ];
  const rects = outline.map((rect) => place(rect, input.outlineColor ?? SELECTION_COLOR));
  const [start, end] = input.selection;
  for (const span of rangeSpans(layout, start, end)) {
    rects.push(placeText(span, input.highlightColor ?? TEXT_SELECTION_FILL));
  }
  const target = input.compositionSelection;
  const hasTarget = target !== undefined && target[0] < target[1];
  if (input.composition) {
    const [from, to] = input.composition;
    // The target segment's underline is twice as thick, on the same bottom edge; the rest thin.
    const pieces: [from: number, to: number, thickness: number][] = hasTarget
      ? [
          [from, target[0], 1],
          [target[0], target[1], 2],
          [target[1], to, 1],
        ]
      : [[from, to, 1]];
    for (const [pieceFrom, pieceTo, thickness] of pieces) {
      if (pieceFrom >= pieceTo) continue;
      for (const span of rangeSpans(layout, pieceFrom, pieceTo)) {
        const underline = {
          x: span.x,
          y: span.y + span.height - (1 + thickness) * pixel,
          width: span.width,
          height: thickness * pixel,
        };
        rects.push(placeText(underline, input.caretColor));
      }
    }
  }
  if (start === end && !hasTarget) {
    // While composing, the input method's caret, if it gave one.
    const index = target === undefined ? input.caret : target[1];
    const caret = caretRect(layout, index);
    const width = CARET_WIDTH_PX * pixel;
    const { secondary } = caretPlacement(layout, index);
    // Where text changes direction the caret splits: the upper half before the
    // grapheme after it, the lower half after the one before it.
    const height = secondary === undefined ? caret.height : caret.height / 2;
    rects.push(placeText({ x: caret.x - width / 2, y: caret.y, width, height }, input.caretColor));
    if (secondary !== undefined) {
      const lower = { x: secondary - width / 2, y: caret.y + height, width, height };
      rects.push(placeText(lower, input.caretColor));
    }
  }
  return rects;
}
