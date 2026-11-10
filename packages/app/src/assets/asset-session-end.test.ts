// Once the board's session ended, the engine's asset
// adapter makes no request, a read or a fetch waiting to be made included, and asks the page for
// no access; what it already holds stays. The page's side: page-images-session-end.test.ts.
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { NO_IMAGE_ASSETS } from '@canvas/engine';
import type { AssetId } from '@canvas/schema';

import {
  FAKE_ASSETS_URL,
  FakeAssetsService,
  fakeToken,
} from './__fixtures__/fake-assets-service.js';
import { ManualSchedule, settle } from './__fixtures__/manual-schedule.js';
import { directLinks, isPageAssetMessage, type AdapterAssetMessage } from './asset-channel.js';
import { refusingOnceEnded, SESSION_ENDED_REQUEST_MESSAGE } from './ended-fetch.js';
import { LinkedAssetSource } from './linked-asset-source.js';

const BYTES = new Uint8Array([7, 7, 7]);
const ASSET = createHash('sha256').update(BYTES).digest('hex') as AssetId;
const ACCESS = { assetsUrl: FAKE_ASSETS_URL, boardId: 'board-a', token: fakeToken('board-a') };

/**
 * A linked source over the fake, with the page's end in the test's hands.
 *
 * @returns The source, the page's end, the fake and what the page received.
 */
function setUp() {
  const service = new FakeAssetsService();
  service.seed(BYTES, ['board-a']);
  const { page, adapter } = directLinks();
  const received: AdapterAssetMessage[] = [];
  page.listen((message) => received.push(message));
  const schedule = new ManualSchedule();
  const source = new LinkedAssetSource(adapter, {
    fallback: NO_IMAGE_ASSETS,
    fetch: service.fetch,
    isAvifDecodable: Promise.resolve(true),
    schedule: schedule.schedule,
    now: () => schedule.now,
  });
  return { source, page, service, received };
}

describe('the asset adapter once the session ended', () => {
  it('takes the message', () => {
    expect(isPageAssetMessage({ type: 'session-ended' })).toBe(true);
  });

  it('makes no request for a read begun before, and takes no access after', async () => {
    const { source, page, service, received } = setUp();
    page.send({ type: 'access', access: ACCESS });
    await settle();
    const before = service.requests.length;
    const describing = source.describe(ASSET).catch(() => undefined);
    page.send({ type: 'session-ended' });
    await describing;
    await settle();
    expect(service.requests).toHaveLength(before);
    // A late access is not taken, and none is asked for.
    page.send({ type: 'access', access: ACCESS });
    const asked = received.filter(({ type }) => type === 'access-request').length;
    await source.describe(ASSET).catch(() => undefined);
    await settle();
    expect(service.requests).toHaveLength(before);
    expect(received.filter(({ type }) => type === 'access-request')).toHaveLength(asked);
  });
});

describe('refusingOnceEnded', () => {
  it('fetches until the session ended, then refuses before the network', async () => {
    let isEnded = false;
    const calls: string[] = [];
    const fetch = refusingOnceEnded(
      () => isEnded,
      (input) => {
        calls.push(input);
        return Promise.resolve(new Response('ok'));
      },
    );
    await fetch('https://assets.test/a');
    isEnded = true;
    await expect(fetch('https://assets.test/b')).rejects.toThrow(SESSION_ENDED_REQUEST_MESSAGE);
    expect(calls).toEqual(['https://assets.test/a']);
  });
});
