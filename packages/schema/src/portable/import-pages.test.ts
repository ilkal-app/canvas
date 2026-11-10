import { describe, expect, it } from 'vitest';

import { sampleObject } from '../objects/__fixtures__/object-samples.js';

import { BoardImportError } from './board-import-error.js';
import { exportBoard } from './export-board.js';
import { importBoard } from './import-board.js';
import { PORTABLE_BOARD_FORMAT } from './portable-board.js';

const document = (pages: unknown, objects: unknown[] = []) => ({
  format: PORTABLE_BOARD_FORMAT,
  schemaVersion: 3,
  pages,
  objects,
});

describe('importBoard pages', () => {
  it('refuses a page id used twice', () => {
    const page = { id: 'p', name: 'P', order: 'a0' };
    expect(() => importBoard(document([page, page]))).toThrow(BoardImportError);
  });

  it('refuses a root object on a page the document lacks', () => {
    const object = { ...sampleObject('shape', 's'), pageId: 'gone' };
    expect(() => importBoard(document([{ id: 'p', name: 'P', order: 'a0' }], [object]))).toThrow(
      BoardImportError,
    );
  });

  it('keeps a board past the page limit, as the live board does', () => {
    const pages = Array.from({ length: 101 }, (unused, index) => ({
      id: `p${String(index)}`,
      name: 'P',
      order: 'a0',
    }));
    expect(exportBoard(importBoard(document(pages))).pages).toHaveLength(101);
  });

  it('reads a document without pages as the default page', () => {
    expect(exportBoard(importBoard(document(undefined))).pages).toEqual([
      { id: 'page-1', name: 'Page 1', order: 'a0' },
    ]);
  });
});
