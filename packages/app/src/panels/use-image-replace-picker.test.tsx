// @vitest-environment jsdom
// The popover's Replace does nothing once the workspace is
// gone, whether the file is chosen or prepared after it went.
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';

import type { AssetId, ObjectId } from '@canvas/schema';

import type { PageImages, ReplacementAsset } from '../assets/page-images.js';

import { imageReplacerOf, type ImageReplacer } from './image-replacement-context.js';
import { useImageReplacePicker } from './use-image-replace-picker.js';

vi.mock('./image-replacement-context.js', () => ({ imageReplacerOf: vi.fn() }));

const PHOTO = 'photo' as ObjectId;
const ASSET: ReplacementAsset = {
  assetId: 'asset-new' as AssetId,
  naturalSize: { width: 300, height: 200 },
};

/** The file inputs' clicks: the detached input the picker clicked is the last one's context. */
let click: MockInstance<(this: HTMLInputElement) => void>;
/** The replacer's calls: the file and the apply callback. */
let replace: ReturnType<typeof vi.fn<ImageReplacer>>;

beforeEach(() => {
  click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
  replace = vi.fn<ImageReplacer>();
  vi.mocked(imageReplacerOf).mockReturnValue(replace);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Chooses a file in the picked input.
 *
 * @throws {Error} When no picker was opened.
 */
function choose(): void {
  const picked = click.mock.contexts.at(-1);
  if (picked === undefined) throw new Error('no picker was opened');
  const file = new File(['png'], 'photo.png', { type: 'image/png' });
  Object.defineProperty(picked, 'files', { value: [file] });
  picked.dispatchEvent(new Event('change'));
}

/**
 * Renders the hook with a dispatch spy and opens the picker for {@link PHOTO}.
 *
 * @returns The dispatch spy and the unmount.
 */
function openPicker(): { dispatch: ReturnType<typeof vi.fn>; unmount: () => void } {
  const dispatch = vi.fn();
  const view = renderHook(() => useImageReplacePicker({} as PageImages, () => undefined, dispatch));
  view.result.current?.(PHOTO);
  return { dispatch, unmount: view.unmount };
}

it('replaces the image with the chosen file in one dispatch', () => {
  const { dispatch } = openPicker();
  choose();
  const apply = replace.mock.calls[0]?.[1];
  expect(apply?.(ASSET)).toEqual([PHOTO]);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'replaceImage', id: PHOTO, ...ASSET });
});

it('ignores a file chosen after the workspace is gone', () => {
  const { dispatch, unmount } = openPicker();
  unmount();
  choose();
  expect(replace).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

it('neither writes nor uploads a file prepared after the workspace is gone', () => {
  const { dispatch, unmount } = openPicker();
  choose();
  unmount();
  const apply = replace.mock.calls[0]?.[1];
  expect(apply?.(ASSET)).toBeUndefined();
  expect(dispatch).not.toHaveBeenCalled();
});
