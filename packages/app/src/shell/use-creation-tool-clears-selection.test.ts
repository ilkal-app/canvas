// @vitest-environment jsdom
// Item 3: the person choosing a creation tool clears the selection under the floating
// chrome; Select, Pan, the engine's own switches and the classic chrome keep it.
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import type { MountedEngine } from '../engine/mounted-engine.js';

import { useCreationToolClearsSelection } from './use-creation-tool-clears-selection.js';
import type { WhiteboardChrome } from './whiteboard-chrome.js';

/**
 * An engine with a selection, recording the selections it is given.
 *
 * @param selectedIds - The selection.
 * @returns The engine and its select spy.
 */
function engineWith(selectedIds: readonly ObjectId[]) {
  const select = vi.fn();
  const engine = { board: { state: () => ({ selectedIds }), select } };
  return { engine: engine as unknown as MountedEngine, select };
}

const SELECTED = ['shape-1' as ObjectId];

/**
 * Renders the hook at Select, then switches to a tool.
 *
 * @param tool - The tool switched to.
 * @param options - The chrome, the selection, and whether the engine made the switch.
 * @param options.chrome - The shell's chrome; floating if absent.
 * @param options.selectedIds - The selection; one shape if absent.
 * @param options.isEngines - Whether the engine switched itself.
 * @returns The select spy.
 */
function switchTo(
  tool: ToolId,
  options: {
    readonly chrome?: WhiteboardChrome;
    readonly selectedIds?: readonly ObjectId[];
    readonly isEngines?: boolean;
  } = {},
) {
  const { engine, select } = engineWith(options.selectedIds ?? SELECTED);
  const chrome = options.chrome ?? 'floating';
  const view = renderHook(
    ({ activeTool }: { activeTool: ToolId }) =>
      useCreationToolClearsSelection(engine, activeTool, chrome),
    { initialProps: { activeTool: 'select' } },
  );
  if (options.isEngines === true) view.result.current.noteEngineTool(tool);
  view.rerender({ activeTool: tool });
  return select;
}

describe('useCreationToolClearsSelection', () => {
  it.each(['sticky', 'shape', 'text', 'connector', 'draw', 'pen', 'line', 'frame'] as const)(
    'clears the selection when the person chooses %s',
    (tool) => {
      expect(switchTo(tool)).toHaveBeenCalledExactlyOnceWith([]);
    },
  );

  it.each(['select', 'hand', 'image'] as const)('keeps the selection for %s', (tool) => {
    expect(switchTo(tool)).not.toHaveBeenCalled();
  });

  it('keeps it when the engine switches itself, and under the classic chrome', () => {
    expect(switchTo('text', { isEngines: true })).not.toHaveBeenCalled();
    expect(switchTo('sticky', { chrome: 'classic' })).not.toHaveBeenCalled();
  });

  it('selects nothing when nothing is selected, and waits for an engine', () => {
    expect(switchTo('sticky', { selectedIds: [] })).not.toHaveBeenCalled();
    const view = renderHook(
      ({ activeTool }: { activeTool: ToolId }) =>
        useCreationToolClearsSelection(undefined, activeTool, 'floating'),
      { initialProps: { activeTool: 'select' } },
    );
    expect(() => {
      view.rerender({ activeTool: 'sticky' });
    }).not.toThrow();
  });
});
