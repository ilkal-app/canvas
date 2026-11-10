import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserClipboardAccess } from './clipboard-access.js';
import type { ClipboardFlavours } from './clipboard-formats.js';

/** Node has no `ClipboardItem`; this holds what the page would hand the browser. */
class FakeClipboardItem {
  readonly parts: Record<string, Blob>;

  constructor(parts: Record<string, Blob>) {
    this.parts = parts;
  }

  get types(): string[] {
    return Object.keys(this.parts);
  }

  getType(type: string): Promise<Blob> {
    const part = this.parts[type];
    return part === undefined ? Promise.reject(new Error(type)) : Promise.resolve(part);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A clipboard that keeps what is written, for the async Clipboard API.
 *
 * @returns The clipboard and what it holds.
 */
function fakeClipboard() {
  const held: FakeClipboardItem[] = [];
  const clipboard = {
    write: (items: FakeClipboardItem[]) => {
      held.splice(0, held.length, ...items);
      return Promise.resolve();
    },
    read: () => Promise.resolve(held),
  };
  return { clipboard: clipboard as unknown as Clipboard, held };
}

describe('createBrowserClipboardAccess', () => {
  it('writes the standard flavours only, the objects riding in the HTML', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { clipboard, held } = fakeClipboard();
    const flavours: ClipboardFlavours = new Map([
      ['application/x-canvas-objects+json', '{}'],
      ['text/plain', 'hello'],
      ['text/html', '<div data-canvas-objects="{}">hello</div>'],
    ]);
    await createBrowserClipboardAccess(clipboard).write(flavours);
    expect(held[0]?.types).toEqual(['text/plain', 'text/html']);
    expect(await held[0]?.parts['text/plain']?.text()).toBe('hello');
    await createBrowserClipboardAccess(clipboard).write(new Map([['text/plain', 'only text']]));
    expect(held[0]?.types).toEqual(['text/plain']);
  });

  it('reads text flavours as strings and images as files', async () => {
    const { clipboard, held } = fakeClipboard();
    held.push(
      new FakeClipboardItem({
        'text/plain': new Blob(['hi'], { type: 'text/plain' }),
        'image/png': new Blob(['png'], { type: 'image/png' }),
      }),
    );
    const items = await createBrowserClipboardAccess(clipboard).read();
    expect(items[0]).toEqual({ kind: 'string', type: 'text/plain', data: 'hi' });
    expect(items[1]).toMatchObject({ kind: 'file', type: 'image/png' });
  });
});
