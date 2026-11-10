// Shared by the level loader's tests: a source whose fetches wait for the test, and a loader over
// the fixture source with every result recorded.
import type { DecodedLevel } from '../../workers/job-kinds.js';
import type { AssetSource } from '../asset-source.js';
import {
  createFixtureAssetSource,
  fixtureAssetId,
  type FixtureFetch,
} from '../fixture-asset-source.js';
import { LevelLoader, type ImageJobRunner } from '../level-loader.js';
import { RetrySchedule } from '../retry-schedule.js';

import { ManualJobRunner } from './manual-job-runner.js';

/** A photo asset of 3000 × 2000 px. */
export const PHOTO = fixtureAssetId('photo');
/** A square asset of 1000 px. */
export const OTHER = fixtureAssetId('other');
/** The fixture specs of {@link PHOTO} and {@link OTHER}. */
export const ASSETS = {
  [PHOTO]: { naturalSize: { width: 3000, height: 2000 } },
  [OTHER]: { naturalSize: { width: 1000, height: 1000 } },
};

/**
 * A source whose fetches wait until the test releases them, counting those in flight.
 *
 * @returns The source, the held fetches, the aborted ones and the count in flight.
 */
export function heldSource() {
  const held: { readonly fetch: FixtureFetch; readonly release: () => void }[] = [];
  const assets = createFixtureAssetSource(1, {
    assets: ASSETS,
    beforeFetch: (fetch) =>
      new Promise<void>((resolve) => {
        held.push({ fetch, release: resolve });
      }),
  });
  let inFlight = 0;
  const aborted: string[] = [];
  const counted = <T>(name: string, promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
    inFlight += 1;
    signal?.addEventListener('abort', () => aborted.push(name));
    return promise.finally(() => {
      inFlight -= 1;
    });
  };
  const source: AssetSource = {
    ...assets,
    fetchLevel: (assetId, longEdgePx, signal) =>
      counted(
        `${assetId} ${String(longEdgePx)}`,
        assets.fetchLevel(assetId, longEdgePx, signal),
        signal,
      ),
    fetchOriginal: (assetId, signal) =>
      counted(`${assetId} original`, assets.fetchOriginal(assetId, signal), signal),
  };
  return { source, held, aborted, inFlight: () => inFlight };
}

/**
 * A loader with its job runner, its results and the retry waits it makes, all recorded.
 *
 * @param maxInFlight - Loads running at once.
 * @param assets - The source; default the fixture source of {@link ASSETS}.
 * @param runner - The job runner; default a {@link ManualJobRunner}.
 * @returns The loader and what it recorded.
 */
export function createLoader(maxInFlight = 6, assets?: AssetSource, runner?: ImageJobRunner) {
  const jobs = new ManualJobRunner();
  const loaded: string[] = [];
  const levels = new Map<string, DecodedLevel>();
  // Retry waits a test runs by hand, and the retries that fell due.
  const waits: (() => void)[] = [];
  const retriesDue: number[] = [];
  const decoderMissing: Error[] = [];
  const loader = new LevelLoader(
    assets ?? createFixtureAssetSource(1, { assets: ASSETS }),
    runner ?? jobs,
    {
      onLoaded: (key, level) => {
        loaded.push(key);
        levels.set(key, level);
      },
      onRetryDue: () => retriesDue.push(1),
      onDecodeQueued: () => undefined,
      onDecoderMissing: (error) => decoderMissing.push(error),
    },
    maxInFlight,
    new RetrySchedule((callback) => {
      waits.push(callback);
      return undefined;
    }),
  );
  return { loader, jobs, loaded, levels, waits, retriesDue, decoderMissing };
}
