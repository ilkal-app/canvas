import { describe, expect, it } from 'vitest';

import type { LineObject, ObjectId } from '@canvas/schema';

import { onBoard, setUpTextDocument, TEXT_CAMERA } from '../__fixtures__/text-document.js';
import type { ScreenPointerInput } from '../select-input-binding.js';

// The line tool and a selected line's endpoint handles over the engine's document side, as the
// canvas drives them. Snapping is off (the document side's default until the shell
// passes the person's preferences), so the ends land where the pointer puts them. In Chrome:
// tooling/scenario/specs/tools/line.spec.ts.

/**
 * The document side with a pointer that drags in screen px (world units at this camera).
 *
 * @returns The fixture, a drag helper and a line reader.
 */
function setUp() {
  const fixture = setUpTextDocument();
  const send = (kind: ScreenPointerInput['kind'], x: number, y: number, isShiftPressed = false) => {
    if (kind === 'pointerCancel' || kind === 'hold' || kind === 'contextPress') return;
    fixture.document.handlePointer(
      { kind, screen: { x, y }, isShiftPressed, isModPressed: false, timeStamp: 0 },
      TEXT_CAMERA,
    );
  };
  const drag = (from: [number, number], to: [number, number], isShiftPressed = false) => {
    send('pointerDown', ...from, isShiftPressed);
    send('pointerMove', ...to, isShiftPressed);
    send('pointerUp', ...to, isShiftPressed);
  };
  const line = (id: string): LineObject | undefined => {
    const object = fixture.store.get(id as ObjectId);
    return object?.type === 'line' ? object : undefined;
  };
  return { ...fixture, drag, line };
}

describe('the line tool on the document side', () => {
  it('draws a line as one undo step, selects it and hands back to the select tool', () => {
    const { document, drag, line, history, onToolChange, store } = setUp();
    document.setActiveTool('line');
    expect(document.cursor()).toBe('crosshair');
    drag([500, 520], [600, 570]);
    // Drawn on a demo section, the line joins it (item 9): where it was drawn on the board.
    expect(onBoard(store, line('text-1'))).toEqual([500, 520]);
    expect(line('text-1')).toMatchObject({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
      endCap: 'none',
      route: 'straight',
    });
    expect(document.inspect().selectedIds).toEqual(['text-1']);
    expect(onToolChange).toHaveBeenLastCalledWith('select');
    history.undo();
    expect(line('text-1')).toBeUndefined();
  });

  it('shows the default cursor over a selected line’s end handle, not the rotate cursor', () => {
    const { document, drag } = setUp();
    document.setActiveTool('line');
    drag([500, 520], [600, 520]);
    // Just outside the end's corner, where the zero-height frame's rotation band (6 to 18 px out) also lies.
    document.handlePointer(
      {
        kind: 'pointerMove',
        screen: { x: 605, y: 525 },
        isShiftPressed: false,
        isModPressed: false,
      },
      TEXT_CAMERA,
    );
    expect(document.cursor()).toBe('default');
  });

  it('shows a selected line’s end handles instead of its frame, and drags an end', () => {
    const { document, drag, line, history, store } = setUp();
    document.setActiveTool('line');
    drag([500, 520], [600, 570]);
    const overlay = document.tools.overlay();
    expect(overlay.frame).toBeUndefined();
    expect(overlay.toolRects).toHaveLength(4);
    drag([600, 570], [650, 500]);
    expect(line('text-1')?.points[1]).toEqual({ x: 150, y: -20 });
    expect(onBoard(store, line('text-1'))).toEqual([500, 520]);
    history.undo();
    expect(line('text-1')?.points[1]).toEqual({ x: 100, y: 50 });
  });
});
