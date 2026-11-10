import { describe, expect, it } from 'vitest';

import * as documentMeta from '../meta/document-meta.js';
import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

const { DOCUMENT_LAYOUT_VERSION, TEXT_DIRECTION_LAYOUT_VERSION } = documentMeta;

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';

describe('text direction style', () => {
  it('reserves stored layout 22 (a later layout may follow)', () => {
    expect(TEXT_DIRECTION_LAYOUT_VERSION).toBe(22);
    expect(DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(TEXT_DIRECTION_LAYOUT_VERSION);
  });

  for (const id of ['text-title', 'sticky-idea']) {
    it(`sets direction and logical alignment on ${id}`, () => {
      const store = createFixtureStore();
      const result = applyCommand(store, setStyleCommand, {
        changes: [{ id, style: { direction: 'rtl', align: 'end' } }],
      });
      expect(result.result).toEqual({ styledIds: [id] });
      expect(mustGet(store, id)).toMatchObject({ direction: 'rtl', align: 'end' });
      applyCommand(store, setStyleCommand, {
        changes: [{ id, style: { direction: 'auto', align: 'start' } }],
      });
      expect(mustGet(store, id)).toMatchObject({ direction: 'auto', align: 'start' });
    });
  }

  it('rejects direction on a shape with the unsupported-type field path', () => {
    const errors = expectRejected(createFixtureStore(), setStyleCommand, {
      changes: [{ id: 'shape-box', style: { direction: 'rtl' } }],
    });
    expect(errors.map(({ code, path }) => [code, path])).toEqual([
      ['unsupported-type', ['changes', 0, 'style', 'direction']],
    ]);
  });
});
