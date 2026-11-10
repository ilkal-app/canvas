// @vitest-environment jsdom
// The failed uploads' error toast (item 4), posted to the shared toast region
// (item 4): counted, with Retry, staying until dismissed or retried, announced as an
// alert. In Chrome: tooling/scenario/specs/tools/image-states.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetId, ObjectId } from '@canvas/schema';

import { ToastHome, ToastRegionProvider } from '../feedback/toast-region.js';
import { TOAST_DURATION_MS } from '../feedback/toast.js';

import { ImageUploads } from './image-uploads.js';
import type { PreparedImage } from './prepare-image.js';
import { failedUploadsMessage, UploadFailedToast } from './upload-failed-toast.js';
import type { UploadEvent } from './upload-state.js';

/**
 * A prepared image with a made-up id.
 *
 * @param name - Makes the id differ.
 * @returns The image.
 */
function prepared(name: string): PreparedImage {
  return {
    assetId: name.padEnd(64, '0') as AssetId,
    naturalSize: { width: 1, height: 1 },
    mimeType: 'image/png',
    byteLength: 1,
  };
}

/**
 * Uploads over a fake run, failing each by hand.
 *
 * @returns The uploads and a function that fails the nth run.
 */
function fakeUploads() {
  const emits: ((event: UploadEvent) => void)[] = [];
  const uploads = new ImageUploads(
    (image, file, onEvent) =>
      new Promise(() => {
        emits.push(onEvent);
      }),
    () => undefined,
  );
  const fail = (index: number) => {
    act(() => {
      emits[index]?.({ type: 'start' });
      emits[index]?.({ type: 'error', message: 'Offline.' });
    });
  };
  return { uploads, fail, runs: () => emits.length };
}

afterEach(cleanup);

describe('failedUploadsMessage', () => {
  it('counts the images', () => {
    expect(failedUploadsMessage(1)).toBe('1 image couldn’t upload');
    expect(failedUploadsMessage(3)).toBe('3 images couldn’t upload');
  });
});

/**
 * The toast's poster inside a region with its home, as the shell has it.
 *
 * @param uploads - The uploads.
 * @returns The tree.
 */
function inRegion(uploads: ImageUploads): ReactElement {
  return (
    <ToastRegionProvider>
      <ToastHome />
      <UploadFailedToast uploads={uploads} />
    </ToastRegionProvider>
  );
}

/**
 * The region's alerts' text: the toasts of the Error kind it shows.
 *
 * @returns Their sentences.
 */
function alerts(): string[] {
  return screen.queryAllByRole('alert').map((alert) => alert.textContent);
}

describe('UploadFailedToast', () => {
  it('posts the failures counted as an alert, retries them all, and goes once none is failed', () => {
    const { uploads, fail } = fakeUploads();
    render(inRegion(uploads));
    expect(alerts()).toEqual([]);
    act(() => {
      uploads.add(prepared('a'), new Blob([]), ['a' as ObjectId]);
      uploads.add(prepared('b'), new Blob([]), ['b' as ObjectId]);
    });
    fail(0);
    expect(alerts()).toEqual(['1 image couldn’t upload']);
    // In the region's home, the shell's one place for toasts.
    expect(document.querySelector('[data-toast-home] [role="alert"]')).not.toBeNull();
    fail(1);
    expect(alerts()).toEqual(['2 images couldn’t upload']);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(uploads.snapshot().map(({ state }) => state.phase)).toEqual(['queued', 'queued']);
    expect(alerts()).toEqual([]);
  });

  it('stays until dismissed, never by itself; a later failure posts it again, counting all', () => {
    vi.useFakeTimers();
    try {
      const { uploads, fail } = fakeUploads();
      render(inRegion(uploads));
      act(() => {
        for (const name of ['a', 'b']) uploads.add(prepared(name), new Blob([]), []);
      });
      fail(0);
      act(() => {
        vi.advanceTimersByTime(TOAST_DURATION_MS * 10);
      });
      expect(alerts()).toEqual(['1 image couldn’t upload']);
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss: 1 image couldn’t upload' }));
      expect(alerts()).toEqual([]);
      fail(1);
      expect(alerts()).toEqual(['2 images couldn’t upload']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('posts it again when the same upload fails again after a dismissal and a retry', async () => {
    // Runs that end once they fail, so a retry starts a new run of the same upload.
    const runs: ((event: UploadEvent) => void)[] = [];
    const uploads = new ImageUploads(
      (image, file, onEvent) =>
        new Promise<void>((resolve) => {
          runs.push((event) => {
            onEvent(event);
            if (event.type === 'error') resolve();
          });
        }),
      () => undefined,
    );
    const failLatest = () => {
      act(() => {
        runs.at(-1)?.({ type: 'start' });
        runs.at(-1)?.({ type: 'error', message: 'Offline.' });
      });
    };
    render(inRegion(uploads));
    act(() => {
      uploads.add(prepared('a'), new Blob([]), []);
    });
    failLatest();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: 1 image couldn’t upload' }));
    expect(alerts()).toEqual([]);
    // Retried from its own overlay; the retry fails again.
    await act(async () => {
      await Promise.resolve();
      uploads.retry(prepared('a').assetId);
      await Promise.resolve();
    });
    expect(runs).toHaveLength(2);
    expect(alerts()).toEqual([]);
    failLatest();
    expect(alerts()).toEqual(['1 image couldn’t upload']);
  });

  it('goes when the failed images are removed', () => {
    const { uploads, fail } = fakeUploads();
    render(inRegion(uploads));
    act(() => {
      uploads.add(prepared('a'), new Blob([]), []);
    });
    fail(0);
    act(() => {
      uploads.forget(prepared('a').assetId);
    });
    expect(alerts()).toEqual([]);
  });

  it('shows in place without a region', () => {
    const { uploads, fail } = fakeUploads();
    render(<UploadFailedToast uploads={uploads} />);
    act(() => {
      uploads.add(prepared('a'), new Blob([]), []);
    });
    fail(0);
    expect(alerts()).toEqual(['1 image couldn’t upload']);
  });
});
