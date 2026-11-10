import { describe, expect, it } from 'vitest';

import {
  FAKE_ASSETS_URL,
  FakeAssetsService,
  fakeToken,
} from './__fixtures__/fake-assets-service.js';
import { settle } from './__fixtures__/manual-schedule.js';
import { BOARD, ofType, png, setUp } from './__fixtures__/page-images-setup.js';
import { directLinks, type PageAssetMessage } from './asset-channel.js';
import { AssetsHttpError } from './assets-responses.js';
import { CopiedAssets } from './copied-assets.js';
import {
  CROSS_BOARD_NOT_COPIED_MESSAGE,
  CROSS_BOARD_REFUSED_MESSAGE,
  CROSS_BOARD_UNAVAILABLE_MESSAGE,
  IMAGE_READER_FAILED_MESSAGE,
  LOCAL_IMAGE_WAIT_MS,
  NO_IMAGES_MESSAGE,
  PageImages,
} from './page-images.js';
import { ImagePreparer, type PrepareWorker } from './prepare-image.js';

describe('PageImages', () => {
  it('answers the adapter with the board’s access, a fresh token after the first', async () => {
    const { adapter, toAdapter, tokens } = setUp();
    adapter.send({ type: 'access-request' });
    await settle();
    adapter.send({ type: 'access-request' });
    await settle();
    expect(ofType(toAdapter, 'access')).toEqual([
      {
        type: 'access',
        access: { assetsUrl: FAKE_ASSETS_URL, boardId: BOARD, token: fakeToken(BOARD) },
      },
      {
        type: 'access',
        access: { assetsUrl: FAKE_ASSETS_URL, boardId: BOARD, token: fakeToken(BOARD) },
      },
    ]);
    expect(tokens).toEqual([false, true]);
  });

  it('places dropped images in a row, draws them from their bytes and uploads them', async () => {
    const { images, service, toAdapter, created, target, adapter } = setUp();
    const first = png(1);
    const second = png(2);
    await images.insert([first.file, second.file], { x: 0, y: 0 }, target);
    expect(created[0]).toHaveLength(2);
    expect(created[0]?.[0]).toMatchObject({ type: 'image', assetId: first.assetId, width: 400 });
    expect(toAdapter.filter(({ type }) => type === 'local-image')).toHaveLength(2);
    await settle();
    expect(service.isLinked(first.assetId, BOARD)).toBe(true);
    expect(toAdapter.filter(({ type }) => type === 'uploaded')).toHaveLength(2);
    expect(images.uploads.snapshot().map(({ state }) => state.phase)).toEqual([
      'processing',
      'processing',
    ]);
    adapter.send({ type: 'asset-status', assetId: first.assetId, status: 'ready', progress: 1 });
    await settle();
    expect(images.uploads.snapshot()).toHaveLength(1);
    expect(images.boardId).toBe(BOARD);
  });

  it('calls an image it uploaded unfinished, not missing, when the board cannot read it', async () => {
    const { images, service, target, adapter } = setUp();
    const uploaded = png(1);
    await images.insert([uploaded.file], { x: 0, y: 0 }, target);
    await settle();
    adapter.send({ type: 'asset-status', assetId: uploaded.assetId, status: 'ready', progress: 1 });
    await settle();
    expect(images.uploads.snapshot()).toEqual([]);
    // The service has lost the board's link to it (a reload after an abandoned upload, say).
    service.failNext({ route: 'record', status: 404, code: 'not-found' });
    expect(await images.availability.availabilityOf(uploaded.assetId)).toBe('unfinished');
    // An image some other page placed and never uploaded is missing.
    expect(await images.availability.availabilityOf(png(2).assetId)).toBe('missing');
  });

  it('refuses what the board cannot take before uploading, with a notice for each', async () => {
    const { images, service, created, notices, target } = setUp();
    const text = new File(['x'], 'notes.txt', { type: 'text/plain' });
    await images.insert(
      [text, png(0, 'broken.png').file, png(9, 'huge.png').file],
      { x: 0, y: 0 },
      target,
    );
    expect(created).toEqual([]);
    expect(notices).toEqual([
      '“notes.txt” is not an image the board can show: use JPEG, PNG, WebP, AVIF or GIF.',
      '“broken.png” could not be read as an image.',
      '“huge.png” has more than 64 megapixels, the most the board takes.',
    ]);
    expect(service.requests).toEqual([]);
  });

  it('passes the board upload limit to the pre-upload check', async () => {
    const { service, target, notices, created } = setUp();
    const images = new PageImages(
      {
        assetsUrl: FAKE_ASSETS_URL,
        boardId: BOARD,
        token: () => Promise.resolve(fakeToken(BOARD)),
        tokenFor: () => Promise.resolve(undefined),
      },
      { fetch: service.fetch, uploadBytes: 25 * 1024 * 1024 },
    );
    const file = new File([], 'photo.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 25 * 1024 * 1024 + 1 });
    await images.insert([file], { x: 0, y: 0 }, target);
    expect(created).toEqual([]);
    expect(service.requests).toEqual([]);
    expect(notices).toContain(
      "“photo.png” is larger than 25 MB, the most this board's plan takes.",
    );
    images.destroy();
  });

  it('says once when the image reader died, creates nothing, and reads the next drop afresh', async () => {
    const { service, target, notices, created } = setUp();
    const workers: PrepareWorker[] = [];
    const images = new PageImages(
      {
        assetsUrl: FAKE_ASSETS_URL,
        boardId: BOARD,
        token: () => Promise.resolve(fakeToken(BOARD)),
        tokenFor: () => Promise.resolve(undefined),
      },
      {
        preparer: new ImagePreparer(() => {
          const worker: PrepareWorker = {
            onmessage: null,
            onerror: null,
            onmessageerror: null,
            // The worker fails to load: its error arrives after the first request.
            postMessage: () => {
              queueMicrotask(() => worker.onerror?.(new Event('error') as ErrorEvent));
            },
            terminate: () => undefined,
          };
          workers.push(worker);
          return worker;
        }),
        fetch: service.fetch,
      },
    );
    await images.insert([png(1).file, png(2).file, png(3).file], { x: 0, y: 0 }, target);
    expect(notices).toEqual([IMAGE_READER_FAILED_MESSAGE]);
    expect(created).toEqual([]);
    await images.insert([png(4).file], { x: 0, y: 0 }, target);
    expect(workers).toHaveLength(2);
    images.destroy();
  });

  it('creates nothing and uploads nothing when the board refuses the objects', async () => {
    const { images, service, target } = setUp();
    await images.insert([png(3).file], { x: 0, y: 0 }, { ...target, createObjects: () => false });
    await settle();
    expect(service.requests.some(({ path }) => path === '/assets')).toBe(false);
  });

  it('tells the person when the page has no assets service', async () => {
    const images = new PageImages(undefined, { preparer: new ImagePreparer(() => undefined) });
    const notices: string[] = [];
    await images.insert(
      [png(4).file],
      { x: 0, y: 0 },
      {
        createObjects: () => true,
        notify: (message) => notices.push(message),
      },
    );
    expect(notices).toEqual([NO_IMAGES_MESSAGE]);
    expect(images.boardId).toBeUndefined();
    await expect(images.linkFrom([], 'other')).rejects.toThrow(NO_IMAGES_MESSAGE);
    images.destroy();
  });

  it('links images copied from a board the page can read, and refuses the others', async () => {
    const { images, service, copies } = setUp({ sources: ['board-b', 'board-c'] });
    const { assetId } = png(5);
    service.seed(new Uint8Array([5, 1, 2, 3]), ['board-b']);
    for (const board of ['board-b', 'board-c', 'board-d']) copies.record([assetId], board);
    await images.linkFrom([assetId, assetId], 'board-b');
    expect(service.isLinked(assetId, BOARD)).toBe(true);
    expect(service.requests.filter(({ path }) => path.endsWith('/link'))).toHaveLength(1);
    await expect(images.linkFrom([assetId], 'board-c')).rejects.toThrow(
      CROSS_BOARD_REFUSED_MESSAGE,
    );
    await expect(images.linkFrom([assetId], 'board-d')).rejects.toThrow(
      CROSS_BOARD_UNAVAILABLE_MESSAGE,
    );
    service.failNext({ route: 'link', status: 0, code: 'network' });
    const offline = new PageImages(
      {
        assetsUrl: FAKE_ASSETS_URL,
        boardId: BOARD,
        token: () => Promise.resolve(fakeToken(BOARD)),
        tokenFor: (board) => Promise.resolve(fakeToken(board)),
      },
      { fetch: () => Promise.reject(new AssetsHttpError(0, 'network', 'x')), copiedAssets: copies },
    );
    await expect(offline.linkFrom([assetId], 'board-b')).rejects.toThrow('could not be reached');
  });

  it('refuses to link from a board this browser did not copy the images from, asking for nothing', async () => {
    const { images, service, copies, tokenRequests } = setUp({ sources: ['board-b'] });
    const { assetId } = png(5);
    service.seed(new Uint8Array([5, 1, 2, 3]), ['board-b']);
    copies.record([assetId], 'board-other');
    await expect(images.linkFrom([assetId], 'board-b')).rejects.toThrow(
      CROSS_BOARD_NOT_COPIED_MESSAGE,
    );
    await expect(images.linkFrom([assetId, png(6).assetId], 'board-other')).rejects.toThrow(
      CROSS_BOARD_NOT_COPIED_MESSAGE,
    );
    expect(tokenRequests).toEqual([]);
    expect(service.requests).toEqual([]);
    expect(service.isLinked(assetId, BOARD)).toBe(false);
  });

  it('links nothing for an empty list, asking for no token and making no request', async () => {
    const { images, service, tokenRequests } = setUp({ sources: ['board-b'] });
    await expect(images.linkFrom([], 'board-b')).resolves.toBeUndefined();
    await expect(images.linkFrom([], 'never-copied-board')).resolves.toBeUndefined();
    expect(tokenRequests).toEqual([]);
    expect(service.requests).toEqual([]);
  });

  it('links what this tab copied even when the storage refuses the record', async () => {
    const service = new FakeAssetsService();
    const { assetId } = png(8);
    service.seed(new Uint8Array([8, 1, 2, 3]), ['board-b']);
    const broken = new CopiedAssets({
      storage: () => ({
        getItem: () => {
          throw new Error('storage is disabled');
        },
        setItem: () => {
          throw new Error('quota exceeded');
        },
      }),
    });
    const images = new PageImages(
      {
        assetsUrl: FAKE_ASSETS_URL,
        boardId: BOARD,
        token: () => Promise.resolve(fakeToken(BOARD)),
        tokenFor: (board) => Promise.resolve(fakeToken(board)),
      },
      { fetch: service.fetch, copiedAssets: broken },
    );
    await expect(images.linkFrom([assetId], 'board-b')).rejects.toThrow(
      CROSS_BOARD_NOT_COPIED_MESSAGE,
    );
    images.copies.record([assetId], 'board-b');
    await images.linkFrom([assetId], 'board-b');
    expect(service.isLinked(assetId, BOARD)).toBe(true);
    // Only the pair this tab copied: another board's claim is still refused.
    await expect(images.linkFrom([assetId], 'board-c')).rejects.toThrow(
      CROSS_BOARD_NOT_COPIED_MESSAGE,
    );
    images.destroy();
  });

  it('tells the adapter whether the page is hidden, on connecting and on each change', async () => {
    const { images, toAdapter, visibility } = setUp();
    visibility.set(true);
    visibility.set(false);
    await settle();
    expect(ofType(toAdapter, 'page-visibility')).toEqual([
      { type: 'page-visibility', isHidden: false },
      { type: 'page-visibility', isHidden: true },
      { type: 'page-visibility', isHidden: false },
    ]);
    images.destroy();
    visibility.set(true);
    await settle();
    expect(ofType(toAdapter, 'page-visibility')).toHaveLength(3);
  });

  it('replaces its link, and hears nothing once destroyed', async () => {
    const { images, toAdapter } = setUp();
    const second = directLinks();
    images.connect(second.page);
    const received: PageAssetMessage[] = [];
    second.adapter.listen((message) => received.push(message));
    second.adapter.send({ type: 'access-request' });
    await settle();
    expect(ofType(received, 'access')).toHaveLength(1);
    expect(ofType(toAdapter, 'access')).toEqual([]);
    images.destroy();
    second.adapter.send({ type: 'access-request' });
    await settle();
    expect(ofType(received, 'access')).toHaveLength(1);
  });

  it('sends an empty token when none can be fetched, so the adapter asks again', async () => {
    const { adapter } = setUp();
    const images = new PageImages({
      assetsUrl: FAKE_ASSETS_URL,
      boardId: BOARD,
      token: () => Promise.reject(new Error('token endpoint down')),
      tokenFor: () => Promise.resolve(undefined),
    });
    const links = directLinks();
    images.connect(links.page);
    const received: PageAssetMessage[] = [];
    links.adapter.listen((message) => received.push(message));
    links.adapter.send({ type: 'access-request' });
    await settle();
    expect(ofType(received, 'access')).toEqual([
      { type: 'access', access: { assetsUrl: FAKE_ASSETS_URL, boardId: BOARD, token: '' } },
    ]);
    adapter.close();
  });

  it('creates the images after a while when no adapter says it holds them', async () => {
    const images = new PageImages(
      {
        assetsUrl: FAKE_ASSETS_URL,
        boardId: BOARD,
        token: () => Promise.resolve(fakeToken(BOARD)),
        tokenFor: () => Promise.resolve(undefined),
      },
      {
        preparer: new ImagePreparer(
          () => undefined,
          () => Promise.resolve({ width: 10, height: 10 }),
        ),
        put: () => new Promise(() => undefined),
        fetch: () => new Promise(() => undefined),
      },
    );
    images.connect(directLinks().page);
    const created: unknown[] = [];
    const inserting = images.insert(
      [png(6).file],
      { x: 0, y: 0 },
      {
        createObjects: (objects) => {
          created.push(...objects);
          return true;
        },
        notify: () => undefined,
      },
    );
    const started = performance.now();
    await settle();
    expect(created).toEqual([]);
    await inserting;
    expect(created).toHaveLength(1);
    expect(performance.now() - started).toBeGreaterThanOrEqual(LOCAL_IMAGE_WAIT_MS - 50);
  });

  it('fetches a fresh token when the service refuses the held one, and waits out a busy service', async () => {
    const { service, tokens, copies } = setUp({ sources: ['board-b'] });
    const { assetId } = png(7);
    copies.record([assetId], 'board-b');
    service.seed(new Uint8Array([7, 1, 2, 3]), ['board-b']);
    const images = new PageImages(
      {
        assetsUrl: FAKE_ASSETS_URL,
        boardId: BOARD,
        token: (isFresh) => {
          tokens.push(isFresh);
          return Promise.resolve(fakeToken(BOARD));
        },
        tokenFor: (board) => Promise.resolve(fakeToken(board)),
      },
      { fetch: service.fetch, copiedAssets: copies },
    );
    service.failNext({ route: 'link', status: 401, code: 'expired' });
    service.failNext({ route: 'link', status: 429, code: 'rate-limited', retryAfterS: 0 });
    await images.linkFrom([assetId], 'board-b');
    expect(service.isLinked(assetId, BOARD)).toBe(true);
    expect(tokens).toEqual([false, true]);
    images.destroy();
  });

  it('uploads with a fresh token when the service refuses the held one', async () => {
    const { images, service, target, tokens } = setUp();
    const { file, assetId } = png(8);
    service.failNext({ route: 'declare', status: 401, code: 'expired' });
    await images.insert([file], { x: 0, y: 0 }, target);
    await settle();
    expect(service.isLinked(assetId, BOARD)).toBe(true);
    expect(tokens).toContain(true);
    images.destroy();
  });
});
