import { runCommand, setStyleCommand } from '@canvas/document';
import {
  connectorLabelSize,
  isDrawableIn,
  resolveConnectorShape,
  worldTransformOf,
} from '@canvas/engine';
import {
  applyTransform,
  connectorPolylineOf,
  type ConnectorObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import type { LineToolContext } from '../line/line-context.js';
import type { ToolPointerInput } from '../modes/tool-mode.js';
import { isPastClickThreshold } from '../select/click-threshold.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectPointer } from '../select/select-input.js';
import type { SelectionSource } from '../select/selection-geometry.js';

/** What dragging a connector's label needs beyond a line tool's context. */
export interface ConnectorLabelDragContext extends LineToolContext {
  /** The document as the scene draws it (the select tool's source, with its drag preview). */
  readonly source: SelectionSource;
}

/** How far around a press connectors are looked for, world units: a label's half wrap width. */
const SEARCH_REACH = 120;

/** A label drag under way. */
interface LabelDrag {
  readonly id: ObjectId;
  readonly press: SelectPointer;
  /** Where the label goes, once the drag passed the click threshold. */
  readonly position: number | undefined;
}

/**
 * A connector's label dragged along it with the select tool: a press on a label (of an
 * unlocked connector the person may edit) takes the drag from the select tool; moves preview the
 * label at the pointer's nearest point of the route, as a fraction of its length, clamped to the
 * ends; the release writes one `setStyle` of `labelPosition`, one undo step. A press released in
 * place writes nothing and is handed back (`takeClick`), so it selects or edits as before.
 */
export class ConnectorLabelDrag {
  private readonly context: ConnectorLabelDragContext;
  private drag: LabelDrag | undefined;
  private click: readonly ToolPointerInput[] | undefined;

  /**
   * Drags labels over a document.
   *
   * @param context - The document, previews and the callbacks.
   */
  constructor(context: ConnectorLabelDragContext) {
    this.context = context;
  }

  /**
   * Whether a label is being dragged.
   *
   * @returns True while a press on a label lasts.
   */
  get isDragging(): boolean {
    return this.drag !== undefined;
  }

  /**
   * The label under a point, if any.
   *
   * @param world - The point, world units.
   * @returns The connector's id, or `undefined`.
   */
  handleAt(world: Point): ObjectId | undefined {
    const { snapIndex, source } = this.context;
    if (snapIndex === undefined) return undefined;
    const ids = snapIndex.searchRect({
      minX: world.x - SEARCH_REACH,
      minY: world.y - SEARCH_REACH,
      maxX: world.x + SEARCH_REACH,
      maxY: world.y + SEARCH_REACH,
    });
    return ids.find((id) => {
      const object = source.get(id);
      if (object?.type !== 'connector' || object.locked || !isDrawableIn(object, source)) {
        return false;
      }
      const box = this.labelBox(object);
      return (
        box !== undefined &&
        Math.abs(world.x - box.center.x) <= box.halfWidth &&
        Math.abs(world.y - box.center.y) <= box.halfHeight
      );
    });
  }

  /**
   * Offers a press: taken when it lands on a label.
   *
   * @param press - The press.
   * @returns Whether it was taken.
   */
  press(press: SelectPointer): boolean {
    const id = this.handleAt(press.world);
    if (id === undefined) return false;
    this.drag = { id, press, position: undefined };
    this.click = undefined;
    return true;
  }

  /**
   * Takes a pointer input while a label is dragged: moves preview it, the release writes it.
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
    const connector = this.connectorOf(drag.id);
    if (connector === undefined) {
      this.cancel();
      return;
    }
    const isDrag = drag.position !== undefined || isPastClickThreshold(drag.press, input.screen);
    const position = isDrag ? this.positionAt(connector, input.world) : undefined;
    if (input.kind === 'pointerUp') {
      this.drag = undefined;
      this.context.setPreview(drag.id, undefined);
      if (position === undefined)
        this.click = [{ ...drag.press, kind: 'pointerDown' } as ToolPointerInput, input];
      else this.commit(connector, position);
      return;
    }
    this.drag = { ...drag, position };
    if (position !== undefined)
      this.context.setPreview(drag.id, { ...connector, labelPosition: position });
  }

  /**
   * The press and release of a press that did not drag, once, so the select tool takes them.
   *
   * @returns The inputs, or `undefined`.
   */
  takeClick(): readonly ToolPointerInput[] | undefined {
    const { click } = this;
    this.click = undefined;
    return click;
  }

  /** Drops the drag and its preview; nothing is written. */
  cancel(): void {
    const { drag } = this;
    if (drag === undefined) return;
    this.drag = undefined;
    this.context.setPreview(drag.id, undefined);
  }

  /**
   * Nothing to redraw at a new zoom: the labels draw themselves.
   *
   * @returns False.
   */
  followZoom(): boolean {
    return false;
  }

  /**
   * Nothing over the select tool's overlay.
   *
   * @returns `undefined`.
   */
  overlay(): Partial<SelectionOverlayModel> | undefined {
    return undefined;
  }

  private connectorOf(id: ObjectId): ConnectorObject | undefined {
    const object = this.context.source.get(id);
    return object?.type === 'connector' ? object : undefined;
  }

  /**
   * A connector's label box on the board: its laid-out size around its label point.
   *
   * @param connector - The connector.
   * @returns The box's centre and half size, or `undefined` without a label.
   */
  private labelBox(
    connector: ConnectorObject,
  ):
    | { readonly center: Point; readonly halfWidth: number; readonly halfHeight: number }
    | undefined {
    const size = connectorLabelSize(connector);
    if (size === undefined) return undefined;
    const { source } = this.context;
    const center = applyTransform(
      worldTransformOf(connector, source),
      resolveConnectorShape(connector, source).label,
    );
    return { center, halfWidth: size.width / 2, halfHeight: size.height / 2 };
  }

  /**
   * The fraction of a connector's route nearest a point, by length: 0 at its start, 1 at its end.
   *
   * @param connector - The connector.
   * @param world - The point, world units.
   * @returns The fraction.
   */
  private positionAt(connector: ConnectorObject, world: Point): number {
    const { source } = this.context;
    const transform = worldTransformOf(connector, source);
    const route = connectorPolylineOf(resolveConnectorShape(connector, source).path).map((point) =>
      applyTransform(transform, point),
    );
    return routeFractionAt(route, world);
  }

  private commit(connector: ConnectorObject, position: number): void {
    const { context } = this;
    if (position === (connector.labelPosition ?? 0.5)) return;
    const write = () => {
      const outcome = runCommand(
        context.store,
        context.origin,
        setStyleCommand,
        { changes: [{ id: connector.id, style: { labelPosition: position } }] },
        context.environment,
      );
      if (outcome.status === 'rejected') context.onCommandRefused?.(outcome.errors);
    };
    if (context.capture) context.capture.command(write);
    else write();
  }
}

/**
 * The fraction of a polyline's length at its point nearest a point. Pure.
 *
 * @param route - The polyline.
 * @param point - The point.
 * @returns The fraction, 0 to 1; 0 for a polyline without length.
 */
export function routeFractionAt(route: readonly Point[], point: Point): number {
  const [first, ...rest] = route;
  if (first === undefined) return 0;
  let total = 0;
  let best = { distance: Number.POSITIVE_INFINITY, along: 0 };
  let from = first;
  for (const to of rest) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const along = length === 0 ? 0 : ((point.x - from.x) * dx + (point.y - from.y) * dy) / length;
    const t = length === 0 ? 0 : Math.min(1, Math.max(0, along / length));
    const distance = Math.hypot(from.x + dx * t - point.x, from.y + dy * t - point.y);
    if (distance < best.distance) best = { distance, along: total + length * t };
    total += length;
    from = to;
  }
  return total === 0 ? 0 : best.along / total;
}
