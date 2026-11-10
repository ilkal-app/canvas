import { useMemo, useSyncExternalStore, type ReactElement } from 'react';

import type { AssetId, ObjectId } from '@canvas/schema';

import { Button } from '../controls/button.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { Spinner } from '../feedback/spinner.js';

import {
  imageObjectsOf,
  imageOverlayRectOf,
  type ImageOverlayRect,
} from './image-overlay-placement.js';
import type { ImageUploads, UploadEntry } from './image-uploads.js';
import type { ProcessingImages } from './processing-images.js';
import styles from './upload-badges.module.css';
import { uploadRemovalOf } from './upload-removal.js';
import { uploadBytesLabel, type UploadState } from './upload-state.js';
import { useFollowOverlays } from './use-follow-overlays.js';

/** What a processing image says, the page's own upload's and a collaborator's. */
export const PROCESSING_IMAGE_LABEL = 'Processing image…';

/** The heading of a failed upload's placeholder. */
export const UPLOAD_FAILED_LABEL = 'Upload failed';

/**
 * What an upload's placeholder says: its bytes while it uploads ("Uploading · 3.2 of
 * 8.0 MB", the put's own count once it reports, the file's size before), what it is doing after,
 * and why it failed. Pure.
 *
 * @param state - The upload.
 * @param byteLength - The file's size, bytes.
 * @returns The sentence.
 */
export function uploadLabelOf(state: UploadState, byteLength = 0): string {
  switch (state.phase) {
    case 'queued':
      return 'Waiting to upload';
    case 'uploading': {
      const total = state.totalBytes ?? byteLength;
      return `Uploading · ${uploadBytesLabel(state.sentBytes ?? 0, total)}`;
    }
    case 'completing':
      return 'Checking the upload';
    case 'processing':
      return PROCESSING_IMAGE_LABEL;
    case 'ready':
      return 'Uploaded';
    case 'failed':
      return state.failure ?? 'The upload failed.';
  }
}

/**
 * What a placeholder's live region says: the phase only, so a screen reader hears each phase
 * change once, not every byte count; a failure with its reason. Pure.
 *
 * @param state - The upload.
 * @returns The sentence.
 */
export function uploadPhaseLabelOf(state: UploadState): string {
  switch (state.phase) {
    case 'uploading':
      return 'Uploading';
    case 'failed':
      return `${UPLOAD_FAILED_LABEL}. ${uploadLabelOf(state)}`;
    default:
      return uploadLabelOf(state);
  }
}

/** One overlay to show: an upload's on one of its images, or a collaborator's processing image. */
type Overlay =
  | { readonly key: string; readonly id: ObjectId; readonly entry: UploadEntry }
  | { readonly key: string; readonly id: ObjectId; readonly entry?: undefined };

/** Nothing processing: the store's absence. */
const NO_PROCESSING: readonly AssetId[] = [];

/**
 * The objects of a collaborator's images still processing, read from the board once per report
 * (the adapter's), never per frame.
 *
 * @param processing - The page's report, if any.
 * @param engine - The engine, once it runs.
 * @returns The objects.
 */
function useProcessingObjects(
  processing: ProcessingImages | undefined,
  engine: MountedEngine | undefined,
): readonly ObjectId[] {
  const assetIds = useSyncExternalStore(
    (listener) => processing?.subscribe(listener) ?? (() => undefined),
    () => processing?.snapshot() ?? NO_PROCESSING,
  );
  return useMemo(() => {
    const board = engine?.board.board.read?.();
    if (board === undefined || assetIds.length === 0) return [];
    return imageObjectsOf(board, assetIds, engine?.pages?.current());
  }, [assetIds, engine]);
}

/** Props of {@link UploadBadges}. */
export interface UploadBadgesProps {
  /** The page's uploads. */
  readonly uploads: ImageUploads;
  /** A collaborator's images still processing (`PageImages.processing`); none if absent. */
  readonly processing?: ProcessingImages | undefined;
  /** The engine: its camera and board. */
  readonly engine: MountedEngine | undefined;
}

/**
 * The images' states over the canvas (items 3 and 4: upload progress shows on the object
 * until the record is `ready`): on each image the page is uploading, over the image, a determinate
 * bar with its real bytes ("Uploading · 3.2 of 8.0 MB") and Cancel, which stops the upload and
 * removes its images (a shape's or frame's image fill is cleared instead, the object kept:
 * `uploadRemovalOf`); once sent, a Spinner and what is happening; a failed upload outlined
 * in dashed red with why, Retry and Remove (which deletes the images, never an asset), never
 * leaving a blank image; and on a collaborator's image still processing, a Spinner and "Processing
 * image…". They follow the camera and the images while any shows, re-rendering only when one moved
 * or a state changed (`useFollowOverlays`); with none, nothing runs. A screen reader hears each
 * phase change of the page's uploads, not each byte. Page.
 *
 * @param props - The uploads, the processing images and the engine.
 * @returns The overlays.
 */
