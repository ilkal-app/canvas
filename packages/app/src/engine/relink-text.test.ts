// A link's Edit and Remove from its chip or the Links list: every text's ranges
// relinked in one setTextRuns batch, one undo step, the characters untouched; a range that no
// longer carries the link (a collaborator's edit since), or bad input, writes nothing.
import { describe, expect, it, vi } from 'vitest';

import { createHistory, YjsDocumentStore } from '@canvas/document';
import type { ObjectId, PrincipalId, TextObject } from '@canvas/schema';

import type { RelinkTarget } from '../state/beside-shell-action.js';

import { LOCAL_USER_ORIGIN } from './demo-document.js';
import { runRelinkText } from './panel-actions.js';

const A = 'https://example.com/a';
const B = 'https://example.com/b';
const STYLE = {
  fontFamily: 'Liberation Sans',
  fontSize: 10,
  color: [0, 0, 0, 1] as [number, number, number, number],
  weight: 400 as const,
  italic: false,
};
const TEXT: TextObject = {
  id: 't' as ObjectId,
  type: 'text',
  parentId: null,
  x: 0,
  y: 0,
  width: 60,
  height: 12.5,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:test' as PrincipalId,
  createdAt: 1,
  updatedAt: 1,
  text: 'ab cd ef',
  runs: [
    { length: 2, style: { ...STYLE, link: A } },
    { length: 4, style: STYLE },
    { length: 2, style: { ...STYLE, link: A } },
  ],
  align: 'left',
  autoWidth: true,
  verticalAlign: 'top',
};
const OTHER: TextObject = { ...TEXT, id: 'u' as ObjectId, x: 100 };

function setUp(objects: readonly TextObject[] = [TEXT]) {
  const store = new YjsDocumentStore();
  store.transact(LOCAL_USER_ORIGIN, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  const edits = {
    store,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
  };
  const onRefused = vi.fn();
  const read = (id: ObjectId = TEXT.id): TextObject => store.get(id) as TextObject;
  const relink = (targets: readonly RelinkTarget[], link: string | null, from = A): void => {
    runRelinkText(edits, { type: 'relinkText', targets, from, link }, onRefused);
  };
  return { store, history, onRefused, read, relink };
}

const BOTH = [
  { start: 0, end: 2 },
  { start: 6, end: 8 },
];
const links = (object: TextObject): (string | undefined)[] =>
  object.runs.map((run) => run.style.link);

describe('runRelinkText', () => {
  it('relinks every range in one undo step, the characters as they were', () => {
    const { history, onRefused, read, relink } = setUp();
    relink([{ id: TEXT.id, ranges: BOTH }], B);
    expect(read().text).toBe(TEXT.text);
    expect(links(read())).toEqual([B, undefined, B]);
    history.undo();
    expect(links(read())).toEqual([A, undefined, A]);
    expect(onRefused).not.toHaveBeenCalled();
  });

  it('removes a link from several texts, and one undo brings it back to all', () => {
    const { history, read, relink } = setUp([TEXT, OTHER]);
    relink(
      [
        { id: TEXT.id, ranges: BOTH },
        { id: OTHER.id, ranges: BOTH },
      ],
      null,
    );
    expect(links(read(TEXT.id))).toEqual([undefined]);
    expect(links(read(OTHER.id))).toEqual([undefined]);
    history.undo();
    expect(links(read(TEXT.id))).toEqual([A, undefined, A]);
    expect(links(read(OTHER.id))).toEqual([A, undefined, A]);
  });

  it("writes nothing when a collaborator's edit moved the link since", () => {
    const { store, read, relink } = setUp();
    // A character typed before the first link: its range is now 1..3, the old 0..2 is stale.
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.insertText(TEXT.id, 0, 'x', STYLE);
    });
    const before = read();
    relink([{ id: TEXT.id, ranges: [{ start: 0, end: 2 }] }], null);
    expect(read()).toBe(before);
  });

  it('writes nothing when the range carries another link now, or only part of it', () => {
    const { read, relink } = setUp();
    const before = read();
    relink([{ id: TEXT.id, ranges: BOTH }], null, B);
    relink([{ id: TEXT.id, ranges: [{ start: 0, end: 1 }] }], null);
    expect(read()).toBe(before);
  });

  it('writes nothing to any text when one of them no longer matches', () => {
    const { read, relink } = setUp([TEXT, OTHER]);
    const before = [read(TEXT.id), read(OTHER.id)];
    relink(
      [
        { id: TEXT.id, ranges: BOTH },
        { id: OTHER.id, ranges: [{ start: 2, end: 4 }] },
      ],
      null,
    );
    expect([read(TEXT.id), read(OTHER.id)]).toEqual(before);
  });

  it.each([
    ['an unsafe link', [{ id: TEXT.id, ranges: BOTH }], 'javascript:alert(1)'],
    ['a link not in normal form', [{ id: TEXT.id, ranges: BOTH }], 'HTTPS://Example.com'],
    ['a range past the text', [{ id: TEXT.id, ranges: [{ start: 6, end: 9 }] }], null],
    ['no range', [{ id: TEXT.id, ranges: [] }], null],
    ['no text', [], null],
    ['an object that draws no text', [{ id: 'missing' as ObjectId, ranges: BOTH }], null],
  ] as const)('writes nothing for %s', (ignored, targets, link) => {
    const { read, relink } = setUp();
    const before = read();
    relink(targets, link);
    expect(read()).toBe(before);
  });

  it('reports a locked text', () => {
    const { onRefused, read, relink } = setUp([{ ...TEXT, locked: true }]);
    relink([{ id: TEXT.id, ranges: BOTH }], null);
    expect(onRefused).toHaveBeenCalledOnce();
    expect(read().runs[0]?.style.link).toBe(A);
  });

  describe('relinking a text with lists', () => {
    it('keeps its paragraph styles, which setTextRuns would otherwise clear', () => {
      const listed: TextObject = {
        ...TEXT,
        text: 'ab\ncd ef',
        paragraphs: [{ list: 'bullet' }, { list: 'numbered', level: 1 }],
      };
      const { read, relink } = setUp([listed]);
      relink([{ id: TEXT.id, ranges: [{ start: 0, end: 2 }] }], B);
      expect(read().runs[0]?.style.link).toBe(B);
      expect(read().paragraphs).toEqual([{ list: 'bullet' }, { list: 'numbered', level: 1 }]);
    });
  });
});
