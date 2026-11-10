// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClipboardAccess } from '../clipboard/clipboard-access.js';
import type { ClipboardFlavours } from '../clipboard/clipboard-formats.js';
import { ClipboardMemory } from '../clipboard/clipboard-memory.js';
import type { PasteItem } from '../clipboard/paste-handlers.js';
import { FakeMountedEngine } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import type { SelectionCommand } from '../state/shell-action.js';
import type { RecordedCanvasAction } from '../state/shell-reducer.js';

import { useClipboard } from './use-clipboard.js';

const FLAVOURS: ClipboardFlavours = new Map([['text/plain', 'copied']]);

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

/** A clipboard that remembers what was written and offers what a test gives it. */
class FakeClipboardAccess implements ClipboardAccess {
  readonly written: ClipboardFlavours[] = [];
  offered: PasteItem[] = [];
  /**
   * Receives each write, in order with the engine's deletes.
   *
   * @returns Nothing.
   */
  onWrite: () => void = () => undefined;

  write(flavours: ClipboardFlavours): Promise<void> {
    this.written.push(flavours);
    this.onWrite();
    return Promise.resolve();
  }

  read(): Promise<PasteItem[]> {
    return Promise.resolve(this.offered);
  }
}

/**
 * Renders the hook over a fake engine in a root element.
 *
 * @param isEnabled - Whether the shell takes clipboard events.
 * @returns The engine, the clipboard, the root and a way to dispatch a selection command.
 */
function renderClipboard(isEnabled = true) {
  const root = document.createElement('div');
  document.body.append(root);
  const engine = new FakeMountedEngine(document.createElement('canvas'), {}, Promise.resolve());
  engine.flavours = FLAVOURS;
  const access = new FakeClipboardAccess();
  const onError = vi.fn();
  const memory = new ClipboardMemory();
  const rootRef = { current: root };
  const engineRef = { current: engine as MountedEngine | undefined };
  let sequence = 0;
  const initialProps: { action: RecordedCanvasAction | undefined } = { action: undefined };
  const hook = renderHook(
    ({ action }: { action: RecordedCanvasAction | undefined }) => {
      useClipboard(rootRef, engineRef, action, isEnabled, { access, onError, memory });
    },
    { initialProps },
  );
  const run = (command: SelectionCommand) => {
    sequence += 1;
    hook.rerender({ action: { action: { type: 'selection', command }, sequence } });
  };
  return { root, engine, access, onError, run, hook };
}

/**
 * Fires a copy event with clipboard data on an element.
 *
 * @param target - Where the event starts.
 * @returns What was written.
 */
function fireCopy(target: EventTarget): Map<string, string> {
  const written = new Map<string, string>();
  const event = new Event('copy', { bubbles: true, cancelable: true });
  const setData = (type: string, data: string) => written.set(type, data);
  Object.defineProperty(event, 'clipboardData', {
    value: { types: [], files: [], getData: () => '', setData },
  });
  target.dispatchEvent(event);
  return written;
}

