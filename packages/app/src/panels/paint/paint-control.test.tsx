// @vitest-environment jsdom
// Gradient fills and Ink in the style panel, with the shell's own sections:
// each committed edit is one action (one setStyle, one undo step). In Chrome:
// tooling/scenario/specs/app/gradient.acceptance.spec.ts and ink.acceptance.spec.ts.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StylePatch } from '@canvas/document';
import type { BoardObject, LinearGradient, Rgba } from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import type { BoardViewSnapshot } from '../../hooks/use-board-view-state.js';
import type { ShellAction } from '../../state/shell-action.js';
import { memoryShape } from '../__fixtures__/memory-board.js';
import { createDefaultStylePanelRegistry } from '../default-style-sections.js';
import type { SelectionContext } from '../panel-sections.js';
import { StylePanel } from '../style-panel.js';

const REGISTRY = createDefaultStylePanelRegistry();
const RED: Rgba = [230 / 255, 57 / 255, 70 / 255, 1];
const WHITE: Rgba = [1, 1, 1, 1];
const GRADIENT: LinearGradient = {
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: RED },
    { offset: 1, color: WHITE },
  ],
};

afterEach(cleanup);

function shape(id: string, fields: Record<string, unknown> = {}): BoardObject {
  return { ...memoryShape(id, 'a0'), ...fields };
}

interface PanelOptions {
  readonly context: SelectionContext;
  readonly selection?: readonly BoardObject[];
  readonly activeTool?: ToolId;
  readonly toolStyles?: Partial<Record<ToolId, StylePatch>>;
}

function renderPanel(options: PanelOptions) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const selection = options.selection ?? [];
  const board = {
    documentVersion: 0,
    selectedIds: selection.map((object) => object.id),
    board: { get: () => undefined },
  } as unknown as BoardViewSnapshot;
  const view = render(
    <StylePanel
      registry={REGISTRY}
      context={options.context}
      board={board}
      selection={selection}
      activeTool={options.activeTool ?? 'select'}
      toolStyles={options.toolStyles ?? {}}
      dispatch={dispatch}
    />,
  );
  return { dispatch, view };
}

/**
 * Commits a value the way the browser does: the input's value, then its `change` event.
 *
 * @param input - The input.
 * @param value - The value.
 */
function commit(input: HTMLElement, value: string): void {
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

/**
 * The patches of the last style action (or the last action, when it was not a style).
 *
 * @param dispatch - The panel's dispatch.
 * @returns The patches.
 */
function lastFill(dispatch: ReturnType<typeof renderPanel>['dispatch']): unknown {
  const action = dispatch.mock.lastCall?.[0];
  return action?.type === 'style' ? action.changes.map((change) => change.style) : action;
}

describe('the fill type control', () => {
  it('shows Solid pressed for a colour and builds a linear or radial gradient in one action', () => {
    const { dispatch } = renderPanel({ context: 'shape', selection: [shape('a', { fill: RED })] });
    expect(button('Solid').getAttribute('aria-pressed')).toBe('true');
    expect(fireEvent.mouseDown(button('Linear'))).toBe(false);
    fireEvent.click(button('Linear'));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [{ id: 'a', style: { fill: GRADIENT } }],
    });
    fireEvent.click(button('Radial'));
    expect(lastFill(dispatch)).toEqual([
      {
        fill: { type: 'radial', center: { x: 0.5, y: 0.5 }, radius: 0.5, stops: GRADIENT.stops },
      },
    ]);
  });

  it('turns a gradient solid in its first stop colour, and leaves a press of its own kind', () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: GRADIENT })],
    });
    expect(button('Linear').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Fill')).toBeNull();
    fireEvent.click(button('Linear'));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(button('Solid'));
    expect(lastFill(dispatch)).toEqual([{ fill: RED }]);
  });

  it('starts a gradient for no fill from opaque black', () => {
    const { dispatch } = renderPanel({ context: 'shape', selection: [shape('a', { fill: null })] });
    fireEvent.click(button('Linear'));
    expect(lastFill(dispatch)).toEqual([
      {
        fill: {
          ...GRADIENT,
          stops: [
            { offset: 0, color: [0, 0, 0, 1] },
            { offset: 1, color: WHITE },
          ],
        },
      },
    ]);
  });

  it('shows a mixed selection with no type pressed, and switches each object from its own', () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: RED }), shape('b', { fill: GRADIENT })],
    });
    for (const name of ['Solid', 'Linear', 'Radial']) {
      expect(button(name).getAttribute('aria-pressed')).toBe('false');
    }
    expect(screen.getByLabelText('Fill (mixed)')).toBeInstanceOf(HTMLInputElement);
    fireEvent.click(button('Linear'));
    // The gradient already linear is left alone; one action for the change there is.
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [{ id: 'a', style: { fill: GRADIENT } }],
    });
  });

  it('says Mixed for gradients of one type that differ, without a stop editor', () => {
    renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: GRADIENT }), shape('b', { fill: { ...GRADIENT, angle: 1 } })],
    });
    expect(button('Linear').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Mixed')).toBeInstanceOf(HTMLElement);
    expect(screen.queryByLabelText('Angle')).toBeNull();
  });

  it("switches the shape tool's fill with nothing selected", () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      activeTool: 'shape',
      toolStyles: { shape: { fill: RED } },
    });
    fireEvent.click(button('Linear'));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'setToolStyle',
      tool: 'shape',
      style: { fill: GRADIENT },
    });
  });
});

