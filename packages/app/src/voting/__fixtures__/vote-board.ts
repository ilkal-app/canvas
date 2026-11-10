import {
  addPageCommand,
  createObjectCommand,
  runCommand,
  YjsDocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import { DEFAULT_PAGE_ID, type ObjectId, type PageId, type PrincipalId } from '@canvas/schema';
import { DEFAULT_NOTE_COLOR, newStickyObject } from '@canvas/tools';

import { DEFAULT_TEXT_STYLE } from '../../text-input/font-catalogue.js';

/** The origin the fixture's objects are made with. */
export const VOTE_ORIGIN: TransactionOrigin = {
  kind: 'user',
  principalId: 'user:vote' as PrincipalId,
};

/** The fixed clock and ids the fixture's commands run with. */
export const VOTE_ENVIRONMENT = {
  clock: () => 1_790_000_000_000,
  createId: () => 'record' as ObjectId,
};

/**
 * A 200 × 200 sticky with a text, its top-left corner at a point.
 *
 * @param id - Its id.
 * @param x - Its left, world units.
 * @param y - Its top.
 * @param fields - What differs: its parent, page, text and z key.
 * @param fields.parentId - Its parent, the root if absent.
 * @param fields.pageId - Its page, a root object's; the first page if absent.
 * @param fields.text - Its text, none if absent.
 * @param fields.z - Its z key.
 * @returns The object to create.
 */
function sticky(
  id: string,
  x: number,
  y: number,
  fields: {
    readonly parentId?: string;
    readonly pageId?: PageId;
    readonly text?: string;
    readonly z: string;
  },
) {
  const note = newStickyObject({ x: 0, y: 0 }, DEFAULT_TEXT_STYLE, [...DEFAULT_NOTE_COLOR]);
  const text = fields.text ?? '';
  return {
    ...note,
    id,
    x,
    y,
    z: fields.z,
    parentId: (fields.parentId ?? null) as ObjectId | null,
    ...(fields.parentId === undefined ? { pageId: fields.pageId ?? DEFAULT_PAGE_ID } : {}),
    text,
    runs: [{ length: text.length, style: DEFAULT_TEXT_STYLE }],
  };
}

/**
 * A board for the vote's section, results and cursor, on its first page: the
 * section (frame) "Ideas" at the origin, 600 × 400; the sticky "inside" in it ("Ship it" over a
 * second line); the sticky "over" at the root but within the section's box ("Fix bugs"); and the
 * sticky "outside", untitled, right of it. A second page holds "elsewhere" where "over" is.
 *
 * @returns The store and the second page.
 * @throws {Error} When a command is refused.
 */
export function voteBoardStore(): { readonly store: YjsDocumentStore; readonly second: PageId } {
  const store = new YjsDocumentStore();
  const added = runCommand(
    store,
    VOTE_ORIGIN,
    addPageCommand,
    { name: 'Second' },
    VOTE_ENVIRONMENT,
  );
  if (added.status !== 'applied') throw new Error('no second page');
  const second = [...store.readPages().values()].find(({ name }) => name === 'Second')?.id;
  if (second === undefined) throw new Error('no second page');
  const objects = [
    {
      type: 'frame' as const,
      id: 'ideas',
      parentId: null,
      pageId: DEFAULT_PAGE_ID,
      x: 0,
      y: 0,
      z: 'a0',
      rotation: 0,
      locked: false,
      width: 600,
      height: 400,
      name: 'Ideas',
      clip: false,
      background: [1, 1, 1, 1] as [number, number, number, number],
    },
    sticky('inside', 20, 20, { parentId: 'ideas', text: 'Ship it\nnow', z: 'a0' }),
    sticky('over', 300, 100, { text: 'Fix bugs', z: 'a1' }),
    sticky('outside', 800, 0, { z: 'a2' }),
    sticky('elsewhere', 300, 100, { pageId: second, text: 'Elsewhere', z: 'a3' }),
  ];
  for (const object of objects) {
    const created = runCommand(
      store,
      VOTE_ORIGIN,
      createObjectCommand,
      { object },
      VOTE_ENVIRONMENT,
    );
    if (created.status !== 'applied') throw new Error(JSON.stringify(created));
  }
  return { store, second };
}
