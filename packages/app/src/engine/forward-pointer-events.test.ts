// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import type { PointerInput } from '@canvas/engine';

import { forwardPointerEvents } from './forward-pointer-events.js';

// A canvas placed at (10, 20) on the page.
function placedCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
  document.body.append(canvas);
  return canvas;
}

function pointerEvent(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, ...init });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('forwardPointerEvents', () => {
  it('forwards presses, moves, releases and cancels in canvas CSS px with their timestamps', () => {
    const canvas = placedCanvas();
    const inputs: PointerInput[] = [];
    forwardPointerEvents(canvas, { pointer: (input) => inputs.push(input) });
    const events = [
      pointerEvent('pointerdown', { clientX: 15, clientY: 25, buttons: 1, pointerId: 3 }),
      pointerEvent('pointermove', { clientX: 16, clientY: 27, buttons: 1, pointerId: 3 }),
      pointerEvent('pointerup', { clientX: 16, clientY: 27, pointerId: 3 }),
      pointerEvent('pointercancel', { pointerId: 4 }),
    ];
    for (const event of events) canvas.dispatchEvent(event);
    expect(
      inputs.map(({ type, xPx, yPx, buttons, pointerId }) => [type, xPx, yPx, buttons, pointerId]),
    ).toEqual([
      ['down', 5, 5, 1, 3],
      ['move', 6, 7, 1, 3],
      ['up', 6, 7, 0, 3],
      ['cancel', -10, -20, 0, 4],
    ]);
    expect(inputs.map(({ timestampMs }) => timestampMs)).toEqual(
      events.map(({ timeStamp }) => timeStamp),
    );
  });

  it('forwards each coalesced event of a move, with its own time', () => {
    const canvas = placedCanvas();
    const inputs: PointerInput[] = [];
    forwardPointerEvents(canvas, { pointer: (input) => inputs.push(input) });
    const move = pointerEvent('pointermove', { clientX: 30, clientY: 30 });
    const coalesced = [
      pointerEvent('pointermove', { clientX: 12, clientY: 22 }),
      pointerEvent('pointermove', { clientX: 14, clientY: 24 }),
    ];
    Object.defineProperty(move, 'getCoalescedEvents', { value: () => coalesced });
    canvas.dispatchEvent(move);
    expect(inputs.map(({ xPx }) => xPx)).toEqual([2, 4]);
  });

  it('stops forwarding when told to', () => {
    const canvas = placedCanvas();
    const inputs: PointerInput[] = [];
    const stop = forwardPointerEvents(canvas, { pointer: (input) => inputs.push(input) });
    stop();
    canvas.dispatchEvent(pointerEvent('pointerdown', {}));
    expect(inputs).toEqual([]);
  });
});
