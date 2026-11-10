// @vitest-environment jsdom
// The Draw panel in the floating dock: its sub-tools, colours and sizes as named,
// pressed buttons; a choice becomes the draw tool's style and is kept; the eraser fades the
// colours and sizes and leaves them inert.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFloatingShortcutRegistry } from '../../keymap/floating-keymap.js';
import { whiteboardChromeContext } from '../../shell/whiteboard-chrome.js';
import { DRAW_CHOICES, DRAW_PANEL_COLOUR_VALUES } from '../../state/panel-choices/draw-choices.js';
import type { ShellAction } from '../../state/shell-action.js';
import { INITIAL_SHELL_STATE } from '../../state/shell-reducer.js';
import type { RecordedToolPanelKey } from '../../state/tool-panel-key.js';
import { FloatingDock } from '../floating-dock.js';

import { toolPanel } from './draw-panel.js';
import { isToolPanelContribution, TOOL_PANELS, toolPanelsOf } from './tool-panel-contribution.js';

const REGISTRY = createFloatingShortcutRegistry('mac');
const PANELS = toolPanelsOf([toolPanel]);

let stored: Map<string, string>;

/** One path of a Library icon: its `d`, in its own coordinates, and its origin in the icon. */
interface LibraryPath {
  readonly d: string;
  readonly origin: readonly [number, number];
}

/**
 * The design Library's four Draw panel icons (as `export_vector` gives
 * them): 20 × 20, every path stroked 1.5 with round caps and joins.
 */
const LIBRARY_ICONS: Readonly<Record<string, readonly LibraryPath[]>> = {
  // icon/pencil uQubG6VFZfEOzPV86d8tO
  Pencil: [
    {
      d: 'M15.98 4.01 C16.42 3.57 16.67 2.97 16.67 2.35 C16.67 1.73 16.42 1.13 15.98 0.69 C15.54 0.25 14.94 0 14.32 0 C13.69 0 13.1 0.25 12.66 0.69 L1.53 11.81 C1.34 12 1.2 12.24 1.12 12.5 L0.02 16.13 C0 16.2 -0.01 16.28 0.01 16.35 C0.03 16.42 0.07 16.49 0.12 16.54 C0.18 16.6 0.24 16.64 0.32 16.65 C0.39 16.67 0.46 16.67 0.54 16.65 L4.16 15.55 C4.43 15.47 4.66 15.33 4.86 15.13 L15.98 4.01',
      origin: [1.67, 1.67],
    },
  ],
  // icon/brush AmFLYMw7Grzn9NlGFoHAK (the marker)
  Marker: [
    {
      d: 'M0 7.44 L6.72 0.72 C6.94 0.5 7.21 0.32 7.5 0.19 C7.79 0.07 8.1 0 8.41 0 C8.73 0 9.04 0.06 9.33 0.18 C9.62 0.3 9.89 0.47 10.11 0.7 C10.33 0.92 10.51 1.18 10.63 1.47 C10.75 1.77 10.81 2.08 10.81 2.39 C10.8 2.71 10.74 3.02 10.61 3.31 C10.49 3.6 10.31 3.86 10.08 4.08 L3.37 10.81',
      origin: [7.55, 2.48],
    },
    {
      d: 'M4.22 0 C2.84 0 1.72 1.12 1.72 2.52 C1.72 3.62 -0.36 3.78 0.06 4.2 C0.96 5.12 2.13 5.88 3.39 5.88 C5.22 5.88 6.72 4.38 6.72 2.52 C6.72 2.19 6.66 1.86 6.53 1.56 C6.41 1.25 6.23 0.97 5.99 0.74 C5.76 0.51 5.48 0.32 5.18 0.19 C4.88 0.07 4.55 0 4.22 0',
      origin: [1.67, 12.45],
    },
  ],
  // icon/highlighter -wBzJG2qCi3UKNbmA2BmD
  Highlighter: [
    { d: 'M7 0 L12 5 L5 12 L0 12 L0 7 Z', origin: [5, 3] },
    { d: 'M0 0 L6 0', origin: [4, 17.5] },
  ],
  // icon/eraser yRX3QN75UOOXZGgrU_ZSz
  Eraser: [
    {
      d: 'M4.21 15.04 L0.63 11.46 C-0.21 10.63 -0.21 9.38 0.63 8.63 L8.63 0.62 C9.46 -0.21 10.71 -0.21 11.46 0.62 L16.12 5.29 C16.96 6.13 16.96 7.38 16.12 8.12 L9.21 15.04',
      origin: [1.62, 2.46],
    },
    { d: 'M12.5 0 L0 0', origin: [5.83, 17.5] },
    { d: 'M0 0 L7.5 7.5', origin: [4.17, 9.17] },
  ],
};

