import { describe, expect, it } from 'vitest';

import { sampleObject } from '../objects/__fixtures__/object-samples.js';

import { exportBoard } from './export-board.js';
import { importBoard } from './import-board.js';
import { PORTABLE_BOARD_FORMAT } from './portable-board.js';

const previous = {
  format: PORTABLE_BOARD_FORMAT,
  schemaVersion: 2,
  objects: [
    sampleObject('group', 'parent'),
    sampleObject('shape', 'child', { parentId: 'parent' as ReturnType<typeof sampleObject>['id'] }),
  ],
};

describe('portable pages', () => {
  it('migrates schema 2 roots and children without changing their coordinates or ids', () => {
    const before = structuredClone(previous);
    const exported = exportBoard(importBoard(previous)) as unknown as {
      pages: readonly { id: string; name: string; order: string }[];
      objects: readonly Record<string, unknown>[];
    };
    expect(exported.pages).toEqual([{ id: 'page-1', name: 'Page 1', order: 'a0' }]);
    expect(exported.objects).toEqual(
      expect.arrayContaining(
        previous.objects.map((object) => ({
          ...object,
          pageId: object.parentId === null ? 'page-1' : null,
        })),
      ),
    );
    expect(previous).toEqual(before);
  });
  it('round-trips schema 3 page identity, name, order and membership', () => {
    const input = {
      ...previous,
      schemaVersion: 3,
      pages: [
        { id: 'other', name: 'Other', order: 'a1' },
        { id: 'page-1', name: 'Renamed', order: 'a0' },
      ],
      objects: previous.objects.map((object) => ({
        ...object,
        pageId: object.parentId === null ? 'other' : null,
      })),
    };
    const exported = exportBoard(importBoard(input)) as unknown as {
      pages: unknown;
      objects: unknown;
    };
    expect(exported.pages).toEqual([...input.pages].reverse());
    expect(exported.objects).toEqual(expect.arrayContaining(input.objects));
  });
});
