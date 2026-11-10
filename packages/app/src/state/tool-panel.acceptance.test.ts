// Acceptance for the panel registry, state and per-user choices.
import { describe, expect, it } from 'vitest';

import type { FloatingDockToolId } from './floating-dock.js';
import {
  loadToolPanelChoices,
  saveToolPanelChoices,
  storedField,
  toolPanelStorageKey,
  type ToolPanelChoiceCodec,
} from './tool-panel-choices.js';
import {
  INITIAL_TOOL_PANEL_STATE,
  TOOL_PANEL_IDS,
  isToolPanelId,
  keepsToolAfterPlacing,
  toolPanelReducer,
} from './tool-panel-state.js';
import type { PreferenceStorage } from './view-preferences.js';

const PANEL_CASES: readonly [FloatingDockToolId, boolean][] = [
  ['select', false],
  ['pan', false],
  ['section', false],
  ['shapes', true],
  ['image', true],
  ['text', false],
  ['connector', true],
  ['draw', true],
  ['sticky', true],
  ['comment', false],
  ['reactions', true],
];

interface Choices {
  readonly color: string;
  readonly size: number;
}

const CODEC: ToolPanelChoiceCodec<Choices> = {
  id: 'sticky',
  defaults: { color: 'yellow', size: 100 },
  parse: (stored) => ({
    color: storedField(
      stored,
      'color',
      (value): value is string => value === 'yellow' || value === 'blue',
      'yellow',
    ),
    size: storedField(
      stored,
      'size',
      (value): value is number => typeof value === 'number' && value > 0,
      100,
    ),
  }),
};

function memoryStorage(): PreferenceStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('tool panels', () => {
  it('registers exactly the six option panels in dock order', () => {
    expect(TOOL_PANEL_IDS).toEqual(['shapes', 'image', 'connector', 'draw', 'sticky', 'reactions']);
  });

  it.each(PANEL_CASES)(
    'choosing %s opens a panel exactly when it has options',
    (tool, hasPanel) => {
      expect(isToolPanelId(tool)).toBe(hasPanel);
      const state = toolPanelReducer(INITIAL_TOOL_PANEL_STATE, { type: 'choose', tool });
      expect(state.tool).toBe(tool);
      expect(state.openPanel).toBe(hasPanel ? tool : null);
      expect(keepsToolAfterPlacing(state)).toBe(hasPanel);
    },
  );

  it('swaps panels when a different option tool is chosen', () => {
    const shapes = toolPanelReducer(INITIAL_TOOL_PANEL_STATE, { type: 'choose', tool: 'shapes' });
    expect(toolPanelReducer(shapes, { type: 'choose', tool: 'sticky' })).toEqual({
      tool: 'sticky',
      openPanel: 'sticky',
    });
    expect(toolPanelReducer(shapes, { type: 'choose', tool: 'text' })).toEqual({
      tool: 'text',
      openPanel: null,
    });
  });

  it('toggles the chosen panel while keeping the tool active', () => {
    const open = toolPanelReducer(INITIAL_TOOL_PANEL_STATE, { type: 'choose', tool: 'sticky' });
    const closed = toolPanelReducer(open, { type: 'choose', tool: 'sticky' });
    expect(closed).toEqual({ tool: 'sticky', openPanel: null });
    expect(keepsToolAfterPlacing(closed)).toBe(false);
    expect(toolPanelReducer(closed, { type: 'choose', tool: 'sticky' })).toEqual(open);
  });

  it('closes the panel on Escape and preserves a panel-less state', () => {
    const open = toolPanelReducer(INITIAL_TOOL_PANEL_STATE, { type: 'choose', tool: 'sticky' });
    const closed = toolPanelReducer(open, { type: 'escape' });
    expect(closed).toEqual({ tool: 'sticky', openPanel: null });
    expect(toolPanelReducer(closed, { type: 'escape' })).toBe(closed);
    expect(toolPanelReducer(INITIAL_TOOL_PANEL_STATE, { type: 'escape' })).toBe(
      INITIAL_TOOL_PANEL_STATE,
    );
  });

  it('closes a panel for an outside tool change unless the tool stays the same', () => {
    const open = toolPanelReducer(INITIAL_TOOL_PANEL_STATE, { type: 'choose', tool: 'sticky' });
    expect(toolPanelReducer(open, { type: 'toolChanged', tool: 'sticky' })).toBe(open);
    expect(toolPanelReducer(open, { type: 'toolChanged', tool: 'select' })).toEqual({
      tool: 'select',
      openPanel: null,
    });
  });

  it('stores choices under one key per panel without a board identifier', () => {
    expect(TOOL_PANEL_IDS.map(toolPanelStorageKey)).toEqual([
      'canvas.tool-panel.shapes',
      'canvas.tool-panel.image',
      'canvas.tool-panel.connector',
      'canvas.tool-panel.draw',
      'canvas.tool-panel.sticky',
      'canvas.tool-panel.reactions',
    ]);
    const storage = memoryStorage();
    saveToolPanelChoices(CODEC, { color: 'blue', size: 120 }, storage);
    expect(storage.getItem('canvas.tool-panel.sticky')).toBe('{"color":"blue","size":120}');
    expect(loadToolPanelChoices(CODEC, storage)).toEqual({ color: 'blue', size: 120 });
  });

  it.each([null, '{broken', 'null', '[]', '42', '"text"'])(
    'uses defaults for missing or malformed stored choices (%s)',
    (raw) => {
      const storage: PreferenceStorage = {
        getItem: () => raw,
        setItem: () => undefined,
      };
      expect(loadToolPanelChoices(CODEC, storage)).toEqual(CODEC.defaults);
    },
  );

  it('falls back field by field and retains valid neighbours', () => {
    const storage: PreferenceStorage = {
      getItem: () => '{"color":"blue","size":-2}',
      setItem: () => undefined,
    };
    expect(loadToolPanelChoices(CODEC, storage)).toEqual({ color: 'blue', size: 100 });
    expect(
      storedField(
        { color: 'green' },
        'color',
        (value): value is string => value === 'yellow' || value === 'blue',
        'yellow',
      ),
    ).toBe('yellow');
    expect(
      storedField([], 'color', (value): value is string => typeof value === 'string', 'yellow'),
    ).toBe('yellow');
  });

  it('uses defaults for a throwing store and ignores a failed save', () => {
    const storage: PreferenceStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadToolPanelChoices(CODEC, storage)).toEqual(CODEC.defaults);
    expect(() => {
      saveToolPanelChoices(CODEC, { color: 'blue', size: 120 }, storage);
    }).not.toThrow();
  });
});
