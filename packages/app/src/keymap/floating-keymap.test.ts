// The shell's keys under the floating whiteboard dock: the dock's letters choose its
// built tools, M toggles comment placement, P and E are the Draw panel's keys, unbuilt
// tools have none, and every other shortcut, contributed ones included, stays.
import { describe, expect, it } from 'vitest';

import { contextMenuSections } from '../context-menu/context-menu-entries.js';
import { matchShortcut } from '../shortcuts/shortcut-registry.js';

import { createDefaultShortcutRegistry, DEFAULT_SHORTCUTS } from './default-keymap.js';
import { createFloatingShortcutRegistry, FLOATING_SHORTCUTS } from './floating-keymap.js';

/**
 * A key press as `matchShortcut` reads it.
 *
 * @param key - The key.
 * @param isShifted - Whether Shift is held.
 * @returns The event.
 */
function press(key: string, isShifted = false) {
  return {
    key,
    code: `Key${key.toUpperCase()}`,
    shiftKey: isShifted,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  };
}

describe('createFloatingShortcutRegistry', () => {
  it.each(['mac', 'other'] as const)('registers without a clash on %s', (platform) => {
    expect(() => createFloatingShortcutRegistry(platform)).not.toThrow();
  });

  it('chooses the built tools by their letters and toggles comments with M', () => {
    const registry = createFloatingShortcutRegistry('other');
    const actionOf = (key: string) => matchShortcut(press(key), registry)?.action;
    expect(actionOf('v')).toEqual({ type: 'selectTool', tool: 'select' });
    expect(actionOf('h')).toEqual({ type: 'selectTool', tool: 'hand' });
    expect(actionOf('f')).toEqual({ type: 'selectTool', tool: 'frame' });
    expect(actionOf('s')).toEqual({ type: 'selectTool', tool: 'shape' });
    expect(actionOf('i')).toEqual({ type: 'openToolPanel', panel: 'image' });
    expect(actionOf('t')).toEqual({ type: 'selectTool', tool: 'text' });
    expect(actionOf('c')).toEqual({ type: 'selectTool', tool: 'connector' });
    expect(actionOf('n')).toEqual({ type: 'selectTool', tool: 'sticky' });
    expect(actionOf('m')).toEqual({ type: 'toggleCommentPlacing' });
  });

  it('stacks a sticky with Shift+N', () => {
    const registry = createFloatingShortcutRegistry('other');
    expect(matchShortcut(press('N', true), registry)?.action).toEqual({
      type: 'arrange',
      command: 'stackSticky',
    });
  });

  it('makes P and Shift+P the Draw panel cycle, choosing Draw, Shift+E its eraser and E Reactions', () => {
    const registry = createFloatingShortcutRegistry('other');
    const cycle = { type: 'toolPanelKey', tool: 'draw', key: 'cycle', shouldChooseTool: true };
    expect(matchShortcut(press('p'), registry)?.action).toEqual(cycle);
    expect(matchShortcut(press('P', true), registry)?.action).toEqual(cycle);
    const eraser = { type: 'toolPanelKey', tool: 'draw', key: 'eraser', shouldChooseTool: false };
    // E is Reactions' key, which the shell turns into the eraser while drawing.
    expect(matchShortcut(press('e'), registry)?.action).toEqual({
      type: 'toggleReactions',
      isKey: true,
    });
    expect(matchShortcut(press('E', true), registry)?.action).toEqual(eraser);
  });

  it('gives the classic tool letters no key', () => {
    const registry = createFloatingShortcutRegistry('other');
    for (const key of ['r', 'o', 'l']) {
      expect(matchShortcut(press(key), registry)).toBeUndefined();
    }
  });

  it('keeps every shortcut that is not a classic tool choice or Create component', () => {
    const kept = DEFAULT_SHORTCUTS.filter(
      ({ id, category, action }) =>
        (category !== 'tools' || action.type !== 'selectTool') &&
        id !== 'arrangement.createComponent',
    );
    expect(FLOATING_SHORTCUTS.slice(0, kept.length)).toEqual(kept);
    expect(FLOATING_SHORTCUTS.map(({ id }) => id)).toContain('navigation.layers-drawer');
  });

  // A whiteboard has no components, so nothing on it runs Create component.
  it.each(['mac', 'other'] as const)('gives Create component no key on %s', (platform) => {
    const registry = createFloatingShortcutRegistry(platform);
    const createComponent = { type: 'arrange', command: 'createComponent' };
    expect(FLOATING_SHORTCUTS.map(({ action }) => action)).not.toContainEqual(createComponent);
    const chord = {
      key: 'k',
      code: 'KeyK',
      shiftKey: false,
      altKey: true,
      ctrlKey: platform === 'other',
      metaKey: platform === 'mac',
    };
    expect(matchShortcut(chord, registry)).toBeUndefined();
    expect(matchShortcut(chord, createDefaultShortcutRegistry(platform))?.action).toEqual(
      createComponent,
    );
  });

  it('leaves Create component out of the context menu on a selection', () => {
    const labels = (registry: ReturnType<typeof createFloatingShortcutRegistry>) =>
      contextMenuSections(registry, { count: 1, hasGroup: false }).flatMap(({ entries }) =>
        entries.map(({ label }) => label),
      );
    expect(labels(createFloatingShortcutRegistry('other'))).not.toContain('Create component');
    expect(labels(createDefaultShortcutRegistry('other'))).toContain('Create component');
  });
});
