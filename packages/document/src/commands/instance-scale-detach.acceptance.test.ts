// Detaching a scaled instance bakes its drawn values into valid stored objects.
import { describe, expect, it } from 'vitest';

import {
  boardObjectSchema,
  resolveInstance,
  validateBoard,
  type BoardObject,
  type InstanceObject,
  type ObjectId,
} from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';
const id = (value: string): ObjectId => value as ObjectId;
const BODY = { fontFamily: 'Inter', fontSize: 24, color: [0, 0, 0, 1], weight: 400, italic: false };

function object(
  type: string,
  objectId: string,
  parentId: string | null,
  fields: Record<string, unknown>,
): BoardObject {
  return {
    id: id(objectId),
    type,
    parentId: parentId === null ? null : id(parentId),
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: ADA.principalId,
    createdAt: 1,
    updatedAt: 1,
    ...fields,
  } as BoardObject;
}

function component(name: string, fields: Record<string, unknown> = {}): BoardObject {
  return object('component', name, null, {
    width: 200,
    height: 100,
    name,
    retired: false,
    ...fields,
  });
}

function instance(name: string, main: string, fields: Record<string, unknown> = {}): BoardObject {
  return object('instance', name, null, {
    width: 200,
    height: 100,
    mainId: id(main),
    overrides: {},
    ...fields,
  });
}

function shape(name: string, parent: string, fields: Record<string, unknown> = {}): BoardObject {
  return object('shape', name, parent, {
    width: 20,
    height: 20,
    kind: 'rectangle',
    stroke: { color: [0, 0, 0, 1], width: 2 },
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
    ...fields,
  });
}

function text(name: string, parent: string, fields: Record<string, unknown> = {}): BoardObject {
  return object('text', name, parent, {
    width: 20,
    height: 10,
    text: 'Hi',
    runs: [{ length: 2, style: BODY }],
    align: 'left',
    autoWidth: false,
    verticalAlign: 'top',
    ...fields,
  });
}

function line(name: string, parent: string, fields: Record<string, unknown> = {}): BoardObject {
  return object('line', name, parent, {
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
    ],
    route: 'straight',
    stroke: { color: [0, 0, 0, 1], width: 2 },
    startCap: 'none',
    endCap: 'arrow',
    ...fields,
  });
}

function frame(name: string, parent: string, fields: Record<string, unknown> = {}): BoardObject {
  return object('frame', name, parent, {
    width: 30,
    height: 20,
    name,
    clip: false,
    background: null,
    ...fields,
  });
}

const SHADOW = { x: 80, y: -80, blur: 40, spread: 0, color: [0, 0, 0, 0.5] } as const;

function seeded(objects: readonly BoardObject[]): YjsDocumentStore {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  return store;
}

function detach(store: YjsDocumentStore, instanceId = 'inst') {
  return applyCommand(store, mustFindCommand('detachInstance'), { id: instanceId }).result as {
    frameId: ObjectId;
    createdIds: readonly ObjectId[];
    idMap: Record<string, ObjectId>;
    clamped?: { objectId: ObjectId; field: string; from: number; to: number }[];
  };
}

function appearance(object: BoardObject): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(object).filter(
      ([key]) =>
        !['id', 'parentId', 'pageId', 'z', 'createdBy', 'createdAt', 'updatedAt'].includes(key),
    ),
  );
}

