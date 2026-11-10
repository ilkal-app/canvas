// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalBoardConnection } from '../collab/local-board-connection.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import type { ShellAction } from '../state/shell-action.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import type { CanvasHarness, CanvasHarnessHost } from './canvas-harness.js';
import { useCanvasHarness, type ShellHarnessInputs } from './use-canvas-harness.js';

const REGISTRY = createDefaultShortcutRegistry('mac');
const PANELS = { styleContext: 'none', styleSectionIds: [] } as const;

interface HarnessedProps {
  readonly inputs: ShellHarnessInputs;
  readonly hasCanvas: boolean;
  readonly onDispatch: (dispatch: (action: ShellAction) => void) => void;
}

function Harnessed(props: HarnessedProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  props.onDispatch(useCanvasHarness(rootRef, props.inputs));
  return <div ref={rootRef}>{props.hasCanvas && <canvas width={40} height={20} />}</div>;
}

function renderHarnessed(overrides: Partial<ShellHarnessInputs> = {}, hasCanvas = true) {
  const reducerDispatch = vi.fn();
  const inputs: ShellHarnessInputs = {
    state: INITIAL_SHELL_STATE,
    dispatch: reducerDispatch,
    registry: REGISTRY,
    theme: { name: 'light', preference: 'system' },
    engineRef: { current: undefined },
    panels: PANELS,
    ...overrides,
  };
  let dispatch: (action: ShellAction) => void = () => undefined;
  const onDispatch = (latest: (action: ShellAction) => void): void => {
    dispatch = latest;
  };
  const view = render(<Harnessed inputs={inputs} hasCanvas={hasCanvas} onDispatch={onDispatch} />);
  const root = view.container.firstElementChild as CanvasHarnessHost;
  const harness = (): CanvasHarness => {
    if (root.canvasHarness === undefined) throw new Error('no harness attached');
    return root.canvasHarness;
  };
  return { view, root, harness, reducerDispatch, dispatch: () => dispatch, onDispatch };
}

afterEach(() => {
  cleanup();
});

describe('useCanvasHarness', () => {
  it('marks the root element and attaches the harness to it', () => {
    const { root } = renderHarnessed();
    expect(root.hasAttribute('data-canvas-harness')).toBe(true);
    expect(root.canvasHarness).toBeDefined();
  });

  it('reports the shell state, the shortcuts, the theme and the measured canvas', () => {
    const { harness } = renderHarnessed({ theme: { name: 'dark', preference: 'dark' } });
    const snapshot = harness().snapshot();
    expect(snapshot.shellState).toBe(INITIAL_SHELL_STATE);
    expect(snapshot.shortcutRegistry).toBe(REGISTRY);
    expect(snapshot.theme).toEqual({ name: 'dark', preference: 'dark' });
    expect(snapshot.canvas).toMatchObject({ widthPx: 40, heightPx: 20 });
    expect(snapshot.dispatchedActions).toEqual([]);
    expect(snapshot.panels).toEqual(PANELS);
  });

  it("reports the board connection's status and reads its objects", async () => {
    const connection = await createLocalBoardConnection('demo');
    const { harness } = renderHarnessed({ connection });
    expect(harness().snapshot().connection).toMatchObject({ state: 'offline', isLocalOnly: true });
    expect(harness().readObject('section-0')).toMatchObject({ id: 'section-0', type: 'frame' });
    expect(harness().readObject('no-such-object')).toBeUndefined();
    expect(harness().readObjects()).toHaveLength(connection.store.read().objects.size);
    connection.destroy();
  });

  it('reports no connection and reads no objects without a board connection', () => {
    const { harness } = renderHarnessed();
    expect(harness().snapshot().connection).toBeUndefined();
    expect(harness().readObject('section-0')).toBeUndefined();
    expect(harness().readObjects()).toEqual([]);
  });

  it('logs each dispatched action, oldest first, and passes it on to the reducer', () => {
    const { harness, reducerDispatch, dispatch } = renderHarnessed();
    const first: ShellAction = { type: 'selectTool', tool: 'pen' };
    const second: ShellAction = { type: 'history', command: 'undo' };
    act(() => {
      dispatch()(first);
      dispatch()(second);
    });
    expect(reducerDispatch.mock.calls).toEqual([[first], [second]]);
    expect(harness().snapshot().dispatchedActions).toEqual([first, second]);
  });

  it('reads the latest inputs after a re-render', () => {
    const { view, harness, onDispatch } = renderHarnessed();
    const state = { ...INITIAL_SHELL_STATE, activeTool: 'text' as const };
    view.rerender(
      <Harnessed
        inputs={{
          state,
          dispatch: vi.fn(),
          registry: REGISTRY,
          theme: { name: 'light', preference: 'light' },
          engineRef: { current: undefined },
          panels: { styleContext: 'shape', styleSectionIds: ['fill-stroke'] },
        }}
        hasCanvas
        onDispatch={onDispatch}
      />,
    );
    expect(harness().snapshot().shellState).toBe(state);
    expect(harness().snapshot().panels).toEqual({
      styleContext: 'shape',
      styleSectionIds: ['fill-stroke'],
    });
    expect(harness().snapshot().theme.preference).toBe('light');
  });

  it('reports no canvas and no camera, and refuses to read pixels, while none is mounted', async () => {
    const { harness } = renderHarnessed({}, false);
    expect(harness().snapshot().canvas).toBeUndefined();
    expect(harness().snapshot().camera).toBeUndefined();
    expect(harness().snapshot().document).toBeUndefined();
    await expect(harness().readPixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 })).rejects.toThrow(
      /no canvas/,
    );
  });

  it('refuses to read pixels from a canvas no engine draws', async () => {
    const { harness } = renderHarnessed();
    await expect(harness().readPixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 })).rejects.toThrow(
      /engine/,
    );
  });

  it('reports the engine camera and selection and reads pixels through the frame capture', async () => {
    const engine = new FakeMountedEngine(document.createElement('canvas'), {}, Promise.resolve());
    engine.currentCamera = { ...engine.currentCamera, x: 5, zoom: 2 };
    const { harness } = renderHarnessed({ engineRef: { current: engine } });
    expect(harness().snapshot().camera).toMatchObject({ x: 5, zoom: 2 });
    expect(harness().snapshot().document).toBe(engine.inspection);
    const rect = { xPx: 1, yPx: 2, widthPx: 3, heightPx: 4 };
    expect((await harness().readPixels(rect)).rgba).toHaveLength(48);
    expect(engine.captures).toEqual([rect]);
  });

  it('removes the mark and the harness when the shell unmounts', () => {
    const { view, root } = renderHarnessed();
    view.unmount();
    expect(root.hasAttribute('data-canvas-harness')).toBe(false);
    expect('canvasHarness' in root).toBe(false);
  });

  it('measures the drawing buffer the engine last drew into, where it runs', () => {
    const engine = new FakeMountedEngine(document.createElement('canvas'), {}, Promise.resolve());
    engine.buffer = { widthPx: 1600, heightPx: 1200, dpr: 2 };
    const { harness } = renderHarnessed({ engineRef: { current: engine } });
    expect(harness().snapshot().canvas).toMatchObject({ widthPx: 1600, heightPx: 1200, dpr: 2 });
  });
});
