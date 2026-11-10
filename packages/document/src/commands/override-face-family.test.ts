// A face name in override records: records are written as
// given and composed field by field, so no write changes a family it was not asked to; an inner
// face is dropped only when its own record names another family. A face that does not belong to
// the resolved family is ignored when drawing (drawing looks it up within the family).
import { describe, expect, it } from 'vitest';

import {
  effectiveOverridesOf,
  mergeOverrideRecords,
  type InstanceObject,
  type OverrideRecord,
} from '@canvas/schema';

import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import { seedMainWithChildren } from './__fixtures__/component-boards.js';
import { fieldOf, mustFindCommand } from './__fixtures__/component-fixtures.js';

const FACE = 'Inter-CondensedBold';

/**
 * A card with a state axis, and the family its note is set in.
 *
 * @returns The store, the card's ids and the note's family.
 * @throws {Error} When the card's note has no runs.
 */
function seeded() {
  const store = new YjsDocumentStore();
  const card = seedMainWithChildren(store);
  applyCommand(store, mustFindCommand('setVariantAxes'), {
    componentId: card.mainId,
    axes: [{ name: 'state', values: ['rest', 'hover'] }],
  });
  const note = store.get(card.noteId as never);
  const family = note?.type === 'sticky' ? note.runs[0]?.style.fontFamily : undefined;
  if (family === undefined) throw new Error('the card note has no runs');
  return { store, family, ...card };
}

/**
 * Sets a hover preset record at a path.
 *
 * @param store - The store.
 * @param mainId - The main.
 * @param path - The path.
 * @param override - The fields.
 */
function setHover(
  store: YjsDocumentStore,
  mainId: string,
  path: string,
  override: OverrideRecord,
): void {
  applyCommand(store, mustFindCommand('setVariantPreset'), {
    componentId: mainId,
    axis: 'state',
    value: 'hover',
    path,
    override,
  });
}

/**
 * The hover preset's record at a path.
 *
 * @param store - The store.
 * @param mainId - The main.
 * @param path - The path.
 * @returns The record, empty if none.
 */
function hoverRecord(store: YjsDocumentStore, mainId: string, path: string): OverrideRecord {
  const presets = fieldOf(store, mainId, 'variantPresets') as
    Record<string, Record<string, OverrideRecord>> | undefined;
  return presets?.['state=hover']?.[path] ?? {};
}

describe('a face name in override records', () => {
  it('stores a face-only record as given, and a later same-family layer keeps the face', () => {
    const { store, mainId, noteId, family } = seeded();
    setHover(store, mainId, noteId, { textStyle: { postScriptName: FACE } });
    const record = hoverRecord(store, mainId, noteId);
    expect(record.textStyle).toEqual({ postScriptName: FACE });
    expect(mergeOverrideRecords(record, { textStyle: { fontFamily: family } }).textStyle).toEqual({
      postScriptName: FACE,
      fontFamily: family,
    });
  });

  it("drops an inner face when its own record names another family than the outer layer's", () => {
    const inner = { textStyle: { fontFamily: 'Inter', postScriptName: FACE } };
    expect(mergeOverrideRecords(inner, { textStyle: { fontFamily: 'Lora' } }).textStyle).toEqual({
      fontFamily: 'Lora',
    });
  });

  it("keeps a selected preset's family under a face-only instance override", () => {
    const { store, mainId, noteId } = seeded();
    setHover(store, mainId, noteId, { textStyle: { fontFamily: 'Lora' } });
    applyCommand(store, mustFindCommand('createInstance'), {
      componentId: mainId,
      x: 1000,
      y: 50,
      instanceId: 'inst-face',
    });
    applyCommand(store, mustFindCommand('setInstanceVariant'), {
      id: 'inst-face',
      variant: { state: 'hover' },
    });
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: 'inst-face',
      path: noteId,
      override: { textStyle: { postScriptName: 'Lora-Bold' } },
    });
    const instance = store.get('inst-face' as never) as InstanceObject;
    expect(instance.overrides[noteId]?.textStyle).toEqual({ postScriptName: 'Lora-Bold' });
    expect(effectiveOverridesOf(instance, store.read())[noteId]?.textStyle).toEqual({
      fontFamily: 'Lora',
      postScriptName: 'Lora-Bold',
    });
  });
});
