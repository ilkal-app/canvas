import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import { FAKE_ASSETS_URL, fakeToken } from './__fixtures__/fake-assets-service.js';
import type { AssetsFetch } from './assets-http.js';
import { HttpAssetSource } from './http-asset-source.js';
import { MAX_RECORD_READS } from './record-reads.js';

/**
 * An asset id for a number.
 *
 * @param index - The number.
 * @returns A distinct id.
 */
function assetNumber(index: number): AssetId {
  return createHash('sha256')
    .update(`board ${String(index)}`)
    .digest('hex') as AssetId;
}

/**
 * A fetch whose every record is `404` (assets the board is not linked to), answered a macrotask
 * later, counting the requests in flight and the order the records were asked for.
 *
 * @returns The fetch, the ids asked for, and the most requests in flight at once.
 */
function unknownService() {
  const asked: AssetId[] = [];
  let inFlight = 0;
  let mostInFlight = 0;
  const fetch: AssetsFetch = async (input, init) => {
    expect(new URL(input).pathname).toBe('/assets/records');
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON batch body.');
    const { ids } = JSON.parse(init.body) as { ids: AssetId[] };
    expect(ids.length).toBeLessThanOrEqual(50);
    asked.push(...ids);
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    inFlight -= 1;
    return new Response(JSON.stringify({ records: ids.map(() => null) }), { status: 200 });
  };
  return { fetch, asked, mostInFlight: () => mostInFlight };
}

describe('HttpAssetSource descriptions at load (fix round 2)', () => {
  it('describes 5,000 unknown assets at most twelve at a time, those on screen first', async () => {
    const service = unknownService();
    const source = new HttpAssetSource(
      { assetsUrl: FAKE_ASSETS_URL, boardId: 'board-a', token: fakeToken('board-a') },
      { fetch: service.fetch, isAvifDecodable: Promise.resolve(false) },
    );
    const ids = Array.from({ length: 5000 }, (unused, index) => assetNumber(index));
    const onScreen = ids.filter((unused, index) => index % 100 === 99);
    const near = ids.filter((unused, index) => index % 100 === 42);
    source.setVisibleAssets(new Set(onScreen), new Set(near));
    const infos = await Promise.all(ids.map((assetId) => source.describe(assetId)));
    // Every one is pending (the board cannot read it), and none was asked for twice.
    expect(infos.every(({ naturalSize }) => naturalSize === null)).toBe(true);
    expect(service.asked).toHaveLength(5000);
    expect(service.mostInFlight()).toBe(MAX_RECORD_READS);
    expect(new Set(service.asked.slice(0, onScreen.length))).toEqual(new Set(onScreen));
    expect(new Set(service.asked.slice(onScreen.length, onScreen.length + near.length))).toEqual(
      new Set(near),
    );
    source.destroy();
  });
});
