import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { importBoard, OBJECT_TYPES, type BoardObject } from '@canvas/schema';

import { createFixtureBoardJson } from './__fixtures__/fixture-board-json.js';
import { fromYjs, toYjs, writeObject } from './object-codec.js';
import { layoutOf } from './object-layout.js';
import { EMPTY_TEXT_STYLE_KEY, TEXT_KEY } from './rich-text-codec.js';

const FIXTURE_OBJECTS = [...importBoard(createFixtureBoardJson(true)).objects.values()];

/**
 * Finds a fixture object by id.
 *
 * @param id - The object id.
 * @returns The object.
 * @throws {Error} When the fixture has no such object.
 */
function fixtureObject(id: string): BoardObject {
  const object = FIXTURE_OBJECTS.find((candidate) => candidate.id === id);
  if (object === undefined) throw new Error(`no fixture object ${id}`);
  return object;
}

/**
 * Stores an object in a fresh document's object map, as the store does.
 *
 * @param object - The object.
 * @returns The object map of the new document and the object's integrated map.
 */
function integrate(object: BoardObject): { objects: Y.Map<unknown>; map: Y.Map<unknown> } {
  const objects = new Y.Doc().getMap<unknown>('objects');
  objects.set(object.id, toYjs(object));
  return { objects, map: objects.get(object.id) as Y.Map<unknown> };
}

describe('the copied fixture board', () => {
  it('holds at least one object of every type, like the schema fixture it copies', () => {
    const types = new Set(FIXTURE_OBJECTS.map((object) => object.type));
    expect([...types].sort()).toEqual([...OBJECT_TYPES].sort());
  });
});

describe('toYjs and fromYjs', () => {
  it.each(FIXTURE_OBJECTS)("round-trip the fixture board's $type object $id", (object) => {
    expect(fromYjs(object.id, integrate(object).map)).toEqual({ object });
  });

  it('group the fields written together and keep text, labels and networks as shared types', () => {
    const title = fixtureObject('text-title');
    if (title.type !== 'text') throw new Error('fixture title changed');
    const text = integrate(title).map;
    expect(text.get('identity')).toEqual({
      id: title.id,
      type: 'text',
      createdBy: title.createdBy,
      createdAt: title.createdAt,
    });
    expect(text.get('placement')).toEqual({
      parentId: title.parentId,
      pageId: null,
      x: title.x,
      y: title.y,
      rotation: title.rotation,
    });
    expect(text.get('size')).toEqual({ width: title.width, height: title.height });
    expect(text.get('z')).toBe(title.z);
    expect(text.has('x')).toBe(false);
    expect(text.get(TEXT_KEY)).toBeInstanceOf(Y.Text);
    expect(text.has('runs')).toBe(false);
    expect(text.get(EMPTY_TEXT_STYLE_KEY)).toEqual(title.runs[0]?.style);
    const label = integrate(fixtureObject('shape-box')).map.get('label');
    expect(label).toBeInstanceOf(Y.Map);
    expect(label instanceof Y.Map && label.get(TEXT_KEY)).toBeInstanceOf(Y.Text);
    const path = integrate(fixtureObject('path-squiggle')).map;
    expect(path.get('vertices')).toBeInstanceOf(Y.Map);
    expect(integrate(fixtureObject('image-photo')).map.get('style')).toMatchObject({
      crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
    });
  });

  it('use the fewest keys: one per group or own-key field, none left over', () => {
    for (const object of FIXTURE_OBJECTS) {
      const keys = [...integrate(object).map.keys()].sort();
      // Layout 5 omits start/start constraints; these unchanged fixtures predate constraints.
      // Layout 9 omits an instance's style until it has a colour mode, layout 10
      // an instance's or main's absent variants, and layout 11 a slot's absent swap
      // options. A group's style holds only its layer name, stored once named.
      // A text's last paragraph style is stored only for a list item.
      const storedKeys = [...(layoutOf(object.type)?.keys ?? [])].filter(
        (key) =>
          !['constraints', 'variant', 'variantPresets', 'swapOptions', 'lastParagraph'].includes(
            key,
          ) &&
          !(key === 'style' && object.type === 'instance' && object.colorMode === undefined) &&
          !(key === 'style' && object.type === 'group' && object.name === undefined),
      );
      expect(keys).toEqual(storedKeys.sort());
    }
  });

  it('refuse an object of a type the codec does not know', () => {
    const widget = { ...fixtureObject('frame-plan'), type: 'widget' } as unknown as BoardObject;
    expect(() => toYjs(widget)).toThrow(RangeError);
    expect(() => {
      writeObject(integrate(fixtureObject('frame-plan')).map, widget);
    }).toThrow(RangeError);
  });

  it('build a map that is not yet in a document, so a transaction can insert it', () => {
    expect(toYjs(fixtureObject('frame-plan')).doc).toBeNull();
  });
});

