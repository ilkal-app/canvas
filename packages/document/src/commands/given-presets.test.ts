import { describe, expect, it } from 'vitest';

import type { ComponentObject, ObjectId } from '@canvas/schema';

import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newRectangle,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';

// Presets given with an axes write: a `__proto__` key refused rather than dropped, a
// given record merged as setVariantPreset merges one, and two axes' presets at one path apart.

const AXES = [
  { name: 'state', values: ['rest', 'hover'] },
  { name: 'size', values: ['s', 'l'] },
];

/**
 * The stored main.
 *
 * @param store - The board.
 * @param id - The main.
 * @returns It.
 * @throws {Error} When it is not a main.
 */
function mainOf(store: YjsDocumentStore, id: string): ComponentObject {
  const main = store.get(id as ObjectId);
  if (main?.type !== 'component') throw new Error(`${id} is not a main`);
  return main;
}

describe('presets given with an axes write', () => {
  it('refuses a "__proto__" child path or preset key, writing nothing', () => {
    const store = new YjsDocumentStore();
    createChild(store, newRectangle('part', null, { x: 0, y: 0, width: 40, height: 40 }));
    const create = mustFindCommand('createComponent');
    for (const presets of [
      '{"state=hover": {"__proto__": {"fill": [1, 0, 0, 1]}}}',
      '{"__proto__": {"part": {"fill": [1, 0, 0, 1]}}}',
    ]) {
      const errors = expectRejected(store, create, {
        ids: ['part'],
        name: 'Card',
        componentId: 'main',
        variantAxes: AXES,
        variantPresets: JSON.parse(presets) as unknown,
      });
      expect(errors.map(({ code }) => code)).toEqual(['invalid-input']);
    }
    const seeded = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(seeded);
    expect(
      expectRejected(seeded, mustFindCommand('setVariantAxes'), {
        componentId: mainId,
        axes: AXES,
        variantPresets: JSON.parse('{"state=hover": {"__proto__": {"isHidden": true}}}') as unknown,
      }).map(({ code }) => code),
    ).toEqual(['invalid-input']);
  });

  it('merges a given text as setVariantPreset does: stored runs and size dropped', () => {
    const store = new YjsDocumentStore();
    const { mainId, captionId } = seedMainWithChildren(store);
    const axes = mustFindCommand('setVariantAxes');
    applyCommand(store, axes, {
      componentId: mainId,
      axes: AXES,
      variantPresets: {
        'state=hover': {
          [captionId]: {
            text: 'Hi',
            runs: [
              {
                length: 2,
                style: {
                  fontFamily: 'Inter',
                  fontSize: 16,
                  color: [0, 0, 0, 1],
                  weight: 700,
                  italic: false,
                },
              },
            ],
            measuredSize: { width: 20, height: 10 },
          },
        },
      },
    });
    applyCommand(store, axes, {
      componentId: mainId,
      axes: AXES,
      variantPresets: { 'state=hover': { [captionId]: { text: 'Hello' } } },
    });
    expect(mainOf(store, mainId).variantPresets?.['state=hover']?.[captionId]).toEqual({
      text: 'Hello',
    });
  });

  it('keeps two axes’ presets at one path apart', () => {
    const store = new YjsDocumentStore();
    const { mainId, boxId } = seedMainWithChildren(store);
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: AXES,
      variantPresets: {
        'state=hover': { [boxId]: { fill: [1, 0, 0, 1] } },
        'size=l': { [boxId]: { fill: [0, 0, 1, 1], isHidden: false } },
      },
    });
    const presets = mainOf(store, mainId).variantPresets;
    expect(presets?.['state=hover']).toEqual({ [boxId]: { fill: [1, 0, 0, 1] } });
    expect(presets?.['size=l']).toEqual({ [boxId]: { fill: [0, 0, 1, 1], isHidden: false } });
  });
});

describe('presets given by name', () => {
  it('refuses a key that names no child, at its own path in the input', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    const errors = expectRejected(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: AXES,
      variantPresets: { 'state=hover': { 'No such layer': { fill: [1, 0, 0, 1] } } },
    });
    expect(errors).toMatchObject([
      {
        code: 'invalid-override-path',
        path: ['variantPresets', 'state=hover', 'No such layer'],
      },
    ]);
  });
});
