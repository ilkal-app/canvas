// @vitest-environment jsdom
// Real touch in Chrome, through the DevTools protocol: tooling/scenario/specs/tools/touch.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LONG_PRESS_MS } from '@canvas/tools';

import { bindSelectInput, type ScreenPointerInput } from './select-input-binding.js';

function setUp() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 50,
    width: 800,
    height: 600,
  } as DOMRect);
  Object.assign(canvas, { setPointerCapture: () => undefined });
  const inputs: ScreenPointerInput[] = [];
  // jsdom stamps events with `Date.now()`, which the fake timers start at 1 000 ms and advance;
  // the page's `performance.now` shares the events' clock the same way.
  vi.setSystemTime(1_000);
  const unbind = bindSelectInput(canvas, (input) => inputs.push(input), {
    clock: () => Date.now(),
  });
  const advance = (ms: number) => {
    vi.advanceTimersByTime(ms);
  };
  return { canvas, inputs, unbind, advance };
}

function touch(type: string, pointerId: number, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId, ...init });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('bindSelectInput: touch', () => {
  it('reports a finger’s press, moves and release with its pointer type and timestamp', () => {
    const { canvas, inputs, advance } = setUp();
    canvas.dispatchEvent(touch('pointerdown', 7, { button: 0, clientX: 110, clientY: 60 }));
    advance(40);
    canvas.dispatchEvent(touch('pointermove', 7, { clientX: 130, clientY: 60 }));
    canvas.dispatchEvent(touch('pointerup', 7, { button: 0, clientX: 130, clientY: 60 }));
    expect(inputs).toEqual([
      {
        kind: 'pointerDown',
        screen: { x: 10, y: 10 },
        isShiftPressed: false,
        isModPressed: false,
        pointerType: 'touch',
        timeStamp: 1_000,
      },
      {
        kind: 'pointerMove',
        screen: { x: 30, y: 10 },
        isShiftPressed: false,
        isModPressed: false,
        pointerType: 'touch',
        timeStamp: 1_040,
      },
      {
        kind: 'pointerUp',
        screen: { x: 30, y: 10 },
        isShiftPressed: false,
        isModPressed: false,
        pointerType: 'touch',
        timeStamp: 1_040,
      },
    ]);
  });

  it('reports a hold once the finger has been down for the long-press delay', () => {
    const { canvas, inputs, advance } = setUp();
    canvas.dispatchEvent(touch('pointerdown', 7, { button: 0, clientX: 110, clientY: 60 }));
    canvas.dispatchEvent(touch('pointermove', 7, { clientX: 117.5, clientY: 60 }));
    advance(LONG_PRESS_MS - 1);
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'pointerMove']);
    advance(1);
    expect(inputs.at(-1)).toEqual({
      kind: 'hold',
      timeStamp: 1_000 + LONG_PRESS_MS,
      screen: { x: 17.5, y: 10 },
    });
  });

  it('sends no hold once the finger has wandered 8 px, even back to where it landed', () => {
    const { canvas, inputs, advance } = setUp();
    canvas.dispatchEvent(touch('pointerdown', 7, { button: 0, clientX: 110, clientY: 60 }));
    canvas.dispatchEvent(touch('pointermove', 7, { clientX: 110, clientY: 68 }));
    canvas.dispatchEvent(touch('pointermove', 7, { clientX: 110, clientY: 60 }));
    advance(LONG_PRESS_MS * 2);
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'pointerMove', 'pointerMove']);
  });

  it('ignores the rest of a finger once its hold is sent, and the next finger is the tool’s', () => {
    const { canvas, inputs, advance } = setUp();
    canvas.dispatchEvent(touch('pointerdown', 7, { button: 0 }));
    advance(LONG_PRESS_MS);
    canvas.dispatchEvent(touch('pointermove', 7, { clientX: 150 }));
    canvas.dispatchEvent(touch('pointerdown', 8, { button: 0 }));
    canvas.dispatchEvent(touch('pointerup', 8, { button: 0 }));
    canvas.dispatchEvent(touch('pointerup', 7, { button: 0, clientX: 150 }));
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'hold']);
    canvas.dispatchEvent(touch('pointerdown', 9, { button: 0 }));
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'hold', 'pointerDown']);
  });

  it('forgets a finger whose capture was lost, so the next finger is the tool’s', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(touch('pointerdown', 7, { button: 0 }));
    canvas.dispatchEvent(touch('lostpointercapture', 7));
    canvas.dispatchEvent(touch('pointerdown', 8, { button: 0 }));
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'pointerCancel', 'pointerDown']);
  });

  it('drops fingers left from a sequence whose lift it never saw when a primary lands', () => {
    const { canvas, inputs } = setUp();
    // Fingers 7 and 8 landed, and their lifts were lost (the page was hidden, say).
    canvas.dispatchEvent(touch('pointerdown', 7, { button: 0 }));
    canvas.dispatchEvent(touch('pointerdown', 8, { button: 0 }));
    canvas.dispatchEvent(touch('pointerdown', 9, { button: 0, isPrimary: true }));
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'pointerCancel', 'pointerDown']);
  });

  it('sends no hold after the finger lifted, nor for a mouse press', () => {
    const { canvas, inputs, advance } = setUp();
    canvas.dispatchEvent(touch('pointerdown', 7, { button: 0 }));
    canvas.dispatchEvent(touch('pointerup', 7, { button: 0 }));
    canvas.dispatchEvent(touch('pointerdown', 1, { button: 0, pointerType: 'mouse' }));
    advance(LONG_PRESS_MS * 2);
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'pointerUp', 'pointerDown']);
  });

  it('cancels the first finger’s press when a second lands, and ignores both after', () => {
    const { canvas, inputs, advance } = setUp();
    canvas.dispatchEvent(touch('pointerdown', 7, { button: 0 }));
    canvas.dispatchEvent(touch('pointermove', 7, { clientX: 150 }));
    canvas.dispatchEvent(touch('pointerdown', 8, { button: 0 }));
    canvas.dispatchEvent(touch('pointermove', 7, { clientX: 170 }));
    canvas.dispatchEvent(touch('pointerup', 8, { button: 0 }));
    canvas.dispatchEvent(touch('pointermove', 7, { clientX: 190 }));
    advance(LONG_PRESS_MS);
    canvas.dispatchEvent(touch('pointerup', 7, { button: 0 }));
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'pointerMove', 'pointerCancel']);
  });

  it('gives the tool a finger again once every finger has lifted', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(touch('pointerdown', 7, { button: 0 }));
    canvas.dispatchEvent(touch('pointerdown', 8, { button: 0 }));
    canvas.dispatchEvent(touch('pointerup', 7, { button: 0 }));
    canvas.dispatchEvent(touch('pointercancel', 8));
    canvas.dispatchEvent(touch('pointerdown', 9, { button: 0 }));
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'pointerCancel', 'pointerDown']);
  });

  it('turns a mouse’s secondary click into contextPress and keeps the browser’s menu away', () => {
    const { canvas, inputs } = setUp();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 300,
      clientY: 250,
    });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(inputs).toEqual([
      {
        kind: 'contextPress',
        screen: { x: 200, y: 200 },
        isShiftPressed: false,
        isModPressed: false,
        pointerType: 'mouse',
        timeStamp: 1_000,
      },
    ]);
  });

  it('leaves a finger’s long-press to the tool: the browser’s touch context menu is ignored', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(touch('pointerdown', 7, { button: 0 }));
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown']);
  });

  it('stops the hold timer once unbound', () => {
    const { canvas, inputs, unbind, advance } = setUp();
    canvas.dispatchEvent(touch('pointerdown', 7, { button: 0 }));
    unbind();
    advance(LONG_PRESS_MS);
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown']);
  });
});