describe('fromYjs reports what it cannot read', () => {
  it('an entry that is not a map, an unknown type, and a map without an identity', () => {
    expect(fromYjs('a', 5)).toMatchObject({ issue: { code: 'not-a-map', key: 'a' } });
    const widgets = new Y.Doc().getMap<unknown>('objects');
    widgets.set('w', new Y.Map<unknown>([['type', 'widget']]));
    expect(fromYjs('w', widgets.get('w'))).toMatchObject({
      issue: { code: 'unknown-type', key: 'w', field: 'identity' },
    });
    widgets.set('v', new Y.Map<unknown>([['identity', { id: 'v', type: 'widget' }]]));
    expect(fromYjs('v', widgets.get('v'))).toMatchObject({
      issue: { code: 'unknown-type', key: 'v', field: 'identity' },
    });
  });

  it('a missing field or group, a malformed group, text, label or network, and a wrong id', () => {
    const { map } = integrate(fixtureObject('frame-plan'));
    const style = map.get('style') as Record<string, unknown>;
    map.set('style', Object.fromEntries(Object.entries(style).filter(([key]) => key !== 'clip')));
    expect(fromYjs('frame-plan', map)).toMatchObject({
      issue: { code: 'missing-field', field: 'clip' },
    });
    map.set('style', 'broken');
    expect(fromYjs('frame-plan', map)).toMatchObject({
      issue: { code: 'malformed-field', field: 'style' },
    });
    map.delete('style');
    expect(fromYjs('frame-plan', map)).toMatchObject({
      issue: { code: 'missing-field', field: 'style' },
    });
    const sticky = integrate(fixtureObject('sticky-idea')).map;
    sticky.set(TEXT_KEY, 'plain');
    expect(fromYjs('sticky-idea', sticky)).toMatchObject({
      issue: { code: 'malformed-field', field: 'text' },
    });
    const shape = integrate(fixtureObject('shape-box')).map;
    shape.set('label', 'API');
    expect(fromYjs('shape-box', shape)).toMatchObject({
      issue: { code: 'malformed-field', field: 'label' },
    });
    const brokenLabel = new Y.Map<unknown>();
    shape.set('label', brokenLabel);
    brokenLabel.set(TEXT_KEY, 1);
    expect(fromYjs('shape-box', shape)).toMatchObject({
      issue: { code: 'malformed-field', field: 'label' },
    });
    const path = integrate(fixtureObject('path-squiggle')).map;
    (path.get('segments') as Y.Map<unknown>).set('s9', 1);
    expect(fromYjs('path-squiggle', path)).toMatchObject({
      issue: { code: 'malformed-field', field: 'segments' },
    });
    path.set('vertices', []);
    expect(fromYjs('path-squiggle', path)).toMatchObject({
      issue: { code: 'malformed-field', field: 'vertices' },
    });
    expect(fromYjs('elsewhere', integrate(fixtureObject('frame-plan')).map)).toMatchObject({
      issue: { code: 'id-mismatch', key: 'elsewhere', field: 'id' },
    });
  });

  it('returns the fields in schema order, whatever the layout', () => {
    const object = fixtureObject('connector-flow');
    const decoded = fromYjs(object.id, integrate(object).map);
    // An optional field the object leaves out (a stroke style) reads as undefined.
    const defined =
      'object' in decoded
        ? Object.entries(decoded.object).flatMap(([key, value]) =>
            value === undefined ? [] : [key],
          )
        : [];
    expect(defined).toEqual(Object.keys(object));
  });
});

describe('writeObject', () => {
  it('writes only the fields that changed, in place', () => {
    const shape = fixtureObject('shape-box');
    const { map } = integrate(shape);
    const label = map.get('label');
    const changed: string[] = [];
    map.observe((event) => changed.push(...event.keysChanged));
    const copy = JSON.parse(JSON.stringify(shape)) as BoardObject;
    map.doc?.transact(() => {
      writeObject(map, { ...copy, x: 50 });
    });
    expect(changed).toEqual(['placement']);
    expect(map.get('label')).toBe(label);
  });

  it('turns a label on and off', () => {
    const star = fixtureObject('shape-star');
    const box = fixtureObject('shape-box');
    if (star.type !== 'shape' || box.type !== 'shape') throw new Error('fixture shapes changed');
    const { map } = integrate(star);
    writeObject(map, { ...star, label: box.label });
    expect(fromYjs(star.id, map)).toEqual({ object: { ...star, label: box.label } });
    writeObject(map, star);
    expect(fromYjs(star.id, map)).toEqual({ object: star });
  });

  it('syncs vertices and segments by member id: keeps, updates, deletes and appends', () => {
    const path = fixtureObject('path-squiggle');
    if (path.type !== 'path') throw new Error('fixture path changed');
    const { map } = integrate(path);
    const vertices = map.get('vertices');
    const edited = {
      ...path,
      vertices: [
        { id: 'v1', x: -5, y: 0, mirror: 'none' as const },
        ...path.vertices.slice(1, 2),
        { id: 'v4', x: 1, y: 2, mirror: 'none' as const },
      ],
      segments: [
        ...path.segments.slice(0, 1),
        { id: 's4', a: 'v2', b: 'v4', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } },
      ],
    };
    writeObject(map, edited);
    expect(fromYjs(path.id, map)).toEqual({ object: edited });
    expect(map.get('vertices')).toBe(vertices);
  });

  it('creates the vertices and segments of a path stored without them', () => {
    const path = fixtureObject('path-squiggle');
    const { map } = integrate(path);
    map.doc?.transact(() => {
      map.delete('vertices');
      map.delete('segments');
    });
    writeObject(map, path);
    expect(fromYjs(path.id, map)).toEqual({ object: path });
  });
});

