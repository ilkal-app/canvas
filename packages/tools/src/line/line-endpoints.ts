import { runCommand, setLinePointsCommand } from '@canvas/document';
import { isDrawableIn, visibleWorldBounds, worldTransformOf } from '@canvas/engine';
import {
  applyTransform,
  invertTransform,
  type LineObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { isPastClickThreshold } from '../select/click-threshold.js';
import { handleHitSizePx } from '../select/handle-layout.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectPointer, SelectPointerType } from '../select/select-input.js';
import type { SelectionSource } from '../select/selection-geometry.js';

import type { LineToolContext } from './line-context.js';
import { lineEndAt, type LineEnd } from './line-end.js';
import { anchorMarkerRect, endpointHandleRects } from './line-overlay.js';

/** What endpoint editing needs beyond a line tool's context: the selection and what is drawn. */
export interface LineEndpointContext extends LineToolContext {
  /**
   * The document as the scene draws it (the select tool's source, with its drag preview), so the
   * handles follow a line being moved.
   */
  readonly source: SelectionSource;
  /** The selected ids now. */
  readonly selection: () => readonly ObjectId[];
}

/** Which end of a line: 0 its start, 1 its end. */
export type LineEndIndex = 0 | 1;

/**
 * An endpoint drag under way. It keeps the line's id, not the line: the line is read again from
 * the source on every input, so a collaborator's move of the line or drag of its other end shows
 * during the drag and is kept by the release.
 */
interface EndpointDrag {
  /** The line. */
  readonly id: ObjectId;
  /** The end dragged. */
  readonly index: LineEndIndex;
  /** The press that started the drag. */
  readonly press: SelectPointer;
  /** Where the dragged end goes, once the drag passed the click threshold. */
  readonly end: LineEnd | undefined;
}

/**
 * A line's two ends in board coordinates.
 *
 * @param line - The line.
 * @param source - The document, for its ancestors.
 * @returns Its start and end.
 */
export function lineEndsOf(line: LineObject, source: SelectionSource): [Point, Point] {
  const transform = worldTransformOf(line, source);
  return [applyTransform(transform, line.points[0]), applyTransform(transform, line.points[1])];
}

/**
 * A line's endpoint editing in the select tool: a
 * lone selected, unlocked line shows a handle on each end instead of the selection frame and its
 * box handles; a press on a handle drags that end, snapping to object anchors, edges, centres and
 * the grid (`lineEndAt`; Alt suspends) or, with Shift, turning to the nearest 45° about the other
 * end. The drag previews the line and writes nothing until the release, which runs exactly one
 * `setLinePoints` of the dragged end alone (one undo step); a release within the click
 * threshold, a cancel (a second finger, a lost pointer) and Escape write nothing. The line is
 * read from the source on every move, so the preview shows a collaborator's move of the line or
 * drag of the other end, and the release leaves the other end where it is then; a line deleted
 * meanwhile ends the drag. A line locked meanwhile (a collaborator) refuses the command, which
 * the shell is told of (`onCommandRefused`). The app's select mode offers each press here first.
 * Main thread; no DOM.
 */
export class LineEndpoints {
  private readonly context: LineEndpointContext;
  private drag: EndpointDrag | undefined;
  private zoom = 1;

  /**
   * Starts with nothing dragged.
   *
   * @param context - The document, the selection, previews and the callbacks.
   */
  constructor(context: LineEndpointContext) {
    this.context = context;
  }

  /**
   * Whether an end is being dragged: the select mode then gives this every pointer input.
   *
   * @returns True between a press on a handle and its release or cancel.
   */
  get isDragging(): boolean {
    return this.drag !== undefined;
  }

  /**
   * The line whose ends show handles: the selection when it is one unlocked line the engine can
   * draw. A line a peer wrote with an end at NaN or far past the board has no handles,
   * so the overlay never carries its ends; it can still be deleted.
   *
   * @returns The line, as the scene draws it, or `undefined`.
   */
  editableLine(): LineObject | undefined {
    const ids = this.context.selection();
    const [only] = ids;
    if (ids.length !== 1 || only === undefined) return undefined;
    const { source } = this.context;
    const object = source.get(only);
    if (object?.type !== 'line' || object.locked) return undefined;
    return isDrawableIn(object, source) ? object : undefined;
  }

  /**
   * The handle under a point, if any: a square of the handle hit size (larger for a finger)
   * centred on each end, the end point last, so it wins where a short line's handles overlap.
   * On a line too short on screen for two whole squares, the squares shrink so that they cover
   * at most a third of the line each: the middle third is body, which a press drags whole. On a
   * line shorter than half a square, or with coinciding ends, the squares stay whole.
   *
   * @param world - The pointer, world units.
   * @param zoom - The camera zoom.
   * @param pointerType - The pointer, which sizes the target.
   * @returns Which end, or `undefined`.
   */
  handleAt(world: Point, zoom: number, pointerType?: SelectPointerType): LineEndIndex | undefined {
    const line = this.editableLine();
    if (!line) return undefined;
    const ends = lineEndsOf(line, this.context.source);
    // A square reaches along the line as far as its half-size over the larger of the line's
    // direction components, so a third of that larger span keeps the middle third free. A line
    // shorter on screen than half a square (down to none: ends that coincide after a merge) has
    // no body worth aiming at, so its handles keep whole squares and it can be pulled apart.
    const sizePx = handleHitSizePx(pointerType);
    const span = Math.max(Math.abs(ends[1].x - ends[0].x), Math.abs(ends[1].y - ends[0].y));
    const full = sizePx / 2 / zoom;
    const reach = span * zoom < sizePx / 2 ? full : Math.min(full, span / 3);
    const isOn = (end: Point) =>
      Math.abs(world.x - end.x) <= reach && Math.abs(world.y - end.y) <= reach;
    if (isOn(ends[1])) return 1;
    return isOn(ends[0]) ? 0 : undefined;
  }

  /**
   * Offers a press: on a handle of the editable line it starts dragging that end.
   *
   * @param press - The primary button's press.
   * @param zoom - The camera zoom.
   * @returns Whether the press was taken (the select tool must not see it then).
   */
  press(press: SelectPointer, zoom: number): boolean {
    this.zoom = zoom;
    const index = this.handleAt(press.world, zoom, press.pointerType);
    const line = this.editableLine();
    if (index === undefined || !line) return false;
    this.drag = { id: line.id, index, press, end: undefined };
    return true;
  }

  /**
   * Takes a pointer input while an end is dragged: moves preview it, the release writes it,
   * a cancel drops it.
   *
   * @param input - The input.
   */
  follow(input: ToolPointerInput): void {
    const { drag } = this;
    if (!drag) return;
    if (input.kind === 'pointerCancel') {
      this.cancel();
      return;
    }
    if (input.kind !== 'pointerMove' && input.kind !== 'pointerUp') return;
    this.zoom = input.zoom;
    const line = this.lineOf(drag);
    if (!line) {
      this.cancel();
      return;
    }
    const fixed = lineEndsOf(line, this.context.source)[drag.index === 0 ? 1 : 0];
    const end = lineEndAt(input, fixed, {
      index: this.context.snapIndex,
      source: this.context.source,
      excludedIds: new Set([drag.id]),
      zoom: input.zoom,
      snapping: input.snapping,
      viewport: input.camera && visibleWorldBounds(input.camera),
    });
    const isDragged = isPastClickThreshold(drag.press, input.screen);
    const dragged = { ...drag, end: isDragged ? end : undefined };
    if (input.kind === 'pointerUp') {
      this.drag = undefined;
      this.commit(dragged);
      return;
    }
    this.drag = dragged;
    this.context.setPreview(drag.id, this.movedLine(line, dragged));
  }

  /** Drops the drag and its preview; nothing is written (Escape, a cancel, leaving the tool). */
  cancel(): void {
    const { drag } = this;
    if (!drag) return;
    this.drag = undefined;
    this.context.setPreview(drag.id, undefined);
  }

  /**
   * Remembers the zoom the handles are sized for.
   *
   * @param zoom - The camera zoom now.
   * @returns Whether the handles show and must be redrawn at the new size.
   */
  followZoom(zoom: number): boolean {
    if (zoom === this.zoom) return false;
    this.zoom = zoom;
    return this.drag !== undefined || this.editableLine() !== undefined;
  }

  /**
   * What endpoint editing shows over the select tool's overlay: for an editable line, no frame
   * (so no box, box handles or rotation outline) and a handle on each end, where the drag puts
   * them, with a marker on the anchor a dragged end landed on and the guides it snapped to.
   *
   * @returns The fields to lay over the select tool's, or none.
   */
  overlay(): Partial<SelectionOverlayModel> | undefined {
    const { drag } = this;
    const line = drag ? this.lineOf(drag) : this.editableLine();
    if (!line) return undefined;
    const ends = drag ? this.draggedEnds(line, drag) : lineEndsOf(line, this.context.source);
    const toolRects = ends.flatMap((end) => endpointHandleRects(end, this.zoom));
    const end = this.drag?.end;
    if (end?.anchor) toolRects.push(anchorMarkerRect(end.anchor, this.zoom));
    const guides = end?.guides ?? [];
    return guides.length > 0
      ? { frame: undefined, toolRects, guides }
      : { frame: undefined, toolRects };
  }

  /**
   * The dragged line as the document holds it now, collaborators' edits included.
   *
   * @param drag - The drag.
   * @returns The line, or `undefined` when it is gone (deleted meanwhile).
   */
  private lineOf(drag: EndpointDrag): LineObject | undefined {
    const object = this.context.source.get(drag.id);
    return object?.type === 'line' ? object : undefined;
  }

  /**
   * The ends of the line as a drag has them, board coordinates: the dragged end where the
   * pointer put it, the other where the document has it now.
   *
   * @param line - The line now.
   * @param drag - The drag.
   * @returns Start and end.
   */
  private draggedEnds(line: LineObject, drag: EndpointDrag): [Point, Point] {
    const ends = lineEndsOf(line, this.context.source);
    const moved = drag.end?.point;
    if (moved) ends[drag.index] = moved;
    return ends;
  }

  /**
   * The line with the dragged end moved, its points brought into its own frame, for the preview.
   *
   * @param line - The line now.
   * @param drag - The drag.
   * @returns The line, or `undefined` before the drag passed the click threshold.
   */
  private movedLine(line: LineObject, drag: EndpointDrag): LineObject | undefined {
    if (!drag.end) return undefined;
    const toLine = invertTransform(worldTransformOf(line, this.context.source));
    const [start, end] = this.draggedEnds(line, drag);
    return { ...line, points: [applyTransform(toLine, start), applyTransform(toLine, end)] };
  }

  /**
   * Writes a finished drag as one `setLinePoints` of the dragged end alone, and drops the
   * preview; a click writes nothing. The command reads the other end from the document.
   *
   * @param drag - The drag, ended.
   */
  private commit(drag: EndpointDrag): void {
    const { context } = this;
    const point = drag.end?.point;
    if (point) {
      const write = () => {
        const outcome = runCommand(
          context.store,
          context.origin,
          setLinePointsCommand,
          { id: drag.id, end: drag.index, point },
          context.environment,
        );
        if (outcome.status === 'rejected') context.onCommandRefused?.(outcome.errors);
      };
      if (context.capture) context.capture.command(write);
      else write();
    }
    context.setPreview(drag.id, undefined);
  }
}
