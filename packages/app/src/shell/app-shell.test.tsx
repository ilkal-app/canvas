// @vitest-environment jsdom
// Real-browser scenarios (real key events per platform and layout, the cheat sheet's focus,
// the editable guard with IME input, the theme following the system): tooling/scenario/specs/app.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MemoryDocumentCache } from '@canvas/collab';
import type { BenchmarkSample } from '@canvas/engine';

import { MAX_PASTE_TEXT_LENGTH } from '../clipboard/clipboard-notice.js';
import type { BoardConnectionStatus } from '../collab/board-connection-status.js';
import type { BoardConnection } from '../collab/board-connection.js';
import { createLocalBoardConnection } from '../collab/local-board-connection.js';
import { DEVELOPER_OVERLAY_POLL_INTERVAL_MS } from '../diagnostics/developer-overlay.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import { THEMES } from '../theme/theme-tokens.js';

import { AppShell } from './app-shell.js';
import { preloadWorkspaceParts } from './lazy-workspace-parts.js';

function renderShell() {
  const onCanvasReady = vi.fn();
  const { mount, engines } = createFakeMount();
  // A design board, whose chrome is classic (D1).
  const view = render(
    <AppShell mode="diagram" platform="mac" onCanvasReady={onCanvasReady} mountEngine={mount} />,
  );
  const shellRoot = view.container.firstElementChild;
  if (!(shellRoot instanceof HTMLElement)) throw new Error('AppShell rendered no root element');
  return { onCanvasReady, shellRoot, engines, view };
}

function toolButton(label: string): HTMLElement {
  const tools = screen.getByRole('toolbar', { name: 'Tools' });
  return within(tools).getByRole('button', { name: new RegExp(label) });
}

function pressKey(target: Element, key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(target, { key, ...init });
}

