// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount } from './mount.js';

const { AppShell, createLocalBoardConnection, connections } = vi.hoisted(() => {
  const connections: {
    boardId: string;
    options: { openCache?: unknown; onError?: (error: unknown) => void };
    isDestroyed: boolean;
  }[] = [];
  return {
    connections,
    AppShell: vi.fn(() => null),
    createLocalBoardConnection: vi.fn(
      async (
        boardId: string,
        options: { openCache?: unknown; onError?: (error: unknown) => void },
      ) => {
        const { YjsDocumentStore } = await import('@canvas/document');
        const record = { boardId, options, isDestroyed: false };
        connections.push(record);
        return {
          boardId,
          store: new YjsDocumentStore(),
          origin: { kind: 'user', principalId: 'user:local' },
          destroy: () => {
            record.isDestroyed = true;
          },
        };
      },
    ),
  };
});

vi.mock('@canvas/app', () => ({ AppShell, createLocalBoardConnection }));

// React's act environment, as @testing-library sets it, so renders settle inside `act`.
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

beforeEach(() => {
  AppShell.mockClear();
  createLocalBoardConnection.mockClear();
  connections.length = 0;
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/**
 * Mounts a board in a new element and lets React render it, its engine mounting as the shell
 * reports it.
 *
 * @param options - The mount's options.
 * @returns The instance and its element.
 * @throws {Error} When the mount never resolves.
 */
async function mounted(options?: Parameters<typeof mount>[1]) {
  const element = document.createElement('div');
  document.body.append(element);
  const { pending } = await startMount(element, options);
  callShell('onEngineMount', undefined);
  return { instance: await pending, element };
}

/**
 * Starts a mount and lets React render the shell, its engine not yet mounted.
 *
 * @param element - The host element.
 * @param options - The mount's options.
 * @returns The mount, still pending (wrapped, so awaiting this does not wait for it).
 */
async function startMount(
  element: HTMLElement,
  options?: Parameters<typeof mount>[1],
): Promise<{ readonly pending: ReturnType<typeof mount> }> {
  let pending: ReturnType<typeof mount> | undefined;
  await act(async () => {
    pending = mount(element, options);
    // Until the root exists and has been told to render; `act` renders it as it ends.
    await vi.waitFor(() => {
      expect(Object.keys(element).some((key) => key.startsWith('__reactContainer'))).toBe(true);
    });
  });
  if (pending === undefined) throw new Error('mount did not start');
  return { pending };
}

/**
 * The props the shell was last rendered with.
 *
 * @returns Its props.
 * @throws {Error} When the shell never rendered.
 */
function shellProps(): Record<string, unknown> {
  const call = AppShell.mock.calls.at(-1) as unknown as [Record<string, unknown>] | undefined;
  if (call === undefined) throw new Error('the shell never rendered');
  return call[0];
}

/**
 * Calls one of the shell's callbacks as the shell would, inside `act`.
 *
 * @param name - The callback prop.
 * @param value - What it is called with.
 */
function callShell(name: string, value: unknown): void {
  const callback = shellProps()[name] as (value: unknown) => void;
  act(() => {
    callback(value);
  });
}

describe('mount', () => {
  it('opens an empty local board in memory and renders the shell on it, in the system theme', async () => {
    const { instance } = await mounted();
    expect(instance.boardId).toBe('board');
    const [boardId, options] = createLocalBoardConnection.mock.calls[0] ?? [];
    expect(boardId).toBe('board');
    expect(options).toMatchObject({ shouldSeedDemoBoard: false, hasFontCatalogue: false });
    expect(options?.openCache).toBeTypeOf('function');
    await expect((options?.openCache as () => Promise<unknown>)()).resolves.toBeUndefined();
    expect(shellProps()).toMatchObject({
      initialThemePreference: 'system',
      themeScope: 'shell',
      isPageInAddress: false,
    });
    expect(shellProps()).not.toHaveProperty('helpLinks');
    expect(shellProps()).not.toHaveProperty('chromeFonts');
  });

  it("keeps a device board in the device's storage under its id", async () => {
    await mounted({ boardId: 'notes', persistence: 'device' });
    const [boardId, options] = createLocalBoardConnection.mock.calls[0] ?? [];
    expect(boardId).toBe('notes');
    expect(options).not.toHaveProperty('openCache');
  });

  it('passes the starting theme, the chrome fonts and the help links', async () => {
    const helpLinks = { docsUrl: '/docs' };
    const chromeFonts = { faces: [], ui: 'Inter, sans-serif', mono: 'monospace' };
    await mounted({ theme: 'dark', helpLinks, chromeFonts });
    expect(shellProps()).toMatchObject({ initialThemePreference: 'dark', helpLinks, chromeFonts });
  });

  it('changes the theme and the chrome fonts live, and follows the person’s own choice', async () => {
    const { instance } = await mounted({ theme: 'light' });
    act(() => {
      instance.setTheme('dark');
    });
    expect(shellProps()).toMatchObject({ initialThemePreference: 'dark' });
    callShell('onThemePreferenceChange', 'light');
    expect(shellProps()).toMatchObject({ initialThemePreference: 'light' });
    act(() => {
      instance.setTheme('dark');
    });
    expect(shellProps()).toMatchObject({ initialThemePreference: 'dark' });
    const fonts = { faces: [], ui: 'Inter', mono: 'monospace' };
    act(() => {
      instance.setChromeFonts(fonts);
    });
    expect(shellProps()).toMatchObject({ chromeFonts: fonts });
  });

  it('sends the board’s changes with their origin, through the document’s commands', async () => {
    const { instance } = await mounted();
    const changes: unknown[] = [];
    instance.on('change', (event) => changes.push(event));
    const outcome = instance.document.run(
      'createObject',
      { object: { type: 'group', x: 0, y: 0 } },
      { origin: 'agent' },
    );
    if (outcome.status !== 'applied') throw new Error('createObject was refused');
    expect(changes).toEqual([
      {
        created: [outcome.result.id],
        updated: [],
        deleted: [],
        pages: [],
        tokens: [],
        textStyles: [],
        effectStyles: [],
        origin: 'agent',
      },
    ]);
    const token = instance.document.run('setColorToken', {
      name: 'Brand',
      light: [0, 1, 0, 1],
      dark: [0, 0, 1, 1],
    });
    if (token.status !== 'applied') throw new Error('setColorToken was refused');
    expect(changes.at(-1)).toMatchObject({
      created: [],
      tokens: [token.result.id],
      origin: 'user',
    });
    expect(instance.document.objects()).toHaveLength(1);
  });

  it('sends the person’s selection and the board’s errors, each typed by where it came from', async () => {
    const onError = vi.fn();
    const { instance } = await mounted({ onError });
    const selections: unknown[] = [];
    instance.on('selection', (event) => selections.push(event));
    callShell('onSelectionChange', ['a', 'b']);
    expect(selections).toEqual([{ ids: ['a', 'b'] }]);
    const storageFailure = new Error('quota');
    act(() => {
      connections[0]?.options.onError?.(storageFailure);
    });
    callShell('onEngineError', 'no GPU');
    expect(onError.mock.calls).toEqual([
      [{ source: 'storage', error: storageFailure }],
      [{ source: 'engine', error: 'no GPU' }],
    ]);
  });

  it('resolves once the shell’s engine has mounted with its undo history, or failed to start', async () => {
    const { pending } = await startMount(document.createElement('div'));
    let isResolved = false;
    void pending.then(() => {
      isResolved = true;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(isResolved).toBe(false);
    const report = vi.fn();
    vi.stubGlobal('reportError', report);
    callShell('onEngineError', 'no GPU');
    await pending;
    expect(isResolved).toBe(true);
    expect(report).toHaveBeenCalledWith('no GPU');
  });

  it('reports an error to the page when the host listens for none', async () => {
    const report = vi.fn();
    vi.stubGlobal('reportError', report);
    await mounted();
    callShell('onEngineError', 'no GPU');
    expect(report).toHaveBeenCalledWith('no GPU');
  });

  it('gives each instance a board, events and theme of its own', async () => {
    const first = await mounted({ boardId: 'a' });
    const second = await mounted({ boardId: 'b' });
    const heard = vi.fn();
    second.instance.on('change', heard);
    first.instance.document.run('createObject', { object: { type: 'group', x: 0, y: 0 } });
    expect(heard).not.toHaveBeenCalled();
    expect(second.instance.document.objects()).toEqual([]);
    const connectionsByShell = AppShell.mock.calls.map(
      (call) => (call as unknown as [{ connection: unknown }])[0].connection,
    );
    expect(new Set(connectionsByShell).size).toBe(2);
  });

  it('unmounts, closes the board and stops its events once, however often it is destroyed', async () => {
    const { instance, element } = await mounted({ boardId: 'once' });
    const heard = vi.fn();
    instance.on('change', heard);
    const { document: board } = instance;
    act(() => {
      instance.destroy();
      instance.destroy();
    });
    expect(connections.map(({ isDestroyed }) => isDestroyed)).toEqual([true]);
    expect(element.childElementCount).toBe(0);
    board.run('createObject', { object: { type: 'group', x: 0, y: 0 } });
    expect(heard).not.toHaveBeenCalled();
    const renders = AppShell.mock.calls.length;
    instance.setTheme('dark');
    expect(AppShell.mock.calls).toHaveLength(renders);
  });
});
