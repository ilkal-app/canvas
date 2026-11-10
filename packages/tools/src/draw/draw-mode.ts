import { createObjectsCommand, runCommand } from '@canvas/document';
import type { FreehandObject, ObjectId } from '@canvas/schema';

import { withCreationParentGroups } from '../frame/creation-parent.js';
import { creationColor } from '../ink/creation-ink.js';
import type {
  ToolCursor,
  ToolKeyInput,
  ToolMode,
  ToolPointerInput,
  ToolStep,
} from '../modes/tool-mode.js';
import { TOOL_STEP_CONTINUE } from '../modes/tool-mode.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectPointer } from '../select/select-input.js';
import { DRAFT_PREVIEW_Z } from '../text/text-session-object.js';

import type { DrawModeContext } from './draw-context.js';
import type { DrawStyle } from './draw-style.js';
import { EraserGesture } from './eraser-gesture.js';
import type { LiveInk } from './live-ink.js';
import {
  freehandObjectsOf,
  newFreehandObjects,
  type NewFreehandObject,
} from './new-freehand-objects.js';
import { StrokeCapture } from './stroke-capture.js';

/** A stroke being drawn: its style, its colour chosen at the press, and its previews' ids. */
interface StrokeDraft {
  readonly style: DrawStyle;
  /** The ids its previewed pieces show under, one per piece so far, in order. */
  readonly previewIds: ObjectId[];
  /** The page overlay it is drawn on, if one was attached at its press. */
  readonly liveInk: LiveInk | undefined;
}

/**
 * The draw tool (Shift+P): a press starts a freehand stroke in the tool's style
 * (pencil, marker or highlighter), each move extends it with the samples the browser coalesced
 * into it and shows it as a preview (nothing is written while drawing), and the release writes
 * it, smoothed and simplified, as one `createObjects` and one undo step, split into several
 * objects when it is longer than one stores. A press without movement draws a one-point dot.
 * The tool selects nothing and stays active for the next stroke, as a whiteboard pencil does. A
 * cancelled press (a second finger, a lost pointer) and Escape drop the stroke; Escape with none
 * under way leaves the tool. Once a pen was seen, a finger draws nothing (palm rejection,
 * `StrokeCapture`). With a live ink overlay attached at the press (`DrawModeContext.liveInk`,
 *) the page draws the stroke under way, and the engine's previews carry opacity 0, so it
 * meshes them for the release without drawing them twice. With the eraser sub-tool (`DrawStyle.isEraser`, Shift+E) a drag
 * erases whole freehand strokes instead, never other objects (`EraserGesture`). Main thread; no
 * DOM.
 */
export class DrawMode implements ToolMode {
  readonly id = 'draw' as const;
  /** A crosshair over the board: the stroke follows the pointer's tip. */
  readonly cursor: ToolCursor = 'crosshair';
  private readonly context: DrawModeContext;
  private readonly capture = new StrokeCapture();
  private readonly eraser: EraserGesture;
  private draft: StrokeDraft | undefined;

  /**
   * Starts the tool with nothing drawn.
   *
   * @param context - The document, the style, previews and the callbacks.
   */
  constructor(context: DrawModeContext) {
    this.context = context;
    this.eraser = new EraserGesture(context);
  }

  /**
   * Takes one pointer input: a press starts a stroke, a pressed move extends and previews it, a
   * release writes it, and a cancel drops it; a hover only notes a pen, and a secondary click
   * and a held finger do nothing.
   *
   * @param input - The input, with its world point, its trail and the zoom.
   * @returns Always continuing: the tool stays active after a stroke.
   */
  onPointer(input: ToolPointerInput): ToolStep {
    switch (input.kind) {
      case 'pointerCancel':
        this.drop();
        break;
      case 'contextPress':
      case 'hold':
        break;
      case 'pointerDown':
        this.begin(input, input.zoom);
        break;
      case 'pointerMove':
        if (this.draft && this.capture.extend(input, input.zoom)) this.showPreview(input.timeStamp);
        else this.capture.note(input);
        this.eraser.move(input, input.zoom);
        break;
      case 'pointerUp':
        this.eraser.release(input, input.zoom);
        this.finish(input, input.zoom);
        break;
    }
    return TOOL_STEP_CONTINUE;
  }

  /**
   * Takes Escape: drops a stroke under way, or with none leaves the tool; declines other keys.
   *
   * @param input - The key.
   * @returns Whether it was used.
   */
  onKey(input: ToolKeyInput): boolean {
    if (input.kind !== 'escape') return false;
    if (this.draft || this.eraser.isActive) this.drop();
    else this.context.requestExit();
    return true;
  }

  /**
   * What the tool shows over the select tool's overlay: nothing, since the stroke is a preview.
   *
   * @returns No fields.
   */
  overlay(): Partial<SelectionOverlayModel> {
    return {};
  }

  /** Drops a stroke under way and its previews, writing nothing: the tool is being left. */
  exit(): void {
    this.drop();
  }

