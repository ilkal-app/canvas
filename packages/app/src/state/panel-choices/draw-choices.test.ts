// The Draw panel's choices: their defaults, how a stored value reads back field by
// field, each drawing sub-tool's own colour and size, and the draw tool's style they give.
import { describe, expect, it } from 'vitest';

import { DEFAULT_DRAW_STYLES, HIGHLIGHTER_AMBER } from '../../tool-styles/draw-style.js';
import { loadToolPanelChoices, saveToolPanelChoices } from '../tool-panel-choices.js';
import type { PreferenceStorage } from '../view-preferences.js';

import {
  DRAW_CHOICES,
  DRAW_PANEL_COLOUR_VALUES,
  DRAW_PANEL_WIDTHS,
  drawPanelToolStyle,
  withDrawKey,
  withDrawLook,
  withDrawSubTool,
  type DrawChoices,
} from './draw-choices.js';

/**
 * A storage kept in a map.
 *
 * @returns The storage and its map.
 */
function memoryStorage(): PreferenceStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

describe('DRAW_CHOICES', () => {
  it('defaults to the pencil, every sub-tool at the middle size, the highlighter amber', () => {
    expect(DRAW_CHOICES.id).toBe('draw');
    expect(DRAW_CHOICES.defaults).toEqual({
      subTool: 'pencil',
      drawingTool: 'pencil',
      looks: {
        pencil: { colour: 'ink', size: 1 },
        marker: { colour: 'ink', size: 1 },
        highlighter: { colour: 'amber', size: 1 },
      },
    });
  });

  it('reads a value of any other shape as the defaults', () => {
    for (const stored of [null, 3, 'pencil', [], undefined]) {
      expect(DRAW_CHOICES.parse(stored)).toEqual(DRAW_CHOICES.defaults);
    }
  });

  it('falls back field by field, keeping every valid one', () => {
    const parsed = DRAW_CHOICES.parse({
      subTool: 'crayon',
      looks: {
        pencil: { colour: 'red', size: 7 },
        marker: 'bold',
        highlighter: { colour: 'green', size: 2 },
      },
    });
    expect(parsed).toEqual({
      subTool: 'pencil',
      drawingTool: 'pencil',
      looks: {
        pencil: { colour: 'red', size: 1 },
        marker: { colour: 'ink', size: 1 },
        highlighter: { colour: 'green', size: 2 },
      },
    });
  });

  it('keeps the look drawing returns to while erasing, and drops a stale one otherwise', () => {
    expect(DRAW_CHOICES.parse({ subTool: 'eraser', drawingTool: 'marker' })).toMatchObject({
      subTool: 'eraser',
      drawingTool: 'marker',
    });
    expect(DRAW_CHOICES.parse({ subTool: 'eraser', drawingTool: 'eraser' })).toMatchObject({
      subTool: 'eraser',
      drawingTool: 'pencil',
    });
    expect(DRAW_CHOICES.parse({ subTool: 'highlighter', drawingTool: 'marker' })).toMatchObject({
      subTool: 'highlighter',
      drawingTool: 'highlighter',
    });
  });

  it('round-trips through the person’s storage under canvas.tool-panel.draw', () => {
    const storage = memoryStorage();
    const choices = withDrawLook(withDrawSubTool(DRAW_CHOICES.defaults, 'marker'), {
      colour: 'red',
      size: 2,
    });
    saveToolPanelChoices(DRAW_CHOICES, choices, storage);
    expect([...storage.items.keys()]).toEqual(['canvas.tool-panel.draw']);
    expect(loadToolPanelChoices(DRAW_CHOICES, storage)).toEqual(choices);
  });
});

describe('the Draw panel’s per-sub-tool memory', () => {
  it('changes only the drawing sub-tool’s look and keeps each one’s own', () => {
    const marker = withDrawLook(withDrawSubTool(DRAW_CHOICES.defaults, 'marker'), {
      colour: 'blue',
    });
    const highlighter = withDrawSubTool(marker, 'highlighter');
    expect(highlighter.looks.highlighter).toEqual({ colour: 'amber', size: 1 });
    const bold = withDrawLook(highlighter, { size: 2 });
    expect(bold.looks).toEqual({
      pencil: { colour: 'ink', size: 1 },
      marker: { colour: 'blue', size: 1 },
      highlighter: { colour: 'amber', size: 2 },
    });
    expect(withDrawSubTool(bold, 'marker').looks.marker).toEqual({ colour: 'blue', size: 1 });
  });

  it('keeps the drawing sub-tool when the eraser is chosen', () => {
    const erasing = withDrawSubTool(withDrawSubTool(DRAW_CHOICES.defaults, 'marker'), 'eraser');
    expect(erasing).toMatchObject({ subTool: 'eraser', drawingTool: 'marker' });
  });
});