describe('useClipboard', () => {
  it('binds the router, so the native copy writes the engine’s selection', () => {
    const { root } = renderClipboard();
    expect([...fireCopy(root)]).toEqual([...FLAVOURS]);
  });

  it('turns the router off while the shell is disabled', () => {
    const { root } = renderClipboard(false);
    expect(fireCopy(root).size).toBe(0);
  });

  it('copies and cuts through the async clipboard when asked by an action; cut deletes after the write', async () => {
    const { engine, access, run } = renderClipboard();
    const order: string[] = [];
    access.onWrite = () => void order.push(`write, ${String(engine.cuts.length)} cuts`);
    run('copy');
    run('cut');
    await vi.waitFor(() => {
      expect(engine.cuts).toHaveLength(1);
    });
    expect(access.written).toEqual([FLAVOURS, FLAVOURS]);
    expect(order).toEqual(['write, 0 cuts', 'write, 0 cuts']);
  });

  it('keeps a cut the system clipboard refuses, and pastes it in the page', async () => {
    const { engine, access, run } = renderClipboard();
    access.write = () => Promise.reject(new Error('no activation'));
    run('cut');
    await vi.waitFor(() => {
      expect(engine.cuts).toHaveLength(1);
    });
    expect(engine.notices).toEqual([expect.stringContaining('not available')]);
    engine.flavours = new Map([['text/plain', 'kept']]);
    run('paste');
    await vi.waitFor(() => {
      expect(engine.pasted).toHaveLength(1);
    });
    expect(engine.pasted[0]?.[0]).toMatchObject({ type: 'text', text: 'copied' });
  });

  it('pastes what the async clipboard offers through the paste handlers', async () => {
    const { engine, access, run } = renderClipboard();
    access.offered = [{ kind: 'string', type: 'text/plain', data: 'from a menu' }];
    run('paste');
    await vi.waitFor(() => {
      expect(engine.pasted).toHaveLength(1);
    });
    expect(engine.pasted[0]?.[0]).toMatchObject({ type: 'text', text: 'from a menu' });
  });

  it('uses the async Clipboard API unless given a clipboard, and does nothing without an engine', async () => {
    const write = vi.fn(() => Promise.resolve());
    vi.stubGlobal('ClipboardItem', Object);
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    const root = document.createElement('div');
    const engine = new FakeMountedEngine(document.createElement('canvas'), {}, Promise.resolve());
    engine.flavours = FLAVOURS;
    const engineRef: { current: MountedEngine | undefined } = { current: undefined };
    const initialProps: { action: RecordedCanvasAction | undefined } = { action: undefined };
    const hook = renderHook(
      ({ action }: { action: RecordedCanvasAction | undefined }) => {
        useClipboard({ current: root }, engineRef, action, true);
      },
      { initialProps },
    );
    hook.rerender({ action: { action: { type: 'selection', command: 'copy' }, sequence: 1 } });
    expect(fireCopy(root).size).toBe(0);
    engineRef.current = engine;
    hook.rerender({ action: { action: { type: 'selection', command: 'copy' }, sequence: 2 } });
    await vi.waitFor(() => {
      expect(write).toHaveBeenCalledOnce();
    });
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('binds nothing without a root', () => {
    const initialProps: { action: RecordedCanvasAction | undefined } = { action: undefined };
    const hook = renderHook(
      ({ action }: { action: RecordedCanvasAction | undefined }) => {
        useClipboard({ current: null }, { current: undefined }, action, true);
      },
      { initialProps },
    );
    expect(() => {
      hook.unmount();
    }).not.toThrow();
  });

  it('tells the person when the page may not read the clipboard, and ignores other actions', async () => {
    const { engine, access, onError, run } = renderClipboard();
    access.read = () => Promise.reject(new Error('denied'));
    run('selectAll');
    run('paste');
    await vi.waitFor(() => {
      expect(engine.notices).toHaveLength(1);
    });
    expect([access.written, onError.mock.calls]).toEqual([[], []]);
  });

  it('reports an unexpected failure to the page when given no error sink', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const engine = new FakeMountedEngine(document.createElement('canvas'), {}, Promise.resolve());
    engine.prepareCut = () => {
      throw new Error('broken');
    };
    const initialProps: { action: RecordedCanvasAction | undefined } = { action: undefined };
    const hook = renderHook(
      ({ action }: { action: RecordedCanvasAction | undefined }) => {
        useClipboard({ current: document.createElement('div') }, { current: engine }, action, true);
      },
      { initialProps },
    );
    hook.rerender({ action: { action: { type: 'selection', command: 'cut' }, sequence: 1 } });
    await vi.waitFor(() => {
      expect(reportError).toHaveBeenCalledOnce();
    });
    vi.unstubAllGlobals();
  });

  it('reports an action that fails unexpectedly', async () => {
    const { engine, onError, run } = renderClipboard();
    engine.prepareCut = () => {
      throw new Error('broken');
    };
    run('cut');
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });
  });
});
