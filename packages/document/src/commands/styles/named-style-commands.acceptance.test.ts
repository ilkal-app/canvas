// Acceptance, written before the code.
import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { SCOUT_FOR_ADA } from '../../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../../history/undo-manager.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  fixtureObject,
} from '../../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';
import { applyCommand, mustGet } from '../__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from '../__fixtures__/component-boards.js';
import { codesOf, expectRefusedBy } from '../__fixtures__/component-fixtures.js';
import { createObjectsCommand } from '../create-objects.js';
import { addPageCommand } from '../pages/add-page.js';
import { findCommand } from '../registry.js';
import { setStyleCommand } from '../set-style.js';

const BODY = { fontFamily: 'Inter', fontSize: 24, weight: 400, italic: false };
const LARGE = { fontFamily: 'Inter', fontSize: 36, weight: 700, italic: true };
const SHADOW = { x: 0, y: 4, blur: 4, spread: 0, color: [0, 0, 0, 0.25] };
const DEEP = { x: 2, y: 8, blur: 12, spread: 1, color: [0, 0, 0, 0.5] };

interface Entry {
  readonly id: string;
  readonly name: string;
  readonly value: unknown;
  readonly createdBy: string;
}
function command(name: string) {
  const found = findCommand(name);
  if (found === undefined) throw new Error(`missing command: ${name}`);
  return found;
}
function table(store: YjsDocumentStore, kind: 'text' | 'effect'): ReadonlyMap<string, Entry> {
  const reader = store as unknown as {
    readTextStyles(): ReadonlyMap<string, Entry>;
    readEffectStyles(): ReadonlyMap<string, Entry>;
  };
  return kind === 'text' ? reader.readTextStyles() : reader.readEffectStyles();
}
function add(store: YjsDocumentStore, kind: 'text' | 'effect', name: string, origin = ADA): string {
  const value = kind === 'text' ? BODY : { shadows: [SHADOW] };
  const result = applyCommand(
    store,
    command(kind === 'text' ? 'setTextStyle' : 'setEffectStyle'),
    { name, value },
    origin,
  ).result as { id: string; isCreated: boolean };
  expect(result.isCreated).toBe(true);
  expect(table(store, kind).get(result.id)).toMatchObject({
    id: result.id,
    name,
    value,
    createdBy: origin.principalId,
  });
  return result.id;
}
function seed(store: YjsDocumentStore, object: BoardObject): void {
  store.transact(ADA, (transaction) => {
    transaction.setObject(object);
  });
}
function unboundValue(style: unknown): Record<string, unknown> {
  const value = { ...(style as Record<string, unknown>) };
  delete value.textStyleId;
  return value;
}

describe.each(['text', 'effect'] as const)(' %s style commands', (kind) => {
  const setName = kind === 'text' ? 'setTextStyle' : 'setEffectStyle';
  const deleteName = kind === 'text' ? 'deleteTextStyle' : 'deleteEffectStyle';
  const changed = kind === 'text' ? LARGE : { shadows: [DEEP, SHADOW] };

  it('creates, updates and deletes a style as separate undo steps', () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ADA.principalId);
    const id = add(store, kind, 'Library/Primary');
    const update = applyCommand(store, command(setName), {
      id,
      name: 'Library/Updated',
      value: changed,
    });
    expect(update.result).toEqual({ id, isCreated: false });
    expect((update.changes as unknown as Record<string, unknown>)[`${kind}Styles`]).toEqual([id]);
    expect(table(store, kind).get(id)).toMatchObject({ name: 'Library/Updated', value: changed });
    expect(history.undo()).toBe(true);
    expect(table(store, kind).get(id)?.name).toBe('Library/Primary');
    applyCommand(store, command(deleteName), { id });
    expect(table(store, kind).has(id)).toBe(false);
    expect(history.undo()).toBe(true);
    expect(table(store, kind).has(id)).toBe(true);
    expect(history.undo()).toBe(true);
    expect(table(store, kind).has(id)).toBe(false);
    history.destroy();
  });

  it('allows slashes and refuses case-blind duplicates, a missing id and a 65th entry without a write', () => {
    const store = new YjsDocumentStore();
    add(store, kind, 'Library/Primary');
    expect(
      codesOf(
        expectRefusedBy(store, ADA, command(setName), { name: 'library/primary', value: changed }),
      ),
    ).toContain('duplicate-style-name');
    expect(
      codesOf(
        expectRefusedBy(store, ADA, command(setName), {
          id: 'missing-style',
          name: 'New',
          value: changed,
        }),
      ),
    ).toContain('missing-style');
    for (let index = 1; index < 64; index++) add(store, kind, `Style/${String(index)}`);
    expect(
      codesOf(expectRefusedBy(store, ADA, command(setName), { name: 'Overflow', value: changed })),
    ).toContain('too-many-styles');
  });

  it('lets an agent change its own entry, but not another creator’s', () => {
    const store = new YjsDocumentStore();
    const foreign = add(store, kind, 'Human');
    const owned = add(store, kind, 'Scout', SCOUT_FOR_ADA);
    applyCommand(
      store,
      command(setName),
      { id: foreign, name: 'Human/Edited', value: changed },
      BOB,
    );
    applyCommand(
      store,
      command(setName),
      { id: owned, name: 'Scout/Updated', value: changed },
      SCOUT_FOR_ADA,
    );
    expect(
      codesOf(
        expectRefusedBy(store, SCOUT_FOR_ADA, command(setName), {
          id: foreign,
          name: 'Changed',
          value: changed,
        }),
      ),
    ).toContain('not-own-style');
    expect(
      codesOf(expectRefusedBy(store, SCOUT_FOR_ADA, command(deleteName), { id: foreign })),
    ).toContain('not-own-style');
    applyCommand(store, command(deleteName), { id: owned }, SCOUT_FOR_ADA);
    expect(table(store, kind).has(owned)).toBe(false);
  });
});

