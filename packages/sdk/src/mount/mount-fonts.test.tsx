// @vitest-environment jsdom
// Where a built SDK's board fetches its font files: `mount` reads `fontsUrl` before the
// board opens and points the page's fonts there only once it has, as the build's settings
// (`CANVAS_SDK_FONTS`) tell it how the bundle names its fonts. Each test opens its board itself
// (a promise it settles), so nothing it starts settles in another test.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { mount } from './mount.js';

const { AppShell, createLocalBoardConnection, setFontFileResolver } = vi.hoisted(() => {
  // The build's settings, there before ./mount.js loads, as a build defines them.
  Reflect.set(globalThis, 'CANVAS_SDK_FONTS', {
    scheme: 'canvas-sdk-font:',
    defaultUrl: 'https://cdn.jsdelivr.net/npm/@ilkal/fonts@0.1.3/',
  });
  return {
    AppShell: vi.fn(() => null),
    createLocalBoardConnection: vi.fn(),
    setFontFileResolver: vi.fn(),
  };
});

vi.mock('@canvas/app', () => ({ AppShell, createLocalBoardConnection, setFontFileResolver }));

/**
 * Starts a mount whose board opens only when the test says so.
 *
 * @param options - The mount's options.
 * @returns Opens the board.
 */
function mountUntilOpened(options?: Parameters<typeof mount>[1]): () => void {
  let open: (connection: unknown) => void = () => undefined;
  createLocalBoardConnection.mockReturnValueOnce(
    new Promise((resolve) => {
      open = resolve;
    }),
  );
  void mount(document.body.appendChild(document.createElement('div')), options);
  return () => {
    open({
      boardId: 'board',
      store: new YjsDocumentStore(),
      origin: { kind: 'user', principalId: 'user:local' },
      destroy: () => undefined,
    });
  };
}

/**
 * The URL the page's resolver, as the last mount set it, fetches a font from.
 *
 * @param named - The URL the catalogue names the font by.
 * @returns The URL to fetch.
 * @throws {Error} When no mount has set one.
 */
function resolved(named: string): string {
  const resolver = setFontFileResolver.mock.lastCall?.[0] as ((url: string) => string) | undefined;
  if (resolver === undefined) throw new Error('No resolver was set.');
  return resolver(named);
}

beforeEach(() => {
  AppShell.mockClear();
  createLocalBoardConnection.mockReset();
  setFontFileResolver.mockReset();
  document.body.replaceChildren();
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'CANVAS_SDK_FONTS');
});

describe("a built SDK's font files", () => {
  it('load from jsDelivr by default, once the board has opened', async () => {
    const open = mountUntilOpened();
    await vi.waitFor(() => {
      expect(createLocalBoardConnection).toHaveBeenCalledTimes(1);
    });
    expect(setFontFileResolver).not.toHaveBeenCalled();
    open();
    await vi.waitFor(() => {
      expect(setFontFileResolver).toHaveBeenCalledTimes(1);
    });
    expect(resolved('canvas-sdk-font:app/library/opensans/400.ttf')).toBe(
      'https://cdn.jsdelivr.net/npm/@ilkal/fonts@0.1.3/app/library/opensans/400.ttf',
    );
    expect(resolved('https://host.example/own.woff2')).toBe('https://host.example/own.woff2');
  });

  it("load from the host's folder, resolved against the page", async () => {
    mountUntilOpened({ fontsUrl: '/fonts' })();
    await vi.waitFor(() => {
      expect(setFontFileResolver).toHaveBeenCalledTimes(1);
    });
    expect(resolved('canvas-sdk-font:engine/LiberationSans-Regular.ttf')).toBe(
      new URL('/fonts/engine/LiberationSans-Regular.ttf', document.baseURI).href,
    );
  });

  it('stay where they were when the board fails to open', async () => {
    createLocalBoardConnection.mockRejectedValueOnce(new Error('storage'));
    await expect(
      mount(document.body.appendChild(document.createElement('div')), {
        fontsUrl: 'https://cdn.example/fonts/',
      }),
    ).rejects.toThrow('storage');
    expect(setFontFileResolver).not.toHaveBeenCalled();
  });

  it('refuse a fontsUrl that is not a URL before opening anything', async () => {
    await expect(
      mount(document.body.appendChild(document.createElement('div')), { fontsUrl: 'https://' }),
    ).rejects.toThrow(TypeError);
    expect(createLocalBoardConnection).not.toHaveBeenCalled();
    expect(setFontFileResolver).not.toHaveBeenCalled();
  });
});
