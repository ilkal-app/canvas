// Acceptance
import { describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import * as documentApi from '../index.js';
import { ADA, BODY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import { seedMainWithChildren } from './__fixtures__/component-boards.js';
import { codesOf, fieldOf, mustFindCommand } from './__fixtures__/component-fixtures.js';

/**
 * A card with a state axis ready for preset commands.
 *
 * @returns The store and card ids.
 */
function seeded() {
  const store = new YjsDocumentStore();
  const card = seedMainWithChildren(store);
  applyCommand(store, mustFindCommand('setVariantAxes'), {
    componentId: card.mainId,
    axes: [{ name: 'state', values: ['rest', 'hover'] }],
  });
  return { store, ...card };
}

/**
 * The stored path records in the hover preset.
 *
 * @param store - The document store.
 * @param mainId - The main id.
 * @returns The hover preset, if present.
 */
function hover(store: YjsDocumentStore, mainId: string): Record<string, unknown> | undefined {
  const presets = fieldOf(store, mainId, 'variantPresets') as
    Record<string, Record<string, unknown>> | undefined;
  return presets?.['state=hover'];
}

describe('variant preset commands', () => {
  it('are registered and exported with their input schemas', () => {
    for (const name of ['setVariantPreset', 'resetVariantPreset']) {
      expect(mustFindCommand(name).name).toBe(name);
      expect(documentApi).toHaveProperty(`${name}Command`);
      expect(documentApi).toHaveProperty(`${name}InputSchema`);
    }
  });

  it('merges records at one path, including nested textStyle keys, and leaves other paths intact', () => {
    const { store, mainId, noteId, boxId } = seeded();
    const set = mustFindCommand('setVariantPreset');
    applyCommand(store, set, {
      componentId: mainId,
      axis: 'state',
      value: 'hover',
      path: noteId,
      override: { text: 'Hi', textStyle: { fontSize: 20 } },
    });
    applyCommand(store, set, {
      componentId: mainId,
      axis: 'state',
      value: 'hover',
      path: noteId,
      override: { color: [0, 1, 0, 1], textStyle: { weight: 700 } },
    });
    applyCommand(store, set, {
      componentId: mainId,
      axis: 'state',
      value: 'hover',
      path: boxId,
      override: { fill: [0, 0, 1, 1] },
    });
    expect(hover(store, mainId)).toEqual({
      [noteId]: { text: 'Hi', color: [0, 1, 0, 1], textStyle: { fontSize: 20, weight: 700 } },
      [boxId]: { fill: [0, 0, 1, 1] },
    });
  });

  it('clears old runs when replacing text without runs and drops measuredSize when changing text fields without a size', () => {
    const { store, mainId, captionId } = seeded();
    const set = mustFindCommand('setVariantPreset');
    const target = { componentId: mainId, axis: 'state', value: 'hover', path: captionId };
    applyCommand(store, set, {
      ...target,
      override: {
        text: 'Hi',
        runs: [{ length: 2, style: BODY }],
        measuredSize: { width: 20, height: 10 },
      },
    });
    applyCommand(store, set, { ...target, override: { text: 'Yo' } });
    expect(hover(store, mainId)?.[captionId]).toEqual({ text: 'Yo' });
    applyCommand(store, set, { ...target, override: { measuredSize: { width: 25, height: 10 } } });
    applyCommand(store, set, { ...target, override: { textStyle: { fontSize: 30 } } });
    expect(hover(store, mainId)?.[captionId]).toEqual({ text: 'Yo', textStyle: { fontSize: 30 } });
  });

  it('resets selected fields, a whole path, and all paths; removes empty records but retains the preset', () => {
    const { store, mainId, noteId, boxId } = seeded();
    const set = mustFindCommand('setVariantPreset');
    const reset = mustFindCommand('resetVariantPreset');
    const target = { componentId: mainId, axis: 'state', value: 'hover' };
    applyCommand(store, set, {
      ...target,
      path: noteId,
      override: { text: 'Hi', color: [0, 1, 0, 1] },
    });
    applyCommand(store, set, { ...target, path: boxId, override: { fill: [0, 0, 1, 1] } });
    applyCommand(store, reset, { ...target, path: noteId, fields: ['text'] });
    expect(hover(store, mainId)?.[noteId]).toEqual({ color: [0, 1, 0, 1] });
    applyCommand(store, reset, { ...target, path: noteId, fields: ['color'] });
    expect(hover(store, mainId)).toEqual({ [boxId]: { fill: [0, 0, 1, 1] } });
    applyCommand(store, reset, { ...target, path: boxId });
    expect(hover(store, mainId)).toEqual({});
    applyCommand(store, set, { ...target, path: noteId, override: { text: 'Again' } });
    applyCommand(store, reset, target);
    expect(hover(store, mainId)).toEqual({});
  });

  it('clears runs with text when resetting the text field', () => {
    const { store, mainId, captionId } = seeded();
    const target = { componentId: mainId, axis: 'state', value: 'hover', path: captionId };
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      ...target,
      override: { text: 'Hi', runs: [{ length: 2, style: BODY }], textStyle: { fontSize: 20 } },
    });
    applyCommand(store, mustFindCommand('resetVariantPreset'), { ...target, fields: ['text'] });
    expect(hover(store, mainId)?.[captionId]).toEqual({ textStyle: { fontSize: 20 } });
  });

  it('refuses non-mains, unknown axis values, outside paths and fields unsupported by the target', () => {
    const { store, mainId, noteId, boxId } = seeded();
    for (const name of ['setVariantPreset', 'resetVariantPreset']) {
      const command = mustFindCommand(name);
      const base = {
        componentId: mainId,
        axis: 'state',
        value: 'hover',
        path: noteId,
        ...(name === 'setVariantPreset' ? { override: { text: 'Hi' } } : {}),
      };
      expect(codesOf(expectRejected(store, command, { ...base, componentId: boxId }))).toEqual([
        'unsupported-type',
      ]);
      expect(codesOf(expectRejected(store, command, { ...base, axis: 'missing' }))).toEqual([
        'unknown-variant',
      ]);
      expect(codesOf(expectRejected(store, command, { ...base, value: 'missing' }))).toEqual([
        'unknown-variant',
      ]);
      expect(codesOf(expectRejected(store, command, { ...base, path: 'outside' }))).toEqual([
        'invalid-override-path',
      ]);
    }
    expect(
      codesOf(
        expectRejected(store, mustFindCommand('setVariantPreset'), {
          componentId: mainId,
          axis: 'state',
          value: 'hover',
          path: boxId,
          override: { color: [0, 1, 0, 1] },
        }),
      ),
    ).toEqual(['invalid-override']);
    expect(
      codesOf(
        expectRejected(store, mustFindCommand('resetVariantPreset'), {
          componentId: mainId,
          axis: 'state',
          value: 'hover',
          path: boxId,
          fields: ['color'],
        }),
      ),
    ).toEqual(['invalid-override']);
    expect(
      codesOf(
        expectRejected(store, mustFindCommand('setVariantPreset'), {
          componentId: mainId,
          axis: 'state',
          value: 'hover',
          path: noteId,
          override: { runs: [{ length: 2, style: BODY }] },
        }),
      ),
    ).toEqual(['invalid-override']);
  });

  it('makes each set and reset exactly one undo step', () => {
    const { store, mainId, noteId } = seeded();
    const target = { componentId: mainId, axis: 'state', value: 'hover', path: noteId };
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      ...target,
      override: { text: 'Hi' },
    });
    expect(history.undo()).toBe(true);
    expect(hover(store, mainId)).toEqual({});
    expect(history.canUndo()).toBe(false);
    history.destroy();
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      ...target,
      override: { text: 'Hi' },
    });
    const resetHistory = createHistory(store, ADA.principalId);
    applyCommand(store, mustFindCommand('resetVariantPreset'), target);
    expect(resetHistory.undo()).toBe(true);
    expect(hover(store, mainId)?.[noteId]).toEqual({ text: 'Hi' });
    expect(resetHistory.canUndo()).toBe(false);
    resetHistory.destroy();
  });
});
