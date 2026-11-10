import { describe, expect, it, vi } from 'vitest';

import type { NewObject } from '@canvas/document';
import type { ObjectId, Point } from '@canvas/schema';

import { PasteHandlerRegistry, type PasteItem, type PasteTarget } from './paste-handlers.js';

/**
 * A paste target that records what it is asked to create.
 *
 * @param pointer - The pointer on the board, if on the canvas.
 * @returns The target and the lists it created.
 */
function recordingTarget(pointer?: Point) {
  const created: (readonly NewObject[])[] = [];
  const target: PasteTarget = {
    pointer,
    viewCentre: { x: -100, y: -100 },
    notify: () => undefined,
    createObjects: (objects, onCreated) => {
      created.push(objects);
      onCreated?.(objects.map((object, index) => `new-${String(index)}` as ObjectId));
      return true;
    },
  };
  return { target, created };
}

const TEXT_ITEM: PasteItem = { kind: 'string', type: 'text/plain', data: 'hello' };
const HTML_ITEM: PasteItem = { kind: 'string', type: 'text/html', data: '<b>hello</b>' };

describe('PasteHandlerRegistry', () => {
  it('tries handlers from the highest priority down until one takes the paste', () => {
    const registry = new PasteHandlerRegistry();
    const calls: string[] = [];
    registry.register('text/plain', () => (calls.push('plain'), true));
    registry.register('text/html', () => (calls.push('html refuses'), false), { priority: 100 });
    registry.register('image/*', () => (calls.push('image'), true), { priority: 200 });
    expect(registry.dispatch([TEXT_ITEM, HTML_ITEM], recordingTarget().target)).toBe(true);
    expect(calls).toEqual(['html refuses', 'plain']);
  });

  it('matches a family such as image/*, and a type with parameters', () => {
    const registry = new PasteHandlerRegistry();
    const seen: string[] = [];
    registry.register('image/*', (item) => (seen.push(item.type), false));
    registry.register('text/plain', (item) => (seen.push(item.type), false));
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    registry.dispatch(
      [
        { kind: 'file', type: 'image/png', file },
        { kind: 'string', type: 'text/plain;charset=utf-8', data: 'x' },
        { kind: 'string', type: 'text/html', data: 'x' },
      ],
      recordingTarget().target,
    );
    expect(seen).toEqual(['image/png', 'text/plain;charset=utf-8']);
  });

  it('removes a handler again, and reports a paste nothing took', () => {
    const registry = new PasteHandlerRegistry();
    const handler = vi.fn(() => true);
    const remove = registry.register('text/plain', handler);
    remove();
    expect(registry.dispatch([TEXT_ITEM], recordingTarget().target)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});
