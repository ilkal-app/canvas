// @vitest-environment jsdom
// A components panel row dragged onto the canvas (ruling 3): the drop names the main.
import { describe, expect, it } from 'vitest';

import { bindComponentDrop, COMPONENT_DRAG_TYPE } from './component-drop.js';

/**
 * Sends a drag event whose data transfer has the given types and data.
 *
 * @param target - Where it goes.
 * @param type - `dragover` or `drop`.
 * @param data - The transfer's data by type.
 * @returns The event, after dispatch.
 */
function drag(target: EventTarget, type: string, data: Record<string, string>): DragEvent {
  const event = new Event(type, { cancelable: true });
  const dataTransfer = {
    types: Object.keys(data),
    getData: (format: string) => data[format] ?? '',
    dropEffect: 'none',
  };
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: 30 },
    clientY: { value: 40 },
  });
  target.dispatchEvent(event);
  return event as DragEvent;
}

describe('bindComponentDrop', () => {
  it('takes a dragged main at the drop’s point, and leaves other drags alone', () => {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
    const drops: [string, { x: number; y: number }][] = [];
    const unbind = bindComponentDrop(canvas, (id, at) => drops.push([id, at]));
    const over = drag(canvas, 'dragover', { [COMPONENT_DRAG_TYPE]: '' });
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer?.dropEffect).toBe('copy');
    expect(drag(canvas, 'dragover', { 'text/plain': 'x' }).defaultPrevented).toBe(false);
    expect(drag(canvas, 'drop', { Files: '' }).defaultPrevented).toBe(false);
    drag(canvas, 'drop', { [COMPONENT_DRAG_TYPE]: '' });
    drag(canvas, 'drop', { [COMPONENT_DRAG_TYPE]: 'card' });
    expect(drops).toEqual([['card', { x: 20, y: 20 }]]);
    unbind();
    drag(canvas, 'drop', { [COMPONENT_DRAG_TYPE]: 'card' });
    expect(drops).toHaveLength(1);
  });

  it('refuses a main while it may not be dropped (a viewer)', () => {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    const drops: string[] = [];
    bindComponentDrop(
      canvas,
      (id) => drops.push(id),
      () => false,
    );
    expect(drag(canvas, 'dragover', { [COMPONENT_DRAG_TYPE]: '' }).dataTransfer?.dropEffect).toBe(
      'none',
    );
    expect(drag(canvas, 'drop', { [COMPONENT_DRAG_TYPE]: 'card' }).defaultPrevented).toBe(true);
    expect(drops).toEqual([]);
  });
});
