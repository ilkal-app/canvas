import { screenToWorld, type SceneSource, type TextLayout } from '@canvas/engine';
import type { BoardObject, ObjectId, Point, StyleRun } from '@canvas/schema';
import {
  layoutContent,
  linkAtLayoutPoint,
  linkHitAtLayoutPoint,
  textFrameOf,
  textOriginIn,
  worldToLocal,
  type EditableTextObject,
  type TextLayoutService,
} from '@canvas/tools';

import type { MountedEngine } from '../engine/mounted-engine.js';
import { PAGE_TEXT_LAYOUT } from '../text-input/page-fonts.js';

/**
 * The stored link of an object, if it has one.
 *
 * @param object - The object.
 * @returns Its link, or undefined.
 */
export function linkOf(object: BoardObject | undefined): string | undefined {
  const link: unknown = object === undefined ? undefined : Reflect.get(object, 'link');
  return typeof link === 'string' ? link : undefined;
}

/**
 * The text an object draws, which may carry run links: a text's or sticky's, or a
 * shape's or connector's label.
 *
 * @param object - The object.
 * @returns The object as an editable text and its content, or undefined when it draws none.
 */
function drawnTextOf(object: BoardObject | undefined):
  | {
      readonly object: EditableTextObject;
      readonly text: string;
      readonly runs: readonly StyleRun[];
    }
  | undefined {
  if (object?.type === 'text' || object?.type === 'sticky') {
    return { object, text: object.text, runs: object.runs };
  }
  if ((object?.type === 'shape' || object?.type === 'connector') && object.label !== null) {
    return { object, text: object.label.text, runs: object.label.runs };
  }
  return undefined;
}

/**
 * The run link of the character under a world point: the text laid out as the engine
 * draws it, the point taken into the object's frame (through its parents when the board is
 * given, else the object's own place and turn), and the character whose glyph box holds it, on
 * the line whose box holds it. Undefined off every glyph, on a character without a link, and for
 * an object that draws no text; the object's own link is the caller's fallback. Pure.
 *
 * @param object - The object.
 * @param layout - Its text, laid out (`layoutContent`).
 * @param world - The point, world units.
 * @param board - The board, for the object's ancestors; a root object needs none.
 * @returns The run's link, or undefined.
 */
export function runLinkAt(
  object: BoardObject,
  layout: TextLayout,
  world: Point,
  board?: SceneSource,
): string | undefined {
  const drawn = drawnTextOf(object);
  if (drawn === undefined) return undefined;
  const frame =
    board === undefined
      ? {
          x: object.x,
          y: object.y,
          cos: Math.cos(object.rotation),
          sin: Math.sin(object.rotation),
        }
      : textFrameOf(object, board);
  const local = worldToLocal(frame, world);
  const origin = textOriginIn(drawn.object, layout);
  return linkAtLayoutPoint(layout, { x: local.x - origin.x, y: local.y - origin.y }, drawn.runs);
}

/** A link under a point of the canvas: whose, which, and where a chip about it sits. */
export interface CanvasLinkHit {
  /** The object the link belongs to, or whose text holds it. */
  readonly objectId: ObjectId;
  /** The link. */
  readonly link: string;
  /** The characters that carry it, for a run link; absent for the object's own link. */
  readonly span?: { readonly start: number; readonly end: number } | undefined;
  /**
   * Where a chip about it sits, world units: under the link's characters on the line under the
   * point (their box's bottom-left corner, turned with the object), or the point itself for the
   * object's own link.
   */
  readonly anchor: Point;
}

/** Laid-out texts by object and layout service: objects are immutable, so a change is a new one. */
const laidOutTexts = new WeakMap<TextLayoutService, WeakMap<BoardObject, TextLayout | undefined>>();

/**
 * An object's drawn text laid out as the page draws it, kept while the object is the same.
 *
 * @param object - The object.
 * @param drawn - Its text.
 * @param textLayout - Lays text out.
 * @returns The layout, or undefined while no font can lay it out.
 */
function laidOutOf(
  object: BoardObject,
  drawn: NonNullable<ReturnType<typeof drawnTextOf>>,
  textLayout: TextLayoutService,
): TextLayout | undefined {
  const known = laidOutTexts.get(textLayout) ?? new WeakMap<BoardObject, TextLayout | undefined>();
  laidOutTexts.set(textLayout, known);
  if (known.has(object)) return known.get(object);
  const laidOut = layoutContent({ layout: textLayout }, drawn.object, {
    text: drawn.text,
    runs: drawn.runs,
  });
  known.set(object, laidOut);
  return laidOut;
}

