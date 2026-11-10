import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import {
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';
import { selectionErrors } from './set-instance-variant.js';
import { setVariantAxesCommand } from './set-variant-axes.js';

// Renames that would merge two names are refused, nested
// selections are found through the reference index alone, and clearing a choice names a real axis.

describe('setVariantAxes renames that would merge two names', () => {
  it('refuses a value renamed onto one that stays, so no preset is lost', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedMainWithChildren(store);
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: [{ name: 'state', values: ['rest', 'hover'] }],
    });
    for (const value of ['rest', 'hover']) {
      applyCommand(store, mustFindCommand('setVariantPreset'), {
        componentId: mainId,
        axis: 'state',
        value,
        path: noteId,
        override: { text: value },
      });
    }
    const outcome = setVariantAxesCommand.validate(
      { board: store, origin: ADA, now: 0, createId: () => 'x' as ObjectId },
      {
        componentId: mainId as ObjectId,
        axes: [{ name: 'state', values: ['hover'] }],
        renames: { values: [{ axis: 'state', from: 'rest', to: 'hover' }] },
      },
    );
    expect(outcome.isValid).toBe(false);
    expect(!outcome.isValid && outcome.errors.map(({ code }) => code)).toEqual(['invalid-input']);
  });

  it('refuses a name renamed twice, and two axes that would become one', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: [
        { name: 'state', values: ['rest', 'hover'] },
        { name: 'size', values: ['small'] },
      ],
    });
    const context = { board: store, origin: ADA, now: 0, createId: () => 'x' as ObjectId };
    const twice = setVariantAxesCommand.validate(context, {
      componentId: mainId as ObjectId,
      axes: [{ name: 'state', values: ['a', 'b', 'hover'] }],
      renames: {
        values: [
          { axis: 'state', from: 'rest', to: 'a' },
          { axis: 'state', from: 'rest', to: 'b' },
        ],
      },
    });
    expect(!twice.isValid && twice.errors.map(({ code }) => code)).toContain('invalid-input');
    const merged = setVariantAxesCommand.validate(context, {
      componentId: mainId as ObjectId,
      axes: [{ name: 'state', values: ['rest', 'hover', 'small'] }],
      renames: { axes: [{ from: 'size', to: 'state' }] },
    });
    expect(!merged.isValid && merged.errors.map(({ code }) => code)).toContain('invalid-input');
  });
});

describe('setVariantAxes renaming nested selections', () => {
  it('finds them through the reference index, with no whole-board read', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'inner', { x: 0, y: 0 });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'inner',
      axes: [{ name: 'state', values: ['a', 'b'] }],
    });
    placeInstance(store, 'inner', { instanceId: 'nested', x: 2000, y: 0 });
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['nested'],
      name: 'Outer',
      componentId: 'outer',
    });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'outer',
      axes: [{ name: 'mode', values: ['x', 'y'] }],
    });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: 'outer',
      axis: 'mode',
      value: 'y',
      path: 'nested',
      override: { variant: { state: 'a' } },
    });
    placeInstance(store, 'outer', {
      instanceId: 'root',
      x: 4000,
      y: 0,
      overrides: { nested: { variant: { state: 'a' } } },
    });
    // A reader with only what every reader has: no `read`.
    const board = { get: (id: ObjectId) => store.get(id), references: store.references };
    const outcome = setVariantAxesCommand.validate(
      { board, origin: ADA, now: 0, createId: () => 'x' as ObjectId },
      {
        componentId: 'inner' as ObjectId,
        axes: [{ name: 'state', values: ['c', 'b'] }],
        renames: { values: [{ axis: 'state', from: 'a', to: 'c' }] },
      },
    );
    if (!outcome.isValid) throw new Error(JSON.stringify(outcome.errors));
    const written = new Map<string, BoardObject>(outcome.plan.objects.map((o) => [o.id, o]));
    expect(written.get('root')).toMatchObject({
      overrides: { nested: { variant: { state: 'c' } } },
    });
    expect(written.get('outer')).toMatchObject({
      variantPresets: { 'mode=y': { nested: { variant: { state: 'c' } } } },
    });
    expect(mustGet(store, 'nested')).not.toHaveProperty('variant');
  });
});

describe('clearing a choice', () => {
  it('still names an axis the main has', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: mainId,
      axes: [{ name: 'state', values: ['rest', 'hover'] }],
    });
    const main = mustGet(store, mainId);
    if (main.type !== 'component') throw new Error('not a main');
    expect(selectionErrors(main, { missing: null }, ['variant']).map(({ code }) => code)).toEqual([
      'unknown-variant',
    ]);
    expect(selectionErrors(main, { state: null }, ['variant'])).toEqual([]);
  });
});
