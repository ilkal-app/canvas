import { describe, expect, it } from 'vitest';

import { DEFAULT_TOOL_STYLES, toolStylesOf } from '../tool-styles/default-tool-styles.js';

import { isToolStyleDefaults, mergeStyle, resolveToolStyles } from './tool-style.js';

describe('resolveToolStyles', () => {
  it("lays the person's choices over each tool's defaults, text style field by field", () => {
    const resolved = resolveToolStyles(
      { shape: { fill: [1, 0, 0, 1], cornerRadius: 4 }, text: { textStyle: { fontSize: 16 } } },
      {
        shape: { fill: null },
        text: { textStyle: { italic: true } },
        sticky: { color: [1, 1, 0, 1] },
      },
    );
    expect(resolved).toEqual({
      shape: { fill: null, cornerRadius: 4 },
      text: { textStyle: { fontSize: 16, italic: true } },
      sticky: { color: [1, 1, 0, 1] },
    });
  });

  it('keeps a default untouched when the person chose nothing, and leaves out tools with neither', () => {
    const defaults = { shape: { fill: null } };
    const resolved = resolveToolStyles(defaults, {});
    expect(resolved.shape).toBe(defaults.shape);
    expect(Object.keys(resolved)).toEqual(['shape']);
  });

  it('merges without a base', () => {
    expect(mergeStyle(undefined, { fill: null })).toEqual({ fill: null });
  });
});

describe('tool style defaults', () => {
  it('recognises a registration by its shape', () => {
    expect(isToolStyleDefaults({ tool: 'shape', style: {} })).toBe(true);
    expect(isToolStyleDefaults({ tool: 'brush', style: {} })).toBe(false);
    expect(isToolStyleDefaults({ tool: 'shape', style: null })).toBe(false);
    expect(isToolStyleDefaults({ tool: 3, style: {} })).toBe(false);
    expect(isToolStyleDefaults(null)).toBe(false);
  });

  it('collects registrations by tool, refusing a second for the same tool', () => {
    expect(toolStylesOf([{ tool: 'shape', style: { fill: null } }])).toEqual({
      shape: { fill: null },
    });
    expect(() =>
      toolStylesOf([
        { tool: 'shape', style: {} },
        { tool: 'shape', style: {} },
      ]),
    ).toThrow('Two files register the default style of the shape tool.');
  });

  it('finds the registrations the shell ships, each for a known tool', () => {
    for (const [tool, style] of Object.entries(DEFAULT_TOOL_STYLES)) {
      expect(isToolStyleDefaults({ tool, style }), tool).toBe(true);
    }
  });
});
