// @vitest-environment jsdom
// The images' states in jsdom (items 3 and 4): over each image being uploaded
// its bar, real bytes and Cancel, following the camera; a failure outlined with Retry and Remove;
// a collaborator's image still processing with a Spinner. In Chrome:
// tooling/scenario/specs/tools/image.spec.ts and image-states.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetId, BoardObject, ObjectId } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';

import {
  ASSET,
  CAMERA,
  fakeEngine,
  fakeUploads,
  image,
  PHOTO,
  PREPARED,
  reader,
} from './__fixtures__/upload-badge-fakes.js';
import { ImageUploads } from './image-uploads.js';
import { ProcessingImages } from './processing-images.js';
import {
  PROCESSING_IMAGE_LABEL,
  UploadBadges,
  uploadLabelOf,
  uploadPhaseLabelOf,
} from './upload-badges.js';
import type { UploadEvent } from './upload-state.js';

afterEach(cleanup);

describe('uploadLabelOf', () => {
  it('announces the phase only, not each byte count; a failure with its reason', () => {
    expect(uploadPhaseLabelOf({ phase: 'uploading', progress: 0.25, attempts: 1 })).toBe(
      'Uploading',
    );
    expect(uploadPhaseLabelOf({ phase: 'processing', progress: 0.5, attempts: 1 })).toBe(
      PROCESSING_IMAGE_LABEL,
    );
    expect(uploadPhaseLabelOf({ phase: 'queued', progress: 0, attempts: 0 })).toBe(
      'Waiting to upload',
    );
    expect(
      uploadPhaseLabelOf({ phase: 'failed', progress: 0, attempts: 1, failure: 'Offline.' }),
    ).toBe('Upload failed. Offline.');
  });

  it('says what the upload is doing, with its real bytes while it uploads', () => {
    expect(uploadLabelOf({ phase: 'queued', progress: 0, attempts: 0 })).toBe('Waiting to upload');
    const uploading = {
      phase: 'uploading',
      progress: 0.4,
      attempts: 1,
      sentBytes: 3_200_000,
      totalBytes: 8_000_000,
    } as const;
    expect(uploadLabelOf(uploading)).toBe('Uploading · 3.2 of 8.0 MB');
    // Before the put reports, the file's own size.
    expect(uploadLabelOf({ phase: 'uploading', progress: 0, attempts: 1 }, 8_000_000)).toBe(
      'Uploading · 0.0 of 8.0 MB',
    );
    expect(uploadLabelOf({ phase: 'completing', progress: 1, attempts: 1 })).toBe(
      'Checking the upload',
    );
    expect(uploadLabelOf({ phase: 'processing', progress: 0.5, attempts: 1 })).toBe(
      'Processing image…',
    );
    expect(uploadLabelOf({ phase: 'ready', progress: 1, attempts: 1 })).toBe('Uploaded');
    expect(uploadLabelOf({ phase: 'failed', progress: 0, attempts: 1, failure: 'Offline.' })).toBe(
      'Offline.',
    );
    expect(uploadLabelOf({ phase: 'failed', progress: 0, attempts: 1 })).toBe('The upload failed.');
  });
});

