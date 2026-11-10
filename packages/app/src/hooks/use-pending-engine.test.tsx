// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { useMountedEngine } from './use-mounted-engine.js';

afterEach(cleanup);

function pending() {
  let resolve: (engine: MountedEngine) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const ready = new Promise<MountedEngine>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { ready, resolve, reject, destroy: vi.fn(), resize: vi.fn() };
}

it('keeps the canvas without an editable engine until the pending handoff resolves', async () => {
  const session = pending();
  const { mount, engines } = createFakeMount();
  const startEngine = vi.fn(() => session);
  const hook = renderHook(() =>
    useMountedEngine({
      mount,
      startEngine,
      hostCallbacks: {},
      lastCanvasAction: undefined,
      onError: vi.fn(),
      canEdit: false,
    }),
  );
  const canvas = document.createElement('canvas');
  let release: ReturnType<typeof hook.result.current.onCanvasReady>;
  act(() => {
    release = hook.result.current.onCanvasReady(canvas);
  });
  expect(engines).toHaveLength(0);
  expect(hook.result.current.engine).toBeUndefined();
  expect(startEngine).toHaveBeenCalledWith(
    canvas,
    expect.objectContaining({
      initialViewPreferences: {
        isGridVisible: false,
        isSnappingOn: true,
        shouldDeleteConnectors: false,
      },
    }),
  );
  const size = { cssWidthPx: 30, cssHeightPx: 20, widthPx: 60, heightPx: 40, dpr: 2 };
  hook.result.current.onCanvasResize(size);
  expect(session.resize).toHaveBeenCalledWith(size);
  const live = mount(canvas, {});
  await act(async () => {
    session.resolve(live);
    await session.ready;
  });
  expect(hook.result.current.engine).toBe(live);
  expect(engines[0]?.editable).toEqual([false]);
  act(() => {
    if (typeof release === 'function') release();
  });
  expect(session.destroy).toHaveBeenCalledOnce();
  expect(hook.result.current.engine).toBeUndefined();
});

it('destroys a late result after unmount without publishing its board', async () => {
  const session = pending();
  const { mount } = createFakeMount();
  const onError = vi.fn();
  const hook = renderHook(() =>
    useMountedEngine({
      mount,
      startEngine: () => session,
      hostCallbacks: {},
      lastCanvasAction: undefined,
      onError,
    }),
  );
  const canvas = document.createElement('canvas');
  let release: ReturnType<typeof hook.result.current.onCanvasReady>;
  act(() => {
    release = hook.result.current.onCanvasReady(canvas);
  });
  act(() => {
    if (typeof release === 'function') release();
  });
  const live = mount(canvas, {});
  const destroy = vi.spyOn(live, 'destroy');
  await act(async () => {
    session.resolve(live);
    await session.ready;
  });
  expect(destroy).toHaveBeenCalledOnce();
  expect(hook.result.current.engine).toBeUndefined();
  expect(onError).not.toHaveBeenCalled();
});

it('reports an active startup failure but suppresses the cancellation rejection', async () => {
  const sessions = [pending(), pending()];
  const { mount } = createFakeMount();
  const onError = vi.fn();
  let index = 0;
  const hook = renderHook(() =>
    useMountedEngine({
      mount,
      startEngine: () => {
        const session = sessions[index++];
        if (session === undefined) throw new Error('Missing session.');
        return session;
      },
      hostCallbacks: {},
      lastCanvasAction: undefined,
      onError,
    }),
  );
  const failure = new Error('Backend unavailable.');
  const canvas = document.createElement('canvas');
  let firstRelease: ReturnType<typeof hook.result.current.onCanvasReady>;
  let secondRelease: ReturnType<typeof hook.result.current.onCanvasReady>;
  act(() => {
    firstRelease = hook.result.current.onCanvasReady(canvas);
  });
  await act(async () => {
    sessions[0]?.reject(failure);
    await Promise.resolve();
  });
  expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  act(() => {
    if (typeof firstRelease === 'function') firstRelease();
    secondRelease = hook.result.current.onCanvasReady(canvas);
    if (typeof secondRelease === 'function') secondRelease();
  });
  await act(async () => {
    sessions[1]?.reject(new Error('Cancelled.'));
    await Promise.resolve();
  });
  expect(onError).toHaveBeenCalledOnce();
});
