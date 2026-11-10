import { describe, expect, it } from 'vitest';

import { DEFAULT_SHAPE_STYLE } from '@canvas/tools';

import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { shapeToolStyleOf, toolStyleDefaults } from './shape-style.js';

describe('the shape tool style', () => {
  it('registers the default shape, its labels in the text tool default style', () => {
    expect(toolStyleDefaults).toEqual({
      tool: 'shape',
      style: { ...DEFAULT_SHAPE_STYLE, textStyle: DEFAULT_TEXT_STYLE },
    });
  });

  it("gives a new shape the tool's kind and paint, defaults for the rest", () => {
    expect(shapeToolStyleOf(undefined)).toEqual({
      shape: DEFAULT_SHAPE_STYLE,
      textStyle: DEFAULT_TEXT_STYLE,
    });
    const chosen = shapeToolStyleOf({
      kind: 'star',
      fill: null,
      sides: 7,
      textStyle: { fontSize: 32 },
    });
    expect(chosen.shape).toEqual({ ...DEFAULT_SHAPE_STYLE, kind: 'star', fill: null, sides: 7 });
    expect(chosen.textStyle).toEqual({ ...DEFAULT_TEXT_STYLE, fontSize: 32 });
    expect(shapeToolStyleOf({ stroke: null, cornerRadius: 12 }).shape).toMatchObject({
      stroke: null,
      cornerRadius: 12,
    });
  });
});