describe('text style bindings', () => {
  it('createObjects keeps matching named values and ids supplied by its caller', () => {
    const store = new YjsDocumentStore();
    const textId = add(store, 'text', 'Body');
    const effectId = add(store, 'effect', 'Depth');
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [
        {
          type: 'text',
          id: 'new-text',
          parentId: null,
          x: 0,
          y: 0,
          rotation: 0,
          width: 200,
          height: 30,
          text: 'Hi',
          runs: [{ length: 2, style: { ...BODY, color: [0, 0, 0, 1], textStyleId: textId } }],
          align: 'left',
          autoWidth: true,
          verticalAlign: 'top',
        },
        {
          type: 'shape',
          id: 'new-shape',
          parentId: null,
          x: 220,
          y: 0,
          rotation: 0,
          width: 100,
          height: 80,
          kind: 'rectangle',
          stroke: null,
          fill: null,
          cornerRadius: 0,
          sides: 4,
          label: null,
          shadow: SHADOW,
          effectStyleId: effectId,
        },
      ],
    } as never);
    expect(result.ids).toHaveLength(2);
    expect(mustGet(store, result.ids[0] ?? '')).toMatchObject({
      runs: [{ style: { textStyleId: textId, fontSize: BODY.fontSize } }],
    });
    expect(mustGet(store, result.ids[1] ?? '')).toMatchObject({
      effectStyleId: effectId,
      shadow: SHADOW,
    });
  });

  it('applies a style to every run, keeps run colours and refuses a missing id atomically', () => {
    const store = createFixtureStore();
    const id = add(store, 'text', 'Body');
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'text-title', style: { textStyle: { textStyleId: id } } }],
    });
    const title = mustGet(store, 'text-title');
    expect(title).toMatchObject({
      runs: [
        { style: { ...BODY, textStyleId: id, color: [0.1, 0.1, 0.12, 1] } },
        { style: { ...BODY, textStyleId: id, color: [0.8, 0.1, 0.1, 1] } },
      ],
    });
    expect(
      codesOf(
        expectRefusedBy(store, ADA, setStyleCommand, {
          changes: [{ id: 'text-title', style: { textStyle: { textStyleId: 'missing' } } }],
        }),
      ),
    ).toContain('missing-style');
  });

  it('rewrites bound runs across pages and a main while applying measured boxes in one undo step', () => {
    const store = createFixtureStore();
    const id = add(store, 'text', 'Body');
    const { pageId } = applyCommand(store, addPageCommand, {}).result;
    const text = fixtureObject('text-title', 'text');
    const second = {
      ...text,
      id: 'second-page',
      parentId: null,
      pageId,
      x: 500,
      // Bound runs hold their style's value, as every command writes them (the binding repair
      // rewrites a run that does not); each keeps its own colour.
      runs: text.runs.map((run) => ({ ...run, style: { ...run.style, ...BODY, textStyleId: id } })),
    } as BoardObject;
    seedLeafMain(store, 'main-one', { x: 900, y: 0 });
    const child = {
      ...text,
      id: 'main-text',
      parentId: 'main-one',
      pageId: null,
      z: 'a1',
      runs: second.type === 'text' ? second.runs : [],
    } as BoardObject;
    seed(store, second);
    seed(store, child);
    placeInstance(store, 'main-one', { x: 1200, y: 0, instanceId: 'instance-one' });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'text-title', style: { textStyle: { textStyleId: id } } }],
    });
    const before = [
      mustGet(store, 'text-title'),
      mustGet(store, 'second-page'),
      mustGet(store, 'main-text'),
    ];
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, command('setTextStyle'), {
      id,
      name: 'Body',
      value: LARGE,
      measured: [
        { id: 'text-title', width: 430, height: 55 },
        { id: 'second-page', width: 510, height: 60 },
        { id: 'main-text', width: 320, height: 45 },
      ],
    });
    for (const objectId of ['text-title', 'second-page', 'main-text']) {
      const object = mustGet(store, objectId);
      // Every run (text-title has two, coloured apart, so they never merge).
      const { runs } = object as unknown as { readonly runs: readonly unknown[] };
      expect(object).toMatchObject({
        runs: runs.map(() => ({ style: { ...LARGE, textStyleId: id } })),
      });
    }
    expect(mustGet(store, 'text-title')).toMatchObject({ width: 430, height: 55 });
    expect(mustGet(store, 'second-page')).toMatchObject({ width: 510, height: 60 });
    expect(mustGet(store, 'main-text')).toMatchObject({ width: 320, height: 45 });
    expect(mustGet(store, 'instance-one')).toMatchObject({ mainId: 'main-one' });
    expect(history.undo()).toBe(true);
    expect([
      mustGet(store, 'text-title'),
      mustGet(store, 'second-page'),
      mustGet(store, 'main-text'),
    ]).toEqual(before);
    history.destroy();
  });

  it('keeps the id for the same governed value, detaches for a different value or explicit null, and delete keeps values', () => {
    const store = createFixtureStore();
    const id = add(store, 'text', 'Body');
    const bind = () =>
      applyCommand(store, setStyleCommand, {
        changes: [{ id: 'text-title', style: { textStyle: { textStyleId: id } } }],
      });
    const patch = (textStyle: Record<string, unknown>) =>
      applyCommand(store, setStyleCommand, {
        changes: [{ id: 'text-title', style: { textStyle } }],
      });
    bind();
    patch({ fontSize: BODY.fontSize });
    const kept = mustGet(store, 'text-title') as unknown as { readonly runs: readonly unknown[] };
    expect(kept).toMatchObject({ runs: kept.runs.map(() => ({ style: { textStyleId: id } })) });
    patch({ fontSize: 30 });
    expect(JSON.stringify(mustGet(store, 'text-title'))).not.toContain('textStyleId');
    bind();
    patch({ textStyleId: null });
    expect(JSON.stringify(mustGet(store, 'text-title'))).not.toContain('textStyleId');
    bind();
    const before = mustGet(store, 'text-title');
    if (before.type !== 'text') throw new Error('fixture text-title changed type');
    applyCommand(store, command('deleteTextStyle'), { id });
    const after = mustGet(store, 'text-title');
    if (after.type !== 'text') throw new Error('fixture text-title changed type');
    expect(
      after.runs.map(({ style }) => (style as unknown as Record<string, unknown>).textStyleId),
    ).toEqual([undefined, undefined]);
    expect(after.runs.map(({ style }) => unboundValue(style))).toEqual(
      before.runs.map(({ style }) => unboundValue(style)),
    );
  });
});

