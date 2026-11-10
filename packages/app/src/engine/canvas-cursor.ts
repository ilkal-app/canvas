import type { ToolCursor } from '@canvas/tools';

import { cssCursorOf } from './select-cursor-style.js';

/**
 * Shows the cursor the active tool asks for on the canvas, writing the element's style only
 * when the CSS value changes: the rotate cursor's value is cached per 15° step, so a hover that
 * stays in one step writes nothing (the browser normalises the value it reads back, so the
 * style itself is not compared). The canvas element stays on the page even after it hands its
 * drawing to a worker, so both mounts use it. Main thread.
 */
export class CanvasCursor {
  private readonly canvas: HTMLCanvasElement;
  /** The CSS cursor last written to the canvas. */
  private shown: string | undefined;

  /**
   * Starts with nothing written.
   *
   * @param canvas - The canvas whose cursor this sets.
   */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /**
   * Shows a cursor.
   *
   * @param cursor - The active tool's cursor (`default` while a tool without a mode is active).
   */
  show(cursor: ToolCursor): void {
    const css = cssCursorOf(cursor);
    if (css === this.shown) return;
    this.shown = css;
    this.canvas.style.cursor = css;
  }
}
