// The page images' test setup (page-images.test.ts): page images over the fake assets service,
// with a size reader that reads the first byte, a put through the fake, an adapter end that holds
// local images at once, and a page visibility the test switches.
import { createHash } from 'node:crypto';

import type { NewObject } from '@canvas/document';
import type { AssetId, ObjectId } from '@canvas/schema';

import { directLinks, type PageAssetMessage } from '../asset-channel.js';
import { CopiedAssets, type CopiedAssetsStorage } from '../copied-assets.js';
import { PageImages, type BoardImageAccess } from '../page-images.js';
import { ImagePreparer } from '../prepare-image.js';
import type { PutFile } from '../run-upload.js';

import { FAKE_ASSETS_URL, FakeAssetsService, fakeToken } from './fake-assets-service.js';

/** The board the page shows. */
export const BOARD = 'board-a';

/**
 * A PNG-typed file of some bytes.
 *
 * @param seed - Makes the bytes differ.
 * @param name - The file's name.
 * @returns The file and its asset id.
 */
export function png(seed: number, name = `image-${String(seed)}.png`) {
  const bytes = new Uint8Array([seed, 1, 2, 3]);
  const file = new File([bytes], name, { type: 'image/png' });
  return { file, assetId: createHash('sha256').update(bytes).digest('hex') as AssetId };
}

/** A page's visibility a test switches by hand. */
export class FakeVisibility {
  isHiddenNow = false;
  private readonly listeners = new Set<() => void>();

  isHidden(): boolean {
    return this.isHiddenNow;
  }

  listen(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  /**
   * Hides or shows the page.
   *
   * @param isHidden - Whether hidden.
   */
  set(isHidden: boolean): void {
    this.isHiddenNow = isHidden;
    for (const listener of this.listeners) listener();
  }
}

/**
 * Messages of one type.
 *
 * @param messages - The messages.
 * @param type - The type.
 * @returns Those of that type.
 */
export function ofType(messages: readonly PageAssetMessage[], type: PageAssetMessage['type']) {
  return messages.filter((message) => message.type === type);
}

/**
 * A record of copies over a storage of its own, empty.
 *
 * @returns The record.
 */
export function memoryCopies(): CopiedAssets {
  const items = new Map<string, string>();
  const storage: CopiedAssetsStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  return new CopiedAssets({ storage: () => storage });
}

/**
 * Page images over the fake, with a decoder that says every image is 400 × 200, unless its first
 * byte is 0 (unreadable) or 9 (too many pixels).
 *
 * @param options - Which boards the page can get tokens for.
 * @param options.sources - The other boards it can read; none by default.
 * @returns The page images, the fake, the created objects, the notices and the adapter's inbox,
 *   the boards the page asked a token for, and the page's record of copies (empty, over a
 *   storage of its own).
 */
export function setUp(options: { sources?: readonly string[] } = {}) {
  const service = new FakeAssetsService();
  const tokens: boolean[] = [];
  const tokenRequests: string[] = [];
  const copies = memoryCopies();
  const access: BoardImageAccess = {
    assetsUrl: FAKE_ASSETS_URL,
    boardId: BOARD,
    token: (isFresh) => {
      tokens.push(isFresh);
      return Promise.resolve(fakeToken(BOARD));
    },
    tokenFor: (board) => {
      tokenRequests.push(board);
      return Promise.resolve(
        options.sources?.includes(board) === true ? fakeToken(board) : undefined,
      );
    },
  };
  const preparer = new ImagePreparer(
    () => undefined,
    async (blob) => {
      const [first] = new Uint8Array(await blob.arrayBuffer());
      if (first === 0) throw new Error('not an image');
      const width = first === 9 ? 10_000 : 400;
      return { width, height: first === 9 ? 10_000 : 200 };
    },
  );
  const put: PutFile = async (url, headers, body) => {
    await service.fetch(url, { method: 'PUT', body, headers });
  };
  const visibility = new FakeVisibility();
  const images = new PageImages(access, {
    preparer,
    put,
    fetch: service.fetch,
    wait: () => Promise.resolve(),
    visibility,
    copiedAssets: copies,
  });
  const { page, adapter } = directLinks();
  images.connect(page);
  const toAdapter: PageAssetMessage[] = [];
  adapter.listen((message) => {
    toAdapter.push(message);
    // The engine's adapter holds a local image at once.
    if (message.type === 'local-image') {
      adapter.send({ type: 'local-image-held', assetId: message.image.assetId });
    }
  });
  const created: NewObject[][] = [];
  const notices: string[] = [];
  let nextId = 0;
  const target = {
    createObjects: (
      objects: readonly NewObject[],
      onCreated?: (ids: readonly ObjectId[]) => void,
    ) => {
      created.push([...objects]);
      onCreated?.(objects.map(() => `object-${String((nextId += 1))}` as ObjectId));
      return true;
    },
    notify: (message: string) => notices.push(message),
  };
  return {
    images,
    service,
    adapter,
    toAdapter,
    created,
    notices,
    target,
    tokens,
    visibility,
    tokenRequests,
    copies,
  };
}
