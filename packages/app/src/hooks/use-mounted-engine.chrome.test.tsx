// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { WhiteboardChrome } from '../shell/whiteboard-chrome.js';

import { useMountedEngine } from './use-mounted-engine.js';

afterEach(() => {
  cleanup();
});

/**
 * Renders the hook over fake mounts with a chrome the test changes.
 *
 * @param chrome - The first chrome, or none.
 * @returns The hook and the engines it mounted.
 */
function renderWithChrome(chrome: WhiteboardChrome | undefined) {
  const { mount, engines } = createFakeMount();
  const hook = renderHook(
    ({ whiteboardChrome }: { readonly whiteboardChrome: WhiteboardChrome | undefined }) =>
      useMountedEngine({
        mount,
        lastCanvasAction: undefined,
        hostCallbacks: {},
        onError: vi.fn(),
        ...(whiteboardChrome === undefined ? {} : { whiteboardChrome }),
      }),
    { initialProps: { whiteboardChrome: chrome } },
  );
  return { hook, engines };
}

it('mounts with the floating chrome and leaves the classic mount’s options as they were', () => {
  const floating = renderWithChrome('floating');
  floating.hook.result.current.onCanvasReady(document.createElement('canvas'));
  expect(floating.engines[0]?.options.whiteboardChrome).toBe('floating');
  expect(floating.engines[0]?.chromes).toEqual(['floating']);
  cleanup();
  const classic = renderWithChrome(undefined);
  classic.hook.result.current.onCanvasReady(document.createElement('canvas'));
  expect(classic.engines[0]?.options).not.toHaveProperty('whiteboardChrome');
  expect(classic.engines[0]?.chromes).toEqual(['classic']);
});

it('tells the mounted engine when the chrome changes, without a remount', () => {
  const { hook, engines } = renderWithChrome('classic');
  hook.result.current.onCanvasReady(document.createElement('canvas'));
  hook.rerender({ whiteboardChrome: 'floating' });
  hook.rerender({ whiteboardChrome: 'classic' });
  expect(engines).toHaveLength(1);
  expect(engines[0]?.chromes).toEqual(['classic', 'floating', 'classic']);
});
