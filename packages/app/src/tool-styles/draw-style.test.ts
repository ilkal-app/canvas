import { describe, expect, it } from 'vitest';

import { DEFAULT_TOOL_STYLES } from './default-tool-styles.js';
import { DEFAULT_DRAW_STYLES, drawToolStyleOf, HIGHLIGHTER_AMBER } from './draw-style.js';

describe('drawToolStyleOf', () => {
  it('is the pencil, 2 px of ink, by default, as registered', () => {
    expect(DEFAULT_TOOL_STYLES.draw).toEqual({ tool: 'pencil' });
    expect(drawToolStyleOf(DEFAULT_TOOL_STYLES.draw)).toEqual({
      tool: 'pencil',
      stroke: { color: 'ink', width: 2 },
    });
    expect(drawToolStyleOf(undefined)).toEqual(DEFAULT_DRAW_STYLES.pencil);
  });

  it('gives each sub-tool its own defaults: the marker 6 px, the highlighter amber at 40%', () => {
    expect(drawToolStyleOf({ tool: 'marker' })).toEqual({
      tool: 'marker',
      stroke: { color: 'ink', width: 6 },
    });
    expect(drawToolStyleOf({ tool: 'highlighter' })).toEqual({
      tool: 'highlighter',
      stroke: { color: HIGHLIGHTER_AMBER, width: 16 },
      opacity: 0.4,
    });
  });

  it('takes the stroke and opacity the style sets over the sub-tool’s', () => {
    expect(
      drawToolStyleOf({
        tool: 'highlighter',
        stroke: { color: [0, 1, 0, 1], width: 10 },
        opacity: 0.6,
      }),
    ).toEqual({ tool: 'highlighter', stroke: { color: [0, 1, 0, 1], width: 10 }, opacity: 0.6 });
    expect(drawToolStyleOf({ tool: 'pencil', stroke: null }).stroke).toEqual({
      color: 'ink',
      width: 2,
    });
  });

  it('erases with the eraser in use, in the look drawing returns to', () => {
    expect(drawToolStyleOf({ tool: 'marker', isEraser: true })).toEqual({
      tool: 'marker',
      stroke: { color: 'ink', width: 6 },
      isEraser: true,
    });
    expect(drawToolStyleOf({ tool: 'marker', isEraser: false })).not.toHaveProperty('isEraser');
  });
});
