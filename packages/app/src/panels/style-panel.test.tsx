// @vitest-environment jsdom
// The contextual style panel with the shell's own sections (fill and stroke, arrange). In
/* eslint-disable max-lines -- Acceptance extends the established panel render fixture. */
// Chrome: tooling/scenario/specs/app/style-panel.spec.ts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StylePatch } from '@canvas/document';
import type { BoardObject, Rgba } from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import type { BoardViewSnapshot } from '../hooks/use-board-view-state.js';
import type { ShellAction } from '../state/shell-action.js';

import { memoryShape } from './__fixtures__/memory-board.js';
import { createDefaultStylePanelRegistry } from './default-style-sections.js';
import {
  createStylePanelRegistry,
  registerStylePanelSection,
  type SelectionContext,
} from './panel-sections.js';
import { StylePanel } from './style-panel.js';

const REGISTRY = createDefaultStylePanelRegistry();
const EMPTY_READER = { get: () => undefined } as unknown as BoardViewSnapshot['board'];
const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];

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
  render(
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
  return { dispatch, panel: screen.getByRole('complementary', { name: 'Style' }) };
}

function commit(input: HTMLElement, value: string): void {
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const sectionTitles = () => screen.queryAllByRole('region').map((r) => r.dataset.section);
const SHAPE_SECTIONS = 'shape,layer,fill-stroke,text-style,effects,layout,arrange';

describe('StylePanel', () => {
  it('marks the scroll container tabindex=-1 and gives no non-control an explicit Tab stop', () => {
    const { panel } = renderPanel({ context: 'shape', selection: [shape('a')] });

    expect(panel.tagName).toBe('ASIDE');
    expect(panel.tabIndex).toBe(-1);
    expect(panel.getAttribute('tabindex')).toBe('-1');

    const interactiveRoles = new Set([
      'button',
      'checkbox',
      'combobox',
      'link',
      'menuitem',
      'option',
      'radio',
      'slider',
      'spinbutton',
      'switch',
      'tab',
      'textbox',
    ]);
    const nonControlTabStops = Array.from(
      panel.querySelectorAll<HTMLElement>('[tabindex]:not([tabindex="-1"])'),
    ).filter(
      (element) =>
        !element.matches('button, input, select, textarea') &&
        !interactiveRoles.has(element.getAttribute('role') ?? ''),
    );
    expect(nonControlTabStops).toEqual([]);
  });

  it('asks for a selection when nothing is selected under the select tool', () => {
    renderPanel({ context: 'none' });
    expect(screen.getByText('Select an object to change its style.')).toBeInstanceOf(HTMLElement);
    expect(sectionTitles()).toEqual(['board-colours']);
  });

  it('offers the connector delete preference with nothing selected, and toggles it', () => {
    const { dispatch } = renderPanel({ context: 'none' });
    const preference = screen.getByRole('switch', {
      name: 'Delete connectors with their objects',
    });
    expect((preference as HTMLInputElement).checked).toBe(false);
    fireEvent.click(preference);
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleDeleteConnectors' });
    cleanup();
    renderPanel({ context: 'shape', selection: [shape('a')] });
    expect(screen.queryByRole('switch', { name: /connectors/ })).toBeNull();
  });

  it('shows the fill and stroke and the arrange row for shapes, as titled regions', () => {
    const { panel } = renderPanel({ context: 'shape', selection: [shape('a', { fill: RED })] });
    expect(panel.getAttribute('data-context')).toBe('shape');
    expect(sectionTitles().join()).toBe(SHAPE_SECTIONS);
    expect(screen.getByRole('region', { name: 'Fill and stroke' })).toBeInstanceOf(HTMLElement);
    expect(screen.getByLabelText<HTMLInputElement>('Fill').value).toBe('#ff0000');
    expect(screen.getByLabelText('Stroke (none)')).toBeInstanceOf(HTMLInputElement);
    expect(screen.queryByLabelText('Width')).toBeNull();
  });

  it('shows the kinds note, the Layer section and the arrange row for a mixed selection', () => {
    renderPanel({ context: 'mixed', selection: [shape('a'), shape('f', { type: 'frame' })] });
    expect(sectionTitles()).toEqual(['mixed-kinds', 'layer', 'arrange']);
    expect(screen.getByText('Select one kind of object to change its style.')).toBeInstanceOf(
      HTMLElement,
    );
  });

  it('sets a fill on every selected shape as one style action', () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a', { fill: RED }), shape('b', { fill: BLUE })],
    });
    const fill = screen.getByLabelText('Fill (mixed)');
    commit(fill, '#00ff00');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: 'a', style: { fill: [0, 1, 0, 1] } },
        { id: 'b', style: { fill: [0, 1, 0, 1] } },
      ],
    });
  });

  it("sets a stroke colour keeping each shape's width, and a width only where there is a stroke", () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [
        shape('a', { stroke: { color: RED, width: 2 } }),
        shape('b', { stroke: { color: BLUE, width: 4 } }),
        shape('c'),
      ],
    });
    commit(screen.getByLabelText('Stroke (mixed)'), '#00ff00');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'style',
      changes: [
        { id: 'a', style: { stroke: { color: [0, 1, 0, 1], width: 2 } } },
        { id: 'b', style: { stroke: { color: [0, 1, 0, 1], width: 4 } } },
        { id: 'c', style: { stroke: { color: [0, 1, 0, 1], width: 1 } } },
      ],
    });
    commit(screen.getByLabelText('Width (mixed)'), '3');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'style',
      changes: [
        { id: 'a', style: { stroke: { color: RED, width: 3 } } },
        { id: 'b', style: { stroke: { color: BLUE, width: 3 } } },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'No stroke' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'style',
      changes: ['a', 'b', 'c'].map((id) => ({ id, style: { stroke: null } })),
    });
  });

  it("keeps each object's own alpha when a colour is chosen for a mixed selection", () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [
        shape('a', { fill: [1, 0, 0, 0.5] }),
        shape('b', { fill: [0, 0, 1, 0.25] }),
        shape('c', { fill: null }),
      ],
    });
    commit(screen.getByLabelText('Fill (mixed)'), '#00ff00');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'style',
      changes: [
        { id: 'a', style: { fill: [0, 1, 0, 0.5] } },
        { id: 'b', style: { fill: [0, 1, 0, 0.25] } },
        { id: 'c', style: { fill: [0, 1, 0, 1] } },
      ],
    });
  });

  it("sends no empty patch to a creation tool's style", () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    const probe = registerStylePanelSection(createStylePanelRegistry(), {
      id: 'probe',
      title: 'Probe',
      context: 'shape',
      order: 1,
      render: ({ applyStyle }) => (
        <button
          type="button"
          onClick={() => {
            applyStyle(() => ({}));
          }}
        >
          Nothing
        </button>
      ),
    });
    render(
      <StylePanel
        registry={probe}
        context="shape"
        board={{ documentVersion: 0, selectedIds: [], enteredGroupId: null, board: EMPTY_READER }}
        selection={[]}
        activeTool="shape"
        toolStyles={{}}
        dispatch={dispatch}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nothing' }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches nothing when no selected object takes the field', () => {
    const { dispatch } = renderPanel({
      context: 'vector',
      selection: [shape('g', { type: 'group' })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'No fill' }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("edits a creation tool's style when nothing is selected, without the arrange row", () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      activeTool: 'shape',
      toolStyles: { shape: { fill: RED, stroke: { color: BLUE, width: 2 } } },
    });
    expect(sectionTitles()).toEqual(['shape', 'fill-stroke', 'text-style']);
    expect(screen.getByLabelText<HTMLInputElement>('Width').value).toBe('2');
    commit(screen.getByLabelText('Stroke'), '#00ff00');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'setToolStyle',
      tool: 'shape',
      style: { stroke: { color: [0, 1, 0, 1], width: 2 } },
      isInkPick: false,
    });
    commit(screen.getByLabelText('Width'), '4');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'setToolStyle',
      tool: 'shape',
      style: { stroke: { color: BLUE, width: 4 } },
    });
  });

  it("records an Ink pick for the tool's stroke, even over its default ink, and not for a label", () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      activeTool: 'shape',
      toolStyles: { shape: { stroke: { color: 'ink', width: 2 } } },
    });
    const inks = screen.getAllByRole('button', { name: 'Ink' });
    // The fill and stroke come before the label's text.
    const strokeInk = inks.at(0) ?? document.body;
    const labelInk = inks.at(1) ?? document.body;
    expect(inks).toHaveLength(2);
    // The stroke already holds the default `ink`: the pick alone is recorded.
    fireEvent.click(strokeInk);
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'setToolStyle',
      tool: 'shape',
      style: {},
      isInkPick: true,
    });
    // The shape tool's label colour is not resolved at creation: no pick.
    fireEvent.click(labelInk);
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'setToolStyle',
      tool: 'shape',
      style: { textStyle: { color: 'ink' } },
    });
  });

  it('records the line tool’s Ink pick after a fixed colour', () => {
    const { dispatch } = renderPanel({
      context: 'line',
      activeTool: 'line',
      toolStyles: { line: { stroke: { color: RED, width: 2 } } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ink' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'setToolStyle',
      tool: 'line',
      style: { stroke: { color: 'ink', width: 2 } },
      isInkPick: true,
    });
  });

  it("records the text tool's colour picks", () => {
    const { dispatch } = renderPanel({ context: 'text', activeTool: 'text', toolStyles: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Ink' }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'setToolStyle',
      tool: 'text',
      style: { textStyle: { color: 'ink' } },
      isInkPick: true,
    });
    commit(screen.getByLabelText('Colour'), '#ff0000');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'setToolStyle',
      tool: 'text',
      style: { textStyle: { color: [1, 0, 0, 1] } },
      isInkPick: false,
    });
    commit(screen.getByLabelText('Size'), '30');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'setToolStyle',
      tool: 'text',
      style: { textStyle: { fontSize: 30 } },
    });
  });

  it('shows a path’s width always, 0 for none, and sets or removes its stroke with one action', () => {
    const { dispatch } = renderPanel({
      context: 'vector',
      selection: [shape('p', { type: 'path', stroke: null, fill: null })],
    });
    expect(screen.getByLabelText<HTMLInputElement>('Width').value).toBe('0');
    commit(screen.getByLabelText('Width'), '3');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'style',
      changes: [{ id: 'p', style: { stroke: { color: 'ink', width: 3 } } }],
    });
    cleanup();
    const stroked = renderPanel({
      context: 'vector',
      selection: [shape('q', { type: 'path', stroke: { color: RED, width: 5 }, fill: null })],
    });
    commit(screen.getByLabelText('Width'), '0');
    expect(stroked.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [{ id: 'q', style: { stroke: null } }],
    });
  });

  it("edits the pen tool's style with nothing selected: 2 px near-black, no fill", () => {
    const { dispatch } = renderPanel({
      context: 'vector',
      activeTool: 'pen',
      toolStyles: { pen: { stroke: { color: [0.1, 0.1, 0.1, 1], width: 2 }, fill: null } },
    });
    expect(screen.getByLabelText<HTMLInputElement>('Width').value).toBe('2');
    expect(screen.getByRole('button', { name: 'No fill' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    commit(screen.getByLabelText('Fill (none)'), '#ff0000');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'setToolStyle',
      tool: 'pen',
      style: { fill: [1, 0, 0, 1] },
    });
  });

  it('says there is nothing to style for a context without sections', () => {
    renderPanel({ context: 'image', activeTool: 'image' });
    expect(screen.getByText('Nothing to style in this selection.')).toBeInstanceOf(HTMLElement);
  });
});

