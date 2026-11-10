// Acceptance: the canvas preview draws the main as its geometry preset resolves it.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createComponentBoard, mustRun } from './__fixtures__/component-board.js';
import { presetPreviewObjects } from './preset-preview.js';

const ROW = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'fixed',
  height: 'fixed',
} as const;

describe('presetPreviewObjects with geometry', () => {
  it('moves and sizes a recorded child without changing the stored main', () => {
    const { store } = createComponentBoard();
    const before = store.get('body' as ObjectId);
    const { objects } = presetPreviewObjects(store, {
      body: { x: 25, y: 35, width: 90, height: 45 },
    });
    expect(objects.find(({ id }) => id === 'body')).toMatchObject({
      x: 25,
      y: 35,
      width: 90,
      height: 45,
    });
    expect(store.get('body' as ObjectId)).toEqual(before);
  });

  it('applies an auto-layout patch to its container', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'setAutoLayout', { ids: ['card'], autoLayout: ROW });
    const { objects } = presetPreviewObjects(store, {
      card: { autoLayout: { gap: 24, direction: 'column' } },
    });
    expect(objects.find(({ id }) => id === 'card')).toMatchObject({
      autoLayout: { ...ROW, gap: 24, direction: 'column' },
    });
    expect(store.get('card' as ObjectId)).toMatchObject({ autoLayout: ROW });
  });

  it('includes the root at variant size and maps unrecorded constrained children into it', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'setConstraints', { ids: ['body'], x: 'end', y: 'end' });
    const main = store.get('card' as ObjectId);
    const body = store.get('body' as ObjectId);
    expect(main).toMatchObject({ type: 'component' });
    expect(body).toMatchObject({ type: 'shape' });
    if (main?.type !== 'component' || body?.type !== 'shape') throw new Error('fixture changed');
    const { objects } = presetPreviewObjects(store, {
      card: { width: main.width + 60, height: main.height + 30 },
    });
    expect(objects.find(({ id }) => id === 'card')).toMatchObject({
      width: main.width + 60,
      height: main.height + 30,
    });
    expect(objects.find(({ id }) => id === 'body')).toMatchObject({
      x: body.x + 60,
      y: body.y + 30,
      width: body.width,
      height: body.height,
    });
    expect(store.get('body' as ObjectId)).toEqual(body);
  });

  it('keeps a hidden child out of a geometry preview', () => {
    const { store } = createComponentBoard();
    const preview = presetPreviewObjects(store, {
      card: { width: 400 },
      body: { x: 25, width: 90, isHidden: true },
    });
    expect(preview.objects.some(({ id }) => id === 'body')).toBe(false);
    expect(preview.hiddenIds).toContain('body');
  });
});
