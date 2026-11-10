// Item 9, written before the code. CONTRACT: exporting a selected section includes drawn legacy page objects above it whose box centres lie inside, and excludes outside or lower objects. Deliberately not asserted: raster colours or PDF encoding.
import { describe, expect, it } from 'vitest';

import type { Board, BoardObject, ObjectId, PageId } from '@canvas/schema';

import { exportScopeOf } from './export-scope.js';

const PAGE = 'page-1' as PageId;
const OTHER = 'page-2' as PageId;
function boardOf(objects: BoardObject[]): Board {
  return { objects: new Map(objects.map((object) => [object.id, object])) };
}
function object(fields: Record<string, unknown>): BoardObject {
  return {
    parentId: null,
    pageId: PAGE,
    rotation: 0,
    locked: false,
    z: 'a0',
    x: 0,
    y: 0,
    ...fields,
  } as BoardObject;
}
const section = object({
  id: 'section',
  type: 'frame',
  x: 100,
  y: 100,
  width: 300,
  height: 200,
  z: 'a1',
});
function sticky(id: string, x: number, y: number, z = 'a2', fields: Record<string, unknown> = {}) {
  return object({ id, type: 'sticky', x, y, width: 100, height: 100, z, ...fields });
}

describe('selected section export of legacy root objects', () => {
  it('includes a root sticky over the section, and keeps the section bounds', () => {
    const scope = exportScopeOf(boardOf([section, sticky('inside', 150, 125)]), {
      kind: 'selection',
      ids: ['section' as ObjectId],
    });
    expect(scope?.shownIds.has('inside' as ObjectId)).toBe(true);
    expect(scope?.objects.map(({ id }) => id)).toContain('inside');
    expect(scope?.rect).toEqual({ x: 100, y: 100, width: 300, height: 200 });
  });
  it('excludes roots outside, below, hidden, on another page, or comments', () => {
    const scope = exportScopeOf(
      boardOf([
        section,
        sticky('outside', 450, 125),
        sticky('below', 150, 125, 'a0'),
        sticky('hidden', 150, 125, 'a3', { isHidden: true }),
        sticky('other-page', 150, 125, 'a4', { pageId: OTHER }),
        object({ id: 'comment', type: 'comment', x: 150, y: 125, z: 'a5' }),
      ]),
      { kind: 'selection', ids: ['section' as ObjectId] },
    );
    expect([...(scope?.shownIds ?? [])]).toEqual(['section']);
  });
});

describe('selected section export, turned sections and groups (review)', () => {
  const turned = { ...section, rotation: Math.PI / 4 };
  it('takes what lies inside a turned section, not what is only inside its bounding box', () => {
    const c = Math.SQRT1_2;
    // Centred at the section's local (150, 100), and at board (250, 130): inside its bounding
    // box but above its turned top edge.
    const inside = sticky('inside', 100 + 150 * c - 100 * c - 50, 100 + 150 * c + 100 * c - 50);
    const corner = sticky('corner', 200, 80);
    const scope = exportScopeOf(boardOf([turned, inside, corner]), {
      kind: 'selection',
      ids: ['section' as ObjectId],
    });
    expect(scope?.shownIds.has('inside' as ObjectId)).toBe(true);
    expect(scope?.shownIds.has('corner' as ObjectId)).toBe(false);
  });
  it('takes a root group whose drawn children lie on the section, with its children', () => {
    const group = object({ id: 'group', type: 'group', z: 'a2' });
    const child = sticky('child', 150, 125, 'a0', { parentId: 'group', pageId: null });
    const scope = exportScopeOf(boardOf([section, group, child]), {
      kind: 'selection',
      ids: ['section' as ObjectId],
    });
    expect(scope?.shownIds.has('group' as ObjectId)).toBe(true);
    expect(scope?.shownIds.has('child' as ObjectId)).toBe(true);
  });
});
