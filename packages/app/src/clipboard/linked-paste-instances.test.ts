// An instance's replacement image (rule 3) is an asset the board shows like an image
// object's: a copy of a main and its instance records both assets, and a paste onto another
// board links both before it creates anything (the link-before-create rule).
import { describe, expect, it } from 'vitest';

import type { NewObject } from '@canvas/document';
import { copySelection } from '@canvas/document';
import type { AssetId, Board, ObjectId } from '@canvas/schema';

import { createComponentBoard, mustRun } from '../engine/__fixtures__/component-board.js';

import { createLinkedPaste, imageAssetsOf } from './linked-paste.js';
import type { PasteImages, PasteTarget } from './paste-handlers.js';

/**
 * A copy of the component fixture's card main and its instance, whose image child the instance
 * replaces with another asset.
 *
 * @returns The copied board.
 * @throws {Error} When nothing was copied.
 */
function mainAndInstanceWithReplacement(): Board {
  const { store } = createComponentBoard();
  mustRun(store, 'setInstanceOverride', {
    id: 'inst',
    path: 'photo',
    override: {
      assetId: 'asset-override',
      naturalSize: { width: 400, height: 300 },
      crop: { x: 0, y: 0, width: 1, height: 1 },
    },
  });
  const copied = copySelection(store.read(), ['card', 'inst'] as ObjectId[]);
  if (copied === undefined) throw new Error('nothing copied');
  return copied;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a copied instance’s replacement image', () => {
  it('is in the copy’s inventory beside the main’s image', () => {
    expect(imageAssetsOf(mainAndInstanceWithReplacement()).sort()).toEqual([
      'asset-override',
      'asset-photo',
    ]);
  });

  it('is linked with the main’s before a paste on another board creates anything', async () => {
    const copied = mainAndInstanceWithReplacement();
    // What the copy recorded (`EngineClipboard.remember` records `imageAssetsOf` the copy).
    const recorded = new Set(imageAssetsOf(copied));
    const links: [AssetId[], string][] = [];
    let created = 0;
    const images: PasteImages = {
      insert: () => undefined,
      wasCopiedFrom: (assets, board) =>
        board === 'b' && assets.every((asset) => recorded.has(asset)),
      linkFrom: (assets, source) => {
        links.push([[...assets].sort(), source]);
        return Promise.resolve();
      },
    };
    const target: PasteTarget = {
      pointer: undefined,
      viewCentre: { x: 0, y: 0 },
      createObjects: () => true,
      notify: () => undefined,
      boardId: 'a',
      sourceBoard: 'b',
      images,
    };
    const objects: NewObject[] = [];
    createLinkedPaste(copied, objects, target, () => {
      created += 1;
    });
    expect(created).toBe(0);
    await settle();
    expect(links).toEqual([[['asset-override', 'asset-photo'], 'b']]);
    expect(created).toBe(1);
  });
});
