///619/624: panel choices define the defaults and styles of newly created objects.
import { describe, expect, it } from 'vitest';

import { DEFAULT_SHAPE_STYLE, NOTE_COLORS } from '@canvas/tools';

import { loadToolPanelChoices, saveToolPanelChoices } from '../tool-panel-choices.js';
import type { PreferenceStorage } from '../view-preferences.js';

import {
  CONNECTOR_PANEL_CAPS,
  CONNECTOR_PANEL_ENDS,
  CONNECTOR_PANEL_WIDTHS,
  CONNECTOR_CHOICES,
  connectorToolStyle,
  type ConnectorChoices,
} from './connector-choices.js';
import {
  SHAPE_PANEL_KINDS,
  SHAPES_CHOICES,
  shapesToolStyle,
  type ShapesChoices,
} from './shapes-choices.js';
import {
  STICKY_PANEL_ASPECTS,
  STICKY_PANEL_COLORS,
  STICKY_CHOICES,
  stickyToolStyle,
  type StickyChoices,
} from './sticky-choices.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: PreferenceStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  return { items, storage };
}

describe('Shapes panel choices', () => {
  it('lists the five kinds in panel order without a block arrow', () => {
    expect(SHAPE_PANEL_KINDS).toEqual(['rectangle', 'ellipse', 'triangle', 'polygon', 'star']);
  });

  it('starts with the shape tool’s rectangle, fill and ink stroke', () => {
    expect(SHAPES_CHOICES.id).toBe('shapes');
    expect(SHAPES_CHOICES.defaults).toEqual({
      kind: 'rectangle',
      fill: DEFAULT_SHAPE_STYLE.fill,
      stroke: 'ink',
    });
  });

  it.each([
    ['rectangle', { kind: 'rectangle' }],
    ['ellipse', { kind: 'ellipse' }],
    ['triangle', { kind: 'polygon', sides: 3 }],
    ['polygon', { kind: 'polygon', sides: 5 }],
    ['star', { kind: 'star', sides: 5 }],
  ] as const)('maps %s to the shape drawn next', (kind, shape) => {
    const choices: ShapesChoices = { kind, fill: null, stroke: null };
    expect(shapesToolStyle(choices)).toEqual({ ...shape, fill: null, stroke: null });
  });

  it('applies selected fill and stroke colours to a new shape', () => {
    expect(shapesToolStyle({ kind: 'ellipse', fill: { token: 'surface' }, stroke: 'ink' })).toEqual(
      {
        kind: 'ellipse',
        fill: { token: 'surface' },
        stroke: { color: 'ink', width: 2 },
      },
    );
  });

  it('keeps valid fields and defaults invalid fields independently', () => {
    expect(
      SHAPES_CHOICES.parse({ kind: 'star', fill: { token: 'surface' }, stroke: 'ink' }),
    ).toEqual({
      kind: 'star',
      fill: { token: 'surface' },
      stroke: 'ink',
    });
    expect(SHAPES_CHOICES.parse({ kind: 'arrow', fill: null, stroke: [0.1, 0.2, 0.3, 1] })).toEqual(
      {
        kind: 'rectangle',
        fill: null,
        stroke: [0.1, 0.2, 0.3, 1],
      },
    );
    expect(SHAPES_CHOICES.parse({ kind: 'triangle', fill: 'ink', stroke: null })).toEqual({
      kind: 'triangle',
      fill: DEFAULT_SHAPE_STYLE.fill,
      stroke: null,
    });
    expect(
      SHAPES_CHOICES.parse({ kind: 'polygon', fill: [2, 0, 0, 1], stroke: { token: 'line' } }),
    ).toEqual({
      kind: 'polygon',
      fill: DEFAULT_SHAPE_STYLE.fill,
      stroke: { token: 'line' },
    });
    expect(
      SHAPES_CHOICES.parse({ kind: 'ellipse', fill: [0, 0, 0, 1], stroke: [2, 0, 0, 1] }),
    ).toEqual({
      kind: 'ellipse',
      fill: [0, 0, 0, 1],
      stroke: 'ink',
    });
    expect(SHAPES_CHOICES.parse([])).toEqual(SHAPES_CHOICES.defaults);
  });

  it('does not mutate choices or share colour arrays with choices or defaults', () => {
    const fill: [number, number, number, number] = [0.2, 0.3, 0.4, 1];
    const stroke: [number, number, number, number] = [0.5, 0.6, 0.7, 1];
    const choices: ShapesChoices = { kind: 'rectangle', fill, stroke };
    const result = shapesToolStyle(choices);
    expect(result).toEqual({ kind: 'rectangle', fill, stroke: { color: stroke, width: 2 } });
    expect(result.fill).not.toBe(fill);
    expect(result.stroke?.color).not.toBe(stroke);
    expect(choices).toEqual({ kind: 'rectangle', fill, stroke });

    const defaultResult = shapesToolStyle(SHAPES_CHOICES.defaults);
    expect(defaultResult.fill).toEqual(DEFAULT_SHAPE_STYLE.fill);
    expect(defaultResult.fill).not.toBe(DEFAULT_SHAPE_STYLE.fill);
  });
});

