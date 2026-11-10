import { useEffect, useRef, type RefObject } from 'react';

import type { SearchHit } from '@canvas/document';
import { EMPTY_SEARCH_HIGHLIGHT, type SearchHighlightModel } from '@canvas/engine';
import type { ObjectId, PageId, Rgba } from '@canvas/schema';

import type { BoardView } from '../engine/board-view.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { hexToRgba } from '../panels/controls/colour-hex.js';

import { searchHighlightModelOf } from './search-highlights.js';
import type { ResultRow } from './use-search-rows.js';

/** The highlight's colour where the theme gives none (Graphite's hand/you). */
const FALLBACK_COLOR: Rgba = [0.89, 0.66, 0.23, 1];

/** The empty highlight's content, as sent. */
const EMPTY_KEY = JSON.stringify(EMPTY_SEARCH_HIGHLIGHT);

/**
 * The person's colour as the theme has it now (`--color-hand-you`), for the highlight: read where
 * the sheet is, since the shell's themed root, not the page's, sets the theme's tokens.
 *
 * @param element - An element of the sheet; the page's root when absent.
 * @returns The colour.
 */
function handColor(element: Element | null): Rgba {
  const value = getComputedStyle(element ?? document.documentElement).getPropertyValue(
    '--color-hand-you',
  );
  return hexToRgba(value.trim(), 1) ?? FALLBACK_COLOR;
}

/** What the highlight follows. */
export interface SearchHighlightsSource {
  /** The engine, which draws it; none before it mounts or where it has no highlight layer. */
  readonly engine?: Pick<MountedEngine, 'showSearchHighlights'> | undefined;
  /** The engine's board view, whose whole board gives the objects' bounds. */
  readonly view: BoardView | undefined;
}

/** Where the highlight's colour is read: an element of the sheet, under the themed root. */
export type ThemedElementRef = RefObject<Element | null>;

/**
 * Outlines the objects the search sheet found on the canvas while it is open: those
 * on the page shown (`searchHighlightModelOf`), the active result heavier, in the person's
 * colour; sent to the engine only when it changes, and cleared when the sheet closes. Comment
 * results are not outlined: their pins already show.
 *
 * @param source - The engine and the board.
 * @param hits - The object results.
 * @param shownPageId - The page shown, or undefined before the pages are known.
 * @param activeRow - The active result's row, if any.
 * @param themed - An element of the sheet, where the theme's colour is read.
 */
export function useSearchHighlights(
  source: SearchHighlightsSource,
  hits: readonly SearchHit[],
  shownPageId: PageId | undefined,
  activeRow: ResultRow | undefined,
  themed?: ThemedElementRef,
): void {
  const { engine, view } = source;
  const sent = useRef('');
  const activeId =
    activeRow === undefined || activeRow.threadId !== undefined
      ? undefined
      : (activeRow.key as ObjectId);
  const ids = hits.filter((hit) => hit.pageId === shownPageId).map((hit) => hit.id);
  const board = ids.length === 0 ? undefined : view?.definitions?.read?.();
  const model =
    board === undefined
      ? EMPTY_SEARCH_HIGHLIGHT
      : searchHighlightModelOf(board, ids, activeId, handColor(themed?.current ?? null));
  // The model's content: a new model object each render sends nothing new; a new engine gets it.
  const key = JSON.stringify(model);
  useEffect(() => {
    sent.current = key;
    engine?.showSearchHighlights?.(JSON.parse(key) as SearchHighlightModel);
  }, [engine, key]);
  useEffect(
    () => () => {
      if (sent.current !== '' && sent.current !== EMPTY_KEY) {
        engine?.showSearchHighlights?.(EMPTY_SEARCH_HIGHLIGHT);
      }
      sent.current = '';
    },
    [engine],
  );
}
