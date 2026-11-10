// @vitest-environment jsdom
// A tab whose size changes with nothing else changing (a renamed agent, edit buttons
// appearing, a font loading) is placed again, so it is not left clamped where it no longer fits.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MountedEngine } from '../engine/mounted-engine.js';
import { ToastRegionProvider } from '../feedback/toast-region.js';

import { createAgentBoard } from './__fixtures__/agent-board.js';
import { TraceSheets } from './trace-sheets.js';

/**
 * Holds page-frame callbacks so each test can advance exactly one frame.
 *
 * @returns The pending callbacks and request, cancellation and advance controls.
 */
function frameQueue() {
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  const request = vi.fn((callback: FrameRequestCallback): number => {
    const id = ++nextId;
    pending.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number): void => {
    pending.delete(id);
  });
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  return {
    pending,
    request,
    cancel,
    runOne: (): void => {
      const first = pending.entries().next().value;
      if (first === undefined) throw new Error('no animation frame was requested');
      const [id, callback] = first;
      pending.delete(id);
      act(() => {
        callback(0);
      });
    },
  };
}

/**
 * Renders a synced board with a movable fake camera and no agent sheet.
 *
 * @returns The board, frame controls and camera controls.
 * @throws {Error} When the trace sheet layer is missing.
 */
function setUp() {
  const frames = frameQueue();
  const board = createAgentBoard();
  let camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
  const cameraSpy = vi.fn(() => camera);
  const engine = { camera: cameraSpy, showTraceTint: vi.fn() } as unknown as MountedEngine;
  render(
    <TraceSheets
      connection={board.connection}
      engine={engine}
      canEdit
      themeName="dark"
      onNotice={vi.fn()}
    />,
    { wrapper: ToastRegionProvider },
  );
  const layer = screen.getByRole('status').parentElement;
  if (layer === null) throw new Error('no trace sheet layer');
  Object.defineProperties(layer, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  });
  act(() => {
    board.connection.set({ state: 'connected' });
  });
  return {
    board,
    frames,
    cameraSpy,
    moveCamera: (x: number): void => {
      camera = { ...camera, x };
    },
    openSheet: (): void => {
      act(() => {
        board.agentCreates([300]);
      });
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TraceSheets tab sizes', () => {
  it('places a tab again when its measured size changes and nothing else does', () => {
    const { frames, openSheet } = setUp();
    openSheet();
    frames.runOne();
    const tab = screen.getByRole('region', { name: 'Atlas’s trace sheet' });
    const transformWrites = vi.spyOn(tab.style, 'transform', 'set');
    frames.runOne();
    expect(transformWrites).not.toHaveBeenCalled();
    Object.defineProperty(tab, 'offsetWidth', { configurable: true, value: 320 });
    frames.runOne();
    expect(transformWrites).toHaveBeenCalledTimes(1);
    frames.runOne();
    expect(transformWrites).toHaveBeenCalledTimes(1);
  });
});
