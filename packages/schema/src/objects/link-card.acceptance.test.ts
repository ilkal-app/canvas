import { describe, expect, it } from 'vitest';

import * as publicSchema from '../index.js';
import { MIGRATIONS, OBJECT_TYPES, SCHEMA_VERSION } from '../index.js';
import { runMigrations } from '../migrations/run-migrations.js';
import { exportBoard } from '../portable/export-board.js';
import { importBoard } from '../portable/import-board.js';
import { PORTABLE_BOARD_FORMAT } from '../portable/portable-board.js';

import { sampleObject, sampleSharedFields } from './__fixtures__/object-samples.js';
import { boardObjectSchema } from './board-object.js';
import {
  LINK_LAYOUTS,
  LINK_STATUSES,
  LINK_TEXT_LIMITS,
  clipLinkText,
  linkObjectSchema,
} from './link-object.js';

const card = {
  ...sampleSharedFields('card-1'),
  type: 'link',
  width: 320,
  height: 240,
  url: 'https://example.com/page',
  title: 'A title',
  description: '',
  siteName: 'Example',
  layout: 'vertical',
  status: 'pending',
  unfurlKey: 'paste-1',
} as const;

describe('link card schema', () => {
  it('registers link last, validates its fields, and accepts it as a board object', () => {
    expect(OBJECT_TYPES.at(-1)).toBe('link');
    expect(publicSchema).toMatchObject({
      linkObjectSchema,
      LINK_LAYOUTS,
      LINK_STATUSES,
      LINK_TEXT_LIMITS,
      clipLinkText,
    });
    expect(LINK_LAYOUTS).toEqual(['vertical', 'horizontal']);
    expect(LINK_STATUSES).toEqual(['pending', 'ready', 'failed']);
    expect(LINK_TEXT_LIMITS).toEqual({ title: 300, description: 1000, siteName: 120 });
    expect(linkObjectSchema.parse(card)).toMatchObject(card);
    expect(boardObjectSchema.parse(card)).toMatchObject(card);
    const longestUrl = 'https://e.test/' + 'x'.repeat(2048 - 'https://e.test/'.length);
    expect(
      linkObjectSchema.safeParse({
        ...card,
        url: longestUrl,
        imageAssetId: 'asset-preview',
        faviconAssetId: 'asset-icon',
      }).success,
    ).toBe(true);
    for (const patch of [
      { url: 'javascript:alert(1)' },
      { url: 'https://e.test/' + 'x'.repeat(2048) },
      { title: 'x'.repeat(301) },
      { description: 'x'.repeat(1001) },
      { siteName: 'x'.repeat(121) },
      { layout: 'grid' },
      { status: 'stale' },
      { unfurlKey: '' },
      { unfurlKey: 'x'.repeat(65) },
      { imageAssetId: '' },
      { faviconAssetId: '' },
    ])
      expect(linkObjectSchema.safeParse({ ...card, ...patch }).success).toBe(false);
    expect(
      linkObjectSchema.safeParse({ ...card, title: '', description: '', siteName: '' }).success,
    ).toBe(true);
  });

  it('clips trimmed text by code point and leaves the caller untouched', () => {
    const fields = Object.freeze({
      title: '  ' + '😀'.repeat(301) + '  ',
      description: '  ' + 'a'.repeat(1001),
      siteName: '  ' + 'b'.repeat(121),
    });
    const clipped = clipLinkText(fields);
    expect(clipped).toEqual({
      title: '😀'.repeat(300),
      description: 'a'.repeat(1000),
      siteName: 'b'.repeat(120),
    });
    expect(fields.title.endsWith('  ')).toBe(true);
    expect(Array.from(clipped.title)).toHaveLength(300);
  });

  it('adds an identity migration and preserves a card through portable JSON', () => {
    expect(SCHEMA_VERSION).toBeGreaterThan(38);
    expect(MIGRATIONS.has(39)).toBe(true);
    const old = { schemaVersion: 38, objects: [sampleObject('sticky', 'older-note')] };
    expect(runMigrations(structuredClone(old), MIGRATIONS, 39)).toEqual({
      schemaVersion: 39,
      objects: old.objects,
    });
    const input = { format: PORTABLE_BOARD_FORMAT, schemaVersion: SCHEMA_VERSION, objects: [card] };
    const imported = importBoard(input);
    const portable = JSON.parse(JSON.stringify(exportBoard(imported))) as unknown;
    expect(exportBoard(importBoard(portable)).objects).toEqual(exportBoard(imported).objects);
    expect(exportBoard(imported).objects).toEqual([expect.objectContaining(card)]);
  });
});
