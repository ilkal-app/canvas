// The shape tool's mode context: new shapes and their labels in the shape tool's style, labels
// centred. A drag in Chrome: tooling/scenario/specs/tools/shape-*.
import { describe, expect, it } from 'vitest';

import { shapeToolStyleOf } from '../../tool-styles/shape-style.js';

import { shapeContextOf } from './shape-mode.js';
import type { ToolModeServices } from './tool-mode-entry.js';

/**
 * Services with only the shape tool's style, as `shapeContextOf` reads them.
 *
 * @param toolStyleOf - The tools' styles.
 * @returns The services.
 */
function servicesWith(toolStyleOf: ToolModeServices['toolStyleOf']): ToolModeServices {
  return { toolStyleOf } as unknown as ToolModeServices;
}

describe('shapeContextOf', () => {
  it('centres a new label, and types it and draws the shape in the shape tool’s style', () => {
    const style = { kind: 'ellipse', fill: null } as const;
    const expected = shapeToolStyleOf(style);
    const context = shapeContextOf(servicesWith((tool) => (tool === 'shape' ? style : {})));

    expect(context.newTextAlign?.()).toBe('center');
    expect(context.newShapeStyle?.()).toEqual(expected.shape);
    expect(context.newShapeStyle?.()).toMatchObject({ kind: 'ellipse', fill: null });
    expect(context.newTextStyle()).toEqual(expected.textStyle);
    expect(context.snap).toBeUndefined();
  });
});
