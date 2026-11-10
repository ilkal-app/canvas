// @vitest-environment jsdom
// The missing-fonts notice: what it says, Replace… for an editor only, Dismiss ignoring
// the families for the board until another goes missing. In Chrome:
// tooling/scenario/specs/app/missing-fonts.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import type { ObjectId, PrincipalId, TextObject } from '@canvas/schema';
import { fallbackFamily } from '@canvas/text';

import type { FontLoadStatus } from './demand-fonts.js';
import type { MissingFontSources } from './missing-board-fonts.js';
import {
  MISSING_FONTS_LABEL,
  MissingFontsNotice,
  MissingFontsNoticeMemory,
  missingFontsMessage,
  REPLACE_MISSING_FONT_ACTION,
} from './missing-fonts-notice.js';

afterEach(() => {
  cleanup();
});

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;

/**
 * A text object in one family.
 *
 * @param id - Its id.
 * @param fontFamily - Its family.
 * @returns The object.
 */
function textIn(id: string, fontFamily: string): TextObject {
  return {
    id: id as ObjectId,
    type: 'text',
    parentId: null,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    z: `a${id}`,
    locked: false,
    createdBy: ORIGIN.principalId,
    createdAt: 1,
    updatedAt: 1,
    text: 'ab',
    runs: [
      {
        length: 2,
        style: { fontFamily, fontSize: 16, weight: 400, italic: false, color: [0, 0, 0, 1] },
      },
    ],
    autoWidth: true,
    align: 'left',
    verticalAlign: 'top',
  };
}

/** Every family missing but Inter. */
const SOURCES: MissingFontSources = {
  status: (family): FontLoadStatus => (family === 'Inter' ? 'ready' : 'missing'),
  subscribe: () => () => undefined,
  ensure: () => Promise.resolve(false),
};

/**
 * A board with texts in these families.
 *
 * @param families - One text per family.
 * @returns The store.
 */
function boardIn(...families: string[]): YjsDocumentStore {
  const store = new YjsDocumentStore();
  store.transact(ORIGIN, (tx) => {
    families.forEach((family, index) => {
      tx.setObject(textIn(String(index), family));
    });
  });
  return store;
}

describe('missingFontsMessage', () => {
  it('names one family and what it is shown in, or counts several', () => {
    expect(missingFontsMessage(['Brand Serif'])).toBe(
      `“Brand Serif” is missing, so its text is shown in ${fallbackFamily('Brand Serif')}.`,
    );
    expect(missingFontsMessage(['A', 'B'])).toBe(
      '2 fonts are missing (A, B), so their text is shown in substitutes.',
    );
  });
});

describe('MissingFontsNoticeMemory', () => {
  it('keeps a board quiet while every missing family was ignored there, however the list changes', () => {
    const memory = new MissingFontsNoticeMemory();
    expect(memory.isIgnored('b', ['A'])).toBe(false);
    memory.ignore('b', ['A', 'B']);
    expect(memory.isIgnored('b', ['A', 'B'])).toBe(true);
    // One replaced: the other stays quiet.
    expect(memory.isIgnored('b', ['B'])).toBe(true);
    // A new one tells again; ignored with it, the first stays ignored once the new one goes.
    expect(memory.isIgnored('b', ['B', 'C'])).toBe(false);
    memory.ignore('b', ['B', 'C']);
    expect(memory.isIgnored('b', ['A'])).toBe(true);
    expect(memory.isIgnored('other', ['A'])).toBe(false);
  });
});

describe('MissingFontsNotice', () => {
  it('shows nothing while every family is available', () => {
    render(
      <MissingFontsNotice
        store={boardIn('Inter')}
        boardId="b"
        canEdit
        onReplace={vi.fn()}
        memory={new MissingFontsNoticeMemory()}
        sources={SOURCES}
      />,
    );
    expect(screen.queryByRole('status', { name: MISSING_FONTS_LABEL })).toBeNull();
  });

  it('offers an editor Replace… for the first missing family', () => {
    const onReplace = vi.fn<(family: string) => void>();
    render(
      <MissingFontsNotice
        store={boardIn('Inter', 'Brand Serif', 'Brand Grotesk')}
        boardId="b"
        canEdit
        onReplace={onReplace}
        memory={new MissingFontsNoticeMemory()}
        sources={SOURCES}
      />,
    );
    const notice = screen.getByRole('status', { name: MISSING_FONTS_LABEL });
    expect(notice.textContent).toContain(missingFontsMessage(['Brand Grotesk', 'Brand Serif']));
    fireEvent.click(screen.getByRole('button', { name: REPLACE_MISSING_FONT_ACTION }));
    expect(onReplace.mock.calls).toEqual([['Brand Grotesk']]);
  });

  it('tells a viewer without offering Replace…', () => {
    render(
      <MissingFontsNotice
        store={boardIn('Brand Serif')}
        boardId="b"
        canEdit={false}
        onReplace={vi.fn()}
        memory={new MissingFontsNoticeMemory()}
        sources={SOURCES}
      />,
    );
    expect(screen.getByRole('status', { name: MISSING_FONTS_LABEL })).toBeDefined();
    expect(screen.queryByRole('button', { name: REPLACE_MISSING_FONT_ACTION })).toBeNull();
  });

  it('stays dismissed for the same families on this board, and shows again for a new one', () => {
    const memory = new MissingFontsNoticeMemory();
    const store = boardIn('Brand Serif');
    const notice = (boardId: string) => (
      <MissingFontsNotice
        store={store}
        boardId={boardId}
        canEdit
        onReplace={vi.fn()}
        memory={memory}
        sources={SOURCES}
      />
    );
    const first = render(notice('b'));
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }));
    expect(screen.queryByRole('status', { name: MISSING_FONTS_LABEL })).toBeNull();
    expect(memory.isIgnored('b', ['Brand Serif'])).toBe(true);
    first.unmount();
    const { rerender } = render(notice('b'));
    expect(screen.queryByRole('status', { name: MISSING_FONTS_LABEL })).toBeNull();
    // Another board with the same family still tells.
    rerender(notice('other'));
    expect(screen.getByRole('status', { name: MISSING_FONTS_LABEL })).toBeDefined();
    rerender(notice('b'));
    act(() => {
      store.transact(ORIGIN, (tx) => {
        tx.setObject(textIn('9', 'Brand Mono'));
      });
    });
    expect(screen.getByRole('status', { name: MISSING_FONTS_LABEL }).textContent).toContain(
      missingFontsMessage(['Brand Mono', 'Brand Serif']),
    );
  });
});
