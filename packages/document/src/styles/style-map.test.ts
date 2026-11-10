import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { PrincipalId } from '@canvas/schema';

import { DocumentWriteError } from '../store/document-write-error.js';

import {
  eraseStyle,
  parseStyleKey,
  readStyles,
  styleKey,
  TEXT_STYLES_MAP_NAME,
  writeStyle,
} from './style-map.js';

const ADA = 'user:ada' as PrincipalId;
const BODY = { fontFamily: 'Inter', fontSize: 16, weight: 400, italic: false } as const;

/**
 * A text styles map, in a document of its own.
 *
 * @returns The document and its map.
 */
function textMap(): { readonly doc: Y.Doc; readonly map: Y.Map<unknown> } {
  const doc = new Y.Doc();
  return { doc, map: doc.getMap<unknown>(TEXT_STYLES_MAP_NAME) };
}

describe('the named style map', () => {
  it('splits keys of style fields only', () => {
    expect(parseStyleKey('body.value')).toEqual({ styleId: 'body', field: 'value' });
    expect(parseStyleKey('body')).toBeUndefined();
    expect(parseStyleKey('body.light')).toBeUndefined();
    expect(parseStyleKey('bad id.name')).toBeUndefined();
  });

  it('writes a style once, then only the keys that change, and erases it', () => {
    const { doc, map } = textMap();
    doc.transact(() => {
      writeStyle(
        map,
        'text',
        { id: 'body', name: 'Body', value: BODY },
        { createdBy: ADA, createdAt: 5 },
      );
    });
    const identity = map.get(styleKey('body', 'identity'));
    doc.transact(() => {
      writeStyle(
        map,
        'text',
        { id: 'body', name: 'Copy', value: BODY },
        { createdBy: ADA, createdAt: 9 },
      );
    });
    expect(map.get(styleKey('body', 'identity'))).toBe(identity);
    expect(readStyles(map, 'text').get('body')).toEqual({
      id: 'body',
      name: 'Copy',
      value: BODY,
      createdBy: ADA,
      createdAt: 5,
    });
    expect(eraseStyle(map, 'body')).toBe(true);
    expect(eraseStyle(map, 'body')).toBe(false);
    expect(readStyles(map, 'text').size).toBe(0);
  });

  it('refuses an invalid write, and reads around unreadable or orphaned keys', () => {
    const { map } = textMap();
    expect(() => {
      writeStyle(
        map,
        'text',
        { id: 'body', name: ' ', value: BODY },
        { createdBy: ADA, createdAt: 1 },
      );
    }).toThrow(DocumentWriteError);
    map.set(styleKey('orphan', 'name'), 'Orphan');
    map.set(styleKey('bad', 'identity'), { createdBy: 'nobody', createdAt: 1 });
    map.set(styleKey('unreadable', 'identity'), { createdBy: null, createdAt: 1 });
    map.set(styleKey('unreadable', 'name'), 'Unreadable');
    map.set(styleKey('unreadable', 'value'), { shadows: [] });
    expect(readStyles(map, 'text').size).toBe(0);
  });
});
