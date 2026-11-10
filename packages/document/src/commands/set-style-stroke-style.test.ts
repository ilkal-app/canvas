import { describe, expect, it } from 'vitest';

import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, expectRejected, mustGet, NOW } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';
import { STROKE_STYLE_FIELDS, STYLE_FIELDS_BY_TYPE, type StylePatch } from './style-fields.js';

// A path's, line's or connector's stroke style (dash, join, miter limit, cap) is set
// by `setStyle` beside its stroke, stored in the style group and read back.

const STYLED: StylePatch = {
  strokeDash: { pattern: [6, 3], offset: 2 },
  strokeJoin: 'miter',
  strokeMiterLimit: 8,
  strokeCap: 'square',
};

describe('setStyle with a stroke style', () => {
  it('gives the four fields to paths, lines and connectors only', () => {
    for (const type of ['path', 'line', 'connector'] as const) {
      expect(STYLE_FIELDS_BY_TYPE[type]).toEqual(expect.arrayContaining([...STROKE_STYLE_FIELDS]));
    }
    for (const type of ['shape', 'frame', 'text', 'sticky', 'image'] as const) {
      for (const field of STROKE_STYLE_FIELDS) {
        expect(STYLE_FIELDS_BY_TYPE[type]).not.toContain(field);
      }
    }
  });

  it.each(['path-squiggle', 'line-divider', 'connector-flow'])(
    'sets and reads back the stroke style of %s, leaving its stroke as it was',
    (objectId) => {
      const store = createFixtureStore();
      const before = mustGet(store, objectId);
      expect(before).toMatchObject({ strokeDash: undefined, strokeCap: undefined });
      applyCommand(store, setStyleCommand, { changes: [{ id: objectId, style: STYLED }] });
      const after = mustGet(store, objectId);
      expect(after).toMatchObject({ ...STYLED, updatedAt: NOW });
      expect('stroke' in after && 'stroke' in before && after.stroke).toEqual(
        'stroke' in before && before.stroke,
      );
      // Solid again: a null dash.
      applyCommand(store, setStyleCommand, {
        changes: [{ id: objectId, style: { strokeDash: null } }],
      });
      expect(mustGet(store, objectId)).toMatchObject({ strokeDash: null, strokeJoin: 'miter' });
      expect(store.read().issues).toEqual([]);
    },
  );

  it('refuses invalid values, and the fields on a type without them', () => {
    const store = createFixtureStore();
    const invalid = [
      { strokeDash: { pattern: [] } },
      { strokeDash: { pattern: [0, 0] } },
      { strokeDash: { pattern: [4, -2] } },
      { strokeDash: [4, 2] },
      { strokeJoin: 'mitre' },
      { strokeMiterLimit: 0.5 },
      { strokeCap: 'arrow' },
      { strokeCap: 'ink' },
    ];
    for (const style of invalid) {
      const codes = expectRejected(store, setStyleCommand, {
        changes: [{ id: 'line-divider', style }],
      }).map((error) => error.code);
      expect(codes.length).toBeGreaterThan(0);
      expect(new Set(codes)).toEqual(new Set(['invalid-input']));
    }
    const errors = expectRejected(store, setStyleCommand, {
      changes: [{ id: 'shape-box', style: { strokeJoin: 'bevel' } }],
    });
    expect(errors.map((error) => [error.code, error.path])).toEqual([
      ['unsupported-type', ['changes', 0, 'style', 'strokeJoin']],
    ]);
  });
});
