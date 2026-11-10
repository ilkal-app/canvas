import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createComponentBoard, mustRun } from './__fixtures__/component-board.js';
import { presetPreviewObjects } from './preset-preview.js';

// The Variants section's preset preview: each child a preset changes, drawn with its
// record, and each it hides, taken out of the scene with everything in it; nothing is written.

describe('presetPreviewObjects', () => {
  it('applies a record to the child at its path, writing nothing', () => {
    const { store } = createComponentBoard();
    const { objects, hiddenIds } = presetPreviewObjects(store, { title: { text: 'Hover' } });
    expect(objects.find(({ id }) => id === 'title')).toMatchObject({ text: 'Hover' });
    expect(hiddenIds).toEqual([]);
    expect(store.get('title' as ObjectId)).not.toMatchObject({ text: 'Hover' });
  });

  it('merges a nested path into the nested instance’s own records', () => {
    const { store } = createComponentBoard();
    const { objects } = presetPreviewObjects(store, {
      'badge-in-card/dot': { fill: [0, 1, 0, 1] },
    });
    expect(objects[0]).toMatchObject({
      id: 'badge-in-card',
      overrides: { dot: { fill: [0, 1, 0, 1] } },
    });
  });

  it('skips a path that addresses nothing', () => {
    const { store } = createComponentBoard();
    expect(presetPreviewObjects(store, { gone: { isHidden: true } })).toEqual({
      objects: [],
      hiddenIds: [],
    });
  });

  it('hides any child, a text or a nested instance alike, drawing nothing of it', () => {
    const { store } = createComponentBoard();
    const preview = presetPreviewObjects(store, {
      title: { isHidden: true, text: 'Hover' },
      'badge-in-card': { isHidden: true },
    });
    expect(preview).toEqual({ objects: [], hiddenIds: ['title', 'badge-in-card'] });
  });

  it('hides a container with everything in it', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'group', { ids: ['title', 'body'], groupId: 'pair' });
    const { hiddenIds } = presetPreviewObjects(store, { pair: { isHidden: true } });
    expect([...hiddenIds].sort()).toEqual(['body', 'pair', 'title']);
  });
});
