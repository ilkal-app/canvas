import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { CanvasAction } from '../state/shell-action.js';

import { cameraInputForCanvasAction } from './canvas-action-input.js';

describe('cameraInputForCanvasAction', () => {
  it('turns the zoom commands into keyboard zoom input', () => {
    for (const command of [
      'zoomIn',
      'zoomOut',
      'zoomToActualSize',
      'zoomToFit',
      'zoomToSelection',
    ] as const) {
      expect(cameraInputForCanvasAction({ type: 'navigate', command })).toEqual({
        kind: 'keyZoom',
        command,
      });
    }
  });

  it('pans the view with a nudge, every nudge until selection exists', () => {
    expect(cameraInputForCanvasAction({ type: 'nudge', direction: 'left', isLarge: true })).toEqual(
      { kind: 'keyPan', direction: 'left', isLarge: true },
    );
  });

  it('pans the view as a drag by the minimap’s pan', () => {
    expect(cameraInputForCanvasAction({ type: 'panCamera', deltaXPx: 12, deltaYPx: -3 })).toEqual({
      kind: 'drag',
      deltaXPx: 12,
      deltaYPx: -3,
    });
  });

  it('zooms about a point as a pinch there, by the zoom control’s presets and the map', () => {
    expect(
      cameraInputForCanvasAction({ type: 'zoomCamera', centerXPx: 4, centerYPx: 5, scale: 2 }),
    ).toEqual({ kind: 'pinch', center: { x: 4, y: 5 }, scale: 2 });
  });

  it('frames the rectangle of a frame action', () => {
    const bounds = { minX: 1, minY: 2, maxX: 30, maxY: 40 };
    expect(cameraInputForCanvasAction({ type: 'frame', bounds })).toEqual({
      kind: 'frame',
      bounds,
    });
  });

  it('zooms to the main the inspector went to (ruling 5)', () => {
    const goToMain: CanvasAction = {
      type: 'component',
      command: 'goToMain',
      id: 'card' as ObjectId,
    };
    expect(cameraInputForCanvasAction(goToMain)).toEqual({
      kind: 'keyZoom',
      command: 'zoomToSelection',
    });
  });

  it('leaves the other canvas actions to their owners', () => {
    const others: CanvasAction[] = [
      { type: 'navigate', command: 'toggleGrid' },
      { type: 'navigate', command: 'toggleSnapping' },
      { type: 'navigate', command: 'toggleMinimap' },
      { type: 'selection', command: 'selectAll' },
      { type: 'arrange', command: 'group' },
      { type: 'history', command: 'undo' },
      { type: 'component', command: 'detach', id: 'inst' as ObjectId },
    ];
    for (const action of others) expect(cameraInputForCanvasAction(action)).toBeUndefined();
  });
});