describe('effect style bindings', () => {
  it('applies and rewrites shape and frame layers, then detaches for a changed shadow', () => {
    const store = createFixtureStore();
    const id = add(store, 'effect', 'Depth');
    for (const objectId of ['shape-box', 'frame-plan'])
      applyCommand(store, setStyleCommand, {
        changes: [{ id: objectId, style: { effectStyleId: id } }],
      });
    applyCommand(store, command('setEffectStyle'), {
      id,
      name: 'Depth',
      value: { shadows: [DEEP, SHADOW] },
    });
    for (const objectId of ['shape-box', 'frame-plan'])
      expect(mustGet(store, objectId)).toMatchObject({ effectStyleId: id, shadow: [DEEP, SHADOW] });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'shape-box', style: { shadow: [DEEP, SHADOW] } }],
    } as never);
    expect(mustGet(store, 'shape-box')).toMatchObject({ effectStyleId: id });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'shape-box', style: { shadow: SHADOW } }],
    } as never);
    expect(mustGet(store, 'shape-box')).toMatchObject({ effectStyleId: undefined });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'frame-plan', style: { effectStyleId: null } }],
    });
    expect(mustGet(store, 'frame-plan')).toMatchObject({ effectStyleId: undefined });
    expect(
      codesOf(
        expectRefusedBy(store, BOB, setStyleCommand, {
          changes: [{ id: 'shape-box', style: { effectStyleId: 'missing' } }],
        }),
      ),
    ).toContain('missing-style');
  });

  it('delete detaches users without erasing drawn shadow layers', () => {
    const store = createFixtureStore();
    const id = add(store, 'effect', 'Depth');
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'shape-box', style: { effectStyleId: id } }],
    });
    applyCommand(store, command('deleteEffectStyle'), { id });
    const shape = mustGet(store, 'shape-box');
    expect(shape).toMatchObject({ effectStyleId: undefined });
    expect(
      shape.type === 'shape' && (Array.isArray(shape.shadow) ? shape.shadow : [shape.shadow]),
    ).toEqual([SHADOW]);
  });
});
