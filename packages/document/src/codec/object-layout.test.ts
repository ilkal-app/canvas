import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { OBJECT_TYPES } from '@canvas/schema';

import { layoutOf, storedTypeOf, type FieldCodec } from './object-layout.js';

/**
 * Lists a type's codecs in a compact form.
 *
 * @param type - The object type.
 * @returns Each codec as `kind:key` or `group:key(fields)`.
 */
function describeLayout(type: string): string[] {
  return (layoutOf(type)?.codecs ?? []).map((codec: FieldCodec) => {
    if (codec.kind === 'group') return `${codec.key}(${codec.fields.join(',')})`;
    if (codec.kind === 'pair') return `pair:${codec.key}(${codec.parts.join(',')})`;
    return codec.kind === 'inline-text' ? 'inline-text' : `${codec.kind}:${codec.key}`;
  });
}

describe('layoutOf', () => {
  it('has a layout for every object type of the schema', () => {
    for (const type of OBJECT_TYPES) expect(layoutOf(type)).toBeDefined();
    expect(layoutOf('widget')).toBeUndefined();
    expect(layoutOf(3)).toBeUndefined();
  });

  it('groups the fields written together and keeps the ones edited apart under their own keys', () => {
    expect(describeLayout('sticky')).toEqual([
      'identity(id,type,createdBy,createdAt)',
      'placement(parentId,pageId,x,y,rotation)',
      'size(width,height,layoutChild)',
      'style(name,opacity,isHidden,align,direction,autoWidth,verticalAlign,color,aspect,link)',
      'plain:constraints',
      'plain:z',
      'plain:locked',
      'plain:updatedAt',
      'inline-text',
    ]);
    expect(describeLayout('connector')).toEqual([
      'identity(id,type,createdBy,createdAt)',
      'placement(parentId,pageId,x,y,rotation)',
      'style(name,opacity,isHidden,route,stroke,strokeDash,strokeJoin,strokeMiterLimit,strokeCap,startCap,endCap,labelPosition,elbowMiddle,curvePoint)',
      'plain:constraints',
      'plain:z',
      'plain:locked',
      'plain:updatedAt',
      'plain:from',
      'plain:to',
      'label:label',
    ]);
  });

  it('stores networks as keyed maps, and gives a group a style group of its name, opacity and visibility', () => {
    expect(describeLayout('path')).toEqual(
      expect.arrayContaining([
        'network:vertices',
        'network:segments',
        'style(name,opacity,isHidden,stroke,strokeDash,strokeJoin,strokeMiterLimit,strokeCap,fill)',
      ]),
    );
    // A group's only style fields are its optional layer name, opacity and
    // visibility, stored once one is set.
    expect(describeLayout('group').filter((codec) => codec.startsWith('style'))).toEqual([
      'style(name,opacity,isHidden)',
    ]);
    expect(describeLayout('comment')).toEqual(
      expect.arrayContaining(['style(name,threadId)', 'plain:anchor']),
    );
    expect(describeLayout('line')).toContain('pair:points(points.0,points.1)');
    expect(layoutOf('line')?.keys.has('points')).toBe(false);
  });

  it('lists every key a layout writes, with the text keys of a body', () => {
    expect([...(layoutOf('text')?.keys ?? [])].sort()).toEqual(
      [
        'constraints',
        'emptyTextStyle',
        'identity',
        'lastParagraph',
        'locked',
        'placement',
        'size',
        'style',
        'text',
        'updatedAt',
        'z',
      ].sort(),
    );
    expect(layoutOf('text')?.fieldNames).toContain('runs');
  });
});

describe('storedTypeOf', () => {
  it('reads the type from the identity group, and nothing from a map without one', () => {
    const objects = new Y.Doc().getMap<unknown>('objects');
    const grouped = new Y.Map<unknown>([['identity', { id: 'a', type: 'shape' }]]);
    const perField = new Y.Map<unknown>([['type', 'sticky']]);
    const broken = new Y.Map<unknown>([['identity', 'shape']]);
    objects.set('a', grouped);
    objects.set('b', perField);
    objects.set('c', broken);
    expect(storedTypeOf(grouped)).toBe('shape');
    expect(storedTypeOf(perField)).toBeUndefined();
    expect(storedTypeOf(broken)).toBeUndefined();
  });
});