describe('the gradient editor', () => {
  it('lists the stops; Add and Remove are refused at eight and two stops', () => {
    const { view } = renderPanel({ context: 'shape', selection: [shape('a', { fill: GRADIENT })] });
    expect(screen.getAllByLabelText('Stop offset')).toHaveLength(2);
    expect(screen.getAllByLabelText('Stop colour')).toHaveLength(2);
    expect(button('Remove stop')).toHaveProperty('disabled', true);
    expect(button('Add stop')).toHaveProperty('disabled', false);
    cleanup();
    const eight = {
      ...GRADIENT,
      stops: [0, 1, 2, 3, 4, 5, 6, 7].map((step) => ({ offset: step / 7, color: RED })),
    };
    renderPanel({ context: 'shape', selection: [shape('a', { fill: eight })] });
    expect(button('Add stop')).toHaveProperty('disabled', true);
    expect(button('Remove stop')).toHaveProperty('disabled', false);
    expect(view.container).toBeInstanceOf(HTMLElement);
  });

  it('adds a stop after the selected one, and removes the selected one, one action each', () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: GRADIENT })],
    });
    // A press on a stop marker or a stop button keeps the focus where it is.
    expect(fireEvent.mouseDown(button('Stop 1'))).toBe(false);
    expect(fireEvent.mouseDown(button('Add stop'))).toBe(false);
    fireEvent.click(button('Add stop'));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [added] = lastFill(dispatch) as [{ fill: LinearGradient }];
    expect(added.fill.stops.map((stop) => stop.offset)).toEqual([0, 0.5, 1]);
    cleanup();
    const three = { ...GRADIENT, stops: added.fill.stops };
    const second = renderPanel({ context: 'shape', selection: [shape('a', { fill: three })] });
    fireEvent.click(button('Stop 2'));
    expect(button('Stop 2').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button('Remove stop'));
    expect(lastFill(second.dispatch)).toEqual([{ fill: GRADIENT }]);
  });

  it('moves a stop by its offset and recolours it, one action per committed edit', () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: GRADIENT })],
    });
    const [firstOffset] = screen.getAllByLabelText('Stop offset');
    if (firstOffset === undefined) throw new Error('no stop offset');
    commit(firstOffset, '0.25');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(lastFill(dispatch)).toEqual([
      {
        fill: {
          ...GRADIENT,
          stops: [
            { offset: 0.25, color: RED },
            { offset: 1, color: WHITE },
          ],
        },
      },
    ]);
    commit(firstOffset, '1.5');
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [, lastColour] = screen.getAllByLabelText('Stop colour');
    if (lastColour === undefined) throw new Error('no stop colour');
    commit(lastColour, '#00ff00');
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(lastFill(dispatch)).toEqual([
      {
        fill: {
          ...GRADIENT,
          stops: [
            { offset: 0, color: RED },
            { offset: 1, color: [0, 1, 0, 1] },
          ],
        },
      },
    ]);
  });

  it('takes a linear angle in degrees, normalised into (−π, π]', () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: GRADIENT })],
    });
    commit(screen.getByLabelText('Angle'), '90');
    expect(lastFill(dispatch)).toEqual([{ fill: { ...GRADIENT, angle: Math.PI / 2 } }]);
    commit(screen.getByLabelText('Angle'), '-180');
    expect(lastFill(dispatch)).toEqual([{ fill: { ...GRADIENT, angle: Math.PI } }]);
    commit(screen.getByLabelText('Angle'), '400');
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('shows a radial centre and radius as percentages, stores fractions, refuses out of range', () => {
    const radial = {
      type: 'radial',
      center: { x: 0.5, y: 0.5 },
      radius: 0.5,
      stops: GRADIENT.stops,
    };
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: radial })],
    });
    expect(screen.getByLabelText('Centre X')).toHaveProperty('value', '50');
    commit(screen.getByLabelText('Centre X'), '25');
    expect(lastFill(dispatch)).toEqual([{ fill: { ...radial, center: { x: 0.25, y: 0.5 } } }]);
    commit(screen.getByLabelText('Centre Y'), '75');
    expect(lastFill(dispatch)).toEqual([{ fill: { ...radial, center: { x: 0.5, y: 0.75 } } }]);
    commit(screen.getByLabelText('Radius'), '200');
    expect(lastFill(dispatch)).toEqual([{ fill: { ...radial, radius: 2 } }]);
    for (const [label, value] of [
      ['Radius', '0'],
      ['Radius', '250'],
      ['Centre X', '120'],
    ] as const) {
      commit(screen.getByLabelText(label), value);
    }
    expect(dispatch).toHaveBeenCalledTimes(3);
  });
});

