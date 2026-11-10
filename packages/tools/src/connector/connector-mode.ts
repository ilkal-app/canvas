import { connectCommand, runCommand } from '@canvas/document';
import { visibleWorldBounds } from '@canvas/engine';
import type { ConnectorObject, ObjectId } from '@canvas/schema';

import { creationColor } from '../ink/creation-ink.js';
import type {
  ToolCursor,
  ToolKeyInput,
  ToolMode,
  ToolPointerInput,
  ToolStep,
} from '../modes/tool-mode.js';
import { TOOL_STEP_CONTINUE } from '../modes/tool-mode.js';
import { isPastClickThreshold } from '../select/click-threshold.js';
import { connectLabelOf } from '../select/overlay-label.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectPointer } from '../select/select-input.js';
import { DRAFT_PREVIEW_Z } from '../text/text-session-object.js';

import type { ConnectorModeContext, ConnectorStyle } from './connector-context.js';
import { connectorEndAt, type ConnectorToolEnd } from './connector-end.js';
import { connectorEndRects, connectorTargetRects } from './connector-overlay.js';
import { connectInputOf, newConnectorObject } from './new-connector.js';

/** A connector being drawn: the press, its id and both ends as the pointer last put them. */
interface ConnectorDraft {
  readonly press: SelectPointer;
  readonly id: ObjectId;
  readonly from: ConnectorToolEnd;
  readonly to: ConnectorToolEnd;
  /** The style it takes, its stroke colour chosen at its start (`creationColor`). */
  readonly style: ConnectorStyle;
}

const STEP_DONE: ToolStep = Object.freeze({ isDone: true });

/**
 * Whether two ends would make a connector: any pair but both ends on the same object; two free
 * points make a free line.
 *
 * @param from - The start.
 * @param to - The end.
 * @returns True when the pair can be connected.
 */
export function isConnectable(from: ConnectorToolEnd, to: ConnectorToolEnd): boolean {
  return !(from.kind === 'object' && to.kind === 'object' && from.objectId === to.objectId);
}

/**
 * The connector tool (`c`): a drag draws a connector from
 * the press to the release. Each end attaches where it lands (`connectorEndAt`): on an object's
 * anchor (its centre or an edge midpoint, within 8 CSS px), stored as that fixed anchor; over an
 * object, attached with an automatic anchor (the side nearest the other end); else a free point,
 * snapped as a line end is. The connector shows as a preview while dragged (once its ends can be
 * connected), routed as it will be drawn, with markers on the anchors of the object an end is on, and is written on release as one
 * `connect` command, one undo step, in the tool's style; the tool then selects it and hands back
 * to the select tool. A click (a release within the click threshold) draws nothing and keeps the
 * tool, as does a drag with both ends on one object (a drag between two free points draws a free
 * line); a cancelled drag (a second finger, a lost pointer) and Escape
 * drop the preview and write nothing, and Escape with no drag leaves the tool. Main thread; no
 * DOM.
 */
export class ConnectorMode implements ToolMode {
  readonly id = 'connector' as const;
  /** A crosshair over the board: the tool draws from the pointer's tip. */
  readonly cursor: ToolCursor = 'crosshair';
  private readonly context: ConnectorModeContext;
  private draft: ConnectorDraft | undefined;
  /** Where the pointer would start a connector, while hovering. */
  private hover: ConnectorToolEnd | undefined;
  private zoom = 1;

  /**
   * Starts the tool with nothing drawn.
   *
   * @param context - The document, the style, previews and the callbacks.
   */
  constructor(context: ConnectorModeContext) {
    this.context = context;
  }

  /**
   * Takes one pointer input: a press starts a connector where the press lands, a move previews it
   * (or, with none under way, marks where one would start), a release writes it, and a cancel
   * drops it; a secondary click and a held finger do nothing.
   *
   * @param input - The input, with its world point, the zoom, the camera and the snapping.
   * @returns Done after a connector was drawn (the tool hands back to select), else continuing.
   */
  onPointer(input: ToolPointerInput): ToolStep {
    switch (input.kind) {
      case 'pointerCancel':
        this.drop();
        return TOOL_STEP_CONTINUE;
      case 'contextPress':
      case 'hold':
        return TOOL_STEP_CONTINUE;
      default: {
        this.zoom = input.zoom;
        const fixed = input.kind === 'pointerDown' ? undefined : this.draft?.from.point;
        const end = connectorEndAt(input, fixed, {
          index: this.context.snapIndex,
          source: this.context.source,
          excludedIds: new Set(this.draft ? [this.draft.id] : []),
          zoom: input.zoom,
          snapping: input.snapping,
          viewport: input.camera && visibleWorldBounds(input.camera),
          objectAt: this.context.objectAt,
        });
        if (input.kind === 'pointerDown') return this.begin(input, end);
        if (input.kind === 'pointerMove') return this.follow(end);
        return this.finish(input, end);
      }
    }
  }

