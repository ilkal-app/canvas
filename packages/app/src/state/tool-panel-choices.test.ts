// Keeping a tool panel's choices per person: one storage key per panel, defaults for
// anything missing or broken, and storage that refuses ignored.
import { describe, expect, it } from 'vitest';

import {
  loadToolPanelChoices,
  saveToolPanelChoices,
  storedField,
  toolPanelStorageKey,
  type ToolPanelChoiceCodec,
} from './tool-panel-choices.js';
import type { PreferenceStorage } from './view-preferences.js';

interface Example {
  readonly size: 'square' | 'wide';
  readonly count: number;
}

const isSize = (value: unknown): value is Example['size'] => value === 'square' || value === 'wide';
const isCount = (value: unknown): value is number => typeof value === 'number';

const CODEC: ToolPanelChoiceCodec<Example> = {
  id: 'sticky',
  defaults: { size: 'square', count: 1 },
  parse: (stored) => ({
    size: storedField(stored, 'size', isSize, 'square'),
    count: storedField(stored, 'count', isCount, 1),
  }),
};

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: PreferenceStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  return { storage, items };
}

const THROWING: PreferenceStorage = {
  getItem: () => {
    throw new Error('Storage is disabled.');
  },
  setItem: () => {
    throw new Error('Storage is full.');
  },
};

describe('tool panel choices', () => {
  it('keeps each panel under its own key', () => {
    expect(toolPanelStorageKey('sticky')).toBe('canvas.tool-panel.sticky');
    expect(toolPanelStorageKey('draw')).toBe('canvas.tool-panel.draw');
  });

  it('round-trips what was saved', () => {
    const { storage, items } = memoryStorage();
    saveToolPanelChoices(CODEC, { size: 'wide', count: 3 }, storage);
    expect(items.get('canvas.tool-panel.sticky')).toBe('{"size":"wide","count":3}');
    expect(loadToolPanelChoices(CODEC, storage)).toEqual({ size: 'wide', count: 3 });
  });

  it('gives the defaults on a first visit, for broken JSON and with no storage', () => {
    expect(loadToolPanelChoices(CODEC, memoryStorage().storage)).toBe(CODEC.defaults);
    const broken = memoryStorage({ 'canvas.tool-panel.sticky': '{' }).storage;
    expect(loadToolPanelChoices(CODEC, broken)).toBe(CODEC.defaults);
    expect(loadToolPanelChoices(CODEC, THROWING)).toBe(CODEC.defaults);
    expect(loadToolPanelChoices(CODEC, undefined)).toBe(CODEC.defaults);
  });

  it('defaults each field that is missing or invalid on its own', () => {
    const stored = memoryStorage({ 'canvas.tool-panel.sticky': '{"size":"huge","count":4}' });
    expect(loadToolPanelChoices(CODEC, stored.storage)).toEqual({ size: 'square', count: 4 });
    const array = memoryStorage({ 'canvas.tool-panel.sticky': '["wide"]' });
    expect(loadToolPanelChoices(CODEC, array.storage)).toEqual(CODEC.defaults);
  });

  it('ignores a storage that refuses to save', () => {
    expect(() => {
      saveToolPanelChoices(CODEC, CODEC.defaults, THROWING);
    }).not.toThrow();
  });
});
