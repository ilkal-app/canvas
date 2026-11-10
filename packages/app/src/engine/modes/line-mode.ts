import { LineMode, type LineToolContext } from '@canvas/tools';

import { lineToolStyleOf } from '../../tool-styles/line-style.js';

import type { ToolModeEntry, ToolModeServices } from './tool-mode-entry.js';

/**
 * What line editing works on, from the tool modes' services: the document, previews, the typing
 * undo policy (so a line is its own undo step), the hit-test index its ends snap through, the
 * creator's theme and picks for a new stroke's default colour (`creationInk`), and
 * where refusals go.
 *
 * @param services - The tool modes' services.
 * @returns The line tool's context.
 */
export function lineToolContextOf(services: ToolModeServices): LineToolContext {
  return {
    store: services.store,
    origin: services.origin,
    environment: services.environment,
    capture: services.capture,
    setPreview: services.setPreview,
    onChange: services.onChange,
    ...(services.snapIndex === undefined ? {} : { snapIndex: services.snapIndex }),
    ...(services.creationInk === undefined ? {} : { creationInk: services.creationInk }),
    ...(services.onCommandRefused === undefined
      ? {}
      : { onCommandRefused: services.onCommandRefused }),
  };
}

/**
 * The line tool (`l`, and Shift+L for the arrow, which sets an `arrow` end cap in the tool's
 * style): a drag draws a line in the tool's style, its ends snapping to object anchors,
 * edges, centres and the grid, Shift turning it to 45°. No object type is activated into it: a
 * selected line's ends are dragged in the select tool (`select-mode.ts`).
 */
export const toolModeEntry: ToolModeEntry = {
  tool: 'line',
  activates: [],
  create: (services) =>
    new LineMode({
      ...lineToolContextOf(services),
      source: services.selectTool.source,
      lineStyle: () => lineToolStyleOf(services.toolStyleOf?.('line')),
      selectObjects: services.selectObjects,
      requestExit: services.requestExit,
    }),
};