describe('Connector panel choices', () => {
  it('lists the offered ends, caps and widths', () => {
    expect(CONNECTOR_PANEL_ENDS).toEqual(['none', 'end', 'both']);
    expect(CONNECTOR_PANEL_CAPS).toEqual(['arrow', 'triangle', 'circle', 'diamond']);
    expect(CONNECTOR_PANEL_WIDTHS).toEqual([1, 2, 4]);
  });

  it('starts with an elbow connector with an arrow at its end', () => {
    expect(CONNECTOR_CHOICES.id).toBe('connector');
    expect(CONNECTOR_CHOICES.defaults).toEqual({
      route: 'elbow',
      ends: 'end',
      cap: 'arrow',
      width: 2,
      color: 'ink',
    });
  });

  it.each([
    ['none', 'none', 'none'],
    ['end', 'none', 'diamond'],
    ['both', 'diamond', 'diamond'],
  ] as const)('maps %s ends to the connector caps', (ends, startCap, endCap) => {
    const choices: ConnectorChoices = {
      route: 'curved',
      ends,
      cap: 'diamond',
      width: 4,
      color: { token: 'line' },
    };
    expect(connectorToolStyle(choices)).toEqual({
      route: 'curved',
      startCap,
      endCap,
      stroke: { color: { token: 'line' }, width: 4 },
    });
  });

  it.each(['arrow', 'triangle', 'circle', 'diamond'] as const)(
    'uses the selected %s cap at the end',
    (cap) => {
      expect(connectorToolStyle({ ...CONNECTOR_CHOICES.defaults, cap }).endCap).toBe(cap);
    },
  );

  it.each(['straight', 'elbow', 'curved'] as const)('keeps the selected %s route', (route) => {
    expect(connectorToolStyle({ ...CONNECTOR_CHOICES.defaults, route }).route).toBe(route);
  });

  it('leaves connector colour choices unchanged', () => {
    const color: [number, number, number, number] = [0.2, 0.3, 0.4, 1];
    const choices: ConnectorChoices = { ...CONNECTOR_CHOICES.defaults, color };
    expect(connectorToolStyle(choices)).toEqual({
      route: 'elbow',
      startCap: 'none',
      endCap: 'arrow',
      stroke: { color, width: 2 },
    });
    expect(choices).toEqual({ ...CONNECTOR_CHOICES.defaults, color });
  });

  it('defaults an invalid width alone and accepts ink or token colours', () => {
    expect(
      CONNECTOR_CHOICES.parse({
        route: 'straight',
        ends: 'both',
        cap: 'circle',
        width: 3,
        color: { token: 'line' },
      }),
    ).toEqual({
      route: 'straight',
      ends: 'both',
      cap: 'circle',
      width: 2,
      color: { token: 'line' },
    });
    expect(
      CONNECTOR_CHOICES.parse({
        route: 'other',
        ends: 'other',
        cap: 'other',
        width: 1,
        color: [2, 0, 0, 1],
      }),
    ).toEqual({ route: 'elbow', ends: 'end', cap: 'arrow', width: 1, color: 'ink' });
    expect(CONNECTOR_CHOICES.parse({ color: [0.2, 0.3, 0.4, 1] })).toEqual({
      ...CONNECTOR_CHOICES.defaults,
      color: [0.2, 0.3, 0.4, 1],
    });
  });
});