describe('the arrange row', () => {
  it('dispatches each ArrangeCommand, keeping focus where it was', () => {
    const { dispatch } = renderPanel({
      context: 'shape',
      selection: [shape('a'), shape('b'), shape('c')],
    });
    const row = screen.getByRole('region', { name: 'Arrange' });
    // The fifteen arrange buttons, in their three toolbars (the header's collapse aside).
    const buttons = within(row)
      .getAllByRole('toolbar')
      .flatMap((toolbar) => within(toolbar).getAllByRole<HTMLButtonElement>('button'));
    expect(buttons).toHaveLength(15);
    for (const button of buttons.filter(
      (candidate) => candidate.getAttribute('aria-disabled') !== 'true',
    )) {
      expect(fireEvent.mouseDown(button)).toBe(false);
      fireEvent.click(button);
    }
    expect(dispatch.mock.calls.map(([action]) => action)).toContainEqual({
      type: 'arrange',
      command: 'bringToFront',
    });
    expect(dispatch).toHaveBeenCalledTimes(14);
  });

  it('disables what cannot apply: distribute below three, group below two, ungroup without a group', () => {
    renderPanel({ context: 'shape', selection: [shape('a')] });
    const disabled = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-disabled') === 'true')
      .map((button) => button.getAttribute('aria-label'));
    expect(disabled).toEqual([
      'Distribute horizontally (Alt+Shift+H)',
      'Distribute vertically (Alt+Shift+V)',
      'Tidy up (Ctrl+Alt+T)',
      'Group (Ctrl+G)',
      'Ungroup (Ctrl+Shift+G)',
    ]);
    cleanup();
    renderPanel({ context: 'group', selection: [shape('g', { type: 'group' })] });
    const ungroup = screen.getByRole('button', { name: /^Ungroup/ });
    expect(ungroup.getAttribute('aria-disabled')).toBeNull();
  });
});
