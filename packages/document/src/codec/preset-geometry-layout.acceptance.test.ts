// Acceptance
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import * as document from '@canvas/document';
import { importBoard, type BoardObject } from '@canvas/schema';

import { createFixtureBoardJson } from './__fixtures__/fixture-board-json.js';
import { toYjs } from './object-codec.js';
import { fromYjs } from './object-reader.js';

const PRESET_GEOMETRY_LAYOUT_VERSION = Reflect.get(
  document,
  'PRESET_GEOMETRY_LAYOUT_VERSION',
) as number;

describe('preset geometry stored layout', () => {
  it('exports the next layout and reads its previous layout', () => {
    // A later layout may follow; this one stays in the build.
    expect(PRESET_GEOMETRY_LAYOUT_VERSION).toBeLessThanOrEqual(document.DOCUMENT_LAYOUT_VERSION);
    expect(PRESET_GEOMETRY_LAYOUT_VERSION).toBe(document.STROKE_ALIGN_LAYOUT_VERSION + 1);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(PRESET_GEOMETRY_LAYOUT_VERSION);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(PRESET_GEOMETRY_LAYOUT_VERSION - 1);
  });

  it('keeps geometry records as plain values in preset and override maps', () => {
    const fixture = [...importBoard(createFixtureBoardJson(true)).objects.values()];
    const sourceMain = fixture.find((object) => object.type === 'component');
    const sourceInstance = fixture.find((object) => object.type === 'instance');
    if (sourceMain === undefined || sourceInstance === undefined)
      throw new Error('missing fixture');
    const main = {
      ...sourceMain,
      variantAxes: [{ name: 'Icon', values: ['20', '24'] }],
      variantPresets: {
        'Icon=24': { [sourceMain.id]: { width: 48 }, icon: { x: 8, y: 8, width: 24, height: 24 } },
      },
    } as BoardObject;
    const placed = { ...sourceInstance, overrides: { icon: { x: 9 } } } as BoardObject;
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.set(main.id, toYjs(main));
    objects.set(placed.id, toYjs(placed));
    const preset = (
      (objects.get(main.id)?.get('variantPresets') as Y.Map<unknown>).get(
        'Icon=24',
      ) as Y.Map<unknown>
    ).get('icon');
    const record = (objects.get(placed.id)?.get('overrides') as Y.Map<unknown>).get('icon');
    expect(preset).toEqual({ x: 8, y: 8, width: 24, height: 24 });
    expect(record).toEqual({ x: 9 });
    expect(preset).not.toBeInstanceOf(Y.AbstractType);
    expect(record).not.toBeInstanceOf(Y.AbstractType);
    for (const object of [main, placed]) {
      const decoded = fromYjs(object.id, objects.get(object.id));
      expect(decoded).toMatchObject({ object });
    }
    doc.destroy();
  });
});
