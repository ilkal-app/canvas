// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
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

describe('TraceSheets idle placement', () => {
  it('requests no frames and never reads the camera with no sheet open', () => {
    const { frames, cameraSpy } = setUp();
    expect(screen.queryByRole('region')).toBeNull();
    expect(frames.pending.size).toBe(0);
    expect(frames.request).not.toHaveBeenCalled();
    expect(cameraSpy).not.toHaveBeenCalled();
  });

  it('places an opened sheet and follows a moving camera on the next frame', () => {
    const { frames, moveCamera, openSheet } = setUp();
    openSheet();
    expect(frames.pending.size).toBeGreaterThan(0);
    frames.runOne();
    const tab = screen.getByRole('region', { name: 'Atlas’s trace sheet' });
    expect(['true', 'docked']).toContain(tab.dataset.placed);
    expect(tab.style.transform).toMatch(/^translate\(/);
    const firstTransform = tab.style.transform;
    moveCamera(100);
    frames.runOne();
    expect(tab.style.transform).not.toBe(firstTransform);
    expect(frames.pending.size).toBeGreaterThan(0);
  });

  it('does not rewrite a placed tab when camera, sheet and layer are unchanged', () => {
    const { frames, openSheet } = setUp();
    openSheet();
    frames.runOne();
    const tab = screen.getByRole('region', { name: 'Atlas’s trace sheet' });
    const transform = tab.style.transform;
    const transformWrites = vi.spyOn(tab.style, 'transform', 'set');
    frames.runOne();
    frames.runOne();
    expect(tab.style.transform).toBe(transform);
    expect(transformWrites).not.toHaveBeenCalled();
  });

  it('cancels the pending frame when Keep sheet closes the last sheet', () => {
    const { frames, openSheet } = setUp();
    openSheet();
    frames.runOne();
    expect(frames.pending.size).toBeGreaterThan(0);
    const pendingId = frames.pending.keys().next().value;
    act(() => {
      screen.getByRole('button', { name: 'Keep sheet' }).click();
    });
    expect(screen.queryByRole('region')).toBeNull();
    expect(frames.cancel).toHaveBeenCalledWith(pendingId);
    expect(frames.pending.size).toBe(0);
    const requests = frames.request.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(frames.request).toHaveBeenCalledTimes(requests);
  });

  it('starts requesting frames again when a new sheet opens after Keep', () => {
    const { board, frames, openSheet } = setUp();
    openSheet();
    frames.runOne();
    act(() => {
      screen.getByRole('button', { name: 'Keep sheet' }).click();
    });
    const requestsAfterClose = frames.request.mock.calls.length;
    act(() => {
      board.agentCreates([500]);
    });
    expect(frames.request.mock.calls.length).toBeGreaterThan(requestsAfterClose);
    expect(frames.pending.size).toBeGreaterThan(0);
    frames.runOne();
    const tab = screen.getByRole('region', { name: 'Atlas’s trace sheet' });
    expect(tab.dataset.placed).toBe('true');
    expect(within(tab).getByText('1 object so far · on its own sheet')).toBeTruthy();
  });
});
