import {
  renameFrameCommand,
  runCommand,
  type CommandEnvironment,
  type CommandError,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type {
  ToolCursor,
  ToolKeyInput,
  ToolMode,
  ToolPointerInput,
  ToolStep,
} from '../modes/tool-mode.js';
import { TOOL_STEP_CONTINUE } from '../modes/tool-mode.js';
import type { TypingCapture } from '../text/text-mode-context.js';

import type { SelectionOverlayModel } from './overlay-rects.js';

/** The longest frame name, characters (the schema's limit). */
export const MAX_FRAME_NAME_LENGTH = 200;

/** What the frame name editor works on and reports to. Main thread. */
export interface FrameNameModeContext {
  /** The document; the mode writes to it only through `renameFrame`. */
  readonly store: DocumentStore;
  /** Who the rename is attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /** How the rename joins the person's undo steps: one step. */
  readonly capture: Pick<TypingCapture, 'command'>;
  /** Ends the mode from inside it: back to the select tool. */
  readonly requestExit: () => void;
  /** Called when what the mode shows changed. */
  readonly onChange: () => void;
  /** Receives the errors of a rename the document refused (the frame was deleted meanwhile). */
  readonly onCommandRefused?: (errors: readonly CommandError[]) => void;
}

/**
 * Editing a frame's name in place: entered by a
 * double-click on the frame's title band. The app shows an input over the band that edits
 * {@link FrameNameMode.draft}; Enter, a click outside it or ending the mode commits the draft as
 * one `renameFrame` command, one undo step (nothing when it is unchanged); Escape cancels,
 * writing nothing. The name is cut to {@link MAX_FRAME_NAME_LENGTH} characters. Main thread; no
 * DOM.
 */
export class FrameNameMode implements ToolMode {
  /** The toolbar keeps the select tool while a name is edited. */
  readonly id = 'select' as const;
  readonly cursor: ToolCursor = 'default';
  /** The frame whose name is edited. */
  readonly frameId: ObjectId;
  private readonly context: FrameNameModeContext;
  private text: string;
  private isEnded = false;

  /**
   * Starts editing a frame's name, the draft starting as the name.
   *
   * @param context - The document, undo grouping and callbacks.
   * @param frameId - The frame.
   */
  constructor(context: FrameNameModeContext, frameId: ObjectId) {
    this.context = context;
    this.frameId = frameId;
    const frame = context.store.get(frameId);
    this.text = frame?.type === 'frame' ? frame.name : '';
  }

  /**
   * The name as edited so far.
   *
   * @returns The draft.
   */
  get draft(): string {
    return this.text;
  }

  /**
   * The document the frame is read from, for placing the input over its title band.
   *
   * @returns The document.
   */
  get source(): Pick<DocumentStore, 'get'> {
    return this.context.store;
  }

  /**
   * Whether the mode has ended (committed or cancelled): the input then goes away.
   *
   * @returns True once ended.
   */
  get isFinished(): boolean {
    return this.isEnded;
  }

  /**
   * Replaces the draft, as the input's value changes.
   *
   * @param text - The input's value; cut to {@link MAX_FRAME_NAME_LENGTH} UTF-16 code units, as
   *   the schema counts.
   */
  setDraft(text: string): void {
    if (this.isEnded) return;
    this.text = text.slice(0, MAX_FRAME_NAME_LENGTH);
  }

  /** Commits the draft and ends the mode (Enter, the input losing focus). */
  commit(): void {
    if (this.isEnded) return;
    this.finish(true);
    this.context.requestExit();
  }

  /** Drops the draft and ends the mode (Escape). */
  cancel(): void {
    if (this.isEnded) return;
    this.finish(false);
    this.context.requestExit();
  }

  onPointer(input: ToolPointerInput): ToolStep {
    // A press on the board is a click outside the input: it commits, and the select tool takes
    // the press as it would have.
    if (input.kind === 'pointerDown') return { isDone: true, isPassedOn: true };
    return TOOL_STEP_CONTINUE;
  }

  onKey(input: ToolKeyInput): boolean {
    if (input.kind === 'escape') this.cancel();
    else if (input.kind === 'enter') this.commit();
    else return false;
    return true;
  }

  overlay(): Partial<SelectionOverlayModel> {
    return {};
  }

  exit(): void {
    this.finish(true);
  }

  abandon(): void {
    this.finish(false);
  }

  /**
   * Ends the mode once, writing the draft when asked and it differs from the name.
   *
   * @param isCommitted - Whether to write the draft.
   */
  private finish(isCommitted: boolean): void {
    if (this.isEnded) return;
    this.isEnded = true;
    const { context, frameId, text } = this;
    const frame = context.store.get(frameId);
    if (isCommitted && frame?.type === 'frame' && frame.name !== text) {
      context.capture.command(() => {
        const input = { id: frameId, name: text };
        const outcome = runCommand(
          context.store,
          context.origin,
          renameFrameCommand,
          input,
          context.environment,
        );
        if (outcome.status === 'rejected') context.onCommandRefused?.(outcome.errors);
      });
    }
    context.onChange();
  }
}
