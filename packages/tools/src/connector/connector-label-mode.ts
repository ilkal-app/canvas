import type { ObjectId, Point } from '@canvas/schema';

import type {
  ToolCursor,
  ToolKeyInput,
  ToolMode,
  ToolPointerInput,
  ToolStep,
} from '../modes/tool-mode.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { TextModeContext } from '../text/text-mode-context.js';
import { TextMode } from '../text/text-mode.js';
import type { TextEditingSession } from '../text/text-session.js';

/** Which connector's label to edit, and where the caret goes. */
export interface ConnectorLabelStart {
  /** The connector. */
  readonly id: ObjectId;
  /** Where the caret goes; the whole label is selected when omitted (Enter). */
  readonly world?: Point;
}

/**
 * Editing a connector's label, as a shape's label is
 * edited (the confirmed rule, 2026-09-28): an activated connector (a double-click on it, or Enter
 * with it selected) has its label edited with the text editor (`TextMode`), the caret at the
 * double-clicked point, the label centred halfway along the route where the engine draws it
 * (`connectorLabelPlacement`); a connector without a label gets one with its first character.
 * Each edit is the editor's `setTextRuns`, typing grouped into undo steps as all text is; a click
 * off the label ends the editing and is passed on to the select tool. It shows as the connector
 * tool, as a shape's label editing shows as the shape tool. Main thread; no DOM.
 */
export class ConnectorLabelMode implements ToolMode {
  readonly id = 'connector' as const;
  private readonly editing: TextMode;

  /**
   * Starts editing a connector's label.
   *
   * @param context - The document, layout, undo grouping and callbacks.
   * @param start - The connector, and where the caret goes.
   */
  constructor(context: TextModeContext, start: ConnectorLabelStart) {
    this.editing = new TextMode(context, { kind: 'edit', ...start });
  }

  /**
   * The label's editing session: what the hidden text input and the style panel drive.
   *
   * @returns The session, or `undefined` when the object was no connector to edit.
   */
  get session(): TextEditingSession | undefined {
    return this.editing.session;
  }

  /**
   * The editor's I-beam.
   *
   * @returns The cursor.
   */
  get cursor(): ToolCursor {
    return this.editing.cursor;
  }

  /**
   * Hands a pointer input to the editor.
   *
   * @param input - The input.
   * @returns The editor's step.
   */
  onPointer(input: ToolPointerInput): ToolStep {
    return this.editing.onPointer(input);
  }

  /**
   * Hands a canvas key to the editor.
   *
   * @param input - The key.
   * @returns Whether the editor used it.
   */
  onKey(input: ToolKeyInput): boolean {
    return this.editing.onKey(input);
  }

  /**
   * The editor's overlay: the label's box, the selection and the caret.
   *
   * @returns The fields.
   */
  overlay(): Partial<SelectionOverlayModel> {
    return this.editing.overlay();
  }

  /**
   * Resizes the caret for a new zoom.
   *
   * @param zoom - The camera zoom now.
   */
  onZoom(zoom: number): void {
    this.editing.onZoom(zoom);
  }

  /** Ends the editing, committing what was typed. */
  exit(): void {
    this.editing.exit();
  }

  /** Ends the editing writing nothing more (the person can no longer edit). */
  abandon(): void {
    this.editing.abandon();
  }
}
