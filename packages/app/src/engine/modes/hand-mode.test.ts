// The hand tool's registration: its mode pans the view through the services. A drag in
// Chrome: tooling/scenario/specs/app/dock-hand.spec.ts.
import { describe, expect, it, vi } from 'vitest';

import { HandMode } from '@canvas/tools';

import { toolModeEntry } from './hand-mode.js';
import type { ToolModeServices } from './tool-mode-entry.js';

function pointer(kind: 'pointerDown' | 'pointerMove', x: number, y: number) {
  const point = { x, y };
  return { kind, screen: point, world: point, isShiftPressed: false, isModPressed: false, zoom: 1 };
}

describe('the hand tool’s mode', () => {
  it('pans the view by the drag, through the services', () => {
    const panView = vi.fn();
    const mode = toolModeEntry.create({ panView } as unknown as ToolModeServices);
    expect(mode).toBeInstanceOf(HandMode);
    expect(toolModeEntry.tool).toBe('hand');
    mode.onPointer(pointer('pointerDown', 10, 10));
    mode.onPointer(pointer('pointerMove', 25, 4));
    expect(panView).toHaveBeenCalledExactlyOnceWith(15, -6);
  });

  it('does nothing where there is no view to pan', () => {
    const mode = toolModeEntry.create({} as unknown as ToolModeServices);
    mode.onPointer(pointer('pointerDown', 10, 10));
    expect(() => mode.onPointer(pointer('pointerMove', 25, 4))).not.toThrow();
  });
});
