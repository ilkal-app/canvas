import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createCanvasEventHub } from './canvas-events.js';

const A = 'a' as ObjectId;
const B = 'b' as ObjectId;
/** A change event's lists other than its objects, all empty. */
const NO_OTHER = { pages: [], tokens: [], textStyles: [], effectStyles: [] } as const;

describe('the SDK event hub', () => {
  it('sends each event to its type’s listeners until they stop listening', () => {
    const hub = createCanvasEventHub(vi.fn());
    const selections: unknown[] = [];
    const changes: unknown[] = [];
    const stop = hub.on('selection', (event) => selections.push(event.ids));
    hub.on('change', (event) => changes.push(event.origin));
    hub.emit('selection', { ids: [A] });
    stop();
    hub.emit('selection', { ids: [B] });
    hub.emit('change', { ...NO_OTHER, created: [], updated: [A], deleted: [], origin: 'agent' });
    expect(selections).toEqual([['a']]);
    expect(changes).toEqual(['agent']);
  });

  it('reports an error no listener takes, and a listener that throws, to the page', () => {
    const report = vi.fn();
    const hub = createCanvasEventHub(report);
    const failure = new Error('storage');
    hub.emit('error', { source: 'storage', error: failure });
    expect(report).toHaveBeenCalledWith(failure);
    const thrown = new Error('listener');
    const heard = vi.fn();
    hub.on('change', () => {
      throw thrown;
    });
    hub.on('change', heard);
    hub.emit('change', { ...NO_OTHER, created: [A], updated: [], deleted: [], origin: 'user' });
    expect(report).toHaveBeenLastCalledWith(thrown);
    expect(heard).toHaveBeenCalledOnce();
  });

  it('hands an error to its listeners instead of the page, and forgets them all when cleared', () => {
    const report = vi.fn();
    const hub = createCanvasEventHub(report);
    const heard = vi.fn();
    hub.on('error', heard);
    hub.emit('error', { source: 'engine', error: 'no GPU' });
    expect(heard).toHaveBeenCalledWith({ source: 'engine', error: 'no GPU' });
    expect(report).not.toHaveBeenCalled();
    hub.clear();
    hub.emit('error', { source: 'engine', error: 'again' });
    expect(heard).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('again');
  });
});
