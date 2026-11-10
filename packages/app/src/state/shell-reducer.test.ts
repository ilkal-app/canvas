import { describe, expect, it } from 'vitest';

import { TOOL_IDS } from '@canvas/tools';

import { DOCK_BUTTON_IDS, DOCK_BUTTONS } from './dock-buttons.js';
import type { ShellAction } from './shell-action.js';
import { INITIAL_SHELL_STATE, shellReducer, type ShellState } from './shell-reducer.js';
import { availableToolIds, SHORTCUT_ONLY_TOOLS, TOOL_AVAILABILITY } from './tool-availability.js';
import { DRAW_VARIANT, ERASER_VARIANT, toolVariantAction } from './tool-variants.js';

const RED: [number, number, number, number] = [1, 0, 0, 1];

function run(actions: ShellAction[], from: ShellState = INITIAL_SHELL_STATE): ShellState {
  return actions.reduce(shellReducer, from);
}

describe('shellReducer', () => {
  it('starts with the select tool active and the cheat sheet closed', () => {
    expect(INITIAL_SHELL_STATE.activeTool).toBe('select');
    expect(INITIAL_SHELL_STATE.isCheatSheetOpen).toBe(false);
    expect(INITIAL_SHELL_STATE.lastCanvasAction).toBeUndefined();
  });

  it('starts with the developer overlay hidden and toggles it', () => {
    expect(INITIAL_SHELL_STATE.isDeveloperOverlayOpen).toBe(false);
    const shown = run([{ type: 'toggleDeveloperOverlay' }]);
    expect(shown.isDeveloperOverlayOpen).toBe(true);
    expect(shown.lastCanvasAction).toBeUndefined();
    expect(run([{ type: 'toggleDeveloperOverlay' }], shown).isDeveloperOverlayOpen).toBe(false);
  });

  it('starts with the minimap unpinned, and shift+m’s command pins and unpins it', () => {
    expect(INITIAL_SHELL_STATE.isMinimapPinned).toBe(false);
    const pinned = run([{ type: 'navigate', command: 'toggleMinimap' }]);
    expect(pinned.isMinimapPinned).toBe(true);
    expect(pinned.lastCanvasAction).toBeUndefined();
    expect(run([{ type: 'navigate', command: 'toggleMinimap' }], pinned).isMinimapPinned).toBe(
      false,
    );
  });

  it('leaves the inspector, comment placement and reactions to the shell, changing nothing', () => {
    for (const action of [
      { type: 'toggleInspector' },
      { type: 'toggleCommentPlacing' },
      { type: 'toggleReactions' },
    ] as const) {
      expect(shellReducer(INITIAL_SHELL_STATE, action)).toBe(INITIAL_SHELL_STATE);
    }
  });

  it('starts detaching connectors on delete and toggles the preference, even read-only', () => {
    expect(INITIAL_SHELL_STATE.shouldDeleteConnectors).toBe(false);
    const on = run([{ type: 'toggleDeleteConnectors' }]);
    expect(on.shouldDeleteConnectors).toBe(true);
    expect(on.lastCanvasAction).toBeUndefined();
    const viewer = { ...INITIAL_SHELL_STATE, canEdit: false };
    expect(run([{ type: 'toggleDeleteConnectors' }], viewer).shouldDeleteConnectors).toBe(true);
  });

  it('makes an available tool active', () => {
    const withPen: ShellState = { ...INITIAL_SHELL_STATE, availableTools: ['select', 'pen'] };
    expect(run([{ type: 'selectTool', tool: 'pen' }], withPen).activeTool).toBe('pen');
  });

  it('starts with the tools an available dock button chooses and the shortcut-only ones', () => {
    const chosen = new Set([
      ...DOCK_BUTTON_IDS.filter((id) => TOOL_AVAILABILITY[id].isAvailable).map(
        (id) => DOCK_BUTTONS[id].tool,
      ),
      ...SHORTCUT_ONLY_TOOLS,
    ]);
    expect(INITIAL_SHELL_STATE.availableTools).toEqual(TOOL_IDS.filter((tool) => chosen.has(tool)));
    expect(INITIAL_SHELL_STATE.availableTools).toContain('select');
  });

  it('remembers the tool last chosen from a flyout group, for its button', () => {
    expect(INITIAL_SHELL_STATE.dockGroupTools).toEqual({ shapes: 'shape', lines: 'line' });
    const connector = run([{ type: 'selectTool', tool: 'connector' }]);
    expect(connector.dockGroupTools).toEqual({ shapes: 'shape', lines: 'connector' });
    const back = run([{ type: 'selectTool', tool: 'select' }], connector);
    expect(back.dockGroupTools).toBe(connector.dockGroupTools);
    const line = run([{ type: 'selectTool', tool: 'line', style: { endCap: 'arrow' } }], back);
    expect(line.dockGroupTools.lines).toBe('line');
  });

  it('lets a viewer take the hand, which only pans, but no creation tool', () => {
    const viewer: ShellState = { ...INITIAL_SHELL_STATE, canEdit: false };
    expect(run([{ type: 'selectTool', tool: 'hand' }], viewer).activeTool).toBe('hand');
    expect(run([{ type: 'selectTool', tool: 'pen' }], viewer).activeTool).toBe('select');
  });

  it('chooses a tool variant: the tool made active with its style fields set', () => {
    const arrow = run([{ type: 'selectTool', tool: 'line', style: { endCap: 'arrow' } }]);
    expect(arrow.activeTool).toBe('line');
    expect(arrow.toolStyles.line).toEqual({ endCap: 'arrow' });
    const plain = run([{ type: 'selectTool', tool: 'line', style: { endCap: 'none' } }], arrow);
    expect(plain.toolStyles.line).toEqual({ endCap: 'none' });
    expect(
      shellReducer(plain, { type: 'selectTool', tool: 'line', style: { endCap: 'none' } }),
    ).toBe(plain);
  });

  it('switches the draw tool to the eraser and back, keeping the look drawing returns to', () => {
    const marker = run([
      { type: 'selectTool', tool: 'draw' },
      { type: 'setToolStyle', tool: 'draw', style: { tool: 'marker' } },
      toolVariantAction(ERASER_VARIANT),
    ]);
    expect(marker.activeTool).toBe('draw');
    expect(marker.toolStyles.draw).toEqual({ tool: 'marker', isEraser: true });
    const drawing = run([toolVariantAction(DRAW_VARIANT)], marker);
    expect(drawing.toolStyles.draw).toEqual({ tool: 'marker', isEraser: false });
  });

  it('turns only the arrow back to a plain line with `l`, keeping a cap chosen in the panel', () => {
    const lineAction: ShellAction = {
      type: 'selectTool',
      tool: 'line',
      style: { endCap: 'none' },
      replaces: { endCap: 'arrow' },
    };
    const arrow = run([{ type: 'selectTool', tool: 'line', style: { endCap: 'arrow' } }]);
    expect(run([lineAction], arrow).toolStyles.line).toEqual({ endCap: 'none' });
    const chosen = run([
      { type: 'setToolStyle', tool: 'line', style: { endCap: 'triangle' } },
      { type: 'selectTool', tool: 'select' },
    ]);
    const back = run([lineAction], chosen);
    expect(back.activeTool).toBe('line');
    expect(back.toolStyles.line).toEqual({ endCap: 'triangle' });
    expect(shellReducer(back, lineAction)).toBe(back);
  });

  it('refuses a tool without a mode, returning the same state', () => {
    const selectOnly: ShellState = { ...INITIAL_SHELL_STATE, availableTools: ['select'] };
    expect(shellReducer(selectOnly, { type: 'selectTool', tool: 'pen' })).toBe(selectOnly);
  });

  it("merges a creation tool's style field by field, text style fields too", () => {
    const state = run([
      {
        type: 'setToolStyle',
        tool: 'text',
        style: { align: 'center', textStyle: { fontSize: 20 } },
      },
      { type: 'setToolStyle', tool: 'text', style: { textStyle: { italic: true } } },
      { type: 'setToolStyle', tool: 'text', style: { align: 'right' } },
      { type: 'setToolStyle', tool: 'sticky', style: { color: [1, 1, 0, 1] } },
    ]);
    expect(state.toolStyles).toEqual({
      text: { align: 'right', textStyle: { fontSize: 20, italic: true } },
      sticky: { color: [1, 1, 0, 1] },
    });
    expect(state.lastCanvasAction).toBeUndefined();
  });

  it('records a tool’s Ink pick, clears it for a fixed colour, and keeps it otherwise', () => {
    const fixed = run([
      {
        type: 'setToolStyle',
        tool: 'line',
        style: { stroke: { color: RED, width: 2 } },
        isInkPick: false,
      },
    ]);
    expect(fixed.pickedInk).toEqual({});
    const picked = run(
      [
        {
          type: 'setToolStyle',
          tool: 'line',
          style: { stroke: { color: 'ink', width: 2 } },
          isInkPick: true,
        },
      ],
      fixed,
    );
    expect(picked.pickedInk).toEqual({ line: true });
    expect(picked.toolStyles.line).toEqual({ stroke: { color: 'ink', width: 2 } });
    // A width change says nothing about the colour; a repeat pick changes nothing.
    const widened = run(
      [{ type: 'setToolStyle', tool: 'line', style: { stroke: { color: 'ink', width: 4 } } }],
      picked,
    );
    expect(widened.pickedInk).toBe(picked.pickedInk);
    const again = run(
      [{ type: 'setToolStyle', tool: 'line', style: {}, isInkPick: true }],
      widened,
    );
    expect(again.pickedInk).toBe(widened.pickedInk);
    const other = run([{ type: 'setToolStyle', tool: 'pen', style: {}, isInkPick: true }], again);
    const cleared = run(
      [
        {
          type: 'setToolStyle',
          tool: 'line',
          style: { stroke: { color: RED, width: 4 } },
          isInkPick: false,
        },
      ],
      other,
    );
    expect(cleared.pickedInk).toEqual({ pen: true });
  });

  it('returns the same state when the tool is already active, so nothing re-renders', () => {
    expect(shellReducer(INITIAL_SHELL_STATE, { type: 'selectTool', tool: 'select' })).toBe(
      INITIAL_SHELL_STATE,
    );
  });

  it('toggles the cheat sheet open and closed', () => {
    const opened = run([{ type: 'toggleCheatSheet' }]);
    expect(opened.isCheatSheetOpen).toBe(true);
    expect(run([{ type: 'toggleCheatSheet' }], opened).isCheatSheetOpen).toBe(false);
  });

  it('closes the cheat sheet, and closing a closed sheet changes nothing', () => {
    const opened = run([{ type: 'toggleCheatSheet' }]);
    expect(run([{ type: 'closeCheatSheet' }], opened).isCheatSheetOpen).toBe(false);
    expect(shellReducer(INITIAL_SHELL_STATE, { type: 'closeCheatSheet' })).toBe(
      INITIAL_SHELL_STATE,
    );
  });

  it('records canvas actions with a rising sequence so a repeated action is still seen', () => {
    const undo: ShellAction = { type: 'history', command: 'undo' };
    const once = run([undo]);
    const twice = run([undo], once);
    expect(once.lastCanvasAction).toEqual({ action: undo, sequence: 1 });
    expect(twice.lastCanvasAction).toEqual({ action: undo, sequence: 2 });
  });

  it('records every kind of canvas action', () => {
    const actions: ShellAction[] = [
      { type: 'navigate', command: 'zoomIn' },
      { type: 'selection', command: 'selectAll' },
      { type: 'nudge', direction: 'left', isLarge: true },
      { type: 'arrange', command: 'bringToFront' },
      { type: 'history', command: 'redo' },
      { type: 'style', changes: [] },
    ];
    for (const action of actions) {
      expect(shellReducer(INITIAL_SHELL_STATE, action).lastCanvasAction?.action).toBe(action);
    }
  });

  it('does not mutate the state it is given', () => {
    const frozen = Object.freeze({ ...INITIAL_SHELL_STATE });
    expect(() =>
      run(
        [
          { type: 'selectTool', tool: 'text' },
          { type: 'toggleCheatSheet' },
          { type: 'toggleDeveloperOverlay' },
          { type: 'navigate', command: 'zoomToFit' },
        ],
        frozen,
      ),
    ).not.toThrow();
    expect(frozen).toEqual(INITIAL_SHELL_STATE);
  });

  it('toggles the grid and snapping as view preferences, not canvas actions', () => {
    expect(INITIAL_SHELL_STATE).toMatchObject({ isGridVisible: false, isSnappingOn: true });
    const toggled = run([
      { type: 'navigate', command: 'toggleGrid' },
      { type: 'navigate', command: 'toggleSnapping' },
    ]);
    expect(toggled).toMatchObject({ isGridVisible: true, isSnappingOn: false });
    expect(toggled.lastCanvasAction).toBeUndefined();
    const back = run(
      [
        { type: 'navigate', command: 'toggleGrid' },
        { type: 'navigate', command: 'toggleSnapping' },
      ],
      toggled,
    );
    expect(back).toMatchObject({ isGridVisible: false, isSnappingOn: true });
  });
});

