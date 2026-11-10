// Fakes of the upload badges' tests: an image in a frame, uploads over a fake run, and an engine
// recording its selection and canvas actions.
import { act } from '@testing-library/react';
import { vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { AssetId, BoardObject, ImageObject, ObjectId } from '@canvas/schema';

import type { MountedEngine } from '../../engine/mounted-engine.js';
import { ImageUploads } from '../image-uploads.js';
import type { PreparedImage } from '../prepare-image.js';
import type { UploadEvent } from '../upload-state.js';

/** The camera: at (100, 50), zoom 2, an 800 × 600 view. */
export const CAMERA: Camera = {
  x: 100,
  y: 50,
  zoom: 2,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};
/** The uploaded asset. */
export const ASSET = 'a'.repeat(64) as AssetId;
/** The image's id. */
export const PHOTO = 'photo' as ObjectId;

/**
 * An image object in a frame.
 *
 * @param fields - Fields to set.
 * @returns The image.
 */
export function image(fields: Partial<ImageObject> = {}): ImageObject {
  return {
    id: PHOTO,
    type: 'image',
    parentId: null,
    x: 150,
    y: 100,
    rotation: 0,
    width: 200,
    height: 100,
    ...fields,
  } as ImageObject;
}

/**
 * A board reader over some objects.
 *
 * @param objects - The objects.
 * @returns The reader.
 */
export function reader(objects: readonly BoardObject[]) {
  return { get: (id: ObjectId) => objects.find((object) => object.id === id) };
}

/** The asset as the page prepared it. */
export const PREPARED: PreparedImage = {
  assetId: ASSET,
  naturalSize: { width: 1, height: 1 },
  mimeType: 'image/png',
  byteLength: 1,
};

/**
 * Uploads over a fake run, whose events and settling the test drives.
 *
 * @returns The uploads, the latest run's emit and signal, and how many runs started.
 */
export function fakeUploads() {
  const runs: { emit: (event: UploadEvent) => void; signal: AbortSignal; finish: () => void }[] =
    [];
  const uploads = new ImageUploads(
    (prepared, file, onEvent, signal) =>
      new Promise((resolve) => {
        runs.push({
          emit: onEvent,
          signal,
          finish: () => {
            resolve();
          },
        });
      }),
    () => undefined,
  );
  const emit = (event: UploadEvent) => {
    act(() => {
      runs.at(-1)?.emit(event);
    });
  };
  return { uploads, runs, emit };
}

/**
 * An engine fake over some objects, recording its selection and canvas actions.
 *
 * @param objects - The board's objects.
 * @returns The engine and its spies.
 */
export function fakeEngine(objects: readonly BoardObject[] = [image()]) {
  const select = vi.fn();
  const runCanvasAction = vi.fn();
  const engine = {
    camera: () => CAMERA,
    board: {
      board: {
        ...reader(objects),
        read: () => ({ objects: new Map(objects.map((o) => [o.id, o])) }),
      },
      select,
    },
    runCanvasAction,
  } as unknown as MountedEngine;
  return { engine, select, runCanvasAction };
}
