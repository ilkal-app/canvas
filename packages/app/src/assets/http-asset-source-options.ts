import type { AssetId, AssetRecord } from '@canvas/schema';

import type { AssetsFetch } from './assets-http.js';
import type { HttpAssetSource } from './http-asset-source.js';
import type { ScheduleTimer } from './poll-budget.js';

/** What {@link HttpAssetSource} takes besides the board's access. */
export interface HttpAssetSourceOptions {
  /** The fetch; the thread's own by default. */
  readonly fetch?: AssetsFetch;
  /** The clock signed URLs age by, ms; `Date.now` by default. */
  readonly now?: () => number;
  /** Whether AVIF decodes here; detected with `canDecodeAvif` by default. */
  readonly isAvifDecodable?: Promise<boolean>;
  /** Schedules the follower's waits; the thread's `setTimeout` by default. */
  readonly schedule?: ScheduleTimer;
  /** The most event streams at once. */
  readonly maxStreams?: number;
  /** The most record reads in flight at once; `MAX_RECORD_READS` by default. */
  readonly maxRecordReads?: number;
  /** Asks the page for a fresh token, when the service refused this one. */
  readonly requestAccess?: () => void;
  /** Receives the records of the assets the page uploaded (`uploaded`), for its badges. */
  readonly onStatus?: (record: AssetRecord) => void;
  /**
   * Receives the assets of a collaborator's images on screen still processing, sorted, whenever
   * they change (`ProcessingReport`), for their spinners.
   */
  readonly onProcessing?: (assetIds: readonly AssetId[]) => void;
}