describe('openToolPanel', () => {
  it('asks for the panel, a new request each time, and hands the canvas to Select', () => {
    const sticky = shellReducer(
      { ...INITIAL_SHELL_STATE, availableTools: ['select', 'sticky'] },
      { type: 'selectTool', tool: 'sticky' },
    );
    const opened = shellReducer(sticky, { type: 'openToolPanel', panel: 'image' });
    expect(opened).toMatchObject({
      activeTool: 'select',
      toolPanelRequest: { panel: 'image', sequence: 1 },
    });
    expect(
      shellReducer(opened, { type: 'openToolPanel', panel: 'image' }).toolPanelRequest,
    ).toEqual({ panel: 'image', sequence: 2 });
  });
});

describe('request counters', () => {
  it('counts board search and popover focus requests, one each', () => {
    const searched = shellReducer(INITIAL_SHELL_STATE, { type: 'openBoardSearch' });
    expect(searched.boardSearchRequests).toBe(1);
    const focused = shellReducer(searched, { type: 'focusSelectionPopover' });
    expect(focused).toMatchObject({ boardSearchRequests: 1, popoverFocusRequests: 1 });
    expect(shellReducer(focused, { type: 'focusSelectionPopover' }).popoverFocusRequests).toBe(2);
  });
});

describe('availableToolIds', () => {
  it('lists the tools available buttons choose and the shortcut-only draw tool, in order', () => {
    expect(availableToolIds()).toEqual([
      'select',
      'hand',
      'text',
      'sticky',
      'pen',
      'draw',
      'shape',
      'line',
      'connector',
      'image',
      'frame',
    ]);
  });

  it('leaves out a tool only disabled buttons choose, and keeps one any button still chooses', () => {
    const tools = availableToolIds({
      ...TOOL_AVAILABILITY,
      pen: { isAvailable: false, ticket: 'no ticket yet' },
      rectangle: { isAvailable: false, ticket: 'no ticket yet' },
    });
    expect(tools).not.toContain('pen');
    expect(tools).toContain('shape');
  });
});
