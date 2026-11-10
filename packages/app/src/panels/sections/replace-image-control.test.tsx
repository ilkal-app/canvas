// @vitest-environment jsdom
// An instance's image override (rule 3): "Replace image…" on an image child's row picks
// a file, which the page's images upload, and overrides the child's asset, size and crop.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetId, InstanceObject, ObjectId } from '@canvas/schema';

import type { PageImages } from '../../assets/page-images.js';
import {
  createComponentBoard,
  mustRun,
  type ComponentBoard,
} from '../../engine/__fixtures__/component-board.js';
import type { ComponentAction } from '../../state/shell-action.js';
import {
  ImageReplacementProvider,
  imageReplacerOf,
  type ImageReplacer,
} from '../image-replacement-context.js';
import { instanceOverrideRows } from '../instance-override-rows.js';

import { InstanceOverrideRowItem } from './instance-override-row.js';
import { coverCrop, resolvedChildSize } from './replace-image-control.js';

/**
 * Renders the card instance's image row.
 *
 * @param replacer - The page's image replacement, or none.
 * @param board - The board; the component fixture's if absent.
 * @param board.store - Its document.
 * @returns The dispatch spy.
 * @throws {Error} When the row is missing.
 */
function renderImageRow(
  replacer: ImageReplacer | undefined,
  { store }: Pick<ComponentBoard, 'store'> = createComponentBoard(),
) {
  const instance = store.get('inst' as ObjectId) as InstanceObject;
  const row = instanceOverrideRows(store, instance).find(({ path }) => path === 'photo');
  if (row === undefined) throw new Error('no image row');
  const dispatch = vi.fn<(action: ComponentAction) => void>();
  render(
    <ImageReplacementProvider value={replacer}>
      <InstanceOverrideRowItem
        board={store}
        instanceId={instance.id}
        row={row}
        name="Image"
        mains={[]}
        set={(path, override) => {
          dispatch({ type: 'component', command: 'setOverride', id: instance.id, path, override });
        }}
        reset={(path, fields) => {
          dispatch({ type: 'component', command: 'resetOverrides', id: instance.id, path, fields });
        }}
      />
    </ImageReplacementProvider>,
  );
  return { dispatch };
}

afterEach(cleanup);

describe('replacing an instance’s image', () => {
  it('crops a replacement to fill the child’s box, centred', () => {
    expect(coverCrop({ width: 100, height: 50 }, { width: 400, height: 100 })).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(coverCrop({ width: 50, height: 100 }, { width: 100, height: 100 })).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(coverCrop({ width: 100, height: 100 }, { width: 100, height: 400 })).toEqual({
      x: 0,
      y: 0.375,
      width: 1,
      height: 0.25,
    });
    expect(coverCrop({ width: 30, height: 20 }, { width: 300, height: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('uploads the picked file and overrides the asset, its size and a filling crop', () => {
    const asset = { assetId: 'a'.repeat(64) as AssetId, naturalSize: { width: 1600, height: 600 } };
    const shown: (readonly ObjectId[] | undefined)[] = [];
    const replacer = vi.fn<ImageReplacer>((...[, apply]) => {
      shown.push(apply(asset));
    });
    const { dispatch } = renderImageRow(replacer);
    const row = screen.getByRole('group', { name: 'Image' });
    const input = within(row).getByLabelText<HTMLInputElement>('Replace image…');
    expect(input.accept).toBe('image/*');
    const opened = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    fireEvent.click(within(row).getByRole('button', { name: 'Replace image…' }));
    expect(opened).toHaveBeenCalledOnce();
    const file = new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(replacer).toHaveBeenCalledWith(file, expect.any(Function));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'component',
      command: 'setOverride',
      id: 'inst',
      path: 'photo',
      override: { ...asset, crop: coverCrop({ width: 80, height: 60 }, asset.naturalSize) },
    });
    expect(shown).toEqual([['inst']]);
  });

  it('crops to the child’s box in this instance, after its constraints', () => {
    const board = createComponentBoard();
    // The photo (80 × 60 in the card) stretches with the card's width; this instance is 80 wider.
    mustRun(board.store, 'setConstraints', { ids: ['photo'], x: 'stretch' });
    mustRun(board.store, 'resizeObjects', {
      resizes: [{ id: 'inst', by: { width: 80, height: 0 } }],
    });
    const instance = board.store.get('inst' as ObjectId) as InstanceObject;
    expect(resolvedChildSize(board.store, instance, 'photo')).toEqual({ width: 160, height: 60 });
    const asset = { assetId: 'b'.repeat(64) as AssetId, naturalSize: { width: 1600, height: 600 } };
    const replacer = vi.fn<ImageReplacer>((...[, apply]) => {
      apply(asset);
    });
    const { dispatch } = renderImageRow(replacer, board);
    const input = within(screen.getByRole('group', { name: 'Image' })).getByLabelText(
      'Replace image…',
    );
    fireEvent.change(input, { target: { files: [new File([], 'wide.png')] } });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        override: { ...asset, crop: coverCrop({ width: 160, height: 60 }, asset.naturalSize) },
      }),
    );
  });

  it('reads a nested child’s box through its nested instance', () => {
    const { store } = createComponentBoard();
    // The badge's dot stretches both ways; the card's badge instance is 20 larger each way.
    mustRun(store, 'setConstraints', { ids: ['dot'], x: 'stretch', y: 'stretch' });
    mustRun(store, 'resizeObjects', {
      resizes: [{ id: 'badge-in-card', by: { width: 20, height: 20 } }],
    });
    const instance = store.get('inst' as ObjectId) as InstanceObject;
    const dot = store.get('dot' as ObjectId);
    expect(resolvedChildSize(store, instance, 'badge-in-card/dot')).toEqual({
      width: (dot?.type === 'shape' ? dot.width : 0) + 20,
      height: (dot?.type === 'shape' ? dot.height : 0) + 20,
    });
    expect(resolvedChildSize(store, instance, 'missing')).toBeUndefined();
  });

  it('offers no replacement where the page has no images', () => {
    renderImageRow(undefined);
    expect(screen.queryByLabelText('Replace image…')).toBeNull();
  });

  it('replaces through the page’s images, telling the shell’s notice why a file was refused', () => {
    expect(imageReplacerOf(undefined, vi.fn())).toBeUndefined();
    const replace = vi.fn(() => Promise.resolve());
    const notify = vi.fn();
    const replacer = imageReplacerOf({ replace } as unknown as PageImages, notify);
    const file = new File([], 'a.png');
    const apply = vi.fn(() => undefined);
    replacer?.(file, apply);
    expect(replace).toHaveBeenCalledWith(file, apply, notify);
  });
});
