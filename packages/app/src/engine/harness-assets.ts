import {
  createFixtureAssetSource,
  type EngineImageSupport,
  type FixtureFetch,
} from '@canvas/engine';

/** The seed of the harness's synthetic images: the same pixels in every run. */
export const HARNESS_ASSET_SEED = 73;

/**
 * How long the harness's assets take to serve anything but a smallest (128 px) level, ms: a
 * network slow enough that zooming in shows the smallest level before the larger one arrives,
 * which the scenario tests and the memory benchmark rely on.
 */
export const HARNESS_LEVEL_LATENCY_MS = 150;

/**
 * The name of the harness's asset channel (`HARNESS_ASSET_CHANNEL`), as a type the
 * scenario tool checks its own copy against.
 */
export type HarnessAssetChannel = 'canvas-harness-assets';

/**
 * The `BroadcastChannel` a scenario holds and releases the harness's larger levels on (the
 * scenario tool's `holdAssetLevels` and `releaseAssetLevels`): it reaches the asset source in
 * the engine worker as well as on the page.
 */
export const HARNESS_ASSET_CHANNEL: HarnessAssetChannel = 'canvas-harness-assets';

/**
 * A message on `HARNESS_ASSET_CHANNEL`: a scenario asks to `hold` or `release` the larger
 * levels, and the asset source answers `held` or `released` once it has.
 */
export interface HarnessAssetMessage {
  /** What is asked or answered. */
  readonly type: 'hold' | 'release' | 'held' | 'released';
}

/**
 * Holds the harness's larger levels back until released: a deterministic "the larger level has
 * not arrived yet" for the never-blank scenario, where a real-time latency can pass on a loaded
 * machine before the test looks.
 */
export class AssetLatch {
  private held: Promise<void> | undefined;
  private open: (() => void) | undefined;

  /** Holds every larger level that has not been served yet, until `release`. */
  hold(): void {
    if (this.held !== undefined) return;
    this.held = new Promise((resolve) => {
      this.open = resolve;
    });
  }

  /** Serves every held level, and those to come at once. */
  release(): void {
    this.open?.();
    this.held = undefined;
    this.open = undefined;
  }

  /**
   * Waits while the latch holds.
   *
   * @returns Settles once released, or at once.
   */
  wait(): Promise<void> {
    return this.held ?? Promise.resolve();
  }
}

/**
 * Waits before a fetch as a slow network would: at once for a 128 px level, else
 * {@link HARNESS_LEVEL_LATENCY_MS}, and then while the latch holds.
 *
 * @param request - The fetch.
 * @param latch - Holds larger levels back while a scenario asks.
 * @returns Settles when the fetch may answer.
 */
export async function harnessLatency(
  request: FixtureFetch,
  latch: AssetLatch = new AssetLatch(),
): Promise<void> {
  const isSmallest = request.kind === 'level' && request.longEdgePx === 128;
  if (isSmallest) return;
  await new Promise((resolve) => {
    setTimeout(resolve, HARNESS_LEVEL_LATENCY_MS);
  });
  await latch.wait();
}

/** The part of a `BroadcastChannel` the latch listens on. */
export interface LatchChannel {
  /** Receives messages. */
  onmessage: ((event: MessageEvent<HarnessAssetMessage>) => void) | null;
  /**
   * Sends a message.
   *
   * @param message - The message.
   */
  postMessage(message: HarnessAssetMessage): void;
}

/**
 * Lets a scenario hold and release a latch over a channel, each answered once done.
 *
 * @param latch - The latch.
 * @param channel - The channel.
 */
export function listenForAssetLatch(latch: AssetLatch, channel: LatchChannel): void {
  channel.onmessage = (event) => {
    if (event.data.type === 'hold') {
      latch.hold();
      channel.postMessage({ type: 'held' });
    } else if (event.data.type === 'release') {
      latch.release();
      channel.postMessage({ type: 'released' });
    }
  };
}

/** A channel the harness opens for its latch, and closes with the engine. */
export interface HarnessChannel extends LatchChannel {
  /** Closes the channel. */
  close(): void;
}

/**
 * Opens the harness's `BroadcastChannel`, where the thread has one (a window and a worker do; a
 * test's Node may not).
 *
 * @returns The channel, or undefined.
 */
function openHarnessChannel(): HarnessChannel | undefined {
  return typeof BroadcastChannel === 'function'
    ? new BroadcastChannel(HARNESS_ASSET_CHANNEL)
    : undefined;
}

/**
 * The image support of harness builds (`VITE_CANVAS_HARNESS=1`) until the app talks to the
 * assets service: every asset id is a seeded synthetic image (`createFixtureAssetSource`),
 * served with {@link harnessLatency}, its larger levels held while a scenario asks on
 * `HARNESS_ASSET_CHANNEL`. Created only on the thread the engine runs on, so one latch answers a
 * scenario; `close` closes its channel when the engine is destroyed.
 *
 * @param openChannel - Opens the latch's channel; the harness's `BroadcastChannel` by default.
 * @returns The support.
 */
export function createHarnessImageSupport(
  openChannel: () => HarnessChannel | undefined = openHarnessChannel,
): EngineImageSupport {
  const latch = new AssetLatch();
  const channel = openChannel();
  if (channel !== undefined) listenForAssetLatch(latch, channel);
  return {
    assets: createFixtureAssetSource(HARNESS_ASSET_SEED, {
      beforeFetch: (request) => harnessLatency(request, latch),
    }),
    close: () => {
      channel?.close();
    },
  };
}
