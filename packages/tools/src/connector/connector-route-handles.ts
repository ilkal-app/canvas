import { runCommand, setStyleCommand } from '@canvas/document';
import {
  isDrawableIn,
  resolveConnectorEnds,
  resolveConnectorShape,
  worldTransformOf,
} from '@canvas/engine';
import {
  applyTransform,
  cubicMidpoint,
  curvedConnectorCubic,
  curvePointOf,
  elbowMiddlePiece,
  invertTransform,
  type ConnectorCurvePoint,
  type ConnectorObject,
  type ElbowMiddlePiece,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import type { LineToolContext } from '../line/line-context.js';
import type { ToolPointerInput } from '../modes/tool-mode.js';
import { isPastClickThreshold } from '../select/click-threshold.js';
import { handleHitSizePx } from '../select/handle-layout.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectPointer, SelectPointerType } from '../select/select-input.js';
import type { SelectionSource } from '../select/selection-geometry.js';

import { curveHandleRects, elbowHandleRects } from './connector-route-overlay.js';
import {
  clampedCurvePoint,
  isQuickAfter,
  ROUTE_HANDLE_RESET_MS,
  withHandle,
  type RouteHandleKind,
} from './connector-route-values.js';

/** What a connector's route handles need beyond a line tool's context. */
export interface ConnectorRouteHandlesContext extends LineToolContext {
  /** The document as the scene draws it (the select tool's source, with its drag preview). */
  readonly source: SelectionSource;
  /** The selected ids now. */
  readonly selection: () => readonly ObjectId[];
}

/** How close to its automatic place a dragged handle snaps back to it, CSS px. */
export const ROUTE_HANDLE_SNAP_PX = 6;

/** A connector's route handle where it is drawn now. */
interface RouteHandle {
  /** The connector. */
  readonly connector: ConnectorObject;
  /** Which handle. */
  readonly kind: RouteHandleKind;
  /** Its centre, world units. */
  readonly center: Point;
  /** The axis an elbow's middle piece moves along (`'x'` for an upright piece; a curve's `'x'`). */
  readonly axis: ElbowMiddlePiece['axis'];
}

/** What a drag writes: a value, or `undefined` to remove the field (back to automatic). */
interface HandleValue {
  /** The value. */
  readonly value: number | ConnectorCurvePoint | undefined;
}

/** A handle drag under way. */
interface HandleDrag {
  readonly id: ObjectId;
  readonly kind: RouteHandleKind;
  readonly press: SelectPointer;
  /** What the release writes, once the drag passed the click threshold. */
  readonly moved: HandleValue | undefined;
}

/** The last click on a handle (a press released in place), for a double-click's reset. */
interface HandleClick {
  readonly id: ObjectId;
  readonly kind: RouteHandleKind;
  readonly timeStamp: number | undefined;
}

/**
 * A lone selected connector's route handles (the owner's batch 4 item 9): a bar on an
 * elbow route's movable piece (`elbowMiddlePiece`: its middle piece, or with one bend the arm into
 * the end, which a drag gives a second bend), which drags square to the piece between the ends'
 * stubs, and a dot
 * at a curved route's midpoint, which bends it. Moves preview the connector; the release writes
 * one `setStyle` of `elbowMiddle` or `curvePoint`, one undo step. Within
 * {@link ROUTE_HANDLE_SNAP_PX} of its automatic place a handle snaps back, and the release removes
 * the field, so the connector routes automatically again (a curve's dot also snaps onto the line
 * between its ends); a second press within
 * {@link ROUTE_HANDLE_RESET_MS} of a click on a handle does the same. A press released in place
 * writes nothing. Straight routes have no handle. Main thread.
 */
export class ConnectorRouteHandles {
  private readonly context: ConnectorRouteHandlesContext;
  private drag: HandleDrag | undefined;
  private click: HandleClick | undefined;
  private zoom = 1;

  /**
   * Starts with nothing dragged.
   *
   * @param context - The document, the selection, previews and the callbacks.
   */
  constructor(context: ConnectorRouteHandlesContext) {
    this.context = context;
  }

  /** Hidden while another editor drags (an end): its place would lag that drag's preview. */
  readonly isHiddenDuringOtherDrags = true;

  /**
   * Whether a handle is being dragged: the select mode then gives this every pointer input.
   *
   * @returns True between a press on a handle and its release or cancel.
   */
  get isDragging(): boolean {
    return this.drag !== undefined;
  }

  /**
   * The handle under a point, if any: a square of the handle hit size (larger for a finger)
   * centred on it.
   *
   * @param world - The pointer, world units.
   * @param zoom - The camera zoom.
   * @param pointerType - The pointer, which sizes the target.
   * @returns Which handle, or `undefined`.
   */
  handleAt(
    world: Point,
    zoom: number,
    pointerType?: SelectPointerType,
  ): RouteHandleKind | undefined {
    const handle = this.handle();
    if (handle === undefined) return undefined;
    const reach = handleHitSizePx(pointerType) / 2 / zoom;
    const isOn =
      Math.abs(world.x - handle.center.x) <= reach && Math.abs(world.y - handle.center.y) <= reach;
    return isOn ? handle.kind : undefined;
  }

  /**
   * Offers a press: on the handle it starts a drag, or, soon after a click on it, resets it.
   *
   * @param press - The primary button's press.
   * @param zoom - The camera zoom.
   * @returns Whether the press was taken (the select tool must not see it then).
   */
  press(press: SelectPointer, zoom: number): boolean {
    this.zoom = zoom;
    const kind = this.handleAt(press.world, zoom, press.pointerType);
    const handle = this.handle();
    if (kind === undefined || handle === undefined) return false;
    const { click } = this;
    this.click = undefined;
    if (
      click?.id === handle.connector.id &&
      click.kind === kind &&
      isQuickAfter(click.timeStamp, press.timeStamp)
    ) {
      this.commit(handle.connector, kind, { value: undefined });
      return true;
    }
    this.drag = { id: handle.connector.id, kind, press, moved: undefined };
    return true;
  }

  /**
   * Takes a pointer input while a handle is dragged: moves preview it, the release writes it, a
   * cancel drops it.
   *
   * @param input - The input.
   */
  follow(input: ToolPointerInput): void {
    const { drag } = this;
    if (drag === undefined) return;
    if (input.kind === 'pointerCancel') {
      this.cancel();
      return;
    }
    if (input.kind !== 'pointerMove' && input.kind !== 'pointerUp') return;
    this.zoom = input.zoom;
    const connector = this.connectorOf(drag.id);
    if (connector === undefined) {
      this.cancel();
      return;
    }
    const isDrag = drag.moved !== undefined || isPastClickThreshold(drag.press, input.screen);
    const moved = isDrag ? this.valueAt(connector, drag.kind, input.world) : undefined;
    if (input.kind === 'pointerUp') {
      this.drag = undefined;
      this.context.setPreview(drag.id, undefined);
      if (moved === undefined) {
        this.click = { id: drag.id, kind: drag.kind, timeStamp: input.timeStamp };
      } else this.commit(connector, drag.kind, moved);
      return;
    }
    this.drag = { ...drag, moved };
    if (moved !== undefined) {
      this.context.setPreview(drag.id, withHandle(connector, drag.kind, moved.value));
    }
  }

  /** Drops the drag and its preview; nothing is written (Escape, a cancel, leaving the tool). */
  cancel(): void {
    const { drag } = this;
    if (drag === undefined) return;
    this.drag = undefined;
    this.context.setPreview(drag.id, undefined);
  }

  /**
   * Remembers the zoom the handle is sized for.
   *
   * @param zoom - The camera zoom now.
   * @returns Whether a handle shows and must be redrawn at the new size.
   */
  followZoom(zoom: number): boolean {
    if (zoom === this.zoom) return false;
    this.zoom = zoom;
    return this.handle() !== undefined;
  }

  /**
   * The handle over the select tool's overlay, where the document (with the drag's preview) puts
   * it: the elbow's bar along its middle piece, or the curve's dot.
   *
   * @returns The fields to lay over the select tool's, or none without a handle.
   */
  overlay(): Partial<SelectionOverlayModel> | undefined {
    const handle = this.handle();
    if (handle === undefined) return undefined;
    const toolRects =
      handle.kind === 'curve'
        ? curveHandleRects(handle.center, this.zoom)
        : elbowHandleRects(handle.center, handle.axis, this.zoom);
    return { frame: undefined, toolRects };
  }

  /**
   * The connector whose route shows a handle: the selection when it is one unlocked connector the
   * engine can draw (as `ConnectorEndpoints` edits its ends), or the one being dragged.
   *
   * @returns The connector, as the scene draws it, or `undefined`.
   */
  private editableConnector(): ConnectorObject | undefined {
    const { drag } = this;
    if (drag !== undefined) {
      // Where the drag previews it: the scene draws the preview, and the handle sits on it.
      const connector = this.connectorOf(drag.id);
      return connector && drag.moved
        ? withHandle(connector, drag.kind, drag.moved.value)
        : connector;
    }
    const ids = this.context.selection();
    const [only] = ids;
    if (ids.length !== 1 || only === undefined) return undefined;
    const object = this.connectorOf(only);
    if (object === undefined || object.locked) return undefined;
    return isDrawableIn(object, this.context.source) ? object : undefined;
  }

  /**
   * The editable connector's handle where it is drawn now.
   *
   * @returns The handle, or `undefined` when there is none.
   */
  private handle(): RouteHandle | undefined {
    const connector = this.editableConnector();
    if (connector === undefined || connector.route === 'straight') return undefined;
    const { source } = this.context;
    const transform = worldTransformOf(connector, source);
    const { path } = resolveConnectorShape(connector, source);
    // A curved route's path is its cubic; an elbow's has none.
    if (path.curve !== undefined) {
      const center = applyTransform(transform, cubicMidpoint(path.curve));
      return { connector, kind: 'curve', center, axis: 'x' };
    }
    const ends = resolveConnectorEnds(connector, source);
    const piece = elbowMiddlePiece(ends.from, ends.to);
    if (piece === undefined) return undefined;
    const middle = Math.min(1, Math.max(0, connector.elbowMiddle ?? piece.automatic));
    const at = piece.start + (piece.end - piece.start) * middle;
    const across = (piece.across[0] + piece.across[1]) / 2;
    const local = piece.axis === 'x' ? { x: at, y: across } : { x: across, y: at };
    return { connector, kind: 'elbow', center: applyTransform(transform, local), axis: piece.axis };
  }

  /**
   * What a handle dragged to a point writes: the elbow's fraction of the way between its stubs
   * along the piece's axis, or the curve point there; the field's removal within
   * {@link ROUTE_HANDLE_SNAP_PX} of the automatic place.
   *
   * @param connector - The connector now.
   * @param kind - The handle.
   * @param world - The pointer, world units.
   * @returns The value, or `undefined` when the route has no such handle any more.
   */
  private valueAt(
    connector: ConnectorObject,
    kind: RouteHandleKind,
    world: Point,
  ): HandleValue | undefined {
    const { source } = this.context;
    const local = applyTransform(invertTransform(worldTransformOf(connector, source)), world);
    const snap = ROUTE_HANDLE_SNAP_PX / this.zoom;
    const ends = resolveConnectorEnds(connector, source);
    if (kind === 'curve') {
      const automatic = cubicMidpoint(curvedConnectorCubic(ends.from, ends.to));
      if (Math.hypot(local.x - automatic.x, local.y - automatic.y) <= snap) {
        return { value: undefined };
      }
      const point = curvePointOf(ends.from.point, ends.to.point, local);
      if (point === undefined) return undefined;
      // Near the line between the ends, onto it: straight between free ends.
      const span = Math.hypot(
        ends.to.point.x - ends.from.point.x,
        ends.to.point.y - ends.from.point.y,
      );
      const across = Math.abs(point.y) * span <= snap ? 0 : point.y;
      return { value: clampedCurvePoint({ x: point.x, y: across }) };
    }
    const piece = elbowMiddlePiece(ends.from, ends.to);
    if (piece === undefined) return undefined;
    const coordinate = local[piece.axis];
    const automatic = piece.start + (piece.end - piece.start) * piece.automatic;
    if (Math.abs(coordinate - automatic) <= snap) return { value: undefined };
    const fraction = (coordinate - piece.start) / (piece.end - piece.start);
    return { value: Math.min(1, Math.max(0, fraction)) };
  }

  private connectorOf(id: ObjectId): ConnectorObject | undefined {
    const object = this.context.source.get(id);
    return object?.type === 'connector' ? object : undefined;
  }

  /**
   * Writes a handle as one `setStyle` of its field, or its removal; nothing when it is unchanged.
   *
   * @param connector - The connector now.
   * @param kind - The handle.
   * @param moved - What to write.
   */
  private commit(connector: ConnectorObject, kind: RouteHandleKind, moved: HandleValue): void {
    const { context } = this;
    const field = kind === 'elbow' ? 'elbowMiddle' : 'curvePoint';
    // A value as stored: a fraction, a curve point, or none.
    if (JSON.stringify(connector[field]) === JSON.stringify(moved.value)) return;
    const write = () => {
      const outcome = runCommand(
        context.store,
        context.origin,
        setStyleCommand,
        { changes: [{ id: connector.id, style: { [field]: moved.value } }] },
        context.environment,
      );
      if (outcome.status === 'rejected') context.onCommandRefused?.(outcome.errors);
    };
    if (context.capture) context.capture.command(write);
    else write();
  }
}
