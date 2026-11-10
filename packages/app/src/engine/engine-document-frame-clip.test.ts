// Clicks and marquees over a clipping frame's hidden overflow: the select tool reads
// the document hit index, whose boxes and hits follow the clip, so what is hidden is not picked.
import { describe, expect, it } from 'vitest';

import { createHistory } from '@canvas/document';
import type { Camera } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument } from './engine-document.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

const SHARED = {
  rotation: 0,
  locked: false,
  createdBy: 'user:test',
  createdAt: 1,
  updatedAt: 1,
};

/**
 * A frame over world x, y 100..300, clipping or not, and a child rectangle overflowing its right
 * edge: world x 250..350, y 120..170, of which x 250..300 shows when the frame clips.
 *
 * @param isClipping - Whether the frame clips.
 * @returns The objects.
 */
function board(isClipping: boolean): BoardObject[] {
  return [
    {
      ...SHARED,
      id: 'p' as ObjectId,
      parentId: null,
      x: 100,
      y: 100,
      z: 'a0',
      type: 'frame',
      width: 200,
      height: 200,
      name: 'Frame',
      clip: isClipping,
      background: [1, 1, 1, 1],
    },
    {
      ...SHARED,
      id: 's' as ObjectId,
      parentId: 'p' as ObjectId,
      x: 150,
      y: 20,
      z: 'a0',
      type: 'shape',
      kind: 'rectangle',
      width: 100,
      height: 50,
      stroke: null,
      fill: [1, 0, 0, 1],
      cornerRadius: 0,
      sides: 4,
      label: null,
    },
  ] as BoardObject[];
}

function setUp(isClipping: boolean) {
  const store = createDemoDocument(board(isClipping));
  const document = new EngineDocument({
    store,
    history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: () => undefined,
  });
  const press = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) => {
    document.handlePointer(
      { kind, screen: { x, y }, isShiftPressed: false, isModPressed: false },
      CAMERA,
    );
  };
  const click = (x: number, y: number): readonly ObjectId[] => {
    press('pointerDown', x, y);
    press('pointerUp', x, y);
    return document.inspect().selectedIds;
  };
  const marquee = (from: readonly [number, number], to: readonly [number, number]) => {
    press('pointerDown', from[0], from[1]);
    press('pointerMove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
    press('pointerMove', to[0], to[1]);
    press('pointerUp', to[0], to[1]);
    return document.inspect().selectedIds;
  };
  return { click, marquee };
}

describe('EngineDocument over a clipping frame', () => {
  it('selects a child by its visible part and nothing by its clipped-away overflow', () => {
    const { click } = setUp(true);
    // Unselected first: once selected, the selection's box (an overlay, never clipped) is a drag
    // handle like any selection's.
    expect(click(330, 145)).toEqual([]);
    expect(click(275, 145)).toEqual(['s']);
  });

  it('selects the overflow when the frame does not clip', () => {
    const { click } = setUp(false);
    expect(click(330, 145)).toEqual(['s']);
  });

  it('does not marquee-select a child by hidden overflow alone', () => {
    const covering = [
      [320, 90],
      [380, 200],
    ] as const;
    expect(setUp(true).marquee(...covering)).toEqual([]);
    expect(setUp(false).marquee(...covering)).toEqual(['s']);
  });
});
