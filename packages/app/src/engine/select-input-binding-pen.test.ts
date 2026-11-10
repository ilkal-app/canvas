// @vitest-environment jsdom
// A pen's pressure and the samples coalesced into a move, for the draw tool. In Chrome:
// tooling/scenario/specs/tools/draw.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bindSelectInput, type ScreenPointerInput } from './select-input-binding.js';

/**
 * A canvas at (100, 50) on the page, bound, recording its inputs without their timestamps.
 *
 * @returns The canvas and the inputs.
 */
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
  const timeStamps: (number | undefined)[] = [];
  bindSelectInput(canvas, (input) => {
    if (input.kind === 'pointerCancel' || input.kind === 'hold') return;
    // Timestamps are the events' own; the expectations compare the rest.
    const { timeStamp, ...rest } = input;
    timeStamps.push(timeStamp);
    inputs.push(rest);
  });
  return { canvas, inputs };
}

/**
 * A pointer event.
 *
 * @param type - The event type.
 * @param init - Its fields; a pen's, pointer 1, unless given.
 * @param coalesced - The events `getCoalescedEvents` returns, when it is to have that method.
 * @returns The event.
 */
function pointer(type: string, init: PointerEventInit, coalesced?: PointerEvent[]): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    pointerType: 'pen',
    pointerId: 1,
    ...init,
  });
  if (coalesced !== undefined) {
    Object.defineProperty(event, 'getCoalescedEvents', { value: () => coalesced });
  }
  return event;
}

/** A pen's fields, no modifier held. */
const PEN = { isShiftPressed: false, isModPressed: false, pointerType: 'pen' } as const;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('bindSelectInput: pressure and coalesced samples', () => {
  it('reports a pen’s pressure on its press, moves and release', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(
      pointer('pointerdown', { button: 0, clientX: 110, clientY: 60, pressure: 0.25 }),
    );
    canvas.dispatchEvent(pointer('pointermove', { clientX: 120, clientY: 60, pressure: 0.75 }));
    canvas.dispatchEvent(
      pointer('pointerup', { button: 0, clientX: 120, clientY: 60, pressure: 0 }),
    );
    expect(inputs).toEqual([
      { kind: 'pointerDown', screen: { x: 10, y: 10 }, ...PEN, pressure: 0.25 },
      { kind: 'pointerMove', screen: { x: 20, y: 10 }, ...PEN, pressure: 0.75 },
      { kind: 'pointerUp', screen: { x: 20, y: 10 }, ...PEN, pressure: 0 },
    ]);
  });

  it('reports a finger’s pressure only where the screen senses one, and never a mouse’s', () => {
    const { canvas, inputs } = setUp();
    const at = { button: 0, clientX: 110, clientY: 60 };
    canvas.dispatchEvent(pointer('pointerdown', { ...at, pointerType: 'touch', pressure: 0.5 }));
    canvas.dispatchEvent(pointer('pointerup', { ...at, pointerType: 'touch', pressure: 0 }));
    canvas.dispatchEvent(pointer('pointerdown', { ...at, pointerType: 'touch', pressure: 0.375 }));
    canvas.dispatchEvent(pointer('pointerup', { ...at, pointerType: 'touch', pressure: 1 }));
    canvas.dispatchEvent(pointer('pointerdown', { ...at, pointerType: 'mouse', pressure: 0.5 }));
    expect(inputs.map((input) => ('pressure' in input ? input.pressure : 'none'))).toEqual([
      'none',
      'none',
      0.375,
      'none',
      'none',
    ]);
  });

  it('reports every raw sample coalesced into a pressed move, the last included, as its trail', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(
      pointer('pointerdown', { button: 0, clientX: 110, clientY: 60, pressure: 0.25 }),
    );
    const samples = [
      pointer('pointermove', { clientX: 112, clientY: 61, pressure: 0.375 }),
      pointer('pointermove', { clientX: 115, clientY: 62, pressure: 0.5 }),
      pointer('pointermove', { clientX: 118, clientY: 63, pressure: 0.625 }),
    ];
    canvas.dispatchEvent(
      pointer('pointermove', { clientX: 118, clientY: 63, pressure: 0.625 }, samples),
    );
    expect(inputs[1]).toEqual({
      kind: 'pointerMove',
      screen: { x: 18, y: 13 },
      ...PEN,
      pressure: 0.625,
      trail: [
        { screen: { x: 12, y: 11 }, pressure: 0.375 },
        { screen: { x: 15, y: 12 }, pressure: 0.5 },
        { screen: { x: 18, y: 13 }, pressure: 0.625 },
      ],
    });
  });

  it('keeps the last raw sample where the aggregate move differs from it', () => {
    const { canvas, inputs } = setUp();
    canvas.dispatchEvent(
      pointer('pointerdown', { button: 0, clientX: 110, clientY: 60, pressure: 0.25 }),
    );
    const samples = [
      pointer('pointermove', { clientX: 112, clientY: 61, pressure: 0.375 }),
      pointer('pointermove', { clientX: 117, clientY: 64, pressure: 0.75 }),
    ];
    canvas.dispatchEvent(
      pointer('pointermove', { clientX: 118, clientY: 63, pressure: 0.625 }, samples),
    );
    expect(inputs[1]).toMatchObject({
      trail: [
        { screen: { x: 12, y: 11 }, pressure: 0.375 },
        { screen: { x: 17, y: 14 }, pressure: 0.75 },
      ],
    });
  });

  it('gives no trail for a hover or a browser without the method, and one sample as its trail', () => {
    const { canvas, inputs } = setUp();
    const self = pointer('pointermove', { clientX: 130, clientY: 70 });
    canvas.dispatchEvent(pointer('pointermove', { clientX: 130, clientY: 70 }, [self, self]));
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 110, clientY: 60 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 118, clientY: 63 }, [self]));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 120, clientY: 64 }));
    expect(inputs.map((input) => 'trail' in input)).toEqual([false, false, true, false]);
    expect(inputs[2]).toMatchObject({ trail: [{ screen: { x: 30, y: 20 } }] });
  });
});
