// @vitest-environment jsdom
// Real wheel, pinch, touch and middle-button input in Chrome: tooling/scenario/specs/tools/camera.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CameraInput } from '@canvas/tools';

import { bindCameraInput } from './camera-input-binding.js';

function setUp() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 50,
    width: 800,
    height: 600,
  } as DOMRect);
  const captured: number[] = [];
  Object.assign(canvas, {
    setPointerCapture: (pointerId: number) => captured.push(pointerId),
  });
  const inputs: CameraInput[] = [];
  const unbind = bindCameraInput(canvas, (input) => inputs.push(input));
  return { canvas, inputs, unbind, captured };
}

/**
 * A Safari gesture event (`GestureEvent`, which jsdom and lib.dom lack): `scale` is the pinch's
 * scale since `gesturestart`.
 *
 * @param type - `gesturestart`, `gesturechange` or `gestureend`.
 * @param scale - The cumulative scale.
 * @returns The event, cancelable.
 */
function gesture(type: string, scale: number): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    scale,
    clientX: 160,
    clientY: 110,
  });
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('bindCameraInput', () => {
  it('turns a wheel event into wheel input at the cursor, in CSS px, and keeps it from the page', () => {
    const { canvas, inputs } = setUp();
    const event = new WheelEvent('wheel', {
      clientX: 130,
      clientY: 90,
      deltaX: 2,
      deltaY: 3,
      deltaMode: 1,
      ctrlKey: true,
      cancelable: true,
    });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(inputs).toEqual([
      {
        kind: 'wheel',
        point: { x: 30, y: 40 },
        deltaXPx: 32,
        deltaYPx: 48,
        isZoomModifierPressed: true,
      },
    ]);
  });

  it('counts ⌘ as the zoom modifier and a plain wheel as a scroll', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, metaKey: true }));
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
    expect(inputs.map((input) => input.kind === 'wheel' && input.isZoomModifierPressed)).toEqual([
      true,
      false,
    ]);
  });

  it('turns two touch points into drag and pinch input', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(
      pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 150 }),
    );
    canvas.dispatchEvent(
      pointer('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 150 }),
    );
    canvas.dispatchEvent(
      pointer('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 150 }),
    );
    expect(inputs).toEqual([
      { kind: 'drag', deltaXPx: 50, deltaYPx: 0 },
      { kind: 'pinch', center: { x: 200, y: 100 }, scale: 2 },
    ]);
    canvas.dispatchEvent(pointer('pointerup', { pointerId: 2, pointerType: 'touch' }));
    canvas.dispatchEvent(
      pointer('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }),
    );
    expect(inputs).toHaveLength(2);
  });

  it('forgets a cancelled touch', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(
      pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }),
    );
    canvas.dispatchEvent(
      pointer('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 0 }),
    );
    canvas.dispatchEvent(pointer('pointercancel', { pointerId: 1, pointerType: 'touch' }));
    canvas.dispatchEvent(
      pointer('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 50, clientY: 0 }),
    );
    expect(inputs).toEqual([]);
  });

  it('pans with a middle-button drag, capturing the pointer, and stops on release', () => {
    const { canvas, inputs, captured } = setUp();
    const down = pointer('pointerdown', {
      pointerId: 7,
      pointerType: 'mouse',
      button: 1,
      clientX: 110,
      clientY: 60,
    });
    canvas.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(captured).toEqual([7]);
    canvas.dispatchEvent(
      pointer('pointermove', { pointerId: 7, pointerType: 'mouse', clientX: 130, clientY: 55 }),
    );
    canvas.dispatchEvent(pointer('pointerup', { pointerId: 7, pointerType: 'mouse', button: 1 }));
    canvas.dispatchEvent(
      pointer('pointermove', { pointerId: 7, pointerType: 'mouse', clientX: 500, clientY: 500 }),
    );
    expect(inputs).toEqual([{ kind: 'drag', deltaXPx: 20, deltaYPx: -5 }]);
  });

  it('ends a middle-button drag when the pointer capture is lost', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(
      pointer('pointerdown', {
        pointerId: 7,
        pointerType: 'mouse',
        button: 1,
        clientX: 110,
        clientY: 60,
      }),
    );
    canvas.dispatchEvent(pointer('lostpointercapture', { pointerId: 7, pointerType: 'mouse' }));
    canvas.dispatchEvent(
      pointer('pointermove', { pointerId: 7, pointerType: 'mouse', clientX: 130, clientY: 55 }),
    );
    expect(inputs).toEqual([]);
  });

  it('leaves primary-button mouse input to the tools', () => {
    const { canvas, inputs } = setUp();
    const down = pointer('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    canvas.dispatchEvent(down);
    canvas.dispatchEvent(
      pointer('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 50, clientY: 0 }),
    );
    expect(down.defaultPrevented).toBe(false);
    expect(inputs).toEqual([]);
  });

  it('keeps the middle button from starting the browser autoscroll', () => {
    const { canvas } = setUp();
    const middle = new MouseEvent('mousedown', { button: 1, cancelable: true });
    const primary = new MouseEvent('mousedown', { button: 0, cancelable: true });
    canvas.dispatchEvent(middle);
    canvas.dispatchEvent(primary);
    expect([middle.defaultPrevented, primary.defaultPrevented]).toEqual([true, false]);
  });

  it('stops listening when unbound', () => {
    // Safari has GestureEvent; any value stands in for it.
    vi.stubGlobal('GestureEvent', Event);
    const { canvas, inputs, unbind } = setUp();
    unbind();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
    canvas.dispatchEvent(gesture('gesturechange', 2));
    vi.unstubAllGlobals();
    expect(inputs).toEqual([]);
  });

  it('turns a Safari trackpad pinch into pinch steps about the cursor, keeping the page still', () => {
    // Safari has GestureEvent; any value stands in for it.
    vi.stubGlobal('GestureEvent', Event);
    const { canvas, inputs } = setUp();
    const events = [
      gesture('gesturestart', 1),
      gesture('gesturechange', 1.5),
      gesture('gesturechange', 3),
      gesture('gestureend', 3),
    ];
    for (const event of events) canvas.dispatchEvent(event);
    expect(events.every((event) => event.defaultPrevented)).toBe(true);
    expect(inputs).toEqual([
      { kind: 'pinch', center: { x: 60, y: 60 }, scale: 1.5 },
      { kind: 'pinch', center: { x: 60, y: 60 }, scale: 2 },
    ]);
    vi.unstubAllGlobals();
  });

  it('leaves a Safari gesture to the touch pointers when two fingers are down (iOS)', () => {
    // Safari has GestureEvent; any value stands in for it.
    vi.stubGlobal('GestureEvent', Event);
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(
      pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 50 }),
    );
    canvas.dispatchEvent(
      pointer('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 50 }),
    );
    canvas.dispatchEvent(gesture('gesturestart', 1));
    const change = gesture('gesturechange', 2);
    canvas.dispatchEvent(change);
    expect(change.defaultPrevented).toBe(true);
    expect(inputs).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('listens for no gesture events where the browser has none', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(gesture('gesturestart', 1));
    canvas.dispatchEvent(gesture('gesturechange', 2));
    expect(inputs).toEqual([]);
  });
});
