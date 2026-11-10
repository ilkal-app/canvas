// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StylePatch } from '@canvas/document';
import type { BoardObject, ObjectId, PrincipalId } from '@canvas/schema';

import type { BoardViewSnapshot } from '../../hooks/use-board-view-state.js';
import type { ShellAction } from '../../state/shell-action.js';
import { createDefaultStylePanelRegistry } from '../default-style-sections.js';
import { StylePanel } from '../style-panel.js';

const registry = createDefaultStylePanelRegistry();
afterEach(cleanup);

/**
 * Render the real style panel for a tool or selected object.
 *
 * @param tool - The active creation tool.
 * @param style - Its chosen style, if any.
 * @param selection - Selected objects, if any.
 * @returns The shell action spy.
 */
function panel(
  tool: 'pen' | 'line' | 'connector',
  style?: StylePatch,
  selection: BoardObject[] = [],
) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const board = {
    documentVersion: 0,
    selectedIds: selection.map((object) => object.id),
    board: { get: () => undefined },
  } as unknown as BoardViewSnapshot;
  render(
    <StylePanel
      registry={registry}
      context={tool === 'pen' ? 'vector' : 'line'}
      board={board}
      selection={selection}
      activeTool={tool}
      toolStyles={style === undefined ? {} : { [tool]: style }}
      dispatch={dispatch}
    />,
  );
  return dispatch;
}

/**
 * Choose a stroke style by its accessible name.
 *
 * @param name - The control's accessible name.
 * @param value - The option value to choose.
 */
function choose(name: string, value: string): void {
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
}

/**
 * Read the current value of a labeled select or input.
 *
 * @param name - The control's accessible name.
 * @returns Its current value.
 */
function value(name: string): string {
  return screen.getByLabelText<HTMLInputElement>(name).value;
}

/**
 * Make a selected path for the selection regression case.
 *
 * @returns A path with the default stroke options.
 */
function path(): BoardObject {
  return {
    id: 'path' as ObjectId,
    type: 'path',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 0,
    updatedAt: 0,
    vertices: [],
    segments: [],
    stroke: { color: 'ink', width: 2 },
    fill: null,
  };
}

describe('tool stroke options in the style panel', () => {
  for (const tool of ['pen', 'line', 'connector'] as const) {
    it(`${tool} shows defaults and sends one sparse patch for each choice`, () => {
      const dispatch = panel(tool);
      expect(value('Dash')).toBe('solid');
      expect(value('Join')).toBe('round');
      expect(value('Cap')).toBe('round');
      expect(screen.queryByLabelText('Miter limit')).toBeNull();
      choose('Dash', 'dashed');
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({
        type: 'setToolStyle',
        tool,
        style: { strokeDash: { pattern: [8, 8] } },
      });
      dispatch.mockClear();
      choose('Join', 'miter');
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({
        type: 'setToolStyle',
        tool,
        style: { strokeJoin: 'miter' },
      });
      dispatch.mockClear();
      choose('Cap', 'square');
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({
        type: 'setToolStyle',
        tool,
        style: { strokeCap: 'square' },
      });
    });

    it(`${tool} reads its current stroke options and edits the miter limit`, () => {
      const dispatch = panel(tool, {
        stroke: { color: 'ink', width: 3 },
        strokeDash: { pattern: [12, 12] },
        strokeJoin: 'miter',
        strokeMiterLimit: 9,
        strokeCap: 'butt',
      });
      expect(value('Dash')).toBe('dashed');
      expect(value('Join')).toBe('miter');
      expect(value('Miter limit')).toBe('9');
      expect(value('Cap')).toBe('butt');
      fireEvent.change(screen.getByLabelText('Miter limit'), { target: { value: '10' } });
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({
        type: 'setToolStyle',
        tool,
        style: { strokeMiterLimit: 10 },
      });
    });

    it(`${tool} makes dots visible with a round cap and clears a dash as null`, () => {
      const dispatch = panel(tool, { strokeCap: 'butt' });
      choose('Dash', 'dotted');
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({
        type: 'setToolStyle',
        tool,
        style: { strokeDash: { pattern: [0, 4] }, strokeCap: 'round' },
      });
      dispatch.mockClear();
      choose('Dash', 'solid');
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({
        type: 'setToolStyle',
        tool,
        style: { strokeDash: null },
      });
    });
  }

  it('scales presets by the tool stroke width, including a dotted pattern', () => {
    const dispatch = panel('line', { stroke: { color: 'ink', width: 3 } });
    choose('Dash', 'dashed');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'setToolStyle',
      tool: 'line',
      style: { strokeDash: { pattern: [12, 12] } },
    });
    dispatch.mockClear();
    choose('Dash', 'dotted');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'setToolStyle',
      tool: 'line',
      style: { strokeDash: { pattern: [0, 6] } },
    });
  });

  for (const tool of ['line', 'connector'] as const) {
    it(`${tool} hides Cap with decorated solid ends and shows it for dashes`, () => {
      panel(tool, { startCap: 'arrow', endCap: 'triangle' });
      expect(screen.queryByLabelText('Cap')).toBeNull();
      cleanup();
      panel(tool, { startCap: 'arrow', endCap: 'triangle', strokeDash: { pattern: [8, 8] } });
      expect(value('Cap')).toBe('round');
    });
  }

  it('keeps the selected path on the selection style action', () => {
    const dispatch = panel('pen', undefined, [path()]);
    choose('Join', 'bevel');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [{ id: 'path', style: { strokeJoin: 'bevel' } }],
    });
  });
});
