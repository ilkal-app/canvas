import { ShapeMode, type ShapeModeContext } from '@canvas/tools';

import { shapeToolStyleOf } from '../../tool-styles/shape-style.js';

import type { ToolModeEntry, ToolModeServices } from './tool-mode-entry.js';

/**
 * The shape mode's context: the services, with new shapes in the shape tool's style
 * (`shapeToolStyleOf`: its kind, the last picked; its fill and outline) and their labels in its
 * text style, centred; drags snapping through the hit-test index.
 *
 * @param services - What the modes work on.
 * @returns The context.
 */
export function shapeContextOf(services: ToolModeServices): ShapeModeContext {
  const style = () => shapeToolStyleOf(services.toolStyleOf?.('shape'));
  const { snapIndex } = services;
  return {
    ...services,
    newTextStyle: () => style().textStyle,
    newTextAlign: () => 'center',
    newShapeStyle: () => style().shape,
    ...(snapIndex === undefined
      ? {}
      : { snap: { index: snapIndex, source: services.selectTool.source } }),
  };
}

/**
 * The shape tool (`r`): a drag draws a shape of the tool's kind (Shift 1:1, Alt from the
 * centre), a click a 100-unit one; a double-click or Enter on a shape edits its label (at the
 * double-clicked point), unless it is locked.
 */
export const toolModeEntry: ToolModeEntry = {
  tool: 'shape',
  activates: ['shape'],
  create: (services) => new ShapeMode(shapeContextOf(services), { kind: 'create' }),
  activate: (services, activation, object) => {
    if (object.locked) return undefined;
    const world = activation.source === 'enter' ? {} : { world: activation.world };
    return new ShapeMode(shapeContextOf(services), { kind: 'edit', id: object.id, ...world });
  },
};