export function UploadBadges(props: UploadBadgesProps): ReactElement | null {
  const { uploads, engine } = props;
  const entries = useSyncExternalStore(
    (listener) => uploads.subscribe(listener),
    () => uploads.snapshot(),
  );
  const processingIds = useProcessingObjects(props.processing, engine);
  const overlays = useMemo<readonly Overlay[]>(() => {
    const own = entries.flatMap((entry) =>
      entry.objectIds.map((id) => ({ key: `${entry.assetId}:${id}`, id, entry })),
    );
    const owned = new Set(own.map(({ id }) => id));
    const peers = processingIds
      .filter((id) => !owned.has(id))
      .map((id) => ({ key: `processing:${id}`, id }));
    return [...own, ...peers];
  }, [entries, processingIds]);
  useFollowOverlays(overlays, entries, engine, uploads);
  if (engine === undefined || overlays.length === 0) return null;
  const camera = engine.camera();
  const remove = (entry: UploadEntry) => {
    const { deleted, cleared } = uploadRemovalOf(
      engine.board.board,
      entry.assetId,
      entry.objectIds,
    );
    if (cleared.length > 0) engine.runCanvasAction({ type: 'style', changes: [...cleared] });
    if (deleted.length === 0) return;
    engine.board.select(deleted);
    engine.runCanvasAction({ type: 'selection', command: 'delete' });
  };
  return (
    <div className={styles.layer}>
      {overlays.flatMap((overlay) => {
        const rect = imageOverlayRectOf(engine.board.board, overlay.id, camera);
        if (rect === undefined) return [];
        const { entry } = overlay;
        if (entry === undefined) return [<ProcessingOverlay key={overlay.key} rect={rect} />];
        return [
          <UploadOverlay
            key={overlay.key}
            entry={entry}
            rect={rect}
            onCancel={() => {
              uploads.cancel(entry.assetId);
              remove(entry);
            }}
            onRetry={() => {
              uploads.retry(entry.assetId);
            }}
            onRemove={() => {
              uploads.forget(entry.assetId);
              remove(entry);
            }}
          />,
        ];
      })}
    </div>
  );
}

/**
 * The style that puts an overlay over its image: at its top-left corner, its size, turned.
 *
 * @param rect - The image's box on screen.
 * @returns The style.
 */
function boxStyle(rect: ImageOverlayRect) {
  const roundedDeg = Number(rect.rotationDeg.toFixed(3));
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    // Rounded: a composed quarter turn is 89.99999999999999 degrees.
    transform: rect.rotationDeg === 0 ? undefined : `rotate(${String(roundedDeg)}deg)`,
  };
}

/**
 * A collaborator's image still processing: a Spinner and "Processing image…" over it. Not a live
 * region: nothing the person did changed.
 *
 * @param props - Where it goes.
 * @param props.rect - The image's box on screen.
 * @returns The overlay.
 */
function ProcessingOverlay(props: { readonly rect: ImageOverlayRect }): ReactElement {
  return (
    <div className={styles.overlay} data-image-state="processing" style={boxStyle(props.rect)}>
      <div className={styles.panel} data-image-state-panel="">
        <Spinner size={16} />
        <span className={styles.label}>{PROCESSING_IMAGE_LABEL}</span>
      </div>
    </div>
  );
}

/** Props of {@link UploadOverlay}. */
interface UploadOverlayProps {
  readonly entry: UploadEntry;
  readonly rect: ImageOverlayRect;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onRemove: () => void;
}

/**
 * One image's upload: its bar, bytes and Cancel while it is waiting or uploading; a Spinner and
 * what is happening once sent; a failure, outlined, with Retry and Remove.
 *
 * @param props - The upload, where it goes and its actions.
 * @returns The overlay.
 */
function UploadOverlay(props: UploadOverlayProps): ReactElement {
  const { entry, rect } = props;
  const { state } = entry;
  const isFailed = state.phase === 'failed';
  const isSending = state.phase === 'queued' || state.phase === 'uploading';
  return (
    <div
      className={styles.overlay}
      data-image-state={isFailed ? 'failed' : isSending ? 'uploading' : 'processing'}
      data-phase={state.phase}
      data-asset-id={entry.assetId}
      style={boxStyle(rect)}
    >
      <div className={styles.panel} data-image-state-panel="">
        <span className={styles.announcement} role="status">
          {uploadPhaseLabelOf(state)}
        </span>
        {isSending && (
          <progress className={styles.progress} max={1} value={state.progress} aria-hidden="true" />
        )}
        {!isFailed && !isSending && <Spinner size={16} />}
        {isFailed && (
          <span className={styles.heading} aria-hidden="true">
            <span className={styles.dot} />
            {UPLOAD_FAILED_LABEL}
          </span>
        )}
        <span className={isFailed ? styles.reason : styles.label} aria-hidden="true">
          {uploadLabelOf(state, entry.byteLength)}
        </span>
        {isSending && (
          <span className={styles.actions}>
            <Button kind="ghost" name="Cancel upload" onClick={props.onCancel}>
              Cancel
            </Button>
          </span>
        )}
        {isFailed && (
          <span className={styles.actions}>
            <Button kind="ghost" name="Retry upload" onClick={props.onRetry}>
              Retry
            </Button>
            <Button kind="ghost" name="Remove image" onClick={props.onRemove}>
              Remove
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
