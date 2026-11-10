// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolId } from '@canvas/tools';

import type { CanvasBackingSize } from '../canvas/backing-store-size.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { RecordedCanvasAction } from '../state/shell-reducer.js';

import { useMountedEngine, type MountedEngineBinding } from './use-mounted-engine.js';

const SIZE: CanvasBackingSize = {
  cssWidthPx: 300,
  cssHeightPx: 200,
  widthPx: 600,
  heightPx: 400,
  dpr: 2,
};

afterEach(() => {
  cleanup();
});

/** What the hook under test is rendered with. */
interface HookProps {
  readonly action: RecordedCanvasAction | undefined;
  readonly tool?: ToolId;
  readonly isMeasuringFrames?: boolean;
}

function renderBinding(hostReady?: (canvas: HTMLCanvasElement) => () => void) {
  const { mount, engines } = createFakeMount();
  const onCanvasResize = vi.fn();
  const onError = vi.fn();
  const onNotice = vi.fn();
  const onToolChange = vi.fn();
  const onTextStyleChange = vi.fn();
  const onCameraInput = vi.fn();
  const hook = renderHook<MountedEngineBinding, HookProps>(
    ({ action, tool = 'select', isMeasuringFrames = false }) =>
      useMountedEngine({
        mount,
        lastCanvasAction: action,
        hostCallbacks:
          hostReady === undefined
            ? { onCanvasResize }
            : { onCanvasResize, onCanvasReady: hostReady },
        onError,
        activeTool: tool,
        isMeasuringFrames,
        onNotice,
        onToolChange,
        onTextStyleChange,
        onCameraInput,
      }),
    { initialProps: { action: undefined } },
  );
  return {
    hook,
    engines,
    onCanvasResize,
    onError,
    onNotice,
    onToolChange,
    onTextStyleChange,
    onCameraInput,
  };
}

