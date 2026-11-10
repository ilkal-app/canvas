// The creation tools' default colour: the tools' style holds `ink`
// until the person picks a colour; `ink` is resolved where the creation starts.
import { describe, expect, it, vi } from 'vitest';

import type { ObjectId, PathObject, ShapeObject, TextObject } from '@canvas/schema';

import { connectorToolContext } from '../connector/__fixtures__/connector-tool-context.js';
import { ConnectorMode } from '../connector/connector-mode.js';
import { lineToolContext, PLAIN_STYLE } from '../line/__fixtures__/line-tool-context.js';
import type { LineStyle } from '../line/line-context.js';
import { LineMode } from '../line/line-mode.js';
import type { ToolId } from '../modes/tool-ids.js';
import { click, createPenModeContext } from '../pen/__fixtures__/pen-mode-context.js';
import { createPenMode } from '../pen/vector-modes.js';
import { rect } from '../select/__fixtures__/select-board.js';
import { DEFAULT_SHAPE_STYLE } from '../shape/new-shape-object.js';
import { ShapeMode, type ShapeModeContext } from '../shape/shape-mode.js';
import { createTextModeContext } from '../text/__fixtures__/text-mode-context.js';
import { TextMode } from '../text/text-mode.js';

import { copyInkableColor, creationColor, type CreationInkSource } from './creation-ink.js';

/** A red square at the origin, 100 × 100. */
const RED = rect('n', null, { x: 0, y: 0, width: 100, height: 100 });

function pointer(kind: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) {
  return {
    kind,
    screen: { x, y },
    world: { x, y },
    isShiftPressed: false,
    isModPressed: false,
    isSnapSuspended: true,
    zoom: 1,
  } as const;
}

function drawShape(from: readonly [number, number], extra: Partial<ShapeModeContext> = {}) {
  const fixture = createTextModeContext([RED]);
  const mode = new ShapeMode({ ...fixture.context, ...extra }, { kind: 'create' });
  mode.onPointer(pointer('pointerDown', ...from));
  mode.onPointer(pointer('pointerMove', from[0] + 80, from[1] + 60));
  const previewed = fixture.record.previews.get('new-1' as ObjectId) as ShapeObject | undefined;
  const previewColor = previewed?.stroke?.color;
  mode.onPointer(pointer('pointerUp', from[0] + 80, from[1] + 60));
  const created = fixture.store.get('new-1' as ObjectId) as ShapeObject | undefined;
  return { previewColor, created };
}

describe('creationColor', () => {
  it('keeps a picked colour and resolves ink by what is under the point', () => {
    const { store } = createTextModeContext([RED]);
    expect(creationColor(store, { x: 50, y: 50 }, [0.2, 0.2, 0.2, 1])).toEqual([0.2, 0.2, 0.2, 1]);
    expect(creationColor(store, { x: 500, y: 500 }, 'ink')).toBe('ink');
    // Red fails 4.5:1 with #1f1f1f and white; black passes.
    expect(creationColor(store, { x: 50, y: 50 }, 'ink')).toEqual([0, 0, 0, 1]);
  });

  it('composites a translucent stack over the creator’s canvas', () => {
    const veil = {
      ...rect('veil', null, { x: 0, y: 0, width: 100, height: 100 }),
      fill: [0, 0, 0, 0.9],
    };
    const { store } = createTextModeContext([veil as typeof RED]);
    const dark = { theme: () => 'dark' as const };
    expect(creationColor(store, { x: 50, y: 50 }, 'ink', dark)).toEqual([1, 1, 1, 1]);
    const custom = {
      theme: () => 'light' as const,
      canvasColor: (): [number, number, number, number] => [1, 1, 1, 1],
    };
    expect(creationColor(store, { x: 50, y: 50 }, 'ink', custom)).toEqual([1, 1, 1, 1]);
  });

  it('keeps ink the person picked for the creating tool, wherever it starts', () => {
    const { store } = createTextModeContext([RED]);
    const isInkPicked = vi.fn((tool: ToolId) => tool === 'line');
    const source = { theme: () => 'light' as const, isInkPicked };
    expect(creationColor(store, { x: 50, y: 50 }, 'ink', source, 'line')).toBe('ink');
    expect(isInkPicked).toHaveBeenLastCalledWith('line');
    // Another tool's pick, or no tool named, leaves the default rule.
    expect(creationColor(store, { x: 50, y: 50 }, 'ink', source, 'shape')).toEqual([0, 0, 0, 1]);
    expect(creationColor(store, { x: 50, y: 50 }, 'ink', source)).toEqual([0, 0, 0, 1]);
    // A picked colour tuple is used as is.
    expect(creationColor(store, { x: 50, y: 50 }, [1, 0, 0, 1], source, 'line')).toEqual([
      1, 0, 0, 1,
    ]);
  });

  it('copies a tuple and keeps the token', () => {
    const color: [number, number, number, number] = [1, 0, 0, 1];
    expect(copyInkableColor(color)).not.toBe(color);
    expect(copyInkableColor('ink')).toBe('ink');
  });
});