/** A sample of no frames. */
const EMPTY_SAMPLE: BenchmarkSample = {
  frames: 0,
  runFrames: 0,
  stages: {},
  passes: {},
  passFrames: {},
  recentFrames: [],
  frameWorkMs: { p50: 0, p90: 0, p95: 0, max: 0 },
  memory: {} as BenchmarkSample['memory'],
  p50: {} as BenchmarkSample['p50'],
  p90: {} as BenchmarkSample['p90'],
  p95: {} as BenchmarkSample['p95'],
  max: {} as BenchmarkSample['max'],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// The style panel and the selection popover load apart from the first script.
beforeAll(preloadWorkspaceParts);

describe('AppShell', () => {
  it('lays out the toolbar, the canvas and the style panel', () => {
    const { onCanvasReady } = renderShell();
    expect(screen.getByRole('toolbar', { name: 'Tools' })).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('main', { name: 'Canvas' }).querySelector('canvas')).not.toBeNull();
    // With nothing selected the inspector drawer is closed: alt+8 opens it.
    fireEvent.keyDown(document.body, { key: '8', code: 'Digit8', altKey: true });
    expect(screen.getByRole('complementary', { name: 'Style' })).toBeInstanceOf(HTMLElement);
    expect(onCanvasReady).toHaveBeenCalledWith(expect.any(HTMLCanvasElement));
  });

  it('toggles the grid and snapping from their shortcuts, tells the engine and remembers them', () => {
    localStorage.clear();
    const { engines, view } = renderShell();
    const engine = engines[0];
    expect(engine?.viewPreferences.at(-1)).toEqual({
      isGridVisible: false,
      isSnappingOn: true,
      shouldDeleteConnectors: false,
    });
    // Mounting stores nothing: only a change is written.
    expect(localStorage.length).toBe(0);
    pressKey(document.body, "'", { metaKey: true });
    pressKey(document.body, "'", { metaKey: true, shiftKey: true });
    expect(engine?.viewPreferences.at(-1)).toEqual({
      isGridVisible: true,
      isSnappingOn: false,
      shouldDeleteConnectors: false,
    });
    view.unmount();
    const again = renderShell();
    expect(again.engines[0]?.viewPreferences[0]).toEqual({
      isGridVisible: true,
      isSnappingOn: false,
      shouldDeleteConnectors: false,
    });
    localStorage.clear();
  });

  it('starts with the select tool pressed', () => {
    renderShell();
    expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
  });

  it('selects the connector tool from its shortcut and its button', () => {
    const { engines } = renderShell();
    pressKey(document.body, 'c');
    expect(toolButton('Connector').getAttribute('aria-disabled')).toBeNull();
    expect(toolButton('Connector').getAttribute('aria-pressed')).toBe('true');
    pressKey(document.body, 'v');
    fireEvent.click(toolButton('Connector'));
    expect(toolButton('Connector').getAttribute('aria-pressed')).toBe('true');
    expect(engines[0]?.activeTools).toContain('connector');
  });

  it('selects the select tool from its shortcut and its button', () => {
    renderShell();
    pressKey(document.body, 'v');
    fireEvent.click(toolButton('Select'));
    expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves keys typed into a text field alone', () => {
    renderShell();
    const field = document.createElement('input');
    document.body.append(field);
    pressKey(field, 'p');
    expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the cheat sheet with ? and closes it with Escape', () => {
    renderShell();
    pressKey(document.body, '?', { shiftKey: true, code: 'Slash' });
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    pressKey(dialog, 'Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the cheat sheet from the board menu (the old toolbar’s Shortcuts button)', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Keyboard shortcuts/ }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInstanceOf(HTMLElement);
  });

  it('makes the rest of the shell inert and turns canvas shortcuts off while the sheet is open', () => {
    renderShell();
    pressKey(document.body, '?', { shiftKey: true, code: 'Slash' });
    expect(
      screen.getByRole('main', { name: 'Canvas', hidden: true }).closest('[inert]'),
    ).not.toBeNull();
    pressKey(document.body, 'p');
    expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
  });

  it("shows the engine's frame statistics in the developer overlay while it is open, measuring only then", async () => {
    vi.useFakeTimers();
    const { engines } = renderShell();
    const engine = engines[0];
    if (engine === undefined) throw new Error('No engine was mounted.');
    expect(screen.queryByRole('region', { name: 'Developer overlay' })).toBeNull();
    expect(engine.isMeasuringFrames).toBe(false);
    pressKey(document.body, 'D', { metaKey: true, shiftKey: true, code: 'KeyD' });
    const overlay = screen.getByRole('region', { name: 'Developer overlay' });
    expect(engine.isMeasuringFrames).toBe(true);
    // The fake engine has no statistics to answer with yet: the read rejects.
    expect(within(overlay).getByText(/Waiting for frame statistics/)).toBeInstanceOf(HTMLElement);
    // The rejected read settles before the next poll starts another.
    await act(() => Promise.resolve());
    engine.frameStats = { ...EMPTY_SAMPLE, frames: 0 };
    act(() => {
      vi.advanceTimersByTime(DEVELOPER_OVERLAY_POLL_INTERVAL_MS);
    });
    await act(() => Promise.resolve());
    expect(within(overlay).getByText(/Waiting for the first frame/)).toBeInstanceOf(HTMLElement);
    pressKey(document.body, 'D', { metaKey: true, shiftKey: true, code: 'KeyD' });
    expect(screen.queryByRole('region', { name: 'Developer overlay' })).toBeNull();
    expect(engine.isMeasuringFrames).toBe(false);
  });

  it('shows the frame statistics it is given in the developer overlay', () => {
    const readFrameStats = vi.fn(() => EMPTY_SAMPLE);
    render(
      <AppShell
        platform="other"
        mountEngine={createFakeMount().mount}
        readFrameStats={readFrameStats}
      />,
    );
    expect(readFrameStats).not.toHaveBeenCalled();
    pressKey(document.body, 'D', { ctrlKey: true, shiftKey: true, code: 'KeyD' });
    const overlay = screen.getByRole('region', { name: 'Developer overlay' });
    expect(within(overlay).getByText(/Waiting for the first frame/)).toBeInstanceOf(HTMLElement);
  });

  it('themes its own root, not the document, in Graphite where the system’s mode is unknown', () => {
    const { shellRoot } = renderShell();
    expect(shellRoot.dataset.theme).toBe('dark');
    expect(shellRoot.style.getPropertyValue('--color-ground-mat')).toBe(
      THEMES.dark['--color-ground-mat'],
    );
    expect(document.documentElement.style.getPropertyValue('--color-ground-mat')).toBe('');
  });

  it('changes the theme from the board menu: Graphite, Vellum, system (no toolbar)', () => {
    const { shellRoot } = renderShell();
    const choose = (name: string): void => {
      fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
      fireEvent.click(screen.getByRole('menuitemradio', { name }));
    };
    choose('Vellum');
    expect(shellRoot.dataset.theme).toBe('light');
    choose('System');
    fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
    expect(screen.getByRole('menuitemradio', { name: 'System' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    // jsdom has no matchMedia, so the system preference falls back to Graphite.
    expect(shellRoot.dataset.theme).toBe('dark');
  });

  it('mounts the engine on the canvas and tears it down with the shell', () => {
    const { engines, view } = renderShell();
    expect(engines).toHaveLength(1);
    const [engine] = engines;
    expect(engine?.canvas).toBe(
      screen.getByRole('main', { name: 'Canvas' }).querySelector('canvas'),
    );
    view.unmount();
    expect(engine?.isDestroyed).toBe(true);
  });

  it('follows the tool the canvas makes active in the toolbar', () => {
    const { engines } = renderShell();
    act(() => {
      engines[0]?.options.onToolChange?.('text');
    });
    expect(toolButton('Text').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the text style the engine reports, and sends the panel’s changes to it', () => {
    const { engines } = renderShell();
    act(() => {
      // The text tool active: the panel shows the text context's sections.
      engines[0]?.options.onToolChange?.('text');
      engines[0]?.options.onTextStyleChange?.({ style: {}, align: 'left', isEditing: true });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(engines[0]?.textStyleChanges).toEqual([{ kind: 'style', patch: { weight: 700 } }]);
    act(() => {
      engines[0]?.options.onTextStyleChange?.(undefined);
    });
    // No text targeted, the text tool active: the section shows the tool's defaults.
    expect(screen.getByLabelText<HTMLInputElement>('Size').value).toBe('24');
    expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('hands the camera shortcuts to the engine, each press once', () => {
    const { engines } = renderShell();
    pressKey(document.body, '=', { metaKey: true });
    pressKey(document.body, '!', { shiftKey: true, code: 'Digit1' });
    pressKey(document.body, 'ArrowLeft');
    pressKey(document.body, 'ArrowLeft');
    expect(engines[0]?.actions).toEqual([
      { type: 'navigate', command: 'zoomIn' },
      { type: 'navigate', command: 'zoomToFit' },
      { type: 'nudge', direction: 'left', isLarge: false },
      { type: 'nudge', direction: 'left', isLarge: false },
    ]);
  });

  it('passes an engine that cannot start to onEngineError', async () => {
    const failure = new Error('no GPU');
    const { mount } = createFakeMount(() => Promise.reject(failure));
    const onEngineError = vi.fn();
    render(<AppShell platform="mac" mountEngine={mount} onEngineError={onEngineError} />);
    await vi.waitFor(() => {
      expect(onEngineError).toHaveBeenCalledWith(failure);
    });
  });

  it('reports an engine that cannot start to the page when nobody listens', async () => {
    const failure = new Error('no GPU');
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const { mount } = createFakeMount(() => Promise.reject(failure));
    render(<AppShell platform="mac" mountEngine={mount} />);
    await vi.waitFor(() => {
      expect(reportError).toHaveBeenCalledWith(failure);
    });
    vi.unstubAllGlobals();
  });

  it("mounts the engine on its board connection's store and origin, and shows where it stands", async () => {
    const connection = await createLocalBoardConnection('team-plan', {
      openCache: () => Promise.resolve(new MemoryDocumentCache()),
    });
    const { mount, engines } = createFakeMount();
    render(<AppShell platform="mac" mountEngine={mount} connection={connection} />);
    expect(engines[0]?.options.store).toBe(connection.store);
    expect(engines[0]?.options.origin).toBe(connection.origin);
    // Its tooltip details the connection, never naming the board by its id (item 8).
    const state = screen.getByRole('status', { name: 'Connection: Offline · local board' });
    expect(state.title).toBe('');
    expect(state.title).not.toContain('team-plan');
    connection.destroy();
  });

  it("shows the clipboard's notices in the shell's notice", () => {
    const { shellRoot } = renderShell();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    const huge = 'x'.repeat(MAX_PASTE_TEXT_LENGTH + 1);
    const data = { types: ['text/plain'], files: [], getData: () => huge };
    Object.defineProperty(paste, 'clipboardData', { value: data });
    act(() => {
      shellRoot.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(true);
    expect(screen.getByRole('status', { name: 'Notice' }).textContent).toContain(
      'The clipboard holds too much to paste.',
    );
  });

  it('turns editing off while the board connection is outdated, and says to reload', async () => {
    const local = await createLocalBoardConnection('team-plan', {
      openCache: () => Promise.resolve(new MemoryDocumentCache()),
    });
    const listeners = new Set<() => void>();
    let status: BoardConnectionStatus = {
      ...local.status(),
      state: 'connecting',
      isLocalOnly: false,
    };
    const connection: BoardConnection = {
      store: local.store,
      origin: local.origin,
      status: () => status,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dismissStrandedEdits: () => undefined,
      destroy: () => {
        local.destroy();
      },
    };
    const { mount } = createFakeMount();
    render(<AppShell platform="mac" mountEngine={mount} connection={connection} />);
    const canvas = screen.getByRole('main', { name: 'Canvas' });
    expect(canvas.closest('[inert]')).toBeNull();
    act(() => {
      status = { ...status, state: 'outdated', rejectionReason: 'unreadable-layout' };
      for (const listener of listeners) listener();
    });
    const chip = screen.getByRole('status', {
      name: 'Connection: App out of date: reload the page',
    });
    expect(chip.closest('[inert]')).toBeNull();
    expect(chip.title).toContain('Reload the page');
    expect(canvas.closest('[inert]')).not.toBeNull();
    pressKey(document.body, 'p');
    expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true');
    connection.destroy();
  });

  it('shows no connection state without a board connection', () => {
    renderShell();
    expect(screen.queryByRole('status', { name: /^Connection/ })).toBeNull();
  });

  it('turns shortcuts and the clipboard off, and the layout inert, while its host says so', () => {
    const { mount, engines } = createFakeMount();
    render(<AppShell platform="mac" onCanvasReady={vi.fn()} mountEngine={mount} isInert />);
    expect(
      screen.getByRole('main', { name: 'Canvas', hidden: true }).closest('[inert]'),
    ).not.toBeNull();
    const before = engines[0]?.actions.length;
    expect(fireEvent.keyDown(document.body, { key: 'Delete' })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'z', metaKey: true })).toBe(true);
    expect(engines[0]?.actions.length).toBe(before);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    const data = { types: ['text/plain'], files: [], getData: () => 'hello' };
    Object.defineProperty(paste, 'clipboardData', { value: data });
    act(() => {
      document.body.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(false);
  });
});
