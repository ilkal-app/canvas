// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClipboardFlavours } from './clipboard-formats.js';
import { ClipboardMemory } from './clipboard-memory.js';
import { MAX_PASTE_TEXT_LENGTH } from './clipboard-notice.js';
import { bindClipboardRouter } from './clipboard-router.js';
import type { ClipboardSource, PreparedCut } from './clipboard-source.js';
import { PasteHandlerRegistry, type PasteItem, type PasteTarget } from './paste-handlers.js';

/** The clipboard data of a synthetic event: what a test puts in and what the router writes. */
class FakeClipboardData {
  readonly written = new Map<string, string>();
  readonly files: File[];
  private readonly offered: Map<string, string>;

  constructor(offered: Record<string, string> = {}, files: File[] = []) {
    this.offered = new Map(Object.entries(offered));
    this.files = files;
  }

  get types(): string[] {
    return [...this.offered.keys(), ...(this.files.length > 0 ? ['Files'] : [])];
  }

  getData(type: string): string {
    return this.offered.get(type) ?? '';
  }

  setData(type: string, data: string): void {
    this.written.set(type, data);
  }
}

/**
 * Dispatches a clipboard event at a target, as the browser does for the native shortcuts.
 *
 * @param target - Where the event starts.
 * @param type - `copy`, `cut` or `paste`.
 * @param data - Its clipboard data.
 * @returns The event.
 */
function fire(target: EventTarget, type: string, data = new FakeClipboardData()): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: data });
  target.dispatchEvent(event);
  return event;
}

const FLAVOURS: ClipboardFlavours = new Map([
  ['application/x-canvas-objects+json', '{}'],
  ['text/plain', 'hello'],
]);

/** The notices the engine's paste target was given, by the last `setUp`. */
let notices: string[] = [];

const TARGET: PasteTarget = {
  pointer: undefined,
  viewCentre: { x: 0, y: 0 },
  createObjects: () => true,
  notify: (notice) => void notices.push(notice),
};

/**
 * A shell root in the document with a router bound to it.
 *
 * @param isEnabled - Whether the shell takes clipboard events.
 * @param canEdit - Whether the person may edit the board.
 * @returns The root, the source's spies, the handlers' calls, notices, memory and the router.
 */