describe('drawPanelToolStyle', () => {
  it('gives the defaults the draw tool’s own default styles', () => {
    const style = drawPanelToolStyle(DRAW_CHOICES.defaults);
    expect(style).toEqual({ ...DEFAULT_DRAW_STYLES.pencil, opacity: undefined, isEraser: false });
    const highlighter = drawPanelToolStyle(withDrawSubTool(DRAW_CHOICES.defaults, 'highlighter'));
    expect(highlighter).toEqual({ ...DEFAULT_DRAW_STYLES.highlighter, isEraser: false });
    expect(highlighter.stroke?.color).toEqual(HIGHLIGHTER_AMBER);
  });

  it('maps each size to its sub-tool’s width', () => {
    expect(DRAW_PANEL_WIDTHS).toEqual({
      pencil: [1, 2, 4],
      marker: [4, 6, 10],
      highlighter: [10, 16, 24],
    });
    for (const tool of ['pencil', 'marker', 'highlighter'] as const) {
      for (const size of [0, 1, 2] as const) {
        const choices = withDrawLook(withDrawSubTool(DRAW_CHOICES.defaults, tool), { size });
        expect(drawPanelToolStyle(choices).stroke?.width).toBe(DRAW_PANEL_WIDTHS[tool][size]);
      }
    }
  });

  it('stores ink as the theme-aware ink and the other colours as fixed colours', () => {
    expect(DRAW_PANEL_COLOUR_VALUES.ink).toBe('ink');
    // The light theme's mark/red-pencil, #c2382e.
    expect(DRAW_PANEL_COLOUR_VALUES.red).toEqual([194 / 255, 56 / 255, 46 / 255, 1]);
    const red: DrawChoices = withDrawLook(withDrawSubTool(DRAW_CHOICES.defaults, 'marker'), {
      colour: 'red',
      size: 2,
    });
    expect(drawPanelToolStyle(red)).toEqual({
      tool: 'marker',
      stroke: { color: DRAW_PANEL_COLOUR_VALUES.red, width: 10 },
      opacity: undefined,
      isEraser: false,
    });
  });

  it('erases with the look drawing returns to', () => {
    const erasing = withDrawSubTool(
      withDrawSubTool(DRAW_CHOICES.defaults, 'highlighter'),
      'eraser',
    );
    expect(drawPanelToolStyle(erasing)).toEqual({
      ...DEFAULT_DRAW_STYLES.highlighter,
      isEraser: true,
    });
  });
});

describe('withDrawKey', () => {
  it('cycles pencil, marker, highlighter and back to the pencil with P', () => {
    const marker = withDrawKey(DRAW_CHOICES.defaults, 'cycle');
    expect([marker.subTool, marker.drawingTool]).toEqual(['marker', 'marker']);
    const highlighter = withDrawKey(marker, 'cycle');
    expect(highlighter.subTool).toBe('highlighter');
    expect(withDrawKey(highlighter, 'cycle').subTool).toBe('pencil');
  });

  it('chooses the eraser with E, and P returns to the drawing sub-tool last chosen', () => {
    const marker = withDrawLook(withDrawSubTool(DRAW_CHOICES.defaults, 'marker'), {
      colour: 'green',
      size: 2,
    });
    const erasing = withDrawKey(marker, 'eraser');
    expect([erasing.subTool, erasing.drawingTool]).toEqual(['eraser', 'marker']);
    expect(withDrawKey(erasing, 'eraser')).toEqual(erasing);
    const back = withDrawKey(erasing, 'cycle');
    expect(back.subTool).toBe('marker');
    expect(back.looks.marker).toEqual({ colour: 'green', size: 2 });
    expect(drawPanelToolStyle(back)).toMatchObject({ tool: 'marker', isEraser: false });
  });
});