describe('the frame background', () => {
  const frame = (id: string, background: unknown) => shape(id, { type: 'frame', background });

  it('shows for frames alone and sets their background, one change per frame', () => {
    const { dispatch } = renderPanel({
      context: 'frame',
      selection: [frame('f', RED), frame('g', null)],
    });
    expect(screen.getByLabelText('Background (mixed)')).toBeInstanceOf(HTMLInputElement);
    fireEvent.click(button('Radial'));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.lastCall?.[0];
    expect(action?.type === 'style' && action.changes.map((change) => change.id)).toEqual([
      'f',
      'g',
    ]);
  });

  it('does not show for a selection mixing frames with other objects', () => {
    renderPanel({ context: 'mixed', selection: [frame('f', RED), shape('a')] });
    expect(screen.queryByRole('group', { name: 'Kind of background' })).toBeNull();
  });
});

describe('the Ink swatch', () => {
  it('shows first for a stroke, pressed for ink, and sets ink in one action', () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { stroke: { color: [0, 0, 0, 1], width: 2 } })],
    });
    expect(button('Ink').getAttribute('aria-pressed')).toBe('false');
    expect(fireEvent.mouseDown(button('Ink'))).toBe(false);
    fireEvent.click(button('Ink'));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [{ id: 'a', style: { stroke: { color: 'ink', width: 2 } } }],
    });
  });

  it('shows an ink stroke as ink and writes a picked colour as an opaque tuple', () => {
    const { dispatch, view } = renderPanel({
      context: 'shape',
      selection: [shape('a', { stroke: { color: 'ink', width: 2 } })],
    });
    expect(button('Ink').getAttribute('aria-pressed')).toBe('true');
    expect(view.container.querySelector('[data-state="ink"]')).not.toBeNull();
    const picker = screen.getByLabelText<HTMLInputElement>('Stroke');
    expect(picker.value).toBe('#1e1f1c');
    commit(picker, '#000000');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'style',
      changes: [{ id: 'a', style: { stroke: { color: [0, 0, 0, 1], width: 2 } } }],
    });
    fireEvent.click(button('Ink'));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('shows ink beside a tuple as mixed, and is not offered for fills', () => {
    renderPanel({
      context: 'shape',
      selection: [
        shape('a', { stroke: { color: 'ink', width: 2 } }),
        shape('b', { stroke: { color: [0, 0, 0, 1], width: 2 } }),
      ],
    });
    expect(screen.getByLabelText('Stroke (mixed)')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getAllByRole('button', { name: 'Ink' })).toHaveLength(1);
  });

  it('sets ink on lines and the line tool’s style', () => {
    const line = shape('l', {
      type: 'line',
      stroke: { color: [1, 0, 0, 1], width: 3 },
      startCap: 'none',
      endCap: 'arrow',
      route: 'straight',
    });
    const { dispatch } = renderPanel({ context: 'line', selection: [line] });
    fireEvent.click(button('Ink'));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'style',
      changes: [{ id: 'l', style: { stroke: { color: 'ink', width: 3 } } }],
    });
    cleanup();
    const tool = renderPanel({
      context: 'line',
      activeTool: 'line',
      toolStyles: { line: { stroke: { color: 'ink', width: 2 } } },
    });
    expect(button('Ink').getAttribute('aria-pressed')).toBe('true');
    commit(screen.getByLabelText('Stroke'), '#ff0000');
    expect(tool.dispatch).toHaveBeenLastCalledWith({
      type: 'setToolStyle',
      tool: 'line',
      style: { stroke: { color: [1, 0, 0, 1], width: 2 } },
      isInkPick: false,
    });
  });
});