/** A path as its commands and absolute points, in the units it is drawn in. */
interface Drawing {
  readonly commands: string;
  readonly points: readonly (readonly [number, number])[];
}

/**
 * Reads a path, resolving relative commands, `H` and `V` into absolute points.
 *
 * @param d - Path data of `M`, `L`, `H`, `V`, `C` and `Z` commands.
 * @param origin - Added to every point.
 * @param scale - Multiplies every point after the origin is added.
 * @returns Its commands (as absolute, `H`/`V` as `L`) and its points.
 * @throws {Error} On any other command.
 */
function drawingOf(d: string, origin: readonly [number, number], scale: number): Drawing {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)/g) ?? [];
  let commands = '';
  const points: [number, number][] = [];
  let [x, y] = [0, 0];
  let [startX, startY] = [0, 0];
  let command = '';
  let index = 0;
  const next = () => Number(tokens[index++]);
  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    if (/^[a-zA-Z]$/.test(token)) {
      command = token;
      index += 1;
    } else if (command === 'M') command = 'L';
    else if (command === 'm') command = 'l';
    const isRelative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    const push = (px: number, py: number) => {
      points.push([(px + origin[0]) * scale, (py + origin[1]) * scale]);
    };
    if (upper === 'Z') {
      commands += 'Z';
      [x, y] = [startX, startY];
      continue;
    }
    if (upper === 'M' || upper === 'L') {
      x = next() + (isRelative ? x : 0);
      y = next() + (isRelative ? y : 0);
      if (upper === 'M') [startX, startY] = [x, y];
      commands += upper;
      push(x, y);
    } else if (upper === 'H' || upper === 'V') {
      if (upper === 'H') x = next() + (isRelative ? x : 0);
      else y = next() + (isRelative ? y : 0);
      commands += 'L';
      push(x, y);
    } else if (upper === 'C') {
      const [baseX, baseY] = isRelative ? [x, y] : [0, 0];
      const values = [next(), next(), next(), next(), next(), next()];
      for (let pair = 0; pair < 6; pair += 2) {
        push((values[pair] ?? 0) + baseX, (values[pair + 1] ?? 0) + baseY);
      }
      [x, y] = [(values[4] ?? 0) + baseX, (values[5] ?? 0) + baseY];
      commands += 'C';
    } else {
      throw new Error(`Unsupported path command: ${command}`);
    }
  }
  return { commands, points };
}

/**
 * Renders the floating dock under the floating chrome with the draw tool active, so its panel
 * shows with the chrome's icons.
 *
 * @returns The dispatch, the panel and its groups.
 */
function renderDrawPanel() {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const dock = (lastToolPanelKey?: RecordedToolPanelKey) => (
    <whiteboardChromeContext.Provider value="floating">
      <FloatingDock
        registry={REGISTRY}
        state={{ ...INITIAL_SHELL_STATE, activeTool: 'draw', canEdit: true, lastToolPanelKey }}
        dispatch={dispatch}
        panels={PANELS}
      />
    </whiteboardChromeContext.Provider>
  );
  const { rerender } = render(dock());
  const panel = screen.getByRole('toolbar', { name: 'Draw options' });
  const group = (name: string) => within(panel).getByRole('group', { name });
  return {
    dispatch,
    /**
     * Renders the dock again with the shell having recorded a Draw panel key.
     *
     * @param key - The key.
     * @param sequence - Its sequence number.
     */
    press: (key: RecordedToolPanelKey['key'], sequence: number) => {
      rerender(dock({ tool: 'draw', key, sequence }));
    },
    panel,
    tools: group('Draw tool'),
    colours: group('Colour'),
    sizes: group('Size'),
  };
}

/**
 * The names of a group's buttons, and which are pressed.
 *
 * @param group - The group.
 * @returns Each button's name and `aria-pressed`.
 */
function buttonsOf(group: HTMLElement): (readonly [string | null, string | null])[] {
  return within(group)
    .getAllByRole('button')
    .map((button) => [button.getAttribute('aria-label'), button.getAttribute('aria-pressed')]);
}