  /**
   * Takes Escape: drops a connector under way, or with none leaves the tool; declines other keys.
   *
   * @param input - The key.
   * @returns Whether it was used.
   */
  onKey(input: ToolKeyInput): boolean {
    if (input.kind !== 'escape') return false;
    if (this.draft) this.drop();
    else this.context.requestExit();
    return true;
  }

  /**
   * What the tool shows over the select tool's overlay: for each end on an object (the hovered
   * start, or the connector under way's two ends) a handle on each of that object's anchors, and
   * a marker on the anchor the end landed on; the guides a free end snapped to; and while the
   * connector's end is over an object it would attach to, the object outlined in the person's
   * colour (with the shell's palette) and "Release to connect" by the end.
   *
   * @returns The fields to lay over the select tool's.
   */
  overlay(): Partial<SelectionOverlayModel> {
    const ends = this.draft ? [this.draft.from, this.draft.to] : this.hover ? [this.hover] : [];
    const { source, creationInk } = this.context;
    const palette = creationInk?.overlayPalette?.();
    const target = this.draft?.to.kind === 'object' ? this.draft.to : undefined;
    const toolRects = [
      ...(target ? connectorTargetRects(target, source, this.zoom, palette) : []),
      ...ends.flatMap((end) => connectorEndRects(end, source, this.zoom)),
    ];
    const last = this.draft?.to ?? this.hover;
    const guides = last?.kind === 'point' ? last.guides : [];
    const labels = target ? [connectLabelOf(target.point)] : [];
    return {
      toolRects,
      ...(guides.length > 0 ? { guides } : {}),
      ...(labels.length > 0 ? { labels } : {}),
    };
  }

  /**
   * Redraws the markers at a new zoom, so they keep one screen size.
   *
   * @param zoom - The camera zoom now.
   */
  onZoom(zoom: number): void {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    if (this.draft ?? this.hover) this.context.onChange();
  }

  /** Drops a connector under way and its preview, writing nothing: the tool is being left. */
  exit(): void {
    this.drop();
    this.hover = undefined;
  }

  /**
   * Starts a connector at a press.
   *
   * @param press - The press.
   * @param from - Where its start landed.
   * @returns Continuing.
   */
  private begin(press: SelectPointer, from: ConnectorToolEnd): ToolStep {
    this.drop();
    const { context } = this;
    const style = context.connectorStyle();
    const color = creationColor(
      context.store,
      from.point,
      style.stroke.color,
      context.creationInk,
      'connector',
    );
    this.draft = {
      press,
      id: context.environment.createId(),
      from,
      to: from,
      style: { ...style, stroke: { ...style.stroke, color } },
    };
    this.hover = undefined;
    return TOOL_STEP_CONTINUE;
  }

  /**
   * Previews the connector under way to a new end, or marks a hovered start.
   *
   * @param to - Where the pointer's end landed.
   * @returns Continuing.
   */
  private follow(to: ConnectorToolEnd): ToolStep {
    const { draft } = this;
    if (!draft) {
      this.hover = to;
      return TOOL_STEP_CONTINUE;
    }
    this.draft = { ...draft, to };
    // Nothing shows until the ends can be connected (an object at one end, not both on one).
    const preview = isConnectable(draft.from, to) ? this.draftObject(this.draft) : undefined;
    this.context.setPreview(draft.id, preview);
    return TOOL_STEP_CONTINUE;
  }

  /**
   * Writes the connector under way at a release as one `connect`, unless it is a click or its
   * ends cannot be connected, and selects it.
   *
   * @param release - The release.
   * @param to - Where its end landed.
   * @returns Done when a connector was drawn, else continuing.
   */
  private finish(release: SelectPointer, to: ConnectorToolEnd): ToolStep {
    if (!this.draft) return TOOL_STEP_CONTINUE;
    const { press, id, from, style } = this.draft;
    if (!isPastClickThreshold(press, release.screen) || !isConnectable(from, to)) {
      this.drop();
      return TOOL_STEP_CONTINUE;
    }
    const { context } = this;
    const input = connectInputOf(id, from, to, style);
    const connect = () => {
      const outcome = runCommand(
        context.store,
        context.origin,
        connectCommand,
        input,
        context.environment,
      );
      if (outcome.status === 'rejected') context.onCommandRefused?.(outcome.errors);
    };
    if (context.capture) context.capture.command(connect);
    else connect();
    this.drop();
    if (context.store.get(id)) context.selectObjects([id]);
    return STEP_DONE;
  }

  /**
   * The draft as the scene previews it: on top of everything (a stacking key above every real
   * one), stamped as the command would stamp it.
   *
   * @param draft - The draft.
   * @returns The connector.
   */
  private draftObject(draft: ConnectorDraft): ConnectorObject {
    const { context } = this;
    const now = context.environment.clock();
    return {
      ...newConnectorObject(draft.id, draft.from, draft.to, draft.style),
      z: DRAFT_PREVIEW_Z,
      createdBy: context.origin.principalId,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Drops the draft and its preview; nothing is written. */
  private drop(): void {
    const { draft } = this;
    if (!draft) return;
    this.draft = undefined;
    this.context.setPreview(draft.id, undefined);
  }
}
