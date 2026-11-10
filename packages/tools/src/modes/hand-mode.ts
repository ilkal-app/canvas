import type { ScreenPoint } from '../camera/camera-moves.js';

import {
  TOOL_STEP_CONTINUE,
  type ToolCursor,
  type ToolMode,
  type ToolPointerInput,
  type ToolStep,
} from './tool-mode.js';

/** What the hand tool works on: the view it pans. */
export interface HandModeContext {
  /**
   * Moves the view with the pointer: the board follows a drag, as a middle-button drag does
   * (`CameraInput` `drag`).
   *
   * @param deltaXPx - How far the pointer moved right since the last call, CSS px.
   * @param deltaYPx - How far it moved down, CSS px.
   */
  readonly pan: (deltaXPx: number, deltaYPx: number) => void;
}

/** The hand's step: never done, so the hand stays the active tool after a drag. */
const HAND_STEP: ToolStep = TOOL_STEP_CONTINUE;

/**
 * The hand tool (`h`) as a tool mode: a drag with the primary button (or one finger)
 * pans the view, the board following the pointer; it writes nothing to the document, so a viewer
 * may use it as well. The cursor is an open hand, closed while it drags. It takes no key: Escape
 * and the others go on to the select tool's shortcuts. Pure, DOM-free; the app hands the pan to
 * its camera.
 */
export class HandMode implements ToolMode {
  readonly id = 'hand' as const;
  private readonly context: HandModeContext;
  /** Where the pointer was at the last input of a drag under way; none between drags. */
  private last: ScreenPoint | undefined;

  /**
   * Starts with no drag under way.
   *
   * @param context - The view it pans.
   */
  constructor(context: HandModeContext) {
    this.context = context;
  }

  /**
   * The open hand, or the closed one while a drag is under way.
   *
   * @returns The cursor.
   */
  get cursor(): ToolCursor {
    return this.last === undefined ? 'grab' : 'grabbing';
  }

  /**
   * A press starts a drag, each move of it pans by the pointer's movement, a release or a
   * cancel ends it. A hover, a secondary click and a held finger do nothing.
   *
   * @param input - The input.
   * @returns A step that keeps the hand active.
   */
  onPointer(input: ToolPointerInput): ToolStep {
    switch (input.kind) {
      case 'pointerDown':
        this.last = input.screen;
        return HAND_STEP;
      case 'pointerMove': {
        const { last } = this;
        if (last === undefined) return HAND_STEP;
        this.last = input.screen;
        const deltaX = input.screen.x - last.x;
        const deltaY = input.screen.y - last.y;
        if (deltaX !== 0 || deltaY !== 0) this.context.pan(deltaX, deltaY);
        return HAND_STEP;
      }
      case 'pointerUp':
      case 'pointerCancel':
        this.last = undefined;
        return HAND_STEP;
      case 'contextPress':
      case 'hold':
        return HAND_STEP;
    }
  }

  /**
   * Takes no key: the select tool's shortcuts take every one.
   *
   * @returns False.
   */
  onKey(): boolean {
    return false;
  }

  /**
   * Shows nothing over the select tool's overlay.
   *
   * @returns No fields.
   */
  overlay(): Record<string, never> {
    return {};
  }

  /** Ends a drag under way; nothing was written. */
  exit(): void {
    this.last = undefined;
  }
}
