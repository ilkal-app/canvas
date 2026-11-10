import { createObjectCommand, runCommand } from '@canvas/document';
import { visibleWorldBounds } from '@canvas/engine';
import type { LineObject, ObjectId } from '@canvas/schema';

import { withCreationParent } from '../frame/creation-parent.js';
import { creationColor } from '../ink/creation-ink.js';
import type {
  ToolCursor,
  ToolKeyInput,
  ToolMode,
  ToolPointerInput,
  ToolStep,
} from '../modes/tool-mode.js';
import { TOOL_STEP_CONTINUE } from '../modes/tool-mode.js';
import { clickThresholdPx, isPastClickThreshold } from '../select/click-threshold.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectPointer } from '../select/select-input.js';
import type { SelectionSource } from '../select/selection-geometry.js';
import { DRAFT_PREVIEW_Z } from '../text/text-session-object.js';

import type { LineStyle, LineToolContext } from './line-context.js';
import { lineEndAt, type LineEnd } from './line-end.js';
import { anchorMarkerRect } from './line-overlay.js';
import { newLineObject } from './new-line-object.js';

/** What the line tool needs beyond a line tool's context: its style and the select tool. */
export interface LineModeContext extends LineToolContext {
  /** The document the ends snap against (the select tool's source). */
  readonly source: SelectionSource;
  /** The line tool's style now: its defaults with the person's choices (and the sub-tool's cap). */
  readonly lineStyle: () => LineStyle;
  /** Selects objects with the select tool: the line just drawn. */
  readonly selectObjects: (ids: readonly ObjectId[]) => void;
  /** Ends the mode from inside it (Escape with no line under way): back to the select tool. */
  readonly requestExit: () => void;
}

/** A line being drawn: where it started, its id and the end the pointer last gave it. */
interface LineDraft {
  readonly press: SelectPointer;
  readonly id: ObjectId;
  readonly start: LineEnd;
  readonly end: LineEnd;
  /** The style the line takes, its stroke colour chosen at its first point (`creationColor`). */
  readonly style: LineStyle;
}

const STEP_DONE: ToolStep = Object.freeze({ isDone: true });

/**
 * The line tool (`l`; the arrow, Shift+L, is the same tool with an arrow end cap): a drag draws a
 * line from the press to the release, its ends snapping to object anchors, edges, centres and the
 * grid (`lineEndAt`; Alt suspends), Shift turning it to the nearest 45°. The line shows as a
 * preview while dragged and is written on release as one `createObject`, one undo step; the tool
 * then selects it and hands back to the select tool. A click (a release within the click threshold)
 * draws nothing and keeps the tool, as does a drag whose snapped ends lie closer on screen than
 * that threshold (both on one anchor); a cancelled drag (a second finger, a lost pointer) and
 * Escape drop the preview and write nothing, and Escape with no drag leaves the tool. Main thread;
 * no DOM.
 */
export class LineMode implements ToolMode {
  readonly id = 'line' as const;
  /** A crosshair over the board: the tool draws from the pointer's tip. */
  readonly cursor: ToolCursor = 'crosshair';
  private readonly context: LineModeContext;
  private draft: LineDraft | undefined;
  /** Where the pointer would start a line, while hovering. */
  private hover: LineEnd | undefined;
  private zoom = 1;

  /**
   * Starts the tool with nothing drawn.
   *
   * @param context - The document, the style, previews and the callbacks.
   */
  constructor(context: LineModeContext) {
    this.context = context;
  }

  /**
   * Takes one pointer input: a press starts a line at the snapped press point, a move previews
   * it (or, with no line under way, marks where one would start), a release writes it, and a
   * cancel drops it; a secondary click and a held finger do nothing.
   *
   * @param input - The input, with its world point, the zoom, the camera and the snapping.
   * @returns Done after a line was drawn (the tool hands back to select), else continuing.
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
        const excludedIds = new Set(this.draft ? [this.draft.id] : []);
        const fixed = input.kind === 'pointerDown' ? undefined : this.draft?.start.point;
        const end = lineEndAt(input, fixed, {
          index: this.context.snapIndex,
          source: this.context.source,
          excludedIds,
          zoom: input.zoom,
          snapping: input.snapping,
          viewport: input.camera && visibleWorldBounds(input.camera),
        });
        if (input.kind === 'pointerDown') return this.begin(input, end);
        if (input.kind === 'pointerMove') return this.follow(end);
        return this.finish(input, end);
      }
    }
  }

  /**
   * Takes Escape: drops a line under way, or with none leaves the tool; declines other keys.
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
   * What the tool shows over the select tool's overlay: a marker on each anchor an end lands on
   * (the hovered start, or the line under way's two ends) and the guides the end snapped to.
   *
   * @returns The fields to lay over the select tool's.
   */
  overlay(): Partial<SelectionOverlayModel> {
    const ends = this.draft ? [this.draft.start, this.draft.end] : this.hover ? [this.hover] : [];
    const toolRects = ends.flatMap(({ anchor }) =>
      anchor ? [anchorMarkerRect(anchor, this.zoom)] : [],
    );
    const guides = this.draft?.end.guides ?? this.hover?.guides ?? [];
    return guides.length > 0 ? { toolRects, guides } : { toolRects };
  }

