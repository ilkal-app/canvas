import type { RefObject } from 'react';

import type { ShellAction } from '../state/shell-action.js';

import { useCanvasHarness, type ShellHarnessInputs } from './use-canvas-harness.js';

/**
 * Whether this build exposes the scenario-test harness: only when built or served with the
 * environment variable `VITE_CANVAS_HARNESS=1`. Vite replaces the variable at build time, so
 * in any other build the harness code is dead and the bundler drops it.
 */
export const isCanvasHarnessEnabled = import.meta.env.VITE_CANVAS_HARNESS === '1';

/**
 * The shell without a harness: the reducer's own dispatch, nothing attached.
 *
 * @param rootRef - Unused; the harness would attach to it.
 * @param inputs - The shell's inputs, of which only the dispatch is used.
 * @returns The reducer's dispatch, unchanged.
 */
function useNoHarness(
  rootRef: RefObject<HTMLElement | null>,
  inputs: ShellHarnessInputs,
): (action: ShellAction) => void {
  return inputs.dispatch;
}

/**
 * The shell's hook for the scenario-test harness: {@link useCanvasHarness} when
 * {@link isCanvasHarnessEnabled}, otherwise a pass-through that returns the reducer's
 * dispatch. Chosen once, when the module loads, so the shell calls the same hook on every
 * render.
 */
export const useShellHarness: (
  rootRef: RefObject<HTMLElement | null>,
  inputs: ShellHarnessInputs,
) => (action: ShellAction) => void = isCanvasHarnessEnabled ? useCanvasHarness : useNoHarness;
