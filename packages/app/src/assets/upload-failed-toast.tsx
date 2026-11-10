import { useState, useSyncExternalStore, type ReactElement } from 'react';

import { useToast } from '../feedback/toast-region.js';

import type { ImageUploads, UploadEntry } from './image-uploads.js';

/**
 * The error toast's words for failed uploads: "1 image couldn’t upload", counted.
 * Pure.
 *
 * @param count - How many uploads failed.
 * @returns The sentence.
 */
export function failedUploadsMessage(count: number): string {
  return `${String(count)} ${count === 1 ? 'image' : 'images'} couldn’t upload`;
}

/**
 * The failures among the page's uploads, each named by its upload and attempt, so a dismissal
 * covers the failures it saw and not the next failure of the same upload after a retry.
 *
 * @param entries - The uploads.
 * @returns One key per failed upload: its asset and its attempt.
 */
function failuresOf(entries: readonly UploadEntry[]): string[] {
  return entries
    .filter(({ state }) => state.phase === 'failed')
    .map(({ assetId, state }) => `${assetId}:${String(state.attempts)}`);
}

/** Props of {@link UploadFailedToast}. */
export interface UploadFailedToastProps {
  /** The page's uploads. */
  readonly uploads: ImageUploads;
}

/**
 * The error toast for failed uploads (item 4), posted to the shared toast
 * region (`useToast`, item 4) like the shell's other notices: the Error kind (so an
 * `alert`, staying until dismissed or acted on, D-TOAST), "1 image couldn’t upload" counted over
 * every failed upload, with Retry (every failed upload again) and Dismiss. A failure after a
 * dismissal posts it again, counting them all, the same upload failing again after a retry
 * included (a dismissal covers the failed attempts it saw); once none is failed, or every failed
 * one was dismissed, it is withdrawn. Page.
 *
 * @param props - The uploads.
 * @returns Nothing inside the toast region; without one, the toast in place.
 */
export function UploadFailedToast(props: UploadFailedToastProps): ReactElement | null {
  const { uploads } = props;
  const entries = useSyncExternalStore(
    (listener) => uploads.subscribe(listener),
    () => uploads.snapshot(),
  );
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const failed = failuresOf(entries);
  const isShown = failed.some((failure) => !dismissed.has(failure));
  return useToast(
    isShown
      ? {
          kind: 'error',
          message: failedUploadsMessage(failed.length),
          action: {
            label: 'Retry',
            onAction: () => {
              uploads.retryFailed();
            },
          },
          onDismiss: () => {
            setDismissed(new Set(failed));
          },
        }
      : undefined,
  );
}
