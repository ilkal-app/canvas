import { describe, expect, it } from 'vitest';

import { TOOL_IDS } from '@canvas/tools';

import type { KeyEventLike } from '../shortcuts/key-event-match.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import { listShortcuts, matchShortcut } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';

import {
  createDefaultShortcutRegistry,
  findToolShortcut,
  isShortcutList,
} from './default-keymap.js';

function keyEvent(key: string, overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key,
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  };
}

function actionFor(event: KeyEventLike, platform: KeyboardPlatform): ShellAction | undefined {
  return matchShortcut(event, createDefaultShortcutRegistry(platform))?.action;
}

describe('createDefaultShortcutRegistry', () => {
  it('builds without chord conflicts on every platform', () => {
    expect(() => createDefaultShortcutRegistry('mac')).not.toThrow();
    expect(() => createDefaultShortcutRegistry('other')).not.toThrow();
  });

  it('gives every dock tool exactly one shortcut, the line, shape and draw tools one per variant', () => {
    const registry = createDefaultShortcutRegistry('mac');
    for (const tool of TOOL_IDS) {
      const selecting = registry.entries.filter(
        (entry) => entry.action.type === 'selectTool' && entry.action.tool === tool,
      );
      // The line and arrow (l, Shift+L); the rectangle and ellipse (r, o); drawing and
      // the eraser (Shift+P, Shift+E).
      const isVaried = tool === 'line' || tool === 'shape' || tool === 'draw';
      expect(selecting, tool).toHaveLength(isVaried ? 2 : 1);
    }
  });

  it('chooses the hand with h, the rectangle with r, the ellipse with o, the connector with c', () => {
    expect(actionFor(keyEvent('h'), 'mac')).toEqual({ type: 'selectTool', tool: 'hand' });
    expect(actionFor(keyEvent('r'), 'mac')).toEqual({
      type: 'selectTool',
      tool: 'shape',
      style: { kind: 'rectangle' },
    });
    expect(actionFor(keyEvent('o'), 'mac')).toEqual({
      type: 'selectTool',
      tool: 'shape',
      style: { kind: 'ellipse' },
    });
    expect(actionFor(keyEvent('c'), 'other')).toEqual({
      type: 'selectTool',
      tool: 'connector',
      style: { route: 'straight' },
      replaces: { route: 'elbow' },
    });
  });

  it('chooses the line with l and the arrow with Shift+L', () => {
    expect(actionFor(keyEvent('l'), 'mac')).toEqual({
      type: 'selectTool',
      tool: 'line',
      style: { endCap: 'none' },
      replaces: { endCap: 'arrow' },
    });
    expect(actionFor(keyEvent('L', { shiftKey: true }), 'other')).toEqual({
      type: 'selectTool',
      tool: 'line',
      style: { endCap: 'arrow' },
    });
  });

  it('selects tools with single letters, as the prototype did for text, sticky and pen', () => {
    expect(actionFor(keyEvent('t'), 'mac')).toEqual({ type: 'selectTool', tool: 'text' });
    expect(actionFor(keyEvent('s'), 'mac')).toEqual({ type: 'selectTool', tool: 'sticky' });
    expect(actionFor(keyEvent('p'), 'other')).toEqual({ type: 'selectTool', tool: 'pen' });
    expect(actionFor(keyEvent('v'), 'other')).toEqual({ type: 'selectTool', tool: 'select' });
  });

  it('chooses the draw tool with Shift+P, Figma’s pencil chord, leaving p the pen', () => {
    expect(actionFor(keyEvent('P', { shiftKey: true }), 'mac')).toEqual({
      type: 'selectTool',
      tool: 'draw',
      style: { isEraser: false },
    });
  });

  it('chooses the draw tool’s eraser with Shift+E', () => {
    expect(actionFor(keyEvent('E', { shiftKey: true }), 'mac')).toEqual({
      type: 'selectTool',
      tool: 'draw',
      style: { isEraser: true },
    });
  });

  it('opens the cheat sheet with the question mark, typed with Shift', () => {
    expect(actionFor(keyEvent('?', { shiftKey: true, code: 'Slash' }), 'mac')).toEqual({
      type: 'toggleCheatSheet',
    });
  });

  it('shows and hides the developer overlay with mod+shift+d, listed under help', () => {
    const toggle = { type: 'toggleDeveloperOverlay' };
    expect(actionFor(keyEvent('D', { metaKey: true, shiftKey: true }), 'mac')).toEqual(toggle);
    expect(actionFor(keyEvent('D', { ctrlKey: true, shiftKey: true }), 'other')).toEqual(toggle);
    expect(actionFor(keyEvent('d', { metaKey: true }), 'mac')).toEqual({
      type: 'selection',
      command: 'duplicate',
    });
    const help = listShortcuts(createDefaultShortcutRegistry('mac')).find(
      (group) => group.category === 'help',
    );
    expect(help?.entries.map((entry) => entry.id)).toContain('help.developer-overlay');
  });

  it('undoes and redoes with Command on mac and Control elsewhere', () => {
    const undo = { type: 'history', command: 'undo' };
    const redo = { type: 'history', command: 'redo' };
    expect(actionFor(keyEvent('z', { metaKey: true }), 'mac')).toEqual(undo);
    expect(actionFor(keyEvent('z', { ctrlKey: true }), 'other')).toEqual(undo);
    expect(actionFor(keyEvent('z', { ctrlKey: true }), 'mac')).toBeUndefined();
    expect(actionFor(keyEvent('Z', { metaKey: true, shiftKey: true }), 'mac')).toEqual(redo);
  });

  it('covers the navigation commands', () => {
    expect(actionFor(keyEvent('=', { metaKey: true }), 'mac')).toEqual({
      type: 'navigate',
      command: 'zoomIn',
    });
    expect(actionFor(keyEvent('+', { metaKey: true, shiftKey: true }), 'mac')).toEqual({
      type: 'navigate',
      command: 'zoomIn',
    });
    expect(actionFor(keyEvent('-', { ctrlKey: true }), 'other')).toEqual({
      type: 'navigate',
      command: 'zoomOut',
    });
    expect(actionFor(keyEvent('!', { shiftKey: true, code: 'Digit1' }), 'mac')).toEqual({
      type: 'navigate',
      command: 'zoomToFit',
    });
    expect(actionFor(keyEvent('@', { shiftKey: true, code: 'Digit2' }), 'mac')).toEqual({
      type: 'navigate',
      command: 'zoomToSelection',
    });
    expect(actionFor(keyEvent(')', { shiftKey: true, code: 'Digit0' }), 'mac')).toEqual({
      type: 'navigate',
      command: 'zoomToActualSize',
    });
  });

  it('zooms with bare + and -, and resets to 100% with mod+0, as the camera expects', () => {
    const zoomIn = { type: 'navigate', command: 'zoomIn' };
    const zoomOut = { type: 'navigate', command: 'zoomOut' };
    const actualSize = { type: 'navigate', command: 'zoomToActualSize' };
    for (const platform of ['mac', 'other'] as const) {
      expect(actionFor(keyEvent('='), platform)).toEqual(zoomIn);
      expect(actionFor(keyEvent('+', { shiftKey: true, code: 'Equal' }), platform)).toEqual(zoomIn);
      expect(actionFor(keyEvent('-'), platform)).toEqual(zoomOut);
    }
    expect(actionFor(keyEvent('0', { metaKey: true }), 'mac')).toEqual(actualSize);
    expect(actionFor(keyEvent('0', { ctrlKey: true }), 'other')).toEqual(actualSize);
  });

  it('keeps Shift+0 and Shift+1 where the layout types = or + with them', () => {
    for (const platform of ['mac', 'other'] as const) {
      // German, Nordic, Spanish, Italian: Shift+0 types "=". Swiss: Shift+1 types "+".
      expect(actionFor(keyEvent('=', { shiftKey: true, code: 'Digit0' }), platform)).toEqual({
        type: 'navigate',
        command: 'zoomToActualSize',
      });
      expect(actionFor(keyEvent('+', { shiftKey: true, code: 'Digit1' }), platform)).toEqual({
        type: 'navigate',
        command: 'zoomToFit',
      });
      // German "+" has a key of its own and zooms in.
      expect(actionFor(keyEvent('+', { code: 'BracketRight' }), platform)).toEqual({
        type: 'navigate',
        command: 'zoomIn',
      });
    }
  });

  it('nudges by one pixel with arrows and by a large step with Shift+arrows', () => {
    expect(actionFor(keyEvent('ArrowLeft'), 'mac')).toEqual({
      type: 'nudge',
      direction: 'left',
      isLarge: false,
    });
    expect(actionFor(keyEvent('ArrowUp', { shiftKey: true }), 'mac')).toEqual({
      type: 'nudge',
      direction: 'up',
      isLarge: true,
    });
  });

  it('orders with brackets and aligns with Option+letter on mac', () => {
    expect(actionFor(keyEvent(']', { metaKey: true }), 'mac')).toEqual({
      type: 'arrange',
      command: 'bringForward',
    });
    expect(
      actionFor(keyEvent('‘', { metaKey: true, altKey: true, code: 'BracketRight' }), 'mac'),
    ).toEqual({ type: 'arrange', command: 'bringToFront' });
    expect(actionFor(keyEvent('å', { altKey: true, code: 'KeyA' }), 'mac')).toEqual({
      type: 'arrange',
      command: 'alignLeft',
    });
  });

  it('selects the same type with mod+alt+a, apart from aligning left with alt+a', () => {
    const selectSameType = { type: 'selection', command: 'selectSameType' };
    expect(actionFor(keyEvent('å', { metaKey: true, altKey: true, code: 'KeyA' }), 'mac')).toEqual(
      selectSameType,
    );
    expect(
      actionFor(keyEvent('a', { ctrlKey: true, altKey: true, code: 'KeyA' }), 'other'),
    ).toEqual(selectSameType);
    expect(actionFor(keyEvent('a', { ctrlKey: true, code: 'KeyA' }), 'other')).toEqual({
      type: 'selection',
      command: 'selectAll',
    });
    const selection = listShortcuts(createDefaultShortcutRegistry('mac')).find(
      (group) => group.category === 'selection',
    );
    expect(selection?.entries.map((entry) => entry.id)).toContain('selection.selectSameType');
  });

  it('repeats only nudging, zooming, undo and redo when a key is held', () => {
    const repeating = createDefaultShortcutRegistry('mac')
      .entries.filter((entry) => entry.canRepeat)
      .map((entry) => entry.action.type);
    expect(new Set(repeating)).toEqual(new Set(['nudge', 'navigate', 'history']));
    expect(repeating).toHaveLength(8 + 2 + 2);
  });

  it('leaves copy, cut and paste to the browser’s clipboard events but lists them', () => {
    const registry = createDefaultShortcutRegistry('mac');
    expect(matchShortcut(keyEvent('c', { metaKey: true }), registry)).toBeUndefined();
    const selection = listShortcuts(registry).find((group) => group.category === 'selection');
    expect(selection?.entries.map((entry) => entry.id)).toContain('selection.copy');
  });

  it('lists every category of the cheat sheet', () => {
    const categories = listShortcuts(createDefaultShortcutRegistry('other')).map(
      (group) => group.category,
    );
    expect(categories).toEqual([
      'tools',
      'navigation',
      'selection',
      'arrangement',
      'history',
      'help',
    ]);
  });
});

describe('findToolShortcut', () => {
  it('finds the shortcut that selects a tool', () => {
    const registry = createDefaultShortcutRegistry('mac');
    expect(findToolShortcut(registry, 'pen')?.id).toBe('tools.pen');
  });

  it('returns undefined for a tool with no shortcut', () => {
    const registry = { platform: 'mac' as const, entries: [] };
    expect(findToolShortcut(registry, 'pen')).toBeUndefined();
  });
});

describe('isShortcutList', () => {
  it('accepts a list of definitions, the empty list included', () => {
    const definition = {
      id: 'selection.same',
      chords: ['mod+alt+a'],
      description: 'Select same type',
      category: 'selection',
      action: { type: 'selection', command: 'selectAll' },
    };
    expect(isShortcutList([definition])).toBe(true);
    expect(isShortcutList([])).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isShortcutList({ id: 'a' })).toBe(false);
    expect(isShortcutList([null])).toBe(false);
    expect(isShortcutList([{ id: 1, chords: [], action: {} }])).toBe(false);
    expect(isShortcutList([{ id: 'a', chords: 'v', action: {} }])).toBe(false);
    expect(isShortcutList([{ id: 'a', chords: [], action: 'go' }])).toBe(false);
  });
});
