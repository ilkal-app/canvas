import { describe, expect, it, vi } from 'vitest';

import type { NewObject } from '@canvas/document';
import type { AssetId, AssetRecord, ObjectId } from '@canvas/schema';

import type { AssetsHttp } from './assets-http.js';
import { AssetsHttpError } from './assets-responses.js';
import type { ImageInsertTarget } from './page-images.js';
import { insertFromLink, LINK_NOT_READ_MESSAGE, placeBoardImage } from './panel-images.js';

const id = 'b'.repeat(64) as AssetId;

const record: AssetRecord = {
  id,
  mimeType: 'image/png',
  byteLength: 3,
  status: 'ready',
  naturalSize: { width: 400, height: 200 },
  levels: [],
  tiles: null,
  blurhash: null,
  averageColor: null,
  progress: 1,
  createdAt: 0,
};

/**
 * A target that creates at once and records what it was given.
 *
 * @param isAccepted - Whether it takes the objects.
 * @returns The target.
 */
function target(isAccepted = true): ImageInsertTarget & { readonly created: NewObject[][] } {
  const created: NewObject[][] = [];
  return {
    created,
    createObjects: (objects, onCreated) => {
      if (!isAccepted) return false;
      created.push([...objects]);
      onCreated?.(objects.map((object) => `new-${object.type}` as ObjectId));
      return true;
    },
    notify: vi.fn(),
  };
}

/**
 * Page images whose requests go to a fake client.
 *
 * @param http - The client's methods the test needs.
 * @returns The images.
 */
function images(http: Partial<AssetsHttp>) {
  return {
    request: <T>(call: (client: AssetsHttp) => Promise<T>) => call(http as AssetsHttp),
  };
}

describe('placeBoardImage', () => {
  it('creates one image centred on the point', async () => {
    const into = target();
    const isPlaced = await placeBoardImage(
      { assetId: id, naturalSize: { width: 400, height: 200 } },
      { x: 10, y: 20 },
      into,
    );
    expect(isPlaced).toBe(true);
    expect(into.created).toHaveLength(1);
    expect(into.created[0]?.[0]).toMatchObject({ type: 'image', assetId: id });
  });

  it('reports a refusal', async () => {
    expect(
      await placeBoardImage(
        { assetId: id, naturalSize: { width: 1, height: 1 } },
        { x: 0, y: 0 },
        target(false),
      ),
    ).toBe(false);
  });
});

describe('insertFromLink', () => {
  it('asks the service for the link and places the image it links', async () => {
    const fromLink = vi.fn(() => Promise.resolve(record));
    const into = target();
    const isPlaced = await insertFromLink(
      images({ fromLink }),
      'https://example.com/a.png',
      { x: 0, y: 0 },
      into,
    );
    expect(isPlaced).toBe(true);
    expect(fromLink).toHaveBeenCalledWith('https://example.com/a.png');
    expect(into.created[0]?.[0]).toMatchObject({
      assetId: id,
      naturalSize: { width: 400, height: 200 },
    });
  });

  it('waits for the size of an image still processing', async () => {
    const into = target();
    await insertFromLink(
      images({
        fromLink: () => Promise.resolve({ ...record, status: 'processing', naturalSize: null }),
        events: (assetIdOf, onRecord) => {
          onRecord(record);
          return Promise.resolve();
        },
      }),
      'https://example.com/a.png',
      { x: 0, y: 0 },
      into,
    );
    expect(into.created[0]?.[0]).toMatchObject({ naturalSize: { width: 400, height: 200 } });
  });

  it('says why a link was refused and places nothing', async () => {
    const into = target();
    await expect(
      insertFromLink(
        images({
          fromLink: () => Promise.reject(new AssetsHttpError(400, 'private-address', '')),
        }),
        'http://10.0.0.1/a.png',
        { x: 0, y: 0 },
        into,
      ),
    ).rejects.toThrow('That link points inside a private network.');
    expect(into.created).toEqual([]);
  });

  it('says so when the image never became readable', async () => {
    await expect(
      insertFromLink(
        images({
          fromLink: () => Promise.resolve({ ...record, status: 'processing', naturalSize: null }),
          events: (assetIdOf, onRecord) => {
            onRecord({ ...record, status: 'failed', naturalSize: null });
            return Promise.resolve();
          },
        }),
        'https://example.com/a.png',
        { x: 0, y: 0 },
        target(),
      ),
    ).rejects.toThrow(LINK_NOT_READ_MESSAGE);
  });
});
