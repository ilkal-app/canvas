import type { Point } from '@canvas/schema';

import {
  TOOL_STEP_CONTINUE,
  type ToolCursor,
  type ToolKeyInput,
  type ToolMode,
  type ToolPointerInput,
  type ToolStep,
} from '../modes/tool-mode.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';

/** What the image tool asks of the app, which owns the file picker (a DOM element). */
export interface ImageModeContext {
  /**
   * Opens the file picker; the images chosen are uploaded and placed centred on `at`, or on the
   * view's centre when `at` is absent.
   *
   * @param at - Where the images go, world units; the view's centre if absent.
   * @returns Settles once the picker closed, whether images were chosen or not.
   */
  readonly pickImages: (at: Point | undefined) => Promise<void>;
  /** Ends the mode from inside it: back to the select tool. */
  readonly requestExit: () => void;
}

/**
 * The image tool, `i`: opens the file picker at once, for
 * images placed at the view's centre, and hands back to the select tool when the picker closes
 * (the placed images are selected). While it waits, a click on the canvas opens the picker again
 * for images placed where it clicked: a browser opens a picker only on a person's gesture, which
 * a click always is. Escape hands back at once. Main thread; no DOM.
 */
export class ImageMode implements ToolMode {
  readonly id = 'image' as const;
  readonly cursor: ToolCursor = 'crosshair';
  private readonly context: ImageModeContext;
  private isEnded = false;
  private press: Point | undefined;

  /**
   * Starts the tool: opens the picker for the view's centre.
   *
   * @param context - The picker and the router's exit.
   */
  constructor(context: ImageModeContext) {
    this.context = context;
    this.pick(undefined);
  }

  onPointer(input: ToolPointerInput): ToolStep {
    if (input.kind === 'pointerDown') this.press = input.world;
    if (input.kind === 'pointerUp' && this.press !== undefined) this.pick(input.world);
    if (input.kind === 'pointerUp' || input.kind === 'pointerCancel') this.press = undefined;
    return TOOL_STEP_CONTINUE;
  }

  onKey(input: ToolKeyInput): boolean {
    if (input.kind !== 'escape') return false;
    this.context.requestExit();
    return true;
  }

  overlay(): Partial<SelectionOverlayModel> {
    return {};
  }

  exit(): void {
    this.isEnded = true;
  }

  /**
   * Opens the picker, and hands back to the select tool once it closes (or failed to open),
   * unless the mode ended first.
   *
   * @param at - Where the images go, or the view's centre.
   */
  private pick(at: Point | undefined): void {
    const done = () => {
      if (!this.isEnded) this.context.requestExit();
    };
    this.context.pickImages(at).then(done, done);
  }
}
