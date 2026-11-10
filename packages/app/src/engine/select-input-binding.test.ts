// @vitest-environment jsdom
// Real primary-button drags in Chrome, captured past the canvas's edge: tooling/scenario/specs/tools/select.spec.ts.
// Touch, the long-press timer and the secondary click: select-input-binding-touch.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  const captured: number[] = [];
  Object.assign(canvas, {
    setPointerCapture: (pointerId: number) => captured.push(pointerId),
  });
  const inputs: ScreenPointerInput[] = [];
  const timeStamps: number[] = [];
  const unbind = bindSelectInput(canvas, (input) => {
    // Timestamps are the events' own; the expectations compare the rest.
    if (input.kind === 'pointerCancel' || input.kind === 'hold') {
      inputs.push(input);
      return;
    }
    const { timeStamp, ...rest } = input;
    timeStamps.push(timeStamp ?? Number.NaN);
    inputs.push(rest);
  });
  return { canvas, inputs, unbind, captured, timeStamps };
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, pointerType: 'mouse', pointerId: 1, ...init });
}

/** A mouse's fields, no modifier held (the timestamp aside). */
const MOUSE = {
  isShiftPressed: false,
  isModPressed: false,
  pointerType: 'mouse',
} as const;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('bindSelectInput', () => {
  it('reports each event’s timestamp, for the select tool’s double presses', () => {
    const { canvas, timeStamps } = setUp();
    const down = pointer('pointerdown', { button: 0, clientX: 110, clientY: 60 });
    canvas.dispatchEvent(down);
    canvas.dispatchEvent(pointer('pointerup', { button: 0, clientX: 110, clientY: 60 }));
    expect(timeStamps).toHaveLength(2);
    expect(timeStamps[0]).toBe(down.timeStamp);
  });

  it('reports a primary-button drag in canvas CSS px and captures the pointer', () => {
    const { canvas, inputs, captured } = setUp();
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 110, clientY: 60 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 150, clientY: 80, shiftKey: true }));
    canvas.dispatchEvent(pointer('pointerup', { button: 0, clientX: 1000, clientY: 900 }));
    canvas.dispatchEvent(pointer('lostpointercapture', {}));
    expect(captured).toEqual([1]);
    expect(inputs).toEqual([
      { kind: 'pointerDown', screen: { x: 10, y: 10 }, ...MOUSE },
      { kind: 'pointerMove', screen: { x: 50, y: 30 }, ...MOUSE, isShiftPressed: true },
      { kind: 'pointerUp', screen: { x: 900, y: 850 }, ...MOUSE },
    ]);
  });

  it('reports mod held for either ⌘ or Control', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, metaKey: true }));
    canvas.dispatchEvent(pointer('pointermove', { ctrlKey: true }));
    canvas.dispatchEvent(pointer('pointerup', { button: 0 }));
    expect(inputs.map((input) => 'isModPressed' in input && input.isModPressed)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('reports Alt (Option on a Mac) as the snap modifier, and not Control', () => {
    const suspended = (init: PointerEventInit) => {
      const { canvas, inputs } = setUp();
      canvas.dispatchEvent(pointer('pointerdown', { button: 0 }));
      canvas.dispatchEvent(pointer('pointermove', init));
      const [, move] = inputs;
      return move !== undefined && 'isModPressed' in move && move.isSnapSuspended === true;
    };
    expect(suspended({ altKey: true })).toBe(true);
    expect(suspended({ ctrlKey: true })).toBe(false);
    expect(suspended({})).toBe(false);
  });

  it('takes the drag step again where the pointer stands when Alt or Shift changes mid-drag', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 110, clientY: 60 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 150, clientY: 80 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(inputs.slice(2)).toEqual([
      {
        kind: 'pointerMove',
        screen: { x: 50, y: 30 },
        ...MOUSE,
        isSnapSuspended: true,
      },
      { kind: 'pointerMove', screen: { x: 50, y: 30 }, ...MOUSE },
    ]);
    canvas.dispatchEvent(pointer('pointerup', { button: 0, clientX: 150, clientY: 80 }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }));
    expect(inputs).toHaveLength(5);
  });

  it('reports mouse and pen hovering as moves with no press, for the cursor; not touch', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(pointer('pointermove', { clientX: 150, clientY: 80, shiftKey: true }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 120, clientY: 70, pointerType: 'pen' }));
    canvas.dispatchEvent(
      pointer('pointermove', { clientX: 130, clientY: 70, pointerType: 'touch' }),
    );
    expect(inputs).toEqual([
      { kind: 'pointerMove', screen: { x: 50, y: 30 }, ...MOUSE, isShiftPressed: true },
      { kind: 'pointerMove', screen: { x: 20, y: 20 }, ...MOUSE, pointerType: 'pen' },
    ]);
  });

  it('ignores other buttons and a second pointer', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(pointer('pointerdown', { button: 1 }));
    canvas.dispatchEvent(pointer('pointerdown', { button: 0 }));
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, pointerId: 2 }));
    canvas.dispatchEvent(pointer('pointermove', { pointerId: 2 }));
    canvas.dispatchEvent(pointer('pointerup', { button: 0, pointerId: 2 }));
    canvas.dispatchEvent(pointer('pointerup', { button: 2 }));
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown']);
  });

  it('reports a cancelled pointer or a lost capture mid-press as pointerCancel, once', () => {
    for (const type of ['pointercancel', 'lostpointercapture']) {
      const { canvas, inputs, unbind } = setUp();
      canvas.dispatchEvent(pointer('pointerdown', { button: 0 }));
      canvas.dispatchEvent(pointer(type, { buttons: 1 }));
      canvas.dispatchEvent(pointer(type, { buttons: 1 }));
      canvas.dispatchEvent(pointer('pointerup', { button: 0 }));
      expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'pointerCancel']);
      unbind();
    }
  });

  it('finishes once when Chrome loses capture with the mouse released before pointerup', () => {
    const { canvas, inputs, timeStamps } = setUp();
    // The owner's Chrome/Mac mouse trace, last held move then release ordering.
    canvas.dispatchEvent(
      pointer('pointerdown', {
        button: 0,
        buttons: 1,
        clientX: 1069.66015625,
        clientY: 564.10546875,
      }),
    );
    canvas.dispatchEvent(
      pointer('pointermove', {
        button: -1,
        buttons: 1,
        clientX: 1034.16015625,
        clientY: 620.26953125,
      }),
    );
    const release = { button: -1, buttons: 0, clientX: 1032.828125, clientY: 621.58984375 };
    const lost = pointer('lostpointercapture', release);
    canvas.dispatchEvent(lost);
    canvas.dispatchEvent(pointer('pointermove', release));
    canvas.dispatchEvent(pointer('pointerup', { ...release, button: 0 }));
    canvas.dispatchEvent(pointer('lostpointercapture', release));
    expect(inputs.map(({ kind }) => kind)).toEqual([
      'pointerDown',
      'pointerMove',
      'pointerUp',
      'pointerMove',
    ]);
    expect(inputs[2]).toEqual({
      kind: 'pointerUp',
      screen: { x: 932.828125, y: 571.58984375 },
      ...MOUSE,
    });
    expect(timeStamps[2]).toBe(lost.timeStamp);
  });

  it.each(['mouse', 'pen', 'touch'])(
    'still cancels %s pointercancel with no buttons down',
    (pointerType) => {
      const { canvas, inputs } = setUp();
      canvas.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, pointerType }));
      canvas.dispatchEvent(pointer('pointercancel', { buttons: 0, pointerType }));
      canvas.dispatchEvent(pointer('lostpointercapture', { buttons: 0, pointerType }));
      canvas.dispatchEvent(pointer('pointerup', { button: 0, pointerType }));
      expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'pointerCancel']);
    },
  );

  it('stops listening once unbound', () => {
    const { canvas, inputs, unbind } = setUp();
    unbind();
    canvas.dispatchEvent(pointer('pointerdown', { button: 0 }));
    expect(inputs).toEqual([]);
  });

  it.each(['pen', 'touch'])('cancels %s capture loss even with no buttons down', (pointerType) => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, pointerType }));
    canvas.dispatchEvent(pointer('lostpointercapture', { buttons: 0, pointerType }));
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'pointerCancel']);
  });

  it('ignores another pointer losing capture with no buttons down', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1 }));
    canvas.dispatchEvent(pointer('lostpointercapture', { pointerId: 2, buttons: 0 }));
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown']);
    canvas.dispatchEvent(pointer('pointerup', { button: 0 }));
    expect(inputs.map(({ kind }) => kind)).toEqual(['pointerDown', 'pointerUp']);
  });
});
