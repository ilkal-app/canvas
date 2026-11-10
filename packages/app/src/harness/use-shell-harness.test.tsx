// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import type { ShellAction } from '../state/shell-action.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import type { ShellHarnessInputs } from './use-canvas-harness.js';
import type { useShellHarness } from './use-shell-harness.js';

type ShellHarnessHook = typeof useShellHarness;

function renderShellWith(useHarness: ShellHarnessHook) {
  const reducerDispatch = vi.fn();
  const inputs: ShellHarnessInputs = {
    state: INITIAL_SHELL_STATE,
    dispatch: reducerDispatch,
    registry: createDefaultShortcutRegistry('other'),
    theme: { name: 'light', preference: 'system' },
    engineRef: { current: undefined },
    panels: { styleContext: 'none', styleSectionIds: [] },
  };
  let dispatch: ((action: ShellAction) => void) | undefined;
  function Shell(): ReactElement {
    const rootRef = useRef<HTMLDivElement>(null);
    dispatch = useHarness(rootRef, inputs);
    return <div ref={rootRef} />;
  }
  const view = render(<Shell />);
  return { root: view.container.firstElementChild, dispatch, reducerDispatch };
}

async function loadGate() {
  vi.resetModules();
  return import('./use-shell-harness.js');
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('useShellHarness', () => {
  it('is off without VITE_CANVAS_HARNESS: the reducer dispatch, nothing attached', async () => {
    vi.stubEnv('VITE_CANVAS_HARNESS', '');
    const gate = await loadGate();
    expect(gate.isCanvasHarnessEnabled).toBe(false);
    const { root, dispatch, reducerDispatch } = renderShellWith(gate.useShellHarness);
    expect(dispatch).toBe(reducerDispatch);
    expect(root?.hasAttribute('data-canvas-harness')).toBe(false);
  });

  it('attaches the harness when VITE_CANVAS_HARNESS is 1', async () => {
    vi.stubEnv('VITE_CANVAS_HARNESS', '1');
    const gate = await loadGate();
    expect(gate.isCanvasHarnessEnabled).toBe(true);
    const { root, dispatch, reducerDispatch } = renderShellWith(gate.useShellHarness);
    expect(dispatch).not.toBe(reducerDispatch);
    expect(root?.hasAttribute('data-canvas-harness')).toBe(true);
  });
});