  /**
   * Redraws the anchor markers at a new zoom, so they keep one screen size.
   *
   * @param zoom - The camera zoom now.
   */
  onZoom(zoom: number): void {
    // Markers keep one screen size: a new zoom redraws them, if any show.
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    if (this.draft ?? this.hover) this.context.onChange();
  }

  /** Drops a line under way and its preview, writing nothing: the tool is being left. */
  exit(): void {
    this.drop();
  }

  /**
   * Starts a line at a press.
   *
   * @param press - The press.
   * @param start - Where its first end snapped.
   * @returns Continuing.
   */
  private begin(press: SelectPointer, start: LineEnd): ToolStep {
    this.drop();
    const { context } = this;
    const style = context.lineStyle();
    const color = creationColor(
      context.store,
      start.point,
      style.stroke.color,
      context.creationInk,
      'line',
    );
    this.draft = {
      press,
      id: context.environment.createId(),
      start,
      end: start,
      style: { ...style, stroke: { ...style.stroke, color } },
    };
    this.hover = undefined;
    return TOOL_STEP_CONTINUE;
  }

  /**
   * Previews the line under way to a new end, or marks a hovered start.
   *
   * @param end - Where the pointer's end snapped.
   * @returns Continuing.
   */
  private follow(end: LineEnd): ToolStep {
    const { draft } = this;
    if (!draft) {
      this.hover = end;
      return TOOL_STEP_CONTINUE;
    }
    this.draft = { ...draft, end };
    this.context.setPreview(draft.id, this.draftObject(this.draft));
    return TOOL_STEP_CONTINUE;
  }

  /**
   * Writes the line under way at a release as one `createObject`, unless it is a click or too
   * short, and selects it.
   *
   * @param release - The release.
   * @param end - Where its second end snapped.
   * @returns Done when a line was drawn, else continuing.
   */
  private finish(release: SelectPointer, end: LineEnd): ToolStep {
    if (!this.draft) return TOOL_STEP_CONTINUE;
    const draft = { ...this.draft, end };
    if (!isPastClickThreshold(draft.press, release.screen) || this.isTooShort(draft)) {
      this.drop();
      return TOOL_STEP_CONTINUE;
    }
    const { context } = this;
    const object = newLineObject(draft.id, draft.start.point, draft.end.point, draft.style);
    const create = () => {
      const outcome = runCommand(
        context.store,
        context.origin,
        createObjectCommand,
        // Drawn in a section, it joins it (item 9).
        { object: withCreationParent(context.store, object) },
        context.environment,
      );
      if (outcome.status === 'rejected') context.onCommandRefused?.(outcome.errors);
    };
    if (context.capture) context.capture.command(create);
    else create();
    this.drop();
    if (context.store.get(draft.id)) context.selectObjects([draft.id]);
    return STEP_DONE;
  }

  /**
   * Whether a draft's line, as its ends snapped, is shorter on screen than the click threshold:
   * both ends on one anchor, say, after a drag. Such a line is not drawn, as a click is not.
   *
   * @param draft - The draft, ended.
   * @returns True when too short to draw.
   */
  private isTooShort(draft: LineDraft): boolean {
    const { start, end } = draft;
    const lengthPx =
      Math.hypot(end.point.x - start.point.x, end.point.y - start.point.y) * this.zoom;
    return lengthPx < clickThresholdPx(draft.press.pointerType);
  }

  /**
   * The draft as the scene previews it: on top of everything (a stacking key above every real
   * one), stamped as the command would stamp it.
   *
   * @param draft - The draft.
   * @returns The line.
   */
  private draftObject(draft: LineDraft): LineObject {
    const { context } = this;
    const now = context.environment.clock();
    return {
      ...newLineObject(draft.id, draft.start.point, draft.end.point, draft.style),
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