/**
 * The last draw tool style the panel set.
 *
 * @param dispatch - The dock's dispatch.
 * @returns The style.
 */
function lastDrawStyle(dispatch: ReturnType<typeof renderDrawPanel>['dispatch']): unknown {
  const styles = dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action.type === 'setToolStyle' && action.tool === 'draw');
  const last = styles.at(-1);
  return last?.type === 'setToolStyle' ? last.style : undefined;
}

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Draw panel', () => {
  it('is registered for the Draw tool', () => {
    expect(isToolPanelContribution(toolPanel)).toBe(true);
    expect(TOOL_PANELS.get('draw')).toBe(toolPanel);
    expect(toolPanel.codec).toBe(DRAW_CHOICES);
  });

  it('shows the sub-tools, colours and sizes as named buttons, the defaults pressed', () => {
    const { panel, tools, colours, sizes } = renderDrawPanel();
    expect(buttonsOf(tools)).toEqual([
      ['Pencil', 'true'],
      ['Marker', 'false'],
      ['Highlighter', 'false'],
      ['Eraser', 'false'],
    ]);
    expect(buttonsOf(colours)).toEqual([
      ['Ink', 'true'],
      ['Red pencil', 'false'],
      ['Slate blue', 'false'],
      ['Green', 'false'],
      ['Amber', 'false'],
    ]);
    expect(buttonsOf(sizes)).toEqual([
      ['Fine', 'false'],
      ['Medium', 'true'],
      ['Bold', 'false'],
    ]);
    // Every button is one of the panel's roving items.
    for (const button of within(panel).getAllByRole('button')) {
      expect(button.hasAttribute('data-dock-item')).toBe(true);
    }
  });

  it('gives the draw tool the pencil on load, then each choice as it is made, and keeps it', () => {
    const { dispatch, tools, colours, sizes } = renderDrawPanel();
    expect(lastDrawStyle(dispatch)).toEqual({
      tool: 'pencil',
      stroke: { color: 'ink', width: 2 },
      opacity: undefined,
      isEraser: false,
    });
    fireEvent.click(within(tools).getByRole('button', { name: 'Marker' }));
    fireEvent.click(within(colours).getByRole('button', { name: 'Red pencil' }));
    fireEvent.click(within(sizes).getByRole('button', { name: 'Bold' }));
    expect(lastDrawStyle(dispatch)).toEqual({
      tool: 'marker',
      stroke: { color: DRAW_PANEL_COLOUR_VALUES.red, width: 10 },
      opacity: undefined,
      isEraser: false,
    });
    expect(within(tools).getByRole('button', { name: 'Marker' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(JSON.parse(stored.get('canvas.tool-panel.draw') ?? 'null')).toMatchObject({
      subTool: 'marker',
      looks: { marker: { colour: 'red', size: 2 } },
    });
    // The highlighter keeps its own amber and middle size.
    fireEvent.click(within(tools).getByRole('button', { name: 'Highlighter' }));
    expect(buttonsOf(colours).find(([, pressed]) => pressed === 'true')?.[0]).toBe('Amber');
    expect(buttonsOf(sizes).find(([, pressed]) => pressed === 'true')?.[0]).toBe('Medium');
    expect(lastDrawStyle(dispatch)).toMatchObject({ tool: 'highlighter', opacity: 0.4 });
  });

  it('fades the colours and sizes while erasing, and they do nothing', () => {
    const { dispatch, tools, colours, sizes } = renderDrawPanel();
    fireEvent.click(within(tools).getByRole('button', { name: 'Eraser' }));
    expect(lastDrawStyle(dispatch)).toMatchObject({ tool: 'pencil', isEraser: true });
    const inert = [
      ...within(colours).getAllByRole('button'),
      ...within(sizes).getAllByRole('button'),
    ];
    for (const button of inert) expect(button.getAttribute('aria-disabled')).toBe('true');
    const before = dispatch.mock.calls.length;
    fireEvent.click(within(colours).getByRole('button', { name: 'Green' }));
    fireEvent.click(within(sizes).getByRole('button', { name: 'Fine' }));
    expect(dispatch.mock.calls.length).toBe(before);
    // Drawing again brings them back.
    fireEvent.click(within(tools).getByRole('button', { name: 'Pencil' }));
    expect(
      within(colours).getByRole('button', { name: 'Green' }).getAttribute('aria-disabled'),
    ).toBe('false');
  });

  it('reads back what was kept on the next visit', () => {
    stored.set(
      'canvas.tool-panel.draw',
      JSON.stringify({
        subTool: 'highlighter',
        looks: { highlighter: { colour: 'green', size: 0 } },
      }),
    );
    const { dispatch, tools } = renderDrawPanel();
    expect(
      within(tools).getByRole('button', { name: 'Highlighter' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(lastDrawStyle(dispatch)).toEqual({
      tool: 'highlighter',
      stroke: { color: DRAW_PANEL_COLOUR_VALUES.green, width: 10 },
      opacity: 0.4,
      isEraser: false,
    });
  });

  it('changes the choices with each key the shell records, as the buttons do', () => {
    const { dispatch, press, tools, colours } = renderDrawPanel();
    const pressed = () => buttonsOf(tools).find(([, isPressed]) => isPressed === 'true')?.[0];
    press('cycle', 1);
    expect(pressed()).toBe('Marker');
    expect(lastDrawStyle(dispatch)).toMatchObject({ tool: 'marker', isEraser: false });
    // The same record again is not a new key.
    press('cycle', 1);
    expect(pressed()).toBe('Marker');
    press('eraser', 2);
    expect(pressed()).toBe('Eraser');
    expect(lastDrawStyle(dispatch)).toMatchObject({ tool: 'marker', isEraser: true });
    expect(within(colours).getByRole('button', { name: 'Ink' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    press('cycle', 3);
    expect(pressed()).toBe('Marker');
    press('cycle', 4);
    expect(pressed()).toBe('Highlighter');
    expect(lastDrawStyle(dispatch)).toMatchObject({ tool: 'highlighter', opacity: 0.4 });
    expect(JSON.parse(stored.get('canvas.tool-panel.draw') ?? 'null')).toMatchObject({
      subTool: 'highlighter',
    });
  });

  it("shows P as the Draw button's key", () => {
    renderDrawPanel();
    const draw = screen.getByRole('button', { name: /^Draw/ });
    expect(draw.getAttribute('aria-keyshortcuts')).toBe('P');
  });

  it("draws each sub-tool's glyph as the design Library's vectors, at 1.5 px", () => {
    const { tools } = renderDrawPanel();
    for (const [label, paths] of Object.entries(LIBRARY_ICONS)) {
      const svg = within(tools).getByRole('button', { name: label }).querySelector('svg');
      // 20 px drawn from a 16-unit box: a Library unit (of 20) is 0.8 of the box's.
      expect(svg?.getAttribute('width'), label).toBe('20');
      expect(svg?.getAttribute('viewBox'), label).toBe('0 0 16 16');
      const path = svg?.querySelector('path');
      expect(path?.getAttribute('stroke-width'), label).toBe('1.5');
      expect(path?.getAttribute('vector-effect'), label).toBe('non-scaling-stroke');
      const drawn = drawingOf(path?.getAttribute('d') ?? '', [0, 0], 1);
      const library = paths.map(({ d, origin }) => drawingOf(d, origin, 0.8));
      expect(drawn.commands, label).toBe(library.map(({ commands }) => commands).join(''));
      const expected = library.flatMap(({ points }) => points);
      expect(drawn.points, label).toHaveLength(expected.length);
      drawn.points.forEach(([px, py], point) => {
        const [ex = Number.NaN, ey = Number.NaN] = expected[point] ?? [];
        expect(Math.abs(px - ex), `${label} point ${String(point)} x`).toBeLessThanOrEqual(0.0051);
        expect(Math.abs(py - ey), `${label} point ${String(point)} y`).toBeLessThanOrEqual(0.0051);
      });
    }
  });

  it('sets Ink as an Ink pick, so strokes keep `ink`, and a fixed colour as none', () => {
    const { dispatch, colours } = renderDrawPanel();
    const lastPick = () =>
      dispatch.mock.calls
        .map(([action]) => (action.type === 'setToolStyle' ? action : undefined))
        .filter((action) => action !== undefined)
        .at(-1)?.isInkPick;
    expect(lastPick()).toBe(true);
    fireEvent.click(within(colours).getByRole('button', { name: 'Slate blue' }));
    expect(lastPick()).toBe(false);
  });
});
