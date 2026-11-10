import { describe, expect, it } from 'vitest';

import { settle } from './__fixtures__/manual-schedule.js';
import { directLinks, type AdapterAssetMessage, type PageLink } from './asset-channel.js';
import { EngineLinks } from './engine-links.js';

/**
 * Engine links that record what they hear and which link became current.
 *
 * @returns The links, the messages heard and the links made current.
 */
function setUp() {
  const heard: AdapterAssetMessage[] = [];
  const current: { link: PageLink; isRestored: boolean }[] = [];
  const links = new EngineLinks(
    (message) => heard.push(message),
    (link, isRestored) => current.push({ link, isRestored }),
  );
  return { links, heard, current };
}

describe('EngineLinks', () => {
  it('parks the link before a newer one and restores it once the newer one is released', async () => {
    const { links, heard, current } = setUp();
    const live = directLinks();
    const preview = directLinks();
    links.connect(live.page);
    const release = links.connect(preview.page);
    expect(links.current).toBe(preview.page);
    live.adapter.send({ type: 'access-request' });
    preview.adapter.send({ type: 'local-image-held', assetId: 'a' as never });
    await settle();
    // Only the current link is heard.
    expect(heard).toEqual([{ type: 'local-image-held', assetId: 'a' }]);
    release();
    expect(links.current).toBe(live.page);
    expect(current.map(({ link, isRestored }) => [link, isRestored])).toEqual([
      [live.page, false],
      [preview.page, false],
      [live.page, true],
    ]);
    // The released link is closed; the restored one is heard again.
    preview.adapter.send({ type: 'access-request' });
    live.adapter.send({ type: 'access-request' });
    await settle();
    expect(heard).toEqual([{ type: 'local-image-held', assetId: 'a' }, { type: 'access-request' }]);
    release();
    expect(links.current).toBe(live.page);
  });

  it('closes a parked link released first, leaving the current one', async () => {
    const { links, heard } = setUp();
    const old = directLinks();
    const next = directLinks();
    const releaseOld = links.connect(old.page);
    links.connect(next.page);
    releaseOld();
    expect(links.current).toBe(next.page);
    old.adapter.send({ type: 'access-request' });
    next.adapter.send({ type: 'access-request' });
    await settle();
    expect(heard).toHaveLength(1);
  });

  it('has no link once the only one is released, and closes all of them', async () => {
    const { links, heard } = setUp();
    const only = directLinks();
    links.connect(only.page)();
    expect(links.current).toBeUndefined();
    const parked = directLinks();
    const top = directLinks();
    links.connect(parked.page);
    links.connect(top.page);
    links.closeAll();
    expect(links.current).toBeUndefined();
    parked.adapter.send({ type: 'access-request' });
    top.adapter.send({ type: 'access-request' });
    await settle();
    expect(heard).toEqual([]);
  });
});
