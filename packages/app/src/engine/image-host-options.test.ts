import { describe, expect, it, vi } from 'vitest';

import { PageImages } from '../assets/page-images.js';
import { ImagePreparer } from '../assets/prepare-image.js';

import { imageHostOptions, type ChannelPorts } from './image-host-options.js';

const ACCESS = {
  assetsUrl: 'http://assets.test',
  boardId: 'board-a',
  token: () => Promise.resolve('token:board-a'),
  tokenFor: () => Promise.resolve(undefined),
};

/**
 * A real channel whose closes are counted.
 *
 * @returns The channel and the count.
 */
function countingChannel(): { channel: ChannelPorts; closed: () => number } {
  const real = new MessageChannel();
  let closed = 0;
  const count = (port: MessagePort) => {
    const close = port.close.bind(port);
    port.close = () => {
      closed += 1;
      close();
    };
    return port;
  };
  return { channel: { port1: count(real.port1), port2: count(real.port2) }, closed: () => closed };
}

describe('imageHostOptions', () => {
  it('gives the fallback without the page’s images, and no channel', () => {
    const options = imageHostOptions(undefined);
    expect(options.imageChannel).toBeUndefined();
    expect(options.createImages(undefined).assets).toBeDefined();
  });

  it('keeps one port for the page’s images and hands the other to the engine', async () => {
    const images = new PageImages(ACCESS, { preparer: new ImagePreparer(() => undefined) });
    const { channel } = countingChannel();
    const options = imageHostOptions(images, () => channel);
    expect(options.imageChannel).toBe(channel.port2);
    // The engine's end asks for the access; the page answers over the port.
    const answers: unknown[] = [];
    const gotAccess = new Promise<void>((resolve) => {
      channel.port2.onmessage = (event: MessageEvent) => {
        answers.push(event.data);
        if ((event.data as { type: string }).type === 'access') resolve();
      };
    });
    channel.port2.postMessage({ type: 'access-request' });
    await gotAccess;
    expect(answers.filter((answer) => (answer as { type: string }).type === 'access')).toEqual([
      {
        type: 'access',
        access: { assetsUrl: 'http://assets.test', boardId: 'board-a', token: 'token:board-a' },
      },
    ]);
    channel.port1.close();
    channel.port2.close();
  });

  it('gives a main-thread host the page’s end directly, closing both ports', async () => {
    // The engine's source reads the board's records with the global fetch. Answered here as an
    // unreachable service at once, never by the network: a real request to assets.test waited on
    // the runner's DNS and timed the test out in the merge queue.
    const fetchRecords = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchRecords);
    try {
      const images = new PageImages(ACCESS, { preparer: new ImagePreparer(() => undefined) });
      const { channel, closed } = countingChannel();
      const options = imageHostOptions(images, () => channel);
      const support = options.createImages(options.imageChannel);
      expect(closed()).toBe(2);
      await expect(support.assets.describe('a'.repeat(64) as never)).resolves.toMatchObject({
        levels: [],
      });
      // The page's access reached the engine's end directly: it asked for the board's records.
      expect(fetchRecords).toHaveBeenCalledWith(
        expect.stringMatching(/^http:\/\/assets\.test\/assets\/records\?board=board-a/),
        expect.anything(),
      );
      support.close?.();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gives the page’s images back to the engine linked before once released', async () => {
    const images = new PageImages(ACCESS, { preparer: new ImagePreparer(() => undefined) });
    const live = countingChannel();
    imageHostOptions(images, () => live.channel);
    // A History preview's engine borrows the images over the mounted live engine.
    const preview = countingChannel();
    const options = imageHostOptions(images, () => preview.channel);
    expect(live.closed()).toBe(0);
    options.release?.();
    expect(preview.closed()).toBe(1);
    // The live engine is current again: it is given a fresh access unasked.
    const gotAccess = new Promise<unknown>((resolve) => {
      live.channel.port2.onmessage = (event: MessageEvent) => {
        if ((event.data as { type: string }).type === 'access') resolve(event.data);
      };
    });
    await expect(gotAccess).resolves.toMatchObject({ access: { boardId: 'board-a' } });
    live.channel.port1.close();
    live.channel.port2.close();
    preview.channel.port2.close();
  });

  it('makes a MessageChannel by default', () => {
    const images = new PageImages(ACCESS, { preparer: new ImagePreparer(() => undefined) });
    const options = imageHostOptions(images);
    expect(options.imageChannel).toBeInstanceOf(MessagePort);
    (options.imageChannel as MessagePort).close();
    images.destroy();
  });
});
