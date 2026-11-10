import {
  caretRect,
  lineOf,
  NOTE_PADDING,
  type PeerEditingBox,
  type SceneSource,
  type TextLayout,
} from '@canvas/engine';
import type { ObjectId, Rgba } from '@canvas/schema';
import {
  layoutContent,
  measuredSize,
  rectToWorld,
  textFrameOf,
  textOriginIn,
  type EditableTextObject,
  type LocalRect,
  type TextLayoutService,
} from '@canvas/tools';

/** A peer editing a text, as presence says. */
export interface PeerEditingInput {
  /** The peer's principal id. */
  readonly principalId: string;
  /** The peer's name, as presence shows it. */
  readonly name: string;
  /** The peer's presence colour, `#rrggbb`. */
  readonly color: string;
  /** The edited object. */
  readonly objectId: string;
  /** The selection's fixed end, a UTF-16 offset. */
  readonly anchor: number;
  /** The selection's moving end, where the caret is, a UTF-16 offset. */
  readonly focus: number;
}

/** Where a peer's edit is on the board, world units, turned with the object. */
export interface PeerEditingGeometry {
  /** The edited text box. */
  readonly box: PeerEditingBox;
  /** The caret's line box, zero wide. */
  readonly caret: PeerEditingBox;
  /** The selection's span on each line it covers; none for a caret. */
  readonly highlights: readonly PeerEditingBox[];
}

/**
 * A `#rrggbb` colour as straight-alpha channels, opaque.
 *
 * @param hex - The colour; presence holds only `#rrggbb`.
 * @returns Its channels, 0 to 1.
 */
export function rgbaOfHex(hex: string): Rgba {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255, 1];
}

/**
 * The objects whose text a peer's edit is shown on: text, sticky notes and labelled shapes. A
 * connector's label is placed along its route, which this does not follow; a shape with no
 * label yet has no text to place a caret in.
 *
 * @param object - The object the peer claims to edit.
 * @returns Whether it is shown.
 */
function isShownText(
  object: ReturnType<SceneSource['get']>,
): object is Exclude<EditableTextObject, { type: 'connector' }> {
  if (object?.type === 'text' || object?.type === 'sticky') return true;
  return object?.type === 'shape' && object.label !== null;
}

/**
 * The box the engine draws a text in, in its object's frame from its origin (as the local
 * editor outlines it): a text object's measured size, a note's width and the taller of its
 * height and its padded text, a shape's whole box.
 *
 * @param object - The object.
 * @param layout - Its text's layout.
 * @returns The box.
 */
function boxOf(object: Exclude<EditableTextObject, { type: 'connector' }>, layout: TextLayout) {
  if (object.type === 'text') return measuredSize(object, layout);
  if (object.type === 'shape') return { width: object.width, height: object.height };
  return {
    width: object.width,
    height: Math.max(object.height, layout.height + 2 * NOTE_PADDING),
  };
}

/**
 * The spans of a range per line, in the text's frame: each line's part of `[start, end)`.
 *
 * @param layout - The laid-out text.
 * @param start - The range's start.
 * @param end - Its end.
 * @returns One rectangle per line the range covers.
 */
function rangeSpans(layout: TextLayout, start: number, end: number): LocalRect[] {
  if (start >= end) return [];
  const spans: LocalRect[] = [];
  const first = lineOf(layout, start);
  const last = lineOf(layout, end);
  for (let index = first; index <= last; index += 1) {
    const line = layout.lines[index];
    if (line === undefined) continue;
    const left = index === first ? caretRect(layout, start).x : line.x;
    const right = index === last ? caretRect(layout, end).x : line.x + line.width;
    if (right > left) spans.push({ x: left, y: line.y, width: right - left, height: line.height });
  }
  return spans;
}

/**
 * Where a peer's edit is on the board: the edited object's text box, the caret at the
 * peer's `focus` and their selection's spans, laid out exactly as the engine draws the text the
 * board holds now, turned with the object. Offsets past the text (the peer's last keystroke not
 * here yet) are held at its end. Pure.
 *
 * @param board - The board, for the object and its ancestors.
 * @param layout - Lays text out on the page.
 * @param peer - The peer's object and offsets.
 * @returns The geometry; `undefined` when the object is not a shown text (`isShownText`), or
 *   while no font lays it out.
 */
export function peerEditingGeometryOf(
  board: SceneSource,
  layout: TextLayoutService,
  peer: Pick<PeerEditingInput, 'objectId' | 'anchor' | 'focus'>,
): PeerEditingGeometry | undefined {
  const object = board.get(peer.objectId as ObjectId);
  if (!isShownText(object)) return undefined;
  const content = object.type === 'shape' ? object.label : object;
  if (content === null) return undefined;
  const laidOut = layoutContent({ layout }, object, content);
  if (laidOut === undefined) return undefined;
  const frame = textFrameOf(object, board);
  const origin = textOriginIn(object, laidOut);
  const inText = (rect: LocalRect): PeerEditingBox =>
    rectToWorld(frame, { ...rect, x: origin.x + rect.x, y: origin.y + rect.y });
  const length = content.text.length;
  const anchor = Math.min(peer.anchor, length);
  const focus = Math.min(peer.focus, length);
  const caret = caretRect(laidOut, focus);
  return {
    box: rectToWorld(frame, { x: 0, y: 0, ...boxOf(object, laidOut) }),
    caret: inText({ x: caret.x, y: caret.y, width: 0, height: caret.height }),
    highlights: rangeSpans(laidOut, Math.min(anchor, focus), Math.max(anchor, focus)).map(inText),
  };
}
