// @vitest-environment jsdom
// Space-drag in Chrome: tooling/scenario/specs/app/dock-hand.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CameraInput } from '@canvas/tools';

import { bindSpacePan } from './space-pan-binding.js';

function setUp() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  Object.assign(canvas, { setPointerCapture: vi.fn() });
  const inputs: CameraInput[] = [];
  const later = vi.fn();
  const unbind = bindSpacePan(
    canvas,
    (event) => ({ x: event.clientX - 10, y: event.clientY - 20 }),
    (input) => inputs.push(input),
  );
  // A tool's listener, added after the binding, as the select tool's is.
  canvas.addEventListener('pointerdown', later);
  canvas.addEventListener('pointermove', later);
  return { canvas, inputs, later, unbind };
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init });
}

function key(type: 'keydown' | 'keyup', target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent(type, { key: ' ', bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('bindSpacePan', () => {
  it('pans by a primary drag while Space is held, and keeps the drag from the tools', () => {
    const { canvas, inputs, later } = setUp();
    expect(key('keydown').defaultPrevented).toBe(true);
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 110, clientY: 120 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 140, clientY: 100 }));
    canvas.dispatchEvent(pointer('pointerup', { clientX: 140, clientY: 100 }));
    expect(inputs).toEqual([{ kind: 'drag', deltaXPx: 30, deltaYPx: -20 }]);
    expect(later).not.toHaveBeenCalled();
  });

  it('leaves the primary button to the tools once Space is let go, or the window blurs', () => {
    const { canvas, inputs, later } = setUp();
    key('keydown');
    key('keyup');
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 110, clientY: 120 }));
    key('keydown');
    window.dispatchEvent(new Event('blur'));
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 110, clientY: 120 }));
    expect(inputs).toEqual([]);
    expect(later).toHaveBeenCalledTimes(2);
  });

  it('ignores Space typed in a field or pressing a button, and a touch', () => {
    const { canvas, inputs } = setUp();
    const field = document.createElement('textarea');
    const button = document.createElement('button');
    document.body.append(field, button);
    expect(key('keydown', field).defaultPrevented).toBe(false);
    expect(key('keydown', button).defaultPrevented).toBe(false);
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 110, clientY: 120 }));
    key('keydown');
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, pointerType: 'touch' }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 200 }));
    expect(inputs).toEqual([]);
  });

  it('stops listening when unbound', () => {
    const { canvas, inputs, unbind } = setUp();
    unbind();
    key('keydown');
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 110, clientY: 120 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 140, clientY: 100 }));
    expect(inputs).toEqual([]);
  });
});
