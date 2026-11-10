// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { storeRunState } from '@canvas/document';

import { createLocalBoardConnection } from '../collab/local-board-connection.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import type { CanvasHarnessHost } from './canvas-harness.js';
import { useCanvasHarness, type ShellHarnessInputs } from './use-canvas-harness.js';

function Harnessed(props: { readonly inputs: ShellHarnessInputs }): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  useCanvasHarness(rootRef, props.inputs);
  return <div ref={rootRef} />;
}

function harnessInputs(inputs: Partial<ShellHarnessInputs>): ShellHarnessInputs {
  return {
    state: INITIAL_SHELL_STATE,
    dispatch: vi.fn(),
    registry: createDefaultShortcutRegistry('other'),
    theme: { name: 'light', preference: 'light' },
    engineRef: { current: undefined },
    panels: { styleContext: 'none', styleSectionIds: [] },
    ...inputs,
  };
}

function harnessFor(inputs: Partial<ShellHarnessInputs>) {
  const view = render(<Harnessed inputs={harnessInputs(inputs)} />);
  const host = view.container.firstElementChild as CanvasHarnessHost;
  if (host.canvasHarness === undefined) throw new Error('missing harness');
  return { harness: host.canvasHarness, view };
}

afterEach(cleanup);

it('opens, progresses, and ends a store run through the harness', async () => {
  const connection = await createLocalBoardConnection('busy-harness', {
    openCache: () => Promise.resolve(undefined),
  });
  const { harness } = harnessFor({ connection });
  harness.beginStoreRun();
  expect(storeRunState(connection.store)).toEqual({ progress: undefined });
  expect(() => {
    harness.beginStoreRun();
  }).toThrow();
  harness.reportStoreRunProgress(2, 4);
  expect(storeRunState(connection.store)).toEqual({ progress: { done: 2, total: 4 } });
  harness.endStoreRun();
  harness.endStoreRun();
  expect(storeRunState(connection.store)).toBeUndefined();
  connection.destroy();
});

it('refuses begin without a connection and tolerates end without a run', () => {
  const { harness } = harnessFor({});
  expect(() => {
    harness.beginStoreRun();
  }).toThrow();
  expect(() => {
    harness.endStoreRun();
  }).not.toThrow();
});

it('closes the harness-held run when its component unmounts', async () => {
  const connection = await createLocalBoardConnection('busy-harness-unmount', {
    openCache: () => Promise.resolve(undefined),
  });
  const { harness, view } = harnessFor({ connection });
  harness.beginStoreRun();
  expect(storeRunState(connection.store)).toEqual({ progress: undefined });

  view.unmount();
  expect(storeRunState(connection.store)).toBeUndefined();
  connection.destroy();
});

it('closes the old connection run when the harness receives a new connection', async () => {
  const oldConnection = await createLocalBoardConnection('busy-harness-old', {
    openCache: () => Promise.resolve(undefined),
  });
  const newConnection = await createLocalBoardConnection('busy-harness-new', {
    openCache: () => Promise.resolve(undefined),
  });
  const { harness, view } = harnessFor({ connection: oldConnection });
  harness.beginStoreRun();
  expect(storeRunState(oldConnection.store)).toEqual({ progress: undefined });

  view.rerender(<Harnessed inputs={harnessInputs({ connection: newConnection })} />);
  expect(storeRunState(oldConnection.store)).toBeUndefined();
  expect(storeRunState(newConnection.store)).toBeUndefined();
  oldConnection.destroy();
  newConnection.destroy();
});