describe('useMountedEngine', () => {
  it('hands the engine an onNotice that reaches the latest callback', () => {
    const { mount, engines } = createFakeMount();
    const first = vi.fn();
    const latest = vi.fn();
    const hook = renderHook(
      ({ onNotice }: { onNotice: (message: string) => void }) =>
        useMountedEngine({
          mount,
          lastCanvasAction: undefined,
          hostCallbacks: {},
          onError: vi.fn(),
          onNotice,
        }),
      { initialProps: { onNotice: first } },
    );
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    hook.rerender({ onNotice: latest });
    engines[0]?.options.onNotice?.('Finish the drag, then paste.');
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith('Finish the drag, then paste.');
  });

  it('holds the mounted engine as state until it unmounts', () => {
    const { hook, engines } = renderBinding();
    expect(hook.result.current.engine).toBeUndefined();
    let release: ReturnType<MountedEngineBinding['onCanvasReady']>;
    act(() => {
      release = hook.result.current.onCanvasReady(document.createElement('canvas'));
    });
    expect(hook.result.current.engine).toBe(engines[0]);
    act(() => {
      if (typeof release === 'function') release();
    });
    expect(hook.result.current.engine).toBeUndefined();
  });

  it('keeps a newer engine as state when an older one is released', () => {
    const { hook, engines } = renderBinding();
    let release: ReturnType<MountedEngineBinding['onCanvasReady']>;
    act(() => {
      release = hook.result.current.onCanvasReady(document.createElement('canvas'));
      hook.result.current.onCanvasReady(document.createElement('canvas'));
    });
    act(() => {
      if (typeof release === 'function') release();
    });
    expect(hook.result.current.engine).toBe(engines[1]);
  });

  it('mounts with the size the canvas reported before it was ready', () => {
    const { hook, engines, onCanvasResize } = renderBinding();
    act(() => {
      hook.result.current.onCanvasResize(SIZE);
    });
    expect(onCanvasResize).toHaveBeenCalledWith(SIZE);
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    expect(engines[0]?.options.viewport).toEqual(SIZE);
    expect(hook.result.current.engineRef.current).toBe(engines[0]);
  });

  it('resizes the mounted engine and still tells the host', () => {
    const { hook, engines, onCanvasResize } = renderBinding();
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    hook.result.current.onCanvasResize(SIZE);
    expect(engines[0]?.sizes).toEqual([SIZE]);
    expect(onCanvasResize).toHaveBeenCalledWith(SIZE);
  });

  it('runs the host callback with the engine and releases both, keeping a newer engine', () => {
    const releaseHost = vi.fn();
    const { hook, engines } = renderBinding(() => releaseHost);
    const release = hook.result.current.onCanvasReady(document.createElement('canvas'));
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    if (typeof release === 'function') release();
    expect(releaseHost).toHaveBeenCalledTimes(1);
    expect(engines[0]?.isDestroyed).toBe(true);
    expect(hook.result.current.engineRef.current).toBe(engines[1]);
  });

  it('tells the engine the active tool when it mounts and whenever it changes', () => {
    const { hook, engines } = renderBinding();
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    expect(engines[0]?.activeTools).toEqual(['select']);
    hook.rerender({ action: undefined, tool: 'pen' });
    expect(engines[0]?.activeTools).toEqual(['select', 'pen']);
  });

  it('hands each new canvas action to the engine once', () => {
    const { hook, engines } = renderBinding();
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    const zoomIn: RecordedCanvasAction = {
      action: { type: 'navigate', command: 'zoomIn' },
      sequence: 1,
    };
    hook.rerender({ action: zoomIn });
    hook.rerender({ action: { ...zoomIn } });
    hook.rerender({ action: { action: { type: 'history', command: 'undo' }, sequence: 2 } });
    expect(engines[0]?.actions).toEqual([
      { type: 'navigate', command: 'zoomIn' },
      { type: 'history', command: 'undo' },
    ]);
  });

  it('steps through the pages for the previous and next page, never handing them to the engine', () => {
    const { hook, engines } = renderBinding();
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    const next: RecordedCanvasAction = {
      action: { type: 'navigate', command: 'nextPage' },
      sequence: 1,
    };
    hook.rerender({ action: next });
    const step = vi.fn();
    Object.assign(engines[0] ?? {}, { pages: { step } });
    hook.rerender({ action: { ...next, sequence: 2 } });
    hook.rerender({
      action: { action: { type: 'navigate', command: 'previousPage' }, sequence: 3 },
    });
    expect(step.mock.calls).toEqual([[1], [-1]]);
    expect(engines[0]?.actions).toEqual([]);
  });

  it('reads no frame times before an engine mounts', () => {
    const { hook, engines } = renderBinding();
    expect(hook.result.current.readFrameTimesMs()).toEqual([]);
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    if (engines[0] !== undefined) engines[0].recentFrameTimesMs = [4, 5];
    expect(hook.result.current.readFrameTimesMs()).toEqual([4, 5]);
  });

  it("hands the engine's faults to the shell's error handler", () => {
    const { hook, engines, onError } = renderBinding();
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    const fault = new Error('the worker crashed');
    engines[0]?.options.onFault?.(fault);
    expect(onError).toHaveBeenCalledWith(fault);
  });

  it("hands the engine's notices to the shell's status line", () => {
    const { hook, engines, onNotice } = renderBinding();
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    engines[0]?.options.onNotice?.('Nothing to ungroup: select a group.');
    expect(onNotice).toHaveBeenCalledWith('Nothing to ungroup: select a group.');
  });

  it('records frame statistics while asked, on the engine mounted now and on a later one', async () => {
    const { hook, engines } = renderBinding();
    await expect(hook.result.current.readFrameStats()).rejects.toThrow(/No engine/);
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    hook.rerender({ action: undefined, isMeasuringFrames: true });
    expect(engines[0]?.isMeasuringFrames).toBe(true);
    await expect(hook.result.current.readFrameStats()).rejects.toThrow(/No frame statistics/);
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    expect(engines[1]?.isMeasuringFrames).toBe(true);
    hook.rerender({ action: undefined, isMeasuringFrames: false });
    expect(engines[1]?.isMeasuringFrames).toBe(false);
  });

  it('passes the tool the canvas made active on to the shell', () => {
    const { hook, engines, onToolChange } = renderBinding();
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    engines[0]?.options.onToolChange?.('select');
    expect(onToolChange).toHaveBeenCalledWith('select');
  });

  it('passes the text style the engine reports on to the shell', () => {
    const { hook, engines, onTextStyleChange } = renderBinding();
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    const context = { style: { weight: 700 }, align: 'left', isEditing: false } as const;
    engines[0]?.options.onTextStyleChange?.(context);
    expect(onTextStyleChange).toHaveBeenCalledWith(context);
  });

  it("passes the person's own camera moves on to the shell", () => {
    const { hook, engines, onCameraInput } = renderBinding();
    hook.result.current.onCanvasReady(document.createElement('canvas'));
    engines[0]?.options.onCameraInput?.();
    expect(onCameraInput).toHaveBeenCalledOnce();
  });
});