describe('Sticky panel choices', () => {
  it('lists all six palette colours in design order and both sizes', () => {
    expect(STICKY_PANEL_COLORS).toEqual(['Yellow', 'Pink', 'Green', 'Blue', 'Purple', 'Orange']);
    expect(
      STICKY_PANEL_COLORS.every((name) => NOTE_COLORS.some((entry) => entry.name === name)),
    ).toBe(true);
    expect(STICKY_PANEL_ASPECTS).toEqual(['square', 'wide']);
  });

  it('starts with a yellow square note', () => {
    expect(STICKY_CHOICES.id).toBe('sticky');
    expect(STICKY_CHOICES.defaults).toEqual({ color: 'Yellow', aspect: 'square' });
  });

  it.each(['Yellow', 'Pink', 'Green', 'Blue', 'Purple', 'Orange'] as const)(
    'maps %s to a fresh copy of its palette RGBA',
    (color) => {
      const paletteColor = NOTE_COLORS.find((entry) => entry.name === color)?.color;
      const choices: StickyChoices = { color, aspect: 'wide' };
      const result = stickyToolStyle(choices);
      expect(result).toEqual({ color: paletteColor });
      expect(result.color).not.toBe(paletteColor);
      expect(choices).toEqual({ color, aspect: 'wide' });
    },
  );

  it('defaults unknown colours and invalid aspects independently', () => {
    expect(STICKY_CHOICES.parse({ color: 'Unknown', aspect: 'wide' })).toEqual({
      color: 'Yellow',
      aspect: 'wide',
    });
    expect(STICKY_CHOICES.parse({ color: 'Purple', aspect: 'tall' })).toEqual({
      color: 'Purple',
      aspect: 'square',
    });
    expect(STICKY_CHOICES.parse(null)).toEqual(STICKY_CHOICES.defaults);
  });
});

describe('panel choice persistence', () => {
  it('round-trips each panel under its own per-person key', () => {
    const { items, storage } = memoryStorage();
    const shapes: ShapesChoices = { kind: 'triangle', fill: null, stroke: { token: 'line' } };
    const connector: ConnectorChoices = {
      route: 'straight',
      ends: 'none',
      cap: 'circle',
      width: 4,
      color: 'ink',
    };
    const sticky: StickyChoices = { color: 'Purple', aspect: 'wide' };
    saveToolPanelChoices(SHAPES_CHOICES, shapes, storage);
    saveToolPanelChoices(CONNECTOR_CHOICES, connector, storage);
    saveToolPanelChoices(STICKY_CHOICES, sticky, storage);
    expect([...items.keys()]).toEqual([
      'canvas.tool-panel.shapes',
      'canvas.tool-panel.connector',
      'canvas.tool-panel.sticky',
    ]);
    expect(loadToolPanelChoices(SHAPES_CHOICES, storage)).toEqual(shapes);
    expect(loadToolPanelChoices(CONNECTOR_CHOICES, storage)).toEqual(connector);
    expect(loadToolPanelChoices(STICKY_CHOICES, storage)).toEqual(sticky);
  });

  it('does not read another panel’s stored JSON', () => {
    const storage = memoryStorage({
      'canvas.tool-panel.shapes': JSON.stringify({ kind: 'star', fill: null, stroke: null }),
    }).storage;
    expect(loadToolPanelChoices(CONNECTOR_CHOICES, storage)).toEqual(CONNECTOR_CHOICES.defaults);
    expect(loadToolPanelChoices(STICKY_CHOICES, storage)).toEqual(STICKY_CHOICES.defaults);
  });
});
