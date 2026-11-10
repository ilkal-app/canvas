// @vitest-environment jsdom
// A multi-selection whose values differ (the design's mixed-selection frame): each differing field reads
// "Mixed", and a value entered there applies to every selected object, as one style action.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, Rgba } from '@canvas/schema';

import type { BoardViewSnapshot } from '../hooks/use-board-view-state.js';
import type { ShellAction } from '../state/shell-action.js';

import { memoryShape } from './__fixtures__/memory-board.js';
import { createDefaultStylePanelRegistry } from './default-style-sections.js';
import { StylePanel } from './style-panel.js';

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];

afterEach(cleanup);

function shape(id: string, fields: Record<string, unknown>): BoardObject {
  return { ...memoryShape(id, 'a0'), ...fields };
}

function renderMixed() {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const selection = [
    shape('a', { fill: RED, stroke: { color: RED, width: 2 } }),
    shape('b', { fill: BLUE, stroke: { color: BLUE, width: 4 } }),
  ];
  const board = {
    documentVersion: 0,
    selectedIds: selection.map((object) => object.id),
    board: { get: () => undefined },
  } as unknown as BoardViewSnapshot;
  render(
    <StylePanel
      registry={createDefaultStylePanelRegistry()}
      context="shape"
      board={board}
      selection={selection}
      activeTool="select"
      toolStyles={{}}
      dispatch={dispatch}
    />,
  );
  return dispatch;
}

describe('StylePanel with a mixed multi-selection', () => {
  it('reads Mixed in each differing field', () => {
    renderMixed();
    const width = screen.getByLabelText<HTMLInputElement>('Width (mixed)');
    expect(width.value).toBe('');
    expect(width.parentElement?.textContent).toContain('Mixed');
    const fill = screen.getByLabelText('Fill (mixed)');
    expect(fill.closest('[class]')?.parentElement?.textContent).toContain('Mixed');
  });

  it('applies a width entered in the Mixed field to every selected object', () => {
    const dispatch = renderMixed();
    const width = screen.getByLabelText<HTMLInputElement>('Width (mixed)');
    act(() => {
      width.value = '6';
      width.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: 'a', style: { stroke: { color: RED, width: 6 } } },
        { id: 'b', style: { stroke: { color: BLUE, width: 6 } } },
      ],
    });
  });
});
