import type { AssetRecord } from '@canvas/schema';

import type { AssetFollower } from './asset-follower.js';
import type { AssetsHttp } from './assets-http.js';
import type { ScheduleTimer } from './poll-budget.js';

/**
 * The most event streams a board's follower keeps open at once: a browser opens at most six
 * HTTP/1.1 connections to a host, and the level fetches need the rest. Assets past it are polled
 * until a stream frees.
 */
export const MAX_EVENT_STREAMS = 3;

/** The part of the assets client the follower calls. */
export type FollowerHttp = Pick<AssetsHttp, 'record' | 'events'> &
  Partial<Pick<AssetsHttp, 'readWaitMs'>>;

/** What an {@link AssetFollower} needs. */
export interface AssetFollowerOptions {
  /** The board's client now (a refreshed token makes a new one). */
  readonly http: () => FollowerHttp;
  /** Receives every record the follower reads, in order. */
  readonly onRecord: (record: AssetRecord) => void;
  /** Told when the service refused the token (`401`): the page is asked for a fresh one. */
  readonly onUnauthorised?: () => void;
  /** Schedules the waits; the thread's `setTimeout` by default. */
  readonly schedule?: ScheduleTimer;
  /** The clock the waits are measured by, ms; `Date.now` by default. */
  readonly now?: () => number;
  /** The most streams open at once; {@link MAX_EVENT_STREAMS} by default. */
  readonly maxStreams?: number;
}
