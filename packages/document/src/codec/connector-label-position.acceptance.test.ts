import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import * as document from '@canvas/document';
import type { BoardObject } from '@canvas/schema';

import { fixtureObject } from '../store/__fixtures__/store-fixtures.js';

import { toYjs } from './object-codec.js';
import { layoutOf } from './object-layout.js';
import { fromYjs } from './object-reader.js';

/**
 * Encodes and decodes a connector through the actual grouped Yjs layout.
 *
 * @param object - The connector to round-trip.
 * @returns Its raw style and decoded object.
 * @throws {Error} When the codec refuses it.
 */
function roundTrip(object: BoardObject): { style: unknown; read: BoardObject } {
  const doc = new Y.Doc();
  const objects = doc.getMap<unknown>('objects');
  objects.set(object.id, toYjs(object));
  const map = objects.get(object.id) as Y.Map<unknown>;
  const decoded = fromYjs(object.id, map);
  if ('issue' in decoded) throw new Error(decoded.issue.message);
  const result = { style: map.get('style'), read: decoded.object };
  doc.destroy();
  return result;
}

describe('connector label position document layout', () => {
  it('reserves layout 33 and continues to read layout 32', () => {
    expect(
      (document as unknown as Record<string, unknown>).CONNECTOR_LABEL_POSITION_LAYOUT_VERSION,
    ).toBe(33);
    expect(document.DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(33);
    expect(document.READABLE_LAYOUT_VERSIONS).toContain(32);
  });

  it('stores the optional position in style and leaves old connectors absent', () => {
    const style = layoutOf('connector')?.codecs.find(
      (codec) => codec.kind === 'group' && codec.key === 'style',
    );
    expect(style).toMatchObject({ fields: expect.arrayContaining(['labelPosition']) as unknown });
    const connector = fixtureObject('connector-flow', 'connector');
    const absent = roundTrip(connector);
    expect(absent.style).not.toHaveProperty('labelPosition');
    expect(absent.read).not.toHaveProperty('labelPosition');
    const moved = roundTrip({ ...connector, labelPosition: 0.25 });
    expect(moved.style).toHaveProperty('labelPosition', 0.25);
    expect(moved.read).toHaveProperty('labelPosition', 0.25);
  });
});
