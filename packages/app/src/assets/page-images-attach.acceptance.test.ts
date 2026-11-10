// Written before the export code. CONTRACT: an export engine has its own image link
// beside the connected engine, including access and visibility across connect replacement.
// Deliberately not asserted: menu animation, background colour, PNG encoding, PDF.
import { describe, expect, it } from 'vitest';

import { BOARD, ofType, setUp } from './__fixtures__/page-images-setup.js';
import { directLinks, type PageAssetMessage, type PageLink } from './asset-channel.js';
import type { PageImages } from './page-images.js';

const attach = (images: PageImages, link: PageLink): (() => void) =>
  (images as PageImages & { attach(link: PageLink): () => void }).attach(link);

async function settleMessages(): Promise<void> {
  // A repeated ask fetches a fresh token first, a few more microtasks than a first ask.
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe('PageImages.attach', () => {
  it('answers both links, sends visibility to both, and detaches only the additional link', async () => {
    const { images, adapter: connected, toAdapter, visibility } = setUp();
    const extra = directLinks();
    const received: PageAssetMessage[] = [];
    extra.adapter.listen((message) => received.push(message));
    const detach = attach(images, extra.page);
    await settleMessages();
    expect(ofType(received, 'page-visibility')).toEqual([
      { type: 'page-visibility', isHidden: false },
    ]);
    extra.adapter.send({ type: 'access-request' });
    connected.send({ type: 'access-request' });
    await settleMessages();
    expect(ofType(received, 'access')).toMatchObject([
      { type: 'access', access: { boardId: BOARD } },
    ]);
    expect(ofType(toAdapter, 'access')).toMatchObject([
      { type: 'access', access: { boardId: BOARD } },
    ]);
    visibility.set(true);
    await settleMessages();
    expect(ofType(received, 'page-visibility').at(-1)).toEqual({
      type: 'page-visibility',
      isHidden: true,
    });
    expect(ofType(toAdapter, 'page-visibility').at(-1)).toEqual({
      type: 'page-visibility',
      isHidden: true,
    });
    const count = received.length;
    detach();
    extra.adapter.send({ type: 'access-request' });
    connected.send({ type: 'access-request' });
    await settleMessages();
    expect(received).toHaveLength(count);
    expect(ofType(toAdapter, 'access')).toHaveLength(2);
    images.destroy();
  });

  it('keeps the attached link after the connected link is replaced', async () => {
    const { images, adapter: original } = setUp();
    const extra = directLinks();
    const replacement = directLinks();
    const attachedMessages: PageAssetMessage[] = [];
    const replacementMessages: PageAssetMessage[] = [];
    extra.adapter.listen((message) => attachedMessages.push(message));
    replacement.adapter.listen((message) => replacementMessages.push(message));
    const detach = attach(images, extra.page);
    images.connect(replacement.page);
    original.send({ type: 'access-request' });
    extra.adapter.send({ type: 'access-request' });
    replacement.adapter.send({ type: 'access-request' });
    await settleMessages();
    expect(ofType(attachedMessages, 'access')).toHaveLength(1);
    expect(ofType(replacementMessages, 'access')).toHaveLength(1);
    detach();
    images.destroy();
  });
});
