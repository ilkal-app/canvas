// @vitest-environment jsdom
// The board search highlight's feed to the engine: the objects found on the page
// shown, the active one marked, in the theme's hand colour; sent only when it changes, cleared
// when the sheet closes.
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SearchHit } from '@canvas/document';
import { EMPTY_SEARCH_HIGHLIGHT, type SearchHighlightModel } from '@canvas/engine';
import { DEFAULT_PAGE_ID, type ObjectId, type PageId } from '@canvas/schema';

import { createDemoDocument } from '../engine/demo-document.js';
import { DocumentBoardView } from '../engine/document-board-view.js';
import { memoryShape } from '../panels/__fixtures__/memory-board.js';

import { useSearchHighlights } from './use-search-highlights.js';
import type { ResultRow } from './use-search-rows.js';

/**
 * A hit on a page.
 *
 * @param id - The object.
 * @param pageId - Its page.
 * @returns The hit.
 */
function hit(id: string, pageId: PageId = DEFAULT_PAGE_ID): SearchHit {
  return { id: id as ObjectId, group: 'text', text: id, pageId, sectionName: undefined };
}

/**
 * A row for a result.
 *
 * @param key - Its key: the object's id, or a comment's.
 * @param threadId - The comment thread, for a comment row.
 * @returns The row.
 */
function row(key: string, threadId?: string): ResultRow {
  return {
    key,
    icon: 'text',
    text: key,
    meta: undefined,
    threadId,
    go: () => Promise.resolve(true),
  };
}

/**
 * Renders the hook over two 10 px shapes, at the origin and at 100, 0.
 *
 * @param hits - The results.
 * @param active - The active row.
 * @returns The engine's calls and the render.
 */
function renderHighlights(hits: readonly SearchHit[], active: ResultRow | undefined) {
  const store = createDemoDocument([memoryShape('a', 'a0'), { ...memoryShape('b', 'a1'), x: 100 }]);
  const view = new DocumentBoardView(store, { ids: () => [], select: () => undefined });
  const shown: SearchHighlightModel[] = [];
  const engine = {
    showSearchHighlights: vi.fn((model: SearchHighlightModel) => {
      shown.push(model);
    }),
  };
  const rendered = renderHook(
    (props: { hits: readonly SearchHit[]; active: ResultRow | undefined }) => {
      useSearchHighlights({ engine, view }, props.hits, DEFAULT_PAGE_ID, props.active);
    },
    { initialProps: { hits, active } },
  );
  return { shown, engine, ...rendered };
}

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--color-hand-you');
});

describe('useSearchHighlights', () => {
  it('outlines the hits on the page shown, the active one marked, in the theme’s colour', () => {
    document.documentElement.style.setProperty('--color-hand-you', '#b7801c');
    const { shown } = renderHighlights(
      [hit('a'), hit('b'), hit('c', 'page-2' as PageId)],
      row('b'),
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]?.boxes.map((box) => box.isActive)).toEqual([false, true]);
    expect(shown[0]?.boxes[1]?.bounds).toMatchObject({ minX: 100, maxX: 110 });
    expect(shown[0]?.color).toEqual([183 / 255, 128 / 255, 28 / 255, 1]);
  });

  it('sends only changes, marks no object for a comment row, and clears on close', () => {
    const { shown, rerender, unmount } = renderHighlights([hit('a')], row('a'));
    rerender({ hits: [hit('a')], active: row('a') });
    expect(shown).toHaveLength(1);
    expect(shown[0]?.color).toEqual([0.89, 0.66, 0.23, 1]);
    rerender({ hits: [hit('a')], active: row('comment:t', 't') });
    expect(shown[1]?.boxes[0]?.isActive).toBe(false);
    unmount();
    expect(shown.at(-1)).toEqual(EMPTY_SEARCH_HIGHLIGHT);
  });

  it('reads the colour where the sheet is, under its themed root', () => {
    const themedRoot = document.body.appendChild(document.createElement('div'));
    themedRoot.style.setProperty('--color-hand-you', '#e3a93b');
    const field = themedRoot.appendChild(document.createElement('input'));
    const store = createDemoDocument([memoryShape('a', 'a0')]);
    const view = new DocumentBoardView(store, { ids: () => [], select: () => undefined });
    const showSearchHighlights = vi.fn<(model: SearchHighlightModel) => void>();
    renderHook(() => {
      useSearchHighlights(
        { engine: { showSearchHighlights }, view },
        [hit('a')],
        DEFAULT_PAGE_ID,
        undefined,
        { current: field },
      );
    });
    expect(showSearchHighlights.mock.calls[0]?.[0].color).toEqual([
      227 / 255,
      169 / 255,
      59 / 255,
      1,
    ]);
    themedRoot.remove();
  });

  it('does nothing without an engine', () => {
    const rendered = renderHook(() => {
      useSearchHighlights(
        { engine: undefined, view: undefined },
        [hit('a')],
        DEFAULT_PAGE_ID,
        undefined,
      );
    });
    expect(() => {
      rendered.unmount();
    }).not.toThrow();
  });

  it('sends nothing for no hits, and nothing again when it closes', () => {
    const { engine, unmount } = renderHighlights([], undefined);
    expect(engine.showSearchHighlights).toHaveBeenCalledTimes(1);
    expect(engine.showSearchHighlights).toHaveBeenLastCalledWith(EMPTY_SEARCH_HIGHLIGHT);
    unmount();
    expect(engine.showSearchHighlights).toHaveBeenCalledTimes(1);
  });
});
