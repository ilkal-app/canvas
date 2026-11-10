import { DrawMode, type DrawModeContext } from '@canvas/tools';

import { drawToolStyleOf } from '../../tool-styles/draw-style.js';

import type { ToolModeEntry, ToolModeServices } from './tool-mode-entry.js';

/**
 * What the draw tool works on, from the tool modes' services: the document, previews, the
 * typing undo policy (so a stroke is its own undo step), the creator's theme and picks for a new
 * stroke's default colour (`creationInk`), the tool's style, where refusals go, and for
 * the eraser the select tool's gated source and the hit-test index.
 *
 * @param services - The tool modes' services.
 * @returns The draw tool's context.
 */
export function drawModeContextOf(services: ToolModeServices): DrawModeContext {
  return {
    store: services.store,
    origin: services.origin,
    environment: services.environment,
    capture: services.capture,
    setPreview: services.setPreview,
    onChange: services.onChange,
    drawStyle: () => drawToolStyleOf(services.toolStyleOf?.('draw')),
    requestExit: services.requestExit,
    source: services.selectTool.source,
    ...(services.snapIndex === undefined ? {} : { hitIndex: services.snapIndex }),
    ...(services.creationInk === undefined ? {} : { creationInk: services.creationInk }),
    ...(services.liveInk === undefined ? {} : { liveInk: services.liveInk }),
    ...(services.onCommandRefused === undefined
      ? {}
      : { onCommandRefused: services.onCommandRefused }),
  };
}

/**
 * The draw tool (Shift+P): a drag draws a freehand stroke in the tool's style (the
 * pencil, the marker or the highlighter), written on release as one undo step; the tool stays
 * active for the next stroke. With the eraser (Shift+E) a drag erases whole strokes,
 * also one undo step. No object type is activated into it.
 */
export const toolModeEntry: ToolModeEntry = {
  tool: 'draw',
  activates: [],
  create: (services) => new DrawMode(drawModeContextOf(services)),
};
