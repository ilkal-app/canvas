import { describe, expect, it } from 'vitest';

import type { ObjectId, Rgba } from '@canvas/schema';

import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, testEnvironment } from './__fixtures__/command-fixtures.js';
import {
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { AGENT_FOR_ADA, mustFindCommand } from './__fixtures__/component-fixtures.js';
import { runCommand } from './run-command.js';
import type { SetInstanceVariantResult } from './set-instance-variant.js';

// What the variant commands report, for the MCP tools: the paths a preset reset
// changed, and the selection a switch stored with the own overrides it dropped.

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];

/**
 * A main with a `state` axis whose `hover` preset fills the box and hides the note, and an
 * instance with its own box fill and caption text.
 *
 * @returns The store and the ids.
 */
function seeded() {
  const store = new YjsDocumentStore();
  const card = seedMainWithChildren(store);
  applyCommand(store, mustFindCommand('setVariantAxes'), {
    componentId: card.mainId,
    axes: [{ name: 'state', values: ['rest', 'hover'] }],
  });
  for (const [path, override] of [
    [card.boxId, { fill: RED }],
    [card.noteId, { isHidden: true }],
  ] as const) {
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: card.mainId,
      axis: 'state',
      value: 'hover',
      path,
      override,
    });
  }
  const instanceId = placeInstance(store, card.mainId, {
    instanceId: 'inst',
    x: 2000,
    overrides: { [card.boxId]: { fill: BLUE, isHidden: false }, [card.captionId]: { text: 'Hi' } },
  });
  return { store, ...card, instanceId };
}

describe('variant command results', () => {
  it('reports the paths a preset reset changed, in order, and none when nothing was set', () => {
    const { store, mainId, boxId, noteId, captionId } = seeded();
    const reset = mustFindCommand('resetVariantPreset');
    const target = { componentId: mainId, axis: 'state', value: 'hover' };
    expect(applyCommand(store, reset, { ...target, path: captionId }).result).toEqual({
      paths: [],
    });
    expect(applyCommand(store, reset, target).result).toEqual({
      paths: [boxId, noteId].sort(),
    });
    expect(applyCommand(store, reset, target).result).toEqual({ paths: [] });
  });

  it('reports a field reset only when the record held it', () => {
    const { store, mainId, boxId } = seeded();
    const reset = mustFindCommand('resetVariantPreset');
    const target = { componentId: mainId, axis: 'state', value: 'hover', path: boxId };
    expect(applyCommand(store, reset, { ...target, fields: ['isHidden'] }).result).toEqual({
      paths: [],
    });
    expect(applyCommand(store, reset, { ...target, fields: ['fill'] }).result).toEqual({
      paths: [boxId],
    });
  });

  it('writes nothing for a reset with nothing to clear: no update, no time stamp', () => {
    const { store, mainId, captionId } = seeded();
    const before = store.encodeState();
    const later = { clock: () => 9_999_999_999_999, createId: () => 'unused' as ObjectId };
    const outcome = applyCommand(
      store,
      mustFindCommand('resetVariantPreset'),
      { componentId: mainId, axis: 'state', value: 'hover', path: captionId },
      undefined,
      later,
    );
    expect(outcome.result).toEqual({ paths: [] });
    expect(store.encodeState()).toEqual(before);
  });

  it('refuses an agent an empty reset of another’s main, and allows one of its own', () => {
    const { store, mainId, captionId } = seeded();
    const reset = mustFindCommand('resetVariantPreset');
    const target = { componentId: mainId, axis: 'state', value: 'hover', path: captionId };
    const before = store.encodeState();
    const refused = runCommand(store, AGENT_FOR_ADA, reset, target, testEnvironment());
    expect(refused.status === 'rejected' && refused.errors.map(({ code }) => code)).toEqual([
      'not-own-main',
    ]);
    expect(store.encodeState()).toEqual(before);
    const own = seedLeafMain(store, 'own', { x: 4000, y: 0 }, AGENT_FOR_ADA);
    applyCommand(
      store,
      mustFindCommand('setVariantAxes'),
      { componentId: 'own', axes: [{ name: 'state', values: ['rest'] }] },
      AGENT_FOR_ADA,
    );
    expect(
      applyCommand(
        store,
        reset,
        { componentId: 'own', axis: 'state', value: 'rest', path: own },
        AGENT_FOR_ADA,
      ).result,
    ).toEqual({ paths: [] });
  });

  it('names the nested axes a switch dropped while the nested choice keeps others', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'inner', { x: 0, y: 0 });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'inner',
      axes: [
        { name: 'state', values: ['rest', 'hover'] },
        { name: 'size', values: ['small', 'large'] },
      ],
    });
    seedLeafMain(store, 'outer', { x: 1000, y: 0 });
    placeInstance(store, 'inner', { instanceId: 'inner-child', x: 1050, y: 0, parentId: 'outer' });
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'outer',
      axes: [{ name: 'mode', values: ['a', 'b'] }],
    });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: 'outer',
      axis: 'mode',
      value: 'b',
      path: 'inner-child',
      override: { variant: { state: 'hover' } },
    });
    const id = placeInstance(store, 'outer', { instanceId: 'outer-copy' });
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id,
      path: 'inner-child',
      override: { variant: { state: 'rest', size: 'large' } },
    });
    const switched = applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id,
      variant: { mode: 'b' },
    });
    expect((switched.result as SetInstanceVariantResult).droppedOverrides).toEqual([
      { path: 'inner-child', fields: ['variant.state'] },
    ]);
  });

  it('reports the selection a switch stored and the own fields it dropped', () => {
    const { store, instanceId, boxId } = seeded();
    const switched = applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: instanceId,
      variant: { state: 'hover' },
    });
    // The hover preset sets the box's fill, so the own fill goes; its `isHidden` and the
    // caption's text stay.
    expect(switched.result).toEqual({
      variant: { state: 'hover' },
      droppedOverrides: [{ path: boxId, fields: ['fill'] }],
    });
  });

  it('names a text style key the switch dropped while the style keeps others', () => {
    const { store, mainId, captionId, instanceId } = seeded();
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: mainId,
      axis: 'state',
      value: 'hover',
      path: captionId,
      override: { textStyle: { color: RED } },
    });
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: captionId,
      override: { textStyle: { color: BLUE, fontSize: 30 } },
    });
    const switched = applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: instanceId,
      variant: { state: 'hover' },
    });
    expect((switched.result as SetInstanceVariantResult).droppedOverrides).toContainEqual({
      path: captionId,
      fields: ['textStyle.color'],
    });
  });

  it('reports no selection once every choice is cleared, and nothing dropped', () => {
    const { store, instanceId } = seeded();
    const command = mustFindCommand('setInstanceVariant');
    applyCommand(store, command, { id: instanceId, variant: { state: 'rest' } });
    expect(
      applyCommand(store, command, { id: instanceId, variant: { state: null } }).result,
    ).toEqual({ droppedOverrides: [] });
  });
});