describe('the placement group', () => {
  it('is written whole by a move and by a reparent, so the two never mix', () => {
    const shape = fixtureObject('shape-star');
    const { map } = integrate(shape);
    const writes: unknown[] = [];
    map.observe(() => writes.push(map.get('placement')));
    map.doc?.transact(() => {
      writeObject(map, { ...shape, x: 1 });
    });
    map.doc?.transact(() => {
      writeObject(map, { ...shape, x: 1, parentId: null });
    });
    expect(writes).toEqual([
      { parentId: shape.parentId, pageId: null, x: 1, y: shape.y, rotation: shape.rotation },
      { parentId: null, pageId: null, x: 1, y: shape.y, rotation: shape.rotation },
    ]);
  });

  it('is not written by a reorder, a resize or a restyle', () => {
    const shape = fixtureObject('shape-box');
    if (shape.type !== 'shape') throw new Error('fixture shape changed');
    const { map } = integrate(shape);
    const changed: string[] = [];
    map.observe((event) => changed.push(...event.keysChanged));
    map.doc?.transact(() => {
      writeObject(map, { ...shape, z: 'a5', width: 1, fill: null });
    });
    expect(changed.sort()).toEqual(['size', 'style', 'z']);
  });
});

describe('a map with stray keys', () => {
  it('reads the layout and ignores keys it does not write', () => {
    const object = fixtureObject('shape-box');
    const { map } = integrate(object);
    map.set('x', 999);
    map.set('fill', null);
    map.set('type', 'widget');
    expect(fromYjs(object.id, map)).toEqual({ object });
    writeObject(map, { ...object, y: 5 });
    expect(fromYjs(object.id, map)).toEqual({ object: { ...object, y: 5 } });
    expect(map.get('x')).toBe(999);
  });
});

describe('the placement page (layout 4)', () => {
  it('reads a placement stored before layout 4 on page-1 for a root, null for a child', () => {
    const root = fixtureObject('frame-plan');
    const child = fixtureObject('text-title');
    for (const object of [root, child]) {
      const { map } = integrate(object);
      map.doc?.transact(() => {
        const legacy = { ...(map.get('placement') as Record<string, unknown>) };
        delete legacy.pageId;
        map.set('placement', legacy);
      });
      const read = fromYjs(object.id, map);
      expect(read).toEqual({
        object: { ...object, pageId: object.parentId === null ? 'page-1' : null },
      });
    }
  });

  it('reads a root naming no valid page on page-1 and a child naming a page with none (R6)', () => {
    const root = fixtureObject('frame-plan');
    const child = fixtureObject('text-title');
    const { map: rootMap } = integrate(root);
    rootMap.doc?.transact(() => {
      rootMap.set('placement', { ...(rootMap.get('placement') as object), pageId: null });
    });
    expect(fromYjs(root.id, rootMap)).toMatchObject({ object: { pageId: 'page-1' } });
    const { map: childMap } = integrate(child);
    childMap.doc?.transact(() => {
      childMap.set('placement', { ...(childMap.get('placement') as object), pageId: 'p2' });
    });
    expect(fromYjs(child.id, childMap)).toMatchObject({ object: { pageId: null } });
  });

  it('does not rewrite a legacy placement only to add the page the reader gives it', () => {
    const root = fixtureObject('frame-plan');
    const { map } = integrate(root);
    map.doc?.transact(() => {
      const legacy = { ...(map.get('placement') as Record<string, unknown>) };
      delete legacy.pageId;
      map.set('placement', legacy);
    });
    const writes: unknown[] = [];
    map.observe(() => writes.push(map.get('placement')));
    map.doc?.transact(() => {
      writeObject(map, { ...root, pageId: 'page-1' as typeof root.pageId });
    });
    expect(writes).toEqual([]);
    map.doc?.transact(() => {
      writeObject(map, { ...root, x: 5, pageId: 'page-1' as typeof root.pageId });
    });
    expect(writes).toEqual([expect.objectContaining({ x: 5, pageId: 'page-1' })]);
  });

  it('rewrites a placement stored as anything but a record', () => {
    const root = fixtureObject('frame-plan');
    for (const stored of [null, 'placement', [1, 2]]) {
      const { map } = integrate(root);
      map.doc?.transact(() => {
        map.set('placement', stored);
      });
      writeObject(map, root);
      expect(fromYjs(root.id, map)).toEqual({ object: root });
    }
  });
});