describe('the shape tool’s outline colour', () => {
  it('is ink over the empty canvas, in the preview and the created shape', () => {
    const { previewColor, created } = drawShape([300, 300]);
    expect(previewColor).toBe('ink');
    expect(created?.stroke?.color).toBe('ink');
    expect(DEFAULT_SHAPE_STYLE.stroke?.color).toBe('ink');
  });

  it('contrasts with the fill under the press, wherever the drag ends', () => {
    const { previewColor, created } = drawShape([50, 50]);
    expect(previewColor).toEqual([0, 0, 0, 1]);
    expect(created?.stroke?.color).toEqual([0, 0, 0, 1]);
  });

  it('keeps ink the person picked, over a fill', () => {
    const creationInk = { theme: () => 'light' as const, isInkPicked: () => true };
    const { previewColor, created } = drawShape([50, 50], { creationInk });
    expect(previewColor).toBe('ink');
    expect(created?.stroke?.color).toBe('ink');
  });

  it('keeps a colour the person picked, even with poor contrast', () => {
    const style = {
      ...DEFAULT_SHAPE_STYLE,
      stroke: { color: [1, 0, 0, 1] as [number, number, number, number], width: 2 },
    };
    const { created } = drawShape([50, 50], { newShapeStyle: () => style });
    expect(created?.stroke?.color).toEqual([1, 0, 0, 1]);
  });
});

describe('the line tool’s stroke colour', () => {
  const inkStyle: LineStyle = { ...PLAIN_STYLE, stroke: { color: 'ink', width: 2 } };
  function drawLine(
    from: { x: number; y: number },
    style = inkStyle,
    creationInk?: CreationInkSource,
  ) {
    const { store, context } = lineToolContext(style);
    const mode = new LineMode(creationInk === undefined ? context : { ...context, creationInk });
    const at = (
      kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
      point: { x: number; y: number },
    ) => ({
      ...pointer(kind, point.x, point.y),
      snapping: { isEnabled: false, isGridVisible: false },
    });
    mode.onPointer(at('pointerDown', from));
    mode.onPointer(at('pointerMove', { x: from.x + 120, y: from.y + 40 }));
    mode.onPointer(at('pointerUp', { x: from.x + 120, y: from.y + 40 }));
    const line = [...store.read().objects.values()].find((object) => object.id === 'new-1');
    return line?.type === 'line' ? line.stroke.color : undefined;
  }

  it('is ink from the empty canvas and contrasts with a fill under its first point', () => {
    expect(drawLine({ x: 300, y: 400 })).toBe('ink');
    expect(drawLine({ x: 50, y: 25 })).toEqual([0, 0, 0, 1]);
  });

  it('keeps ink the person picked after a fixed colour, over a fill', () => {
    const picked = {
      theme: () => 'light' as const,
      isInkPicked: (tool: ToolId) => tool === 'line',
    };
    expect(drawLine({ x: 50, y: 25 }, inkStyle, picked)).toBe('ink');
    const other = { theme: () => 'light' as const, isInkPicked: () => false };
    expect(drawLine({ x: 50, y: 25 }, inkStyle, other)).toEqual([0, 0, 0, 1]);
  });

  it('keeps a picked colour', () => {
    expect(drawLine({ x: 50, y: 25 }, PLAIN_STYLE)).toEqual([0, 0, 0, 1]);
    const red = {
      ...PLAIN_STYLE,
      stroke: { color: [1, 0, 0, 1] as [number, number, number, number], width: 2 },
    };
    expect(drawLine({ x: 50, y: 25 }, red)).toEqual([1, 0, 0, 1]);
  });
});