describe('detachInstance of scaled content', () => {
  it('bakes the resolved child appearance and scales the main layout on the same-id frame', () => {
    const layout = {
      direction: 'row',
      gap: 6,
      padding: { top: 1, right: 2, bottom: 3, left: 4 },
      align: 'start',
      justify: 'start',
      width: 'fixed',
      height: 'fixed',
    } as const;
    const store = seeded([
      component('main', { width: 100, height: 50, autoLayout: layout }),
      shape('box', 'main', { x: 4, y: 5, width: 20, height: 10, cornerRadius: 2, z: 'a0' }),
      text('label', 'main', { x: 30, y: 5, z: 'a1' }),
      instance('inst', 'main', { x: 400, width: 200, height: 100, scale: 2 }),
    ]);
    const before = mustGet(store, 'inst') as InstanceObject;
    const copies = resolveInstance(store.read(), before).objects;
    const result = detach(store);
    expect(result.clamped).toEqual([]);
    expect(mustGet(store, 'inst')).toMatchObject({
      type: 'frame',
      x: 400,
      width: 200,
      height: 100,
      autoLayout: { gap: 12, padding: { top: 2, right: 4, bottom: 6, left: 8 } },
    });
    expect('scale' in mustGet(store, 'inst')).toBe(false);
    for (const copy of copies) {
      const path = copy.id.slice('inst/'.length);
      expect(appearance(mustGet(store, result.idMap[path] ?? 'missing'))).toEqual(appearance(copy));
    }
    expect(validateBoard(store.read())).toEqual([]);
  });

  it('composes a retained nested instance scale and leaves its overrides in main units', () => {
    const overrides = { leaf: { text: 'Long', measuredSize: { width: 30, height: 12 } } };
    const store = seeded([
      component('inner', { width: 100, height: 50 }),
      text('leaf', 'inner'),
      component('main', { width: 100, height: 50 }),
      instance('nested', 'inner', {
        parentId: id('main'),
        x: 10,
        width: 50,
        height: 25,
        scale: 0.5,
        overrides,
      }),
      instance('inst', 'main', { width: 200, height: 100, scale: 2 }),
    ]);
    const resolved = resolveInstance(store.read(), mustGet(store, 'inst') as InstanceObject);
    const copy = resolved.objects.find((object) => object.id === 'inst/nested');
    expect(copy).toMatchObject({ overrides });
    const result = detach(store);
    expect(mustGet(store, result.idMap.nested ?? 'missing')).toMatchObject({
      type: 'instance',
      x: 20,
      width: 100,
      height: 50,
      // 0.5 × 2 composes to 1, which is stored as no scale (absent is 1).
      scale: undefined,
      overrides,
    });
    expect(validateBoard(store.read())).toEqual([]);
  });

  it('clamps and reports every out-of-range baked length, then stores a valid board', () => {
    const baseText = text('words', 'main', { text: 'Hi' });
    if (baseText.type !== 'text') throw new Error('text fixture changed');
    const style = baseText.runs[0]?.style;
    if (style === undefined) throw new Error('text fixture has no style');
    const store = seeded([
      component('main', { width: 100, height: 50 }),
      {
        ...baseText,
        runs: [
          {
            length: 2,
            style: {
              ...style,
              fontSize: 30,
              letterSpacing: { unit: 'px', value: 30 },
              lineHeight: { unit: 'px', value: 300 },
            },
          },
        ],
      },
      shape('box', 'main', {
        stroke: { color: [0, 0, 0, 1], width: 5 },
        shadow: [SHADOW],
      }),
      line('dash', 'main', { strokeDash: { pattern: [300, 2], offset: 0 } }),
      instance('inst', 'main', { width: 2000, height: 1000, scale: 20 }),
    ]);
    const result = detach(store);
    const expected = [
      ['words', 'runs.0.style.fontSize', 600, 400],
      ['words', 'runs.0.style.letterSpacing.value', 600, 400],
      ['words', 'runs.0.style.lineHeight.value', 6000, 4000],
      ['box', 'stroke.width', 100, 64],
      ['box', 'shadow.0.blur', 800, 500],
      ['box', 'shadow.0.x', 1600, 1000],
      ['box', 'shadow.0.y', -1600, -1000],
      ['dash', 'strokeDash.pattern.0', 6000, 4096],
    ] as const;
    for (const [path, field, from, to] of expected) {
      expect(result.clamped ?? []).toContainEqual({
        objectId: result.idMap[path],
        field,
        from,
        to,
      });
    }
    expect(validateBoard(store.read())).toEqual([]);
    for (const object of store.read().objects.values())
      expect(boardObjectSchema.safeParse(object).success).toBe(true);
  });

  it.each([
    [0.05, 0.05, 0.0025, 0.05],
    [20, 20, 400, 20],
  ] as const)('clamps composed nested scale %s × %s to %s', (outerScale, innerScale, from, to) => {
    const store = seeded([
      component('inner'),
      component('main'),
      instance('nested', 'inner', { parentId: id('main'), scale: innerScale }),
      instance('inst', 'main', { scale: outerScale }),
    ]);
    const result = detach(store);
    const nestedId = result.idMap.nested;
    // The composed scale is a float product (0.05 × 0.05 is 0.0025000000000000005).
    expect(result.clamped ?? []).toContainEqual({
      objectId: nestedId,
      field: 'scale',
      from: expect.closeTo(from, 12) as number,
      to,
    });
    expect(mustGet(store, nestedId ?? 'missing')).toMatchObject({ scale: to });
    expect(validateBoard(store.read())).toEqual([]);
  });

  it('clamps a baked run below the 4 px minimum and reports the change', () => {
    const source = text('words', 'main');
    const store = seeded([
      component('main'),
      source,
      instance('inst', 'main', { scale: 0.05, width: 10, height: 5 }),
    ]);
    const result = detach(store);
    expect(result.clamped ?? []).toContainEqual({
      objectId: result.idMap.words,
      field: 'runs.0.style.fontSize',
      from: 24 * 0.05,
      to: 4,
    });
    expect(validateBoard(store.read())).toEqual([]);
  });

  it('keeps named style ids at scale 1 and drops them after baking a different scale', () => {
    for (const scale of [1, 2]) {
      const base = text('words', 'main');
      if (base.type !== 'text') throw new Error('text fixture changed');
      const firstRun = base.runs[0];
      if (firstRun === undefined) throw new Error('text fixture has no run');
      const store = seeded([
        component('main'),
        { ...base, runs: [{ length: 2, style: { ...firstRun.style, textStyleId: 'body' } }] },
        shape('box', 'main', { effectStyleId: 'effect-card' }),
        frame('inner-frame', 'main', { effectStyleId: 'effect-card' }),
        instance('inst', 'main', { scale }),
      ]);
      const result = detach(store);
      const innerFrame = mustGet(store, result.idMap['inner-frame'] ?? 'missing');
      const box = mustGet(store, result.idMap.box ?? 'missing');
      const words = mustGet(store, result.idMap.words ?? 'missing');
      expect(Reflect.get(innerFrame, 'effectStyleId')).toBe(
        scale === 1 ? 'effect-card' : undefined,
      );
      expect(Reflect.get(box, 'effectStyleId')).toBe(scale === 1 ? 'effect-card' : undefined);
      expect(words.type).toBe('text');
      if (words.type === 'text')
        expect(words.runs[0]?.style.textStyleId).toBe(scale === 1 ? 'body' : undefined);
    }
  });

  it('undoes to the exact scaled instance and redoes the baked frame in one step', () => {
    const store = seeded([
      component('main'),
      shape('box', 'main'),
      instance('inst', 'main', { scale: 2 }),
    ]);
    const before = mustGet(store, 'inst');
    const history = createHistory(store, ADA.principalId);
    const result = detach(store);
    const frame = mustGet(store, 'inst');
    const children = result.createdIds.map((childId) => mustGet(store, childId));
    expect(history.undo()).toBe(true);
    expect(mustGet(store, 'inst')).toEqual(before);
    for (const childId of result.createdIds) expect(store.get(childId)).toBeUndefined();
    expect(history.redo()).toBe(true);
    expect(mustGet(store, 'inst')).toEqual(frame);
    expect(result.createdIds.map((childId) => mustGet(store, childId))).toEqual(children);
    history.destroy();
  });
});
