import { describe, expect, it } from 'vitest';

import { NO_IMAGE_ASSETS } from '../images/image-pass-support.js';
import { flushMicrotasks } from '../workers/__fixtures__/fake-worker-transport.js';

import { FakeCanvas, FakeHostPlatform } from './__fixtures__/fake-host-platform.js';
import { createEngineWorkerEntry } from './engine-worker-entry.js';
import type { WorkerToHostMessage } from './host-protocol.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };
const INIT = { type: 'engine-init', canvas: new FakeCanvas(4, 2), options: {} } as const;

function setUp(): {
  platform: FakeHostPlatform;
  entry: ReturnType<typeof createEngineWorkerEntry>;
  posted: { message: WorkerToHostMessage; transfer: readonly object[] }[];
  post: (message: unknown, transfer: readonly object[]) => void;
} {
  const platform = new FakeHostPlatform();
  const posted: { message: WorkerToHostMessage; transfer: readonly object[] }[] = [];
  const post = (message: unknown, transfer: readonly object[]): void => {
    posted.push({ message: message as WorkerToHostMessage, transfer });
  };
  return { platform, entry: createEngineWorkerEntry(platform), posted, post };
}

const types = (posted: { message: WorkerToHostMessage }[]): string[] =>
  posted.map(({ message }) =>
    message.type === 'engine-failure' ? `failure: ${message.failure.message}` : message.type,
  );

describe('createEngineWorkerEntry', () => {
  it('answers init with the backend capabilities and its clock origin', async () => {
    const { entry, posted, post, platform } = setUp();
    await entry.onMessage(INIT, post);
    expect(posted[0]?.message).toEqual({
      type: 'engine-ready',
      capabilities: platform.backends[0]?.capabilities,
      timeOriginMs: platform.timeOriginMs,
    });
  });

  it('refuses malformed messages, commands before init and a second init', async () => {
    const { entry, posted, post } = setUp();
    await entry.onMessage({ type: 'engine-commands', commands: [{ type: 'fly' }] }, post);
    await entry.onMessage({ type: 'engine-commands', commands: [] }, post);
    await entry.onMessage(INIT, post);
    await entry.onMessage(INIT, post);
    entry.onMessageError(post);
    expect(types(posted)).toEqual([
      'failure: The engine worker received a malformed message.',
      'failure: The engine worker received commands before it started.',
      'engine-ready',
      'failure: The engine worker was started twice.',
      'failure: A message to the engine worker could not be deserialised.',
    ]);
  });

  it('creates the image support from the init’s channel once the backend exists', async () => {
    const platform = new FakeHostPlatform();
    const channels: (object | undefined)[] = [];
    const createImages = (channel: object | undefined) => {
      channels.push(channel);
      return { assets: NO_IMAGE_ASSETS };
    };
    const posted: WorkerToHostMessage[] = [];
    const post = (message: unknown): void => {
      posted.push(message as WorkerToHostMessage);
    };
    const withChannel = createEngineWorkerEntry(platform, { createImages });
    await withChannel.onMessage({ ...INIT, imageChannel: { port: 'images' } }, post);
    const without = createEngineWorkerEntry(platform, { createImages });
    await without.onMessage(INIT, post);
    expect(channels).toEqual([{ port: 'images' }, undefined]);
    platform.backendFailure = new Error('no adapter');
    await createEngineWorkerEntry(platform, { createImages }).onMessage(INIT, post);
    expect(channels).toHaveLength(2);
    await createEngineWorkerEntry(platform).onMessage({ ...INIT, imageChannel: 7 }, post);
    expect(posted.map(({ type }) => type)).toEqual([
      'engine-ready',
      'engine-ready',
      'engine-failure',
      'engine-failure',
    ]);
  });

  it('reports a backend that cannot be created', async () => {
    const { entry, posted, post, platform } = setUp();
    platform.backendFailure = new Error('no adapter');
    await entry.onMessage(INIT, post);
    expect(types(posted)).toEqual(['failure: no adapter']);
  });

  it("draws a frameless worker's frames at the page's ticks, asked once per frame", async () => {
    const platform = new FakeHostPlatform();
    platform.hasAnimationFrames = false;
    const entry = createEngineWorkerEntry(platform);
    const posted: WorkerToHostMessage[] = [];
    const post = (message: unknown): void => {
      posted.push(message as WorkerToHostMessage);
    };
    await entry.onMessage(INIT, post);
    await entry.onMessage(
      { type: 'engine-commands', commands: [{ type: 'camera', camera: CAMERA }] },
      post,
    );
    expect(platform.pendingFrames).toBe(0);
    expect(posted.map(({ type }) => type)).toEqual(['engine-ready', 'engine-needs-frame-tick']);
    await entry.onMessage({ type: 'engine-frame-tick' }, post);
    expect(posted.map(({ type }) => type).slice(2)).toEqual(['engine-frame']);
  });

  it('runs the rest of a batch after a command that fails', async () => {
    const { entry, posted, post, platform } = setUp();
    await entry.onMessage(INIT, post);
    const commands = [
      { type: 'resize', widthPx: -1, heightPx: 2, dpr: 1 },
      { type: 'camera', camera: CAMERA },
    ];
    await entry.onMessage({ type: 'engine-commands', commands }, post);
    platform.runFrame(0);
    expect(types(posted).slice(1)).toEqual([
      expect.stringMatching(/^failure: A canvas size/),
      'engine-frame',
    ]);
  });

  it('transfers read pixels, and answers a read whose reply cannot be posted with a failure for its id', async () => {
    const { entry, posted, platform } = setUp();
    let isNextPostFailing = false;
    const post = (message: unknown, transfer: readonly object[]): void => {
      if (isNextPostFailing) {
        isNextPostFailing = false;
        throw new Error('DataCloneError');
      }
      posted.push({ message: message as WorkerToHostMessage, transfer });
    };
    await entry.onMessage(INIT, post);
    const rect = { xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 };
    const commands = [
      { type: 'camera', camera: CAMERA },
      { type: 'read-pixels', id: 7, rect },
    ];
    await entry.onMessage({ type: 'engine-commands', commands }, post);
    platform.runFrame(0);
    await flushMicrotasks();
    const pixels = posted.find(({ message }) => message.type === 'engine-pixels');
    expect(pixels?.message).toMatchObject({ id: 7, pixels: { widthPx: 1, heightPx: 1 } });
    expect(pixels?.transfer).toHaveLength(1);
    await entry.onMessage({ type: 'engine-commands', commands: commands.slice(1) }, post);
    platform.runFrame(16);
    // The frame's report is posted within the frame; the pixels follow once read back.
    isNextPostFailing = true;
    await flushMicrotasks();
    expect(posted.at(-1)?.message).toEqual({
      type: 'engine-failure',
      id: 7,
      failure: { name: 'Error', message: 'DataCloneError' },
    });
  });
});
