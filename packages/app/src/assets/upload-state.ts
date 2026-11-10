import type { AssetStatus } from '@canvas/schema';

/**
 * Where one image upload stands: `queued` until a slot is free,
 * `uploading` its bytes to the signed URL, `completing` while the service verifies them against
 * the hash, `processing` while the pyramid is generated, then `ready`; `failed` whenever a step
 * gave up, from which the person can retry.
 */
export type UploadPhase = 'queued' | 'uploading' | 'completing' | 'processing' | 'ready' | 'failed';

/** One upload's state, as its badge on the image shows it. */
export interface UploadState {
  /** Where it stands. */
  readonly phase: UploadPhase;
  /** How far the phase is, 0 to 1: bytes sent while uploading, the pyramid while processing. */
  readonly progress: number;
  /** Bytes sent so far, while uploading, once the put reported any. */
  readonly sentBytes?: number;
  /** Bytes in all, while uploading, once the put reported any. */
  readonly totalBytes?: number;
  /** Why it failed, a sentence for the person; only when `failed`. */
  readonly failure?: string;
  /** How many times it was started, retries included. */
  readonly attempts: number;
}

/** What happened to an upload. */
export type UploadEvent =
  | {
      /** A slot is free: the upload declares itself and starts sending. */
      readonly type: 'start';
    }
  | {
      /** Bytes went out. */
      readonly type: 'sent';
      /** Bytes sent so far. */
      readonly loaded: number;
      /** Bytes in all. */
      readonly total: number;
    }
  | {
      /** The bytes are all sent (or the board already had them): verifying. */
      readonly type: 'sent-all';
    }
  | {
      /** The asset's record said where it is: after the completion, and then from its events. */
      readonly type: 'record';
      /** Its status. */
      readonly status: AssetStatus;
      /** Its pyramid's progress, 0 to 1. */
      readonly progress: number;
    }
  | {
      /** A step gave up. */
      readonly type: 'error';
      /** Why, a sentence for the person. */
      readonly message: string;
    }
  | {
      /** The person asked to try again. */
      readonly type: 'retry';
    };

/** A new upload, waiting for a slot. */
export const QUEUED_UPLOAD: UploadState = Object.freeze({
  phase: 'queued',
  progress: 0,
  attempts: 0,
});

/** The sentence for an asset whose pyramid the service could not generate. */
export const PROCESSING_FAILED_MESSAGE = 'The server could not process this image.';

/**
 * Whether an upload is still under way (a badge with progress), rather than done or failed.
 *
 * @param state - The upload.
 * @returns True while queued, uploading, completing or processing.
 */
export function isUploadActive(state: UploadState): boolean {
  return state.phase !== 'ready' && state.phase !== 'failed';
}

/**
 * The state after a record: `ready` or `failed` with the asset, else processing with its
 * progress.
 *
 * @param state - The upload.
 * @param status - The record's status.
 * @param progress - The record's progress.
 * @returns The new state.
 */
function afterRecord(state: UploadState, status: AssetStatus, progress: number): UploadState {
  if (status === 'ready') return { phase: 'ready', progress: 1, attempts: state.attempts };
  if (status === 'failed') {
    return { ...state, phase: 'failed', progress: 0, failure: PROCESSING_FAILED_MESSAGE };
  }
  // `uploading` after a completion means the service has the bytes and is about to process.
  if (state.phase === 'processing' && state.progress === progress) return state;
  return { phase: 'processing', progress, attempts: state.attempts };
}

/**
 * One upload's state machine: events
 * that do not apply where the upload stands leave it as it is, so a late byte count or a record
 * of an earlier attempt changes nothing. Pure.
 *
 * @param state - The upload now.
 * @param event - What happened.
 * @returns The upload after it.
 */
export function stepUpload(state: UploadState, event: UploadEvent): UploadState {
  switch (event.type) {
    case 'start':
      return state.phase === 'queued'
        ? { phase: 'uploading', progress: 0, attempts: state.attempts + 1 }
        : state;
    case 'sent':
      return state.phase === 'uploading'
        ? {
            ...state,
            progress: event.total > 0 ? Math.min(1, event.loaded / event.total) : 0,
            sentBytes: Math.min(event.loaded, event.total),
            totalBytes: event.total,
          }
        : state;
    case 'sent-all':
      return state.phase === 'uploading'
        ? { phase: 'completing', progress: 1, attempts: state.attempts }
        : state;
    case 'record':
      return state.phase === 'completing' || state.phase === 'processing'
        ? afterRecord(state, event.status, event.progress)
        : state;
    case 'error':
      return isUploadActive(state)
        ? { ...state, phase: 'failed', progress: 0, failure: event.message }
        : state;
    case 'retry':
      return state.phase === 'failed' ? { ...QUEUED_UPLOAD, attempts: state.attempts } : state;
  }
}

/** Bytes in a megabyte, as the upload's label counts them (decimal, as the system's file sizes). */
const BYTES_PER_MB = 1_000_000;

/**
 * The bytes an upload has sent, as its placeholder says them ("3.2 of 8.0 MB"): one
 * decimal of a megabyte. Pure.
 *
 * @param sentBytes - Bytes sent.
 * @param totalBytes - Bytes in all.
 * @returns The words.
 */
export function uploadBytesLabel(sentBytes: number, totalBytes: number): string {
  const mb = (bytes: number) => (Math.max(0, bytes) / BYTES_PER_MB).toFixed(1);
  return `${mb(Math.min(sentBytes, totalBytes))} of ${mb(totalBytes)} MB`;
}