/**
 * The run link under a world point in an object's text, with its span and the world point a
 * chip about it sits at, as `runLinkAt` finds it.
 *
 * @param object - The object.
 * @param drawn - Its text.
 * @param layout - Its text, laid out.
 * @param world - The point, world units.
 * @param board - The board, for the object's ancestors.
 * @returns The hit, or undefined.
 */
function runLinkHitAt(
  object: BoardObject,
  drawn: NonNullable<ReturnType<typeof drawnTextOf>>,
  layout: TextLayout,
  world: Point,
  board: SceneSource,
): CanvasLinkHit | undefined {
  const frame = textFrameOf(object, board);
  const local = worldToLocal(frame, world);
  const origin = textOriginIn(drawn.object, layout);
  const point = { x: local.x - origin.x, y: local.y - origin.y };
  const hit = linkHitAtLayoutPoint(layout, point, drawn.runs);
  if (hit === undefined) return undefined;
  const corner = { x: origin.x + hit.box.x, y: origin.y + hit.box.y + hit.box.height };
  const anchor = {
    x: frame.x + frame.cos * corner.x - frame.sin * corner.y,
    y: frame.y + frame.sin * corner.x + frame.cos * corner.y,
  };
  return { objectId: object.id, link: hit.link, span: { start: hit.start, end: hit.end }, anchor };
}

/**
 * Whether an object carries any link, its own or a run's: the cheap test before laying its text
 * out under a moving pointer.
 *
 * @param object - The object.
 * @param drawn - Its text, if it draws one.
 * @returns True when it does.
 */
function hasLink(object: BoardObject, drawn: ReturnType<typeof drawnTextOf>): boolean {
  return (
    linkOf(object) !== undefined || drawn?.runs.some((run) => run.style.link !== undefined) === true
  );
}

/**
 * The link under a point of the page: the topmost object drawn there
 * (the engine's exact hit, `BoardView.idsAt`: fills, strokes and clipping, as the select tool
 * picks), then the link of the run under the point in its text, else the object's own link, with
 * where a chip about it sits. An object drawn above a linked one hides the link; a point outside
 * an object's painted geometry is not on it. An object without a link is never laid out, so a
 * hover costs one hit test; a linked text is laid out once per version. Main thread.
 *
 * @param engine - The engine.
 * @param canvas - The canvas the engine draws into.
 * @param clientX - The point, CSS px on the page.
 * @param clientY - The point, CSS px on the page.
 * @param textLayout - Lays text out as the page draws it; the page's fonts by default.
 * @returns The link, whose and where, or undefined.
 */
export function linkHitAtPoint(
  engine: MountedEngine,
  canvas: Element,
  clientX: number,
  clientY: number,
  textLayout: TextLayoutService = PAGE_TEXT_LAYOUT,
): CanvasLinkHit | undefined {
  const rect = canvas.getBoundingClientRect();
  const camera = engine.camera();
  const world = screenToWorld(camera, { x: clientX - rect.left, y: clientY - rect.top });
  const [topmost] = engine.board.idsAt?.(world, camera.zoom) ?? [];
  const object = topmost === undefined ? undefined : engine.board.board.get(topmost);
  if (object === undefined) return undefined;
  const drawn = drawnTextOf(object);
  if (!hasLink(object, drawn)) return undefined;
  const laidOut = drawn === undefined ? undefined : laidOutOf(object, drawn, textLayout);
  const runHit =
    drawn === undefined || laidOut === undefined
      ? undefined
      : runLinkHitAt(object, drawn, laidOut, world, engine.board.board);
  if (runHit !== undefined) return runHit;
  const own = linkOf(object);
  return own === undefined ? undefined : { objectId: object.id, link: own, anchor: world };
}

/**
 * The link under a point of the page, for ⌘/Ctrl-click: `linkHitAtPoint`'s
 * link. Main thread.
 *
 * @param engine - The engine.
 * @param canvas - The canvas the engine draws into.
 * @param clientX - The point, CSS px on the page.
 * @param clientY - The point, CSS px on the page.
 * @param textLayout - Lays text out as the page draws it; the page's fonts by default.
 * @returns The link, or undefined.
 */
export function linkAtPoint(
  engine: MountedEngine,
  canvas: Element,
  clientX: number,
  clientY: number,
  textLayout: TextLayoutService = PAGE_TEXT_LAYOUT,
): string | undefined {
  return linkHitAtPoint(engine, canvas, clientX, clientY, textLayout)?.link;
}
