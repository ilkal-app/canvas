// The inspector's variant-set actions run on a mounted board: each edit one command
// over the whole board, a refusal reported, and the preset preview drawing the main in a preset
// (hidden children out of the scene) and clearing, writing nothing.
import { describe, expect, it, vi } from 'vitest';

import type { SceneChangeSet } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { mustRun } from './__fixtures__/component-board.js';
import { mountComponentBoard } from './__fixtures__/mounted-component-board.js';

const AXES = [{ name: 'state', values: ['rest', 'hover'] }];

/**
 * A mounted card board with a `state` axis.
 *
 * @returns The mounted board.
 */
function mounted() {
  const board = mountComponentBoard();
  mustRun(board.store, 'setVariantAxes', { componentId: 'card', axes: AXES });
  return board;
}

describe('variant actions', () => {
  it('sets axes, presets and an instance’s choice, each one undo step', () => {
    const board = mounted();
    const hover = { id: 'card' as ObjectId, axis: 'state', value: 'hover' };
    board.component({
      command: 'setVariantAxes',
      id: 'card' as ObjectId,
      axes: [{ name: 'mode', values: ['rest', 'hover'] }],
      renames: { axes: [{ from: 'state', to: 'mode' }] },
    });
    expect(board.store.get('card' as ObjectId)).toMatchObject({
      variantAxes: [{ name: 'mode', values: ['rest', 'hover'] }],
    });
    board.component({
      command: 'setVariantAxes',
      id: 'card' as ObjectId,
      axes: AXES,
      renames: { axes: [{ from: 'mode', to: 'state' }], values: [] },
    });
    board.component({ command: 'setPreset', ...hover, path: 'body', override: { isHidden: true } });
    expect(board.store.get('card' as ObjectId)).toMatchObject({
      variantPresets: { 'state=hover': { body: { isHidden: true } } },
    });
    board.component({ command: 'setVariant', id: 'inst' as ObjectId, variant: { state: 'hover' } });
    expect(board.instance().variant).toEqual({ state: 'hover' });
    board.component({ command: 'resetPreset', ...hover, path: 'body', fields: ['isHidden'] });
    board.component({ command: 'resetPreset', ...hover });
    expect(board.store.get('card' as ObjectId)).toMatchObject({
      variantPresets: { 'state=hover': {} },
    });
    board.history.undo();
    board.history.undo();
    expect(board.store.get('card' as ObjectId)).toMatchObject({
      variantPresets: { 'state=hover': { body: { isHidden: true } } },
    });
    board.component({ command: 'setVariantAxes', id: 'card' as ObjectId, axes: null });
    const main = board.store.get('card' as ObjectId);
    expect(main?.type === 'component' ? main.variantAxes : 'not a main').toBeUndefined();
  });

  it('reports a refused variant command and writes nothing', () => {
    const board = mounted();
    board.component({ command: 'setVariant', id: 'inst' as ObjectId, variant: { state: 'gone' } });
    expect(board.instance().variant).toBeUndefined();
    expect(board.onNotice).toHaveBeenCalled();
  });

  it('previews the main in a preset, hidden children out of the scene, and clears it', () => {
    const board = mounted();
    mustRun(board.store, 'setVariantPreset', {
      componentId: 'card',
      axis: 'state',
      value: 'hover',
      path: 'body',
      override: { isHidden: true },
    });
    mustRun(board.store, 'setVariantPreset', {
      componentId: 'card',
      axis: 'state',
      value: 'hover',
      path: 'title',
      override: { text: 'Hover' },
    });
    const enqueue = vi.fn<(changes: SceneChangeSet) => void>();
    board.document.attach({ enqueue, showOverlay: () => undefined });
    enqueue.mockClear();
    const before = board.store.encodeState();
    expect(
      board.component({
        command: 'previewPreset',
        id: 'card' as ObjectId,
        axis: 'state',
        value: 'hover',
      }),
    ).toBe(true);
    const shown = enqueue.mock.calls.map(([changes]) => changes);
    expect(shown.some((changes) => changes.deleted.includes('body' as ObjectId))).toBe(true);
    const title = shown.find((changes) => changes.updated.includes('title' as ObjectId));
    expect(title?.get('title' as ObjectId)).toMatchObject({ text: 'Hover' });
    enqueue.mockClear();
    board.component({ command: 'previewPreset', id: 'card' as ObjectId });
    const cleared = enqueue.mock.calls.map(([changes]) => changes);
    expect(cleared.some((changes) => changes.created.includes('body' as ObjectId))).toBe(true);
    expect(board.store.encodeState()).toEqual(before);
  });

  it('previews nothing for a main that is not on the page, or a value without a preset', () => {
    const board = mounted();
    const enqueue = vi.fn<(changes: SceneChangeSet) => void>();
    board.document.attach({ enqueue, showOverlay: () => undefined });
    enqueue.mockClear();
    board.component({ command: 'previewPreset', id: 'gone' as ObjectId, axis: 'a', value: 'b' });
    board.component({ command: 'previewPreset', id: 'card' as ObjectId, axis: 'x', value: 'y' });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