describe('the connector, pen and text tools’ picked ink', () => {
  /**
   * A source where only one tool's ink was picked, recording which tools were asked.
   *
   * @param tool - The tool whose ink was picked.
   * @returns The source.
   */
  function pickedFor(tool: ToolId) {
    const isInkPicked = vi.fn((asked: ToolId) => asked === tool);
    return { theme: () => 'light' as const, isInkPicked };
  }
  const snapping = { isEnabled: false, isGridVisible: false };
  const camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 };

  it('the connector tool asks for its own pick and keeps it', () => {
    const creationInk = pickedFor('connector');
    const style = {
      stroke: { color: 'ink' as const, width: 2 },
      startCap: 'none' as const,
      endCap: 'arrow' as const,
      route: 'straight' as const,
    };
    const { store, context } = connectorToolContext(style);
    const mode = new ConnectorMode({ ...context, creationInk });
    const at = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) => ({
      ...pointer(kind, x, y),
      snapping,
      camera,
    });
    mode.onPointer(at('pointerDown', 50, 25));
    mode.onPointer(at('pointerMove', 400, 400));
    mode.onPointer(at('pointerUp', 400, 400));
    expect(creationInk.isInkPicked).toHaveBeenCalledWith('connector');
    const made = [...store.read().objects.values()].find((object) => object.id === 'new-1');
    expect(made?.type === 'connector' ? made.stroke.color : undefined).toBe('ink');
  });

  it('the pen tool asks for its own pick and keeps it', () => {
    const creationInk = pickedFor('pen');
    const { store, context } = createPenModeContext([RED]);
    const mode = createPenMode(
      {
        ...context,
        creationInk,
        newPathStyle: () => ({ stroke: { color: 'ink', width: 2 }, fill: null }),
      },
      { kind: 'create' },
    );
    click(mode, { x: 50, y: 50 });
    click(mode, { x: 80, y: 80 });
    expect(creationInk.isInkPicked).toHaveBeenCalledWith('pen');
    const path = [...store.read().objects.values()].find(
      (object): object is PathObject => object.type === 'path',
    );
    expect(path?.stroke?.color).toBe('ink');
  });

  it('the text tool asks for its own pick and keeps it', () => {
    const creationInk = pickedFor('text');
    const fixture = createTextModeContext([RED]);
    const base = fixture.context.newTextStyle();
    const mode = new TextMode(
      { ...fixture.context, creationInk, newTextStyle: () => ({ ...base, color: 'ink' }) },
      { kind: 'create' },
    );
    mode.onPointer(pointer('pointerDown', 50, 50));
    mode.onPointer(pointer('pointerUp', 50, 50));
    mode.session?.type('A');
    expect(creationInk.isInkPicked).toHaveBeenCalledWith('text');
    const text = [...fixture.store.read().objects.values()].find(
      (object): object is TextObject => object.type === 'text',
    );
    expect(text?.runs[0]?.style.color).toBe('ink');
  });
});