function setUp(isEnabled = true, canEdit = true) {
  const root = document.createElement('div');
  root.append(document.createElement('canvas'), document.createElement('input'));
  document.body.append(root);
  const log: string[] = [];
  const source = {
    copy: vi.fn((): ClipboardFlavours | undefined => FLAVOURS),
    prepareCut: vi.fn((): PreparedCut => ({
      kind: 'ready',
      flavours: FLAVOURS,
      remove: () => void log.push('remove'),
    })),
    pasteTarget: vi.fn(() => TARGET),
  } satisfies ClipboardSource;
  const pasted: PasteItem[][] = [];
  const handlers = new PasteHandlerRegistry();
  handlers.register('text/plain', (item) => (pasted.push([item]), true));
  notices = [];
  const memory = new ClipboardMemory();
  const router = bindClipboardRouter(root, {
    source: () => source,
    isEnabled: () => isEnabled,
    canEdit: () => canEdit,
    handlers,
    memory,
  });
  const unbind = () => {
    router.destroy();
  };
  return { root, source, pasted, notices, memory, router, log, unbind };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('bindClipboardRouter', () => {
  it('writes the selection’s flavours on copy and keeps the browser from writing its own', () => {
    const { root, source, unbind } = setUp();
    const data = new FakeClipboardData();
    const event = fire(root.querySelector('canvas') ?? root, 'copy', data);
    expect(source.copy).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect([...data.written]).toEqual([...FLAVOURS]);
    unbind();
  });

  it('cuts through the source, and leaves the browser its default with nothing to copy', () => {
    const { root, source, unbind } = setUp();
    const cutData = new FakeClipboardData();
    fire(document.body, 'cut', cutData);
    expect(source.prepareCut).toHaveBeenCalledOnce();
    expect([...cutData.written]).toEqual([...FLAVOURS]);
    source.copy.mockReturnValue(undefined);
    const data = new FakeClipboardData();
    expect(fire(root, 'copy', data).defaultPrevented).toBe(false);
    expect(data.written.size).toBe(0);
    unbind();
  });

  it('hands a paste’s strings and files to the handlers at the source’s target', () => {
    const { root, source, pasted, unbind } = setUp();
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const data = new FakeClipboardData({ 'text/plain': 'hello' }, [file]);
    expect(fire(root, 'paste', data).defaultPrevented).toBe(true);
    expect(source.pasteTarget).toHaveBeenCalledOnce();
    expect(pasted).toEqual([[{ kind: 'string', type: 'text/plain', data: 'hello' }]]);
    unbind();
  });

  it('marks the paste after Mod+Shift+V, or a Mac’s ⌥⇧⌘V, as plain text, once', () => {
    const root = document.createElement('div');
    root.append(document.createElement('canvas'));
    document.body.append(root);
    const plain: (boolean | undefined)[] = [];
    const handlers = new PasteHandlerRegistry();
    handlers.register(
      'text/plain',
      (item, target) => (plain.push(item.kind === 'string' && target.isPlainText), true),
    );
    const router = bindClipboardRouter(root, {
      source: () =>
        ({
          copy: () => undefined,
          prepareCut: () => ({ kind: 'empty' }),
          pasteTarget: () => TARGET,
        }) as never,
      isEnabled: () => true,
      handlers,
      memory: new ClipboardMemory(),
    });
    const data = () => new FakeClipboardData({ 'text/plain': 'https://example.com' });
    root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '◊',
        code: 'KeyV',
        metaKey: true,
        altKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    fire(root, 'paste', data());
    fire(root, 'paste', data());
    root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'V',
        code: 'KeyV',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    fire(root, 'paste', data());
    expect(plain).toEqual([true, false, true]);
    router.destroy();
  });

  it('drops only the paste a middle-button release on the canvas makes in its own task', async () => {
    const { root, pasted, unbind } = setUp();
    const canvas = root.querySelector('canvas');
    const input = root.querySelector('input');
    if (canvas === null || input === null) throw new Error('no canvas or input');
    const release = (target: Element, button: number) =>
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button }));
    const offered = () => new FakeClipboardData({ 'text/plain': 'from the selection' });
    // After the router's own message, which is queued first.
    const nextTask = () =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          resolve();
        };
        channel.port2.postMessage(undefined);
      });
    // A middle-button pan ends on the canvas; Chrome on Linux pastes the primary selection then,
    // in the same task.
    release(canvas, 1);
    expect(fire(root, 'paste', offered()).defaultPrevented).toBe(true);
    expect(pasted).toEqual([]);
    // A release that made no paste (macOS, an empty selection): a later paste, from a menu with
    // no key or press before it, pastes.
    release(canvas, 1);
    await nextTask();
    fire(root, 'paste', offered());
    expect(pasted).toHaveLength(1);
    // Nor do a primary release or a middle release elsewhere (a text field's own paste) arm it.
    release(canvas, 0);
    fire(root, 'paste', offered());
    release(input, 1);
    fire(root, 'paste', offered());
    expect(pasted).toHaveLength(3);
    unbind();
  });

  it('copies for a person who cannot edit, and leaves their cut and paste alone', async () => {
    const { root, source, pasted, router, log, unbind } = setUp(true, false);
    const data = new FakeClipboardData();
    expect(fire(root, 'copy', data).defaultPrevented).toBe(true);
    expect([...data.written]).toEqual([...FLAVOURS]);
    expect(fire(root, 'cut', new FakeClipboardData()).defaultPrevented).toBe(false);
    const offered = new FakeClipboardData({ 'text/plain': 'hello' });
    expect(fire(root, 'paste', offered).defaultPrevented).toBe(false);
    await router.runAction('cut');
    await router.runAction('paste');
    expect(source.prepareCut).not.toHaveBeenCalled();
    expect(source.pasteTarget).not.toHaveBeenCalled();
    expect(pasted).toEqual([]);
    expect(log).toEqual([]);
    unbind();
  });

  it('leaves events in editable elements, already handled, or while disabled alone', () => {
    const { root, source, unbind } = setUp();
    fire(root.querySelector('input') ?? root, 'copy');
    const handled = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(handled, 'clipboardData', { value: new FakeClipboardData() });
    handled.preventDefault();
    root.dispatchEvent(handled);
    expect(source.copy).not.toHaveBeenCalled();
    unbind();
    const disabled = setUp(false);
    fire(disabled.root, 'paste', new FakeClipboardData({ 'text/plain': 'x' }));
    expect(disabled.pasted).toEqual([]);
    disabled.unbind();
  });

  it('gives page-level events to the shell used last, and stops after unbinding', () => {
    const first = setUp();
    const second = setUp();
    fire(document.body, 'copy');
    expect([first.source.copy.mock.calls.length, second.source.copy.mock.calls.length]).toEqual([
      0, 1,
    ]);
    first.root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fire(document.body, 'copy');
    expect(first.source.copy).toHaveBeenCalledOnce();
    // An event inside a shell is that shell's, whichever was used last.
    fire(second.root, 'copy');
    expect(second.source.copy).toHaveBeenCalledTimes(2);
    first.unbind();
    second.unbind();
    fire(document.body, 'copy');
    expect(second.source.copy).toHaveBeenCalledTimes(2);
  });

  it('writes a cut before deleting what it copied, and keeps the copy in the page', () => {
    const { root, source, log, memory, unbind } = setUp();
    source.prepareCut.mockReturnValueOnce({
      kind: 'ready',
      flavours: FLAVOURS,
      remove: () => void log.push(`remove after ${String(data.written.size)} writes`),
    });
    const data = new FakeClipboardData();
    fire(root, 'cut', data);
    expect(log).toEqual(['remove after 2 writes']);
    expect(memory.itemsFor(true)).toEqual([
      { kind: 'string', type: 'application/x-canvas-objects+json', data: '{}' },
      { kind: 'string', type: 'text/plain', data: 'hello' },
    ]);
    unbind();
  });

  it('refuses a cut of a locked object: nothing written, the browser kept out, a notice', () => {
    const { root, source, notices, log, unbind } = setUp();
    source.prepareCut.mockReturnValue({ kind: 'refused', message: 'locked' });
    const data = new FakeClipboardData();
    expect(fire(root, 'cut', data).defaultPrevented).toBe(true);
    expect([data.written.size, log, notices]).toEqual([0, [], ['locked']]);
    source.prepareCut.mockReturnValue({ kind: 'empty' });
    expect(fire(root, 'cut', data).defaultPrevented).toBe(false);
    unbind();
  });

  it('runs actions through the system clipboard with the same handlers, cut deleting after the write', async () => {
    const { router, pasted, log } = setUp();
    const written: ClipboardFlavours[] = [];
    const access = {
      write: (flavours: ClipboardFlavours) => {
        log.push('write');
        written.push(flavours);
        return Promise.resolve();
      },
      read: () => Promise.resolve([{ kind: 'string', type: 'text/plain', data: 'hi' } as const]),
    };
    const memory = new ClipboardMemory();
    const root = document.createElement('div');
    const bound = bindClipboardRouter(root, {
      source: () => ({
        copy: () => FLAVOURS,
        prepareCut: () => ({
          kind: 'ready',
          flavours: FLAVOURS,
          remove: () => void log.push('remove'),
        }),
        pasteTarget: () => TARGET,
      }),
      isEnabled: () => true,
      access: () => access,
      memory,
    });
    await bound.runAction('cut');
    expect(log).toEqual(['write', 'remove']);
    await bound.runAction('copy');
    expect(written).toHaveLength(2);
    await router.runAction('paste');
    expect(pasted).toEqual([]);
    bound.destroy();
  });

  it('keeps a cut whose write the system refuses, and pastes it from the page', async () => {
    const { source, pasted, notices, log, unbind } = setUp();
    const root = document.createElement('div');
    const memory = new ClipboardMemory();
    const handlers = new PasteHandlerRegistry();
    handlers.register('text/plain', (item) => (pasted.push([item]), true));
    const refusing = {
      write: () => Promise.reject(new Error('denied')),
      read: () => Promise.reject(new Error('denied')),
    };
    const router = bindClipboardRouter(root, {
      source: () => source,
      isEnabled: () => true,
      handlers,
      access: () => refusing,
      memory,
    });
    await router.runAction('cut');
    expect(log).toEqual(['remove']);
    expect(notices).toEqual([expect.stringContaining('not available')]);
    await router.runAction('paste');
    expect(pasted).toEqual([[{ kind: 'string', type: 'text/plain', data: 'hello' }]]);
    router.destroy();
    unbind();
  });

  it('refuses an action cut of a locked object, and does nothing while disabled', async () => {
    const { source, notices, log, router, unbind } = setUp();
    source.prepareCut.mockReturnValue({ kind: 'refused', message: 'locked' });
    await router.runAction('cut');
    expect([log, notices]).toEqual([[], ['locked']]);
    unbind();
    const disabled = setUp(false);
    await disabled.router.runAction('copy');
    expect(disabled.source.copy).not.toHaveBeenCalled();
    disabled.unbind();
  });

  it('tells the person when nothing was pasted because every flavour was over its limit', () => {
    const { root, pasted, unbind } = setUp();
    const huge = 'x'.repeat(MAX_PASTE_TEXT_LENGTH + 1);
    const event = fire(root, 'paste', new FakeClipboardData({ 'text/other': huge }));
    expect(event.defaultPrevented).toBe(true);
    expect([pasted, notices]).toEqual([[], ['The clipboard holds too much to paste.']]);
    expect(fire(root, 'paste', new FakeClipboardData({ 'text/other': 'x' })).defaultPrevented).toBe(
      false,
    );
    unbind();
  });
});