describe('UploadBadges', () => {
  it('shows the bar, the real bytes and Cancel over each uploading image, over the image', () => {
    const { uploads, emit } = fakeUploads();
    const { engine } = fakeEngine();
    const { container } = render(<UploadBadges uploads={uploads} engine={engine} />);
    expect(container.textContent).toBe('');
    act(() => {
      uploads.add({ ...PREPARED, byteLength: 8_000_000 }, new Blob([]), [
        PHOTO,
        'gone' as ObjectId,
      ]);
    });
    expect(container.textContent).toContain('Waiting to upload');
    emit({ type: 'start' });
    emit({ type: 'sent', loaded: 3_200_000, total: 8_000_000 });
    expect(screen.getByRole('status').textContent).toBe('Uploading');
    expect(container.textContent).toContain('Uploading · 3.2 of 8.0 MB');
    expect(container.querySelector('progress')?.value).toBeCloseTo(0.4);
    // Over the image (its top-left corner at (150 - 100) × 2, (100 - 50) × 2), its size on screen.
    const overlay = container.querySelector<HTMLElement>('[data-image-state="uploading"]');
    expect(overlay?.style).toMatchObject({ left: '100px', top: '100px', width: '400px' });
    expect(overlay?.style.height).toBe('200px');
    expect(screen.getByRole('button', { name: 'Cancel upload' }).textContent).toBe('Cancel');
  });

  it('cancels an upload: its put is stopped, its images removed, nothing more shown', () => {
    const { uploads, runs, emit } = fakeUploads();
    const { engine, select, runCanvasAction } = fakeEngine();
    const { container } = render(<UploadBadges uploads={uploads} engine={engine} />);
    act(() => {
      uploads.add(PREPARED, new Blob([]), [PHOTO]);
    });
    emit({ type: 'start' });
    emit({ type: 'sent', loaded: 1, total: 4 });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel upload' }));
    expect(runs[0]?.signal.aborted).toBe(true);
    expect(select).toHaveBeenCalledWith([PHOTO]);
    expect(runCanvasAction).toHaveBeenCalledWith({ type: 'selection', command: 'delete' });
    expect(uploads.snapshot()).toEqual([]);
    expect(container.textContent).toBe('');
  });

  it('shows a failure outlined, with Retry and Remove; Remove deletes the images only', () => {
    const { uploads, emit } = fakeUploads();
    const { engine, select, runCanvasAction } = fakeEngine();
    const { container } = render(<UploadBadges uploads={uploads} engine={engine} />);
    act(() => {
      uploads.add(PREPARED, new Blob([]), [PHOTO, 'gone' as ObjectId]);
    });
    emit({ type: 'start' });
    emit({ type: 'error', message: 'The upload could not reach the server.' });
    expect(container.querySelector('[data-image-state="failed"]')).not.toBeNull();
    expect(container.textContent).toContain('Upload failed');
    expect(screen.getByRole('status').textContent).toBe(
      'Upload failed. The upload could not reach the server.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
    expect(screen.getByRole('status').textContent).toBe('Waiting to upload');
    emit({ type: 'start' });
    emit({ type: 'error', message: 'Busy.' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(select).toHaveBeenCalledWith([PHOTO, 'gone']);
    expect(runCanvasAction).toHaveBeenCalledWith({ type: 'selection', command: 'delete' });
    expect(container.textContent).toBe('');
  });

  it('shows a Spinner once the bytes are sent, and on a collaborator’s image processing', () => {
    const { uploads, emit } = fakeUploads();
    const peer = image({ id: 'peer' as ObjectId, assetId: 'b'.repeat(64) as AssetId });
    const other = image({ id: 'other' as ObjectId, assetId: 'c'.repeat(64) as AssetId });
    const { engine } = fakeEngine([image({ assetId: ASSET }), peer, other]);
    const processing = new ProcessingImages();
    const { container } = render(
      <UploadBadges uploads={uploads} processing={processing} engine={engine} />,
    );
    act(() => {
      processing.set(['b'.repeat(64) as AssetId]);
    });
    const spinners = () => container.querySelectorAll('[data-spinner]').length;
    expect(spinners()).toBe(1);
    expect(container.textContent).toBe(PROCESSING_IMAGE_LABEL);
    // A collaborator's processing image is not announced: nothing the person did changed.
    expect(screen.queryByRole('status')).toBeNull();
    act(() => {
      uploads.add(PREPARED, new Blob([]), [PHOTO]);
    });
    emit({ type: 'start' });
    emit({ type: 'sent-all' });
    expect(spinners()).toBe(2);
    expect(container.querySelector('[data-phase="completing"]')?.textContent).toContain(
      'Checking the upload',
    );
    // The page's own upload is shown once, by its own state, though it is reported too.
    act(() => {
      processing.set([ASSET, 'b'.repeat(64) as AssetId]);
    });
    expect(container.querySelectorAll('[data-image-state]')).toHaveLength(2);
    act(() => {
      processing.set([]);
    });
    expect(container.querySelectorAll('[data-image-state]')).toHaveLength(1);
  });

  it('turns an overlay with its image and the frames it is in', () => {
    const frame = { id: 'frame', type: 'frame', parentId: null, x: 0, y: 0, rotation: Math.PI / 4 };
    const { uploads } = fakeUploads();
    const { engine } = fakeEngine([
      image({ parentId: 'frame' as ObjectId, rotation: Math.PI / 4 }),
      frame as BoardObject,
    ]);
    const { container } = render(<UploadBadges uploads={uploads} engine={engine} />);
    act(() => {
      uploads.add(PREPARED, new Blob([]), [PHOTO]);
    });
    const overlay = container.querySelector<HTMLElement>('[data-image-state]');
    expect(overlay?.style.transform).toBe('rotate(90deg)');
  });

  it('shows nothing before the engine runs', () => {
    const uploads = new ImageUploads(
      () => new Promise(() => undefined),
      () => undefined,
    );
    uploads.add(PREPARED, new Blob([]), [PHOTO]);
    const { container } = render(<UploadBadges uploads={uploads} engine={undefined} />);
    expect(container.textContent).toBe('');
  });

  it('re-renders only when a badge moves, and forgets a failed upload whose images are gone', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
    const runFrames = () => {
      act(() => {
        for (const [frame, callback] of [...frames]) {
          frames.delete(frame);
          callback(16);
        }
      });
    };
    try {
      let camera = CAMERA;
      let objects: BoardObject[] = [image()];
      const engine = {
        camera: () => camera,
        board: { board: { get: (id: ObjectId) => reader(objects).get(id) }, select: vi.fn() },
        runCanvasAction: vi.fn(),
      } as unknown as MountedEngine;
      let emit: (event: UploadEvent) => void = () => undefined;
      const uploads = new ImageUploads(
        (prepared, file, onEvent) => {
          emit = onEvent;
          return new Promise(() => undefined);
        },
        () => undefined,
      );
      uploads.add(PREPARED, new Blob([]), [PHOTO]);
      let commits = 0;
      render(
        <Profiler id="badges" onRender={() => (commits += 1)}>
          <UploadBadges uploads={uploads} engine={engine} />
        </Profiler>,
      );
      // React may render once more to find an equal state; after that, frames cost nothing.
      runFrames();
      runFrames();
      const settled = commits;
      for (let frame = 0; frame < 5; frame += 1) runFrames();
      expect(commits).toBe(settled);
      camera = { ...CAMERA, x: CAMERA.x + 10 };
      runFrames();
      expect(commits).toBe(settled + 1);
      act(() => {
        emit({ type: 'start' });
        emit({ type: 'error', message: 'Offline.' });
      });
      objects = [];
      runFrames();
      expect(uploads.snapshot()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('follows the camera frame by frame while it shows a badge', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
    try {
      const camera = vi.fn(() => CAMERA);
      const engine = {
        camera,
        board: { board: reader([image()]), select: vi.fn() },
        runCanvasAction: vi.fn(),
      } as unknown as MountedEngine;
      const uploads = new ImageUploads(
        () => new Promise(() => undefined),
        () => undefined,
      );
      uploads.add(PREPARED, new Blob([]), [PHOTO]);
      const { unmount } = render(<UploadBadges uploads={uploads} engine={engine} />);
      const before = camera.mock.calls.length;
      act(() => {
        for (const [frame, callback] of [...frames]) {
          frames.delete(frame);
          callback(16);
        }
      });
      expect(camera.mock.calls.length).toBeGreaterThan(before);
      expect(frames.size).toBe(1);
      unmount();
      expect(frames.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
