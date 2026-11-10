import { runCommand, setConnectorEndCommand } from '@canvas/document';
import {
  isDrawableIn,
  resolveConnectorShape,
  visibleWorldBounds,
  worldTransformOf,
} from '@canvas/engine';
import {
  applyTransform,
  invertTransform,
  type ConnectorEnd,
  type ConnectorObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import type { LineToolContext } from '../line/line-context.js';
import { endpointHandleRects } from '../line/line-overlay.js';
import type { ToolPointerInput } from '../modes/tool-mode.js';
import { isPastClickThreshold } from '../select/click-threshold.js';
import { handleHitSizePx } from '../select/handle-layout.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectPointer, SelectPointerType } from '../select/select-input.js';
import type { SelectionSource } from '../select/selection-geometry.js';

import { connectorEndAt, type ConnectorToolEnd } from './connector-end.js';
import { isConnectable } from './connector-mode.js';
import { connectorEndRects } from './connector-overlay.js';

/** What a connector's end editing needs beyond a line tool's context. */
export interface ConnectorEndpointContext extends LineToolContext {
  /** The document as the scene draws it (the select tool's source, with its drag preview). */
  readonly source: SelectionSource;
  /** The selected ids now. */
  readonly selection: () => readonly ObjectId[];
  /**
   * The topmost object under a point a dragged end attaches to when no anchor is near.
   *
   * @param world - The point, world units.
   * @param zoom - The camera zoom.
   * @returns The object's id, or `undefined`.
   */
  readonly objectAt: (world: Point, zoom: number) => ObjectId | undefined;
}

/** Which end of a connector: its start or its end. */
export type ConnectorEndName = 'from' | 'to';

/** An end drag under way: the connector's id, not the connector, which is read on every input. */
interface EndDrag {
  readonly id: ObjectId;
  readonly end: ConnectorEndName;
  readonly press: SelectPointer;
  /** Where the dragged end goes, once the drag passed the click threshold. */
  readonly target: ConnectorToolEnd | undefined;
}

/**
 * A connector's two ends where it draws them now, in board coordinates: the first and last
 * points of its route (`resolveConnectorShape`), through its world transform.
 *
 * @param connector - The connector.
 * @param source - The document, for its targets and ancestors.
 * @returns Its start and end.
 */
export function connectorEndsOf(
  connector: ConnectorObject,
  source: SelectionSource,
): Record<ConnectorEndName, Point> {
  const { route } = resolveConnectorShape(connector, source).path;
  const transform = worldTransformOf(connector, source);
  const first = route[0] ?? { x: 0, y: 0 };
  const last = route.at(-1) ?? first;
  return { from: applyTransform(transform, first), to: applyTransform(transform, last) };
}

/**
 * A stored end as the tool's ends are compared (`isConnectable`).
 *
 * @param end - The stored end.
 * @returns The tool end.
 */
function toolEndOf(end: ConnectorEnd): ConnectorToolEnd {
  return end.kind === 'object'
    ? { kind: 'object', objectId: end.objectId, anchor: end.anchor, point: { x: 0, y: 0 } }
    : { kind: 'point', point: { x: end.x, y: end.y }, guides: [] };
}

/**
 * A connector's end editing in the select tool, as a
 * line's (`LineEndpoints`, the confirmed rule for a lone line): a lone selected, unlocked
 * connector shows a handle on each end instead of the selection frame; a press on a handle drags
 * that end, which attaches where it is released as the connector tool's ends do
 * (`connectorEndAt`: an anchor within 8 CSS px, else the object under the pointer automatically,
 * else a free point; never the connector itself). The drag previews the connector and writes
 * nothing until the release, which runs exactly one `setConnectorEnd` of the dragged end alone
 * (one undo step); a release within the click threshold, one that drops the end on the other
 * end's object, a cancel and Escape write nothing (both ends free is a free line). The connector is read from the source on every input, so a
 * collaborator's change shows during the drag; a connector deleted meanwhile ends it, and one
 * locked meanwhile refuses the command, which the shell is told of. Main thread; no DOM.
 */
export class ConnectorEndpoints {
  private readonly context: ConnectorEndpointContext;
  private drag: EndDrag | undefined;
  private zoom = 1;

  /**
   * Starts with nothing dragged.
   *
   * @param context - The document, the selection, previews and the callbacks.
   */
  constructor(context: ConnectorEndpointContext) {
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
   * The connector whose ends show handles: the selection when it is one unlocked connector the
   * engine can draw.
   *
   * @returns The connector, as the scene draws it, or `undefined`.
   */
  editableConnector(): ConnectorObject | undefined {
    const ids = this.context.selection();
    const [only] = ids;
    if (ids.length !== 1 || only === undefined) return undefined;
    const { source } = this.context;
    const object = source.get(only);
    if (object?.type !== 'connector' || object.locked) return undefined;
    return isDrawableIn(object, source) ? object : undefined;
  }

  /**
   * The handle under a point, if any: a square of the handle hit size (larger for a finger)
   * centred on each end, the end (`to`) last, so it wins where the handles overlap.
   *
   * @param world - The pointer, world units.
   * @param zoom - The camera zoom.
   * @param pointerType - The pointer, which sizes the target.
   * @returns Which end, or `undefined`.
   */
  handleAt(
    world: Point,
    zoom: number,
    pointerType?: SelectPointerType,
  ): ConnectorEndName | undefined {
    const connector = this.editableConnector();
    if (!connector) return undefined;
    const ends = connectorEndsOf(connector, this.context.source);
    const reach = handleHitSizePx(pointerType) / 2 / zoom;
    const isOn = (end: Point) =>
      Math.abs(world.x - end.x) <= reach && Math.abs(world.y - end.y) <= reach;
    if (isOn(ends.to)) return 'to';
    return isOn(ends.from) ? 'from' : undefined;
  }

  /**
   * Offers a press: on a handle of the editable connector it starts dragging that end.
   *
   * @param press - The primary button's press.
   * @param zoom - The camera zoom.
   * @returns Whether the press was taken (the select tool must not see it then).
   */
  press(press: SelectPointer, zoom: number): boolean {
    this.zoom = zoom;
    const end = this.handleAt(press.world, zoom, press.pointerType);
    const connector = this.editableConnector();
    if (end === undefined || !connector) return false;
    this.drag = { id: connector.id, end, press, target: undefined };
    return true;
  }

  /**
   * Takes a pointer input while an end is dragged: moves preview it, the release writes it, a
   * cancel drops it.
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
    const connector = this.connectorOf(drag);
    if (!connector) {
      this.cancel();
      return;
    }
    const fixed = connectorEndsOf(connector, this.context.source)[otherEnd(drag.end)];
    const target = connectorEndAt(input, fixed, {
      index: this.context.snapIndex,
      source: this.context.source,
      excludedIds: new Set([drag.id]),
      zoom: input.zoom,
      snapping: input.snapping,
      viewport: input.camera && visibleWorldBounds(input.camera),
      objectAt: this.context.objectAt,
    });
    const dragged = {
      ...drag,
      target: isPastClickThreshold(drag.press, input.screen) ? target : undefined,
    };
    if (input.kind === 'pointerUp') {
      this.drag = undefined;
      this.commit(connector, dragged);
      return;
    }
    this.drag = dragged;
    this.context.setPreview(drag.id, this.movedConnector(connector, dragged));
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
    return this.drag !== undefined || this.editableConnector() !== undefined;
  }

  /**
   * What end editing shows over the select tool's overlay: for an editable connector, no frame
   * and a handle on each end, where the drag puts them, with the anchors of the object a dragged
   * end is over and the guides a free end snapped to.
   *
   * @returns The fields to lay over the select tool's, or none.
   */
  overlay(): Partial<SelectionOverlayModel> | undefined {
    const { drag } = this;
    const connector = drag ? this.connectorOf(drag) : this.editableConnector();
    if (!connector) return undefined;
    const ends = connectorEndsOf(connector, this.context.source);
    const target = drag?.target;
    if (drag && target) ends[drag.end] = target.point;
    const toolRects = [ends.from, ends.to].flatMap((end) => endpointHandleRects(end, this.zoom));
    if (target) toolRects.push(...connectorEndRects(target, this.context.source, this.zoom));
    const guides = target?.kind === 'point' ? target.guides : [];
    return guides.length > 0
      ? { frame: undefined, toolRects, guides }
      : { frame: undefined, toolRects };
  }

  /**
   * The dragged connector as the document holds it now.
   *
   * @param drag - The drag.
   * @returns The connector, or `undefined` when it is gone.
   */
  private connectorOf(drag: EndDrag): ConnectorObject | undefined {
    const object = this.context.source.get(drag.id);
    return object?.type === 'connector' ? object : undefined;
  }

  /**
   * The connector with the dragged end where the drag puts it, a free point brought into its own
   * frame, for the preview.
   *
   * @param connector - The connector now.
   * @param drag - The drag.
   * @returns The connector, or `undefined` before the drag passed the click threshold.
   */
  private movedConnector(connector: ConnectorObject, drag: EndDrag): ConnectorObject | undefined {
    const { target } = drag;
    if (!target) return undefined;
    if (target.kind === 'object') {
      const end = { kind: 'object', objectId: target.objectId, anchor: target.anchor } as const;
      return { ...connector, [drag.end]: end };
    }
    const local = applyTransform(
      invertTransform(worldTransformOf(connector, this.context.source)),
      target.point,
    );
    return { ...connector, [drag.end]: { kind: 'point', x: local.x, y: local.y } };
  }

  /**
   * Writes a finished drag as one `setConnectorEnd` of the dragged end alone, and drops the
   * preview; a click, or a drop on the other end's object, writes nothing.
   *
   * @param connector - The connector now.
   * @param drag - The drag, ended.
   */
  private commit(connector: ConnectorObject, drag: EndDrag): void {
    const { context } = this;
    const { target } = drag;
    const other = toolEndOf(connector[otherEnd(drag.end)]);
    if (target && isConnectable(target, other)) {
      const write = () => {
        const outcome = runCommand(
          context.store,
          context.origin,
          setConnectorEndCommand,
          {
            id: drag.id,
            end: drag.end,
            target:
              target.kind === 'object'
                ? { objectId: target.objectId, anchor: target.anchor }
                : { point: target.point },
          },
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

/**
 * The other end of a connector.
 *
 * @param end - One end.
 * @returns The other.
 */
function otherEnd(end: ConnectorEndName): ConnectorEndName {
  return end === 'from' ? 'to' : 'from';
}
