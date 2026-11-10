import {
  CONNECTOR_LABEL_WRAP_WIDTH,
  NOTE_PADDING,
  noteTextPlacement,
  textOriginOf,
  worldTransformOf,
  type SceneSource,
  type TextLayout,
  type WorldTransform,
} from '@canvas/engine';
import type { BoardObject, Point } from '@canvas/schema';

import type { OrientedBox } from '../select/oriented-box.js';

import type { EditableTextObject } from './text-box-object.js';
import { editedPlacementOf, measuredSize } from './text-content-writer.js';

/** A rectangle in a text box's own frame, world units. */
export interface LocalRect {
  /** Left. */
  readonly x: number;
  /** Top. */
  readonly y: number;
  /** Width. */
  readonly width: number;
  /** Height. */
  readonly height: number;
}

/**
 * A text object's frame to the world, its ancestors included.
 *
 * @param object - The text object.
 * @param source - The document, for its ancestors.
 * @returns The transform.
 */
export function textFrameOf(object: BoardObject, source: SceneSource): WorldTransform {
  return worldTransformOf(object, source);
}

/**
 * A rectangle in an object's frame as an oriented box in the world, for the overlay.
 *
 * @param transform - The object's frame.
 * @param rect - The rectangle, in the object's frame.
 * @returns The box, turned with the object.
 */
export function rectToWorld(transform: WorldTransform, rect: LocalRect): OrientedBox {
  return {
    x: transform.x + transform.cos * rect.x - transform.sin * rect.y,
    y: transform.y + transform.sin * rect.x + transform.cos * rect.y,
    width: rect.width,
    height: rect.height,
    rotation: Math.atan2(transform.sin, transform.cos),
  };
}

/**
 * A world point in an object's frame (the inverse of the transform).
 *
 * @param transform - The object's frame.
 * @param world - The point, world units.
 * @returns The point in the object's frame.
 */
export function worldToLocal(transform: WorldTransform, world: Point): Point {
  const dx = world.x - transform.x;
  const dy = world.y - transform.y;
  return {
    x: transform.cos * dx + transform.sin * dy,
    y: -transform.sin * dx + transform.cos * dy,
  };
}

/**
 * The box an edited text box occupies, as the engine draws it, in its object's frame from its
 * origin: a sticky note's stored width and the taller of its stored height and its text with the
 * padding (the engine's text pass centres short text in the stored height and lets taller text
 * run from the top padding, `textOriginOf`), so the editor outlines and hit-tests exactly the
 * paper the engine shows; a text object's measured size (`measuredSize`), which is exactly its
 * text's; a shape's stored size, the whole shape, whose label never resizes it; a
 * connector's label box, as wide as it wraps and as tall as its text. Pure.
 *
 * @param object - The text, note, shape or connector, with its stored size.
 * @param layout - The content the editor shows, laid out.
 * @returns The box's size, world units.
 */
export function editedBoxSize(
  object: EditableTextObject,
  layout: TextLayout,
): {
  /** The box's width, world units. */
  readonly width: number;
  /** The box's height, world units. */
  readonly height: number;
} {
  if (object.type === 'text') return measuredSize(object, layout);
  if (object.type === 'shape') return { width: object.width, height: object.height };
  if (object.type === 'connector')
    return { width: CONNECTOR_LABEL_WRAP_WIDTH, height: layout.height };
  return {
    width: object.width,
    height: Math.max(object.height, layout.height + 2 * NOTE_PADDING),
  };
}

/**
 * Where a text box's laid-out text starts in its object's frame, exactly as the engine's text
 * pass places it (`textPlacementOf`, `textOriginOf`) from the object's stored size: a sticky
 * note's text inside its padding, centred vertically in its stored height while short, from the
 * top padding once taller; a text object's at its origin, since it measures exactly as tall as
 * its text; a shape's label centred in the box inscribed in its kind (`shapeLabelPlacement`); a
 * connector's label centred halfway along its route (`connectorLabelPlacement`). The editor maps
 * presses, the caret and highlights through it.
 *
 * @param object - The text, note, shape or connector, with its stored size.
 * @param layout - Its content's layout.
 * @returns The text's top-left, world units in the object's frame.
 */
export function textOriginIn(object: EditableTextObject, layout: TextLayout): Point {
  if (object.type === 'text') return { x: 0, y: 0 };
  if (object.type === 'sticky') return textOriginOf(noteTextPlacement(object), layout);
  return textOriginOf(editedPlacementOf(object), layout);
}

/**
 * The box an edited object's editor outlines, in its object's frame: from the frame's origin
 * ({@link editedBoxSize}) for a text box or a shape; for a connector, its label's box, centred on
 * the label point halfway along its route. Pure.
 *
 * @param object - The text, note, shape or connector.
 * @param layout - The content the editor shows, laid out.
 * @returns The rectangle, world units in the object's frame.
 */
export function editedBoxRect(object: EditableTextObject, layout: TextLayout): LocalRect {
  const { width, height } = editedBoxSize(object, layout);
  if (object.type !== 'connector') return { x: 0, y: 0, width, height };
  return { ...textOriginIn(object, layout), width, height };
}

/**
 * Where presses on an edited box go to the editor, in its object's frame: the box it occupies
 * ({@link editedBoxRect}), and for a shape also its label's lines where they overflow the shape
 * above or below (a label taller than its box stays centred on it, `shapeLabelPlacement`;
 *), so a press on any line of the label places the caret. Pure.
 *
 * @param object - The text, note, shape or connector, with its stored size.
 * @param layout - The content the editor shows, laid out.
 * @returns The rectangle, world units in the object's frame.
 */
export function editedHitRect(object: EditableTextObject, layout: TextLayout): LocalRect {
  const box = editedBoxRect(object, layout);
  if (object.type !== 'shape') return box;
  const textTop = textOriginIn(object, layout).y;
  const top = Math.min(0, textTop);
  const bottom = Math.max(box.height, textTop + layout.height);
  return { x: 0, y: top, width: box.width, height: bottom - top };
}
