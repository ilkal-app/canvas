import { describe, expect, it, vi } from 'vitest';

import { HandMode } from './hand-mode.js';
import type { ToolMode, ToolPointerInput } from './tool-mode.js';

function pointer(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  x: number,
  y: number,
): ToolPointerInput {
  return {
    kind,
    screen: { x, y },
    world: { x: x * 2, y: y * 2 },
    isShiftPressed: false,
    isModPressed: false,
    zoom: 0.5,
  };
}

function setUp() {
  const pan = vi.fn<(deltaXPx: number, deltaYPx: number) => void>();
  return { pan, mode: new HandMode({ pan }) };
}

describe('HandMode', () => {
  it('pans by the pointer’s movement in CSS px while the primary button is down', () => {
    const { pan, mode } = setUp();
    expect(mode.id).toBe('hand');
    expect(mode.onPointer(pointer('pointerDown', 100, 100))).toEqual({ isDone: false });
    mode.onPointer(pointer('pointerMove', 130, 90));
    mode.onPointer(pointer('pointerMove', 130, 90));
    mode.onPointer(pointer('pointerMove', 120, 140));
    expect(mode.onPointer(pointer('pointerUp', 120, 140))).toEqual({ isDone: false });
    expect(pan.mock.calls).toEqual([
      [30, -10],
      [-10, 50],
    ]);
  });

  it('does nothing on a hover, and stops at a release or a cancel', () => {
    const { pan, mode } = setUp();
    mode.onPointer(pointer('pointerMove', 10, 10));
    mode.onPointer(pointer('pointerDown', 10, 10));
    mode.onPointer({ kind: 'pointerCancel' });
    mode.onPointer(pointer('pointerMove', 50, 50));
    mode.onPointer(pointer('pointerDown', 50, 50));
    mode.onPointer(pointer('pointerUp', 50, 50));
    mode.onPointer(pointer('pointerMove', 90, 90));
    expect(pan).not.toHaveBeenCalled();
  });

  it('shows an open hand, closed while it drags', () => {
    const { mode } = setUp();
    expect(mode.cursor).toBe('grab');
    mode.onPointer(pointer('pointerDown', 0, 0));
    expect(mode.cursor).toBe('grabbing');
    mode.exit();
    expect(mode.cursor).toBe('grab');
  });

  it('takes no key, shows nothing and ignores a secondary click and a held finger', () => {
    const { pan, mode } = setUp();
    const tool: ToolMode = mode;
    expect(tool.onKey({ kind: 'escape' })).toBe(false);
    expect(tool.onKey({ kind: 'nudge', direction: 'left', isLarge: false })).toBe(false);
    expect(mode.overlay()).toEqual({});
    mode.onPointer({
      kind: 'contextPress',
      screen: { x: 0, y: 0 },
      world: { x: 0, y: 0 },
      isShiftPressed: false,
      isModPressed: false,
      zoom: 1,
    });
    mode.onPointer({ kind: 'hold', timeStamp: 1, screen: { x: 0, y: 0 }, zoom: 1 });
    expect(mode.cursor).toBe('grab');
    expect(pan).not.toHaveBeenCalled();
  });
});