  /**
   * Starts a stroke at a press, its colour chosen where it starts (`creationColor`), or with the
   * eraser an erasing drag, unless the press is a palm's.
   *
   * @param press - The press.
   * @param zoom - The camera zoom.
   */
  private begin(press: SelectPointer, zoom: number): void {
    this.drop();
    if (!this.capture.press(press)) return;
    const { context } = this;
    const style = context.drawStyle();
    if (style.isEraser === true) {
      this.capture.cancel();
      this.eraser.press(press, zoom);
      return;
    }
    const color = creationColor(
      context.store,
      press.world,
      style.stroke.color,
      context.creationInk,
      'draw',
    );
    const liveInk = context.liveInk?.isAttached() === true ? context.liveInk : undefined;
    this.draft = {
      style: { ...style, stroke: { ...style.stroke, color } },
      previewIds: [],
      liveInk,
    };
    this.showPreview(press.timeStamp);
  }

  /**
   * Writes the stroke under way at a release as one `createObjects`, one undo step, its objects
   * given its previews' ids (the command's id generator hands those out first), then drops its
   * previews; a refusal goes to `onCommandRefused`. Written under the ids it was previewed
   * under, the stroke takes its preview's place in the scene (an update of what is drawn, not a
   * removal and an arrival:), so committing it on a large board costs what changed. A
   * live ink overlay is told to keep the stroke until the engine draws it, or to clear it when
   * the stroke was refused.
   *
   * @param release - The release.
   * @param zoom - The camera zoom the stroke was drawn at.
   */
  private finish(release: SelectPointer, zoom: number): void {
    const { draft, context } = this;
    const samples = this.capture.release(release, zoom);
    if (!draft || !samples) return;
    this.draft = undefined;
    const objects = newFreehandObjects(samples, draft.style, zoom, () =>
      context.environment.createId(),
    );
    // Set inside the command's run, which a typing capture may wrap.
    const outcome = { isWritten: false };
    // Drawn in a section, a piece joins it (item 9): one call per section, one step.
    const create = () => {
      for (const group of withCreationParentGroups(context.store, objects)) {
        // `createObjects` gives each object a generated id: its preview's id, in order.
        let index = 0;
        const environment = {
          ...context.environment,
          createId: () =>
            draft.previewIds[group.indexes[index++] ?? -1] ?? context.environment.createId(),
        };
        const { parentId } = group;
        const input = { objects: group.objects, parentId };
        const result = runCommand(
          context.store,
          context.origin,
          createObjectsCommand,
          input,
          environment,
        );
        if (result.status === 'rejected') context.onCommandRefused?.(result.errors);
        else outcome.isWritten = true;
      }
    };
    if (objects.length > 0 && context.capture) context.capture.command(create);
    else if (objects.length > 0) create();
    this.clearPreviews(draft);
    if (outcome.isWritten) draft.liveInk?.release();
    else draft.liveInk?.clear();
  }

  /**
   * Shows the stroke under way as previews, one per piece, under ids kept from move to move; on a
   * live ink overlay too, the engine's previews then at opacity 0.
   *
   * @param inputMs - When the input it takes was made (its `timeStamp`), if known.
   */
  private showPreview(inputMs?: number): void {
    const { draft, context } = this;
    if (!draft) return;
    let index = 0;
    const pieces = freehandObjectsOf(this.capture.samples, draft.style, () => {
      const id = draft.previewIds[index] ?? context.environment.createId();
      draft.previewIds[index] = id;
      index += 1;
      return id;
    });
    const objects = pieces.map((piece) => this.previewObject(piece));
    // The overlay may stop listening mid-stroke (its canvas cannot draw): the engine shows it then.
    const liveInk = draft.liveInk?.isAttached() === true ? draft.liveInk : undefined;
    if (liveInk === undefined) {
      for (const object of objects) context.setPreview(object.id, object);
      return;
    }
    liveInk.show(objects, inputMs);
    for (const object of objects) context.setPreview(object.id, { ...object, opacity: 0 });
  }

  /**
   * A piece as the scene previews it: on top of everything, stamped as the command would.
   *
   * @param piece - The piece.
   * @returns The object.
   */
  private previewObject(piece: NewFreehandObject): FreehandObject {
    const { context } = this;
    const now = context.environment.clock();
    return {
      ...piece,
      z: DRAFT_PREVIEW_Z,
      createdBy: context.origin.principalId,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Drops a draft's previews.
   *
   * @param draft - The draft.
   */
  private clearPreviews(draft: StrokeDraft): void {
    for (const id of draft.previewIds) this.context.setPreview(id, undefined);
  }

  /** Drops the stroke or erasing drag under way and its previews; nothing is written. */
  private drop(): void {
    this.capture.cancel();
    this.eraser.cancel();
    const { draft } = this;
    if (!draft) return;
    this.draft = undefined;
    this.clearPreviews(draft);
    draft.liveInk?.clear();
  }
}
