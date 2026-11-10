import type { BoardObject, StyleRun, TextStyle } from '@canvas/schema';
import { LINE_HEIGHT_EM } from '@canvas/text';

import type { TextBoxGeometry } from './text-placement.js';

/**
 * How tall a frame's title band is, CSS px, whatever the zoom: the strip just above the frame's
 * top edge, across its width, where its name is drawn and where the select tool picks
 * the frame (`FRAME_TITLE_BAND_PX` of `@canvas/tools`, which must stay equal).
 */
export const FRAME_TITLE_BAND_PX = 24;

/** The frame name's font size, CSS px, whatever the zoom. */
export const FRAME_TITLE_FONT_PX = 12;

/** The style a frame's name is drawn in: the bundled sans at 12 px, a quiet grey. */
export const FRAME_TITLE_STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: FRAME_TITLE_FONT_PX,
  color: [0.38, 0.39, 0.42, 1],
  weight: 400,
  italic: false,
};

/** How far the name's line sits above the frame's top edge, CSS px (its bottom margin). */
const BOTTOM_MARGIN_PX = 4;

/**
 * Where a frame's name is laid out, in CSS pixels from the frame's top-left corner,
 * x along its top edge and y down: one line, unwrapped, left-aligned at the corner, its bottom
 * 4 CSS px above the top edge, inside the {@link FRAME_TITLE_BAND_PX} band. The
 * frame title pass scales these units by the camera's CSS pixel on the GPU, so the name keeps
 * its size on screen at every zoom and turns with the frame. A frame whose name is hidden
 * (`showName: false`, as the scene resolves it) places none. Pure.
 *
 * @param object - The object.
 * @returns The box, or `undefined` for anything but a frame with a shown name.
 */
export function frameTitlePlacement(object: BoardObject): TextBoxGeometry | undefined {
  if (!hasFrameTitle(object) || object.name.length === 0) return undefined;
  const lineHeight = FRAME_TITLE_FONT_PX * LINE_HEIGHT_EM;
  const runs: readonly StyleRun[] = [{ length: object.name.length, style: FRAME_TITLE_STYLE }];
  return {
    text: object.name,
    runs,
    origin: { x: 0, y: -BOTTOM_MARGIN_PX - lineHeight },
    wrapWidth: null,
    align: 'left',
    direction: 'auto',
    verticalAlign: 'top',
    boxHeight: lineHeight,
  };
}

/**
 * Whether an object is a frame whose name the frame title pass draws: any frame but
 * one whose `showName` is `false`. The scene hands passes frames with `showName` resolved over
 * their ancestors (`withResolvedFrameNames`, `isFrameNameShown`), once per change set, so the
 * pass reads the frame alone and a frame at rest costs nothing per drawn frame. Pure.
 *
 * @param object - The object, as the scene hands it to passes.
 * @returns `true` for a frame with a shown name.
 */
export function hasFrameTitle(
  object: BoardObject,
): object is Extract<BoardObject, { type: 'frame' }> {
  return object.type === 'frame' && object.showName !== false;
}

/**
 * The text the frame title pass draws for an object: a frame's name, when it is shown.
 *
 * @param object - The object.
 * @returns The name, or `undefined` for anything but a frame with a shown name.
 */
export function frameTitleTextOf(object: BoardObject): string | undefined {
  return hasFrameTitle(object) ? object.name : undefined;
}
