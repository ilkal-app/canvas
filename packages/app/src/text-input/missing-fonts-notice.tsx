import { useState, type ReactElement } from 'react';

import type { DocumentStore } from '@canvas/document';
import { fallbackFamily } from '@canvas/text';

import { useToast } from '../feedback/toast-region.js';

import {
  PAGE_FONT_SOURCES,
  useMissingBoardFonts,
  type MissingFontSources,
} from './missing-board-fonts.js';

/** The notice's live region name. */
export const MISSING_FONTS_LABEL = 'Missing fonts';

/** The notice's action: opens the board-wide replacement of the first missing family. */
export const REPLACE_MISSING_FONT_ACTION = 'Replace…';

/**
 * What the notice says for the board's missing families: which, and what they are shown in.
 *
 * @param families - The missing families, at least one.
 * @returns The sentence.
 */
export function missingFontsMessage(families: readonly string[]): string {
  const [first] = families;
  if (families.length === 1 && first !== undefined) {
    return `“${first}” is missing, so its text is shown in ${fallbackFamily(first)}.`;
  }
  return `${String(families.length)} fonts are missing (${families.join(', ')}), so their text is shown in substitutes.`;
}

/**
 * Which missing families the person ignored on each board on this page: the board stays quiet
 * while every missing family is one they ignored there, whether more or fewer are missing since;
 * a family newly missing shows the notice again. Forgotten when the page reloads.
 */
export class MissingFontsNoticeMemory {
  readonly #ignored = new Map<string, Set<string>>();

  /**
   * Whether the person ignored every one of these families on this board.
   *
   * @param boardId - The board.
   * @param families - The missing families.
   * @returns True once {@link MissingFontsNoticeMemory.ignore} ran for each of them.
   */
  isIgnored(boardId: string, families: readonly string[]): boolean {
    const ignored = this.#ignored.get(boardId);
    return ignored !== undefined && families.every((family) => ignored.has(family));
  }

  /**
   * Remembers that the person ignored these families on this board.
   *
   * @param boardId - The board.
   * @param families - The missing families.
   */
  ignore(boardId: string, families: readonly string[]): void {
    const ignored = this.#ignored.get(boardId) ?? new Set<string>();
    for (const family of families) ignored.add(family);
    this.#ignored.set(boardId, ignored);
  }
}

/** The page's memory of ignored missing fonts. */
export const PAGE_MISSING_FONTS_NOTICES = new MissingFontsNoticeMemory();

/** Props of {@link MissingFontsNotice}. */
export interface MissingFontsNoticeProps {
  /** The board's store. */
  readonly store: DocumentStore;
  /** The board, which ignoring is remembered for. */
  readonly boardId: string;
  /** Whether the person may edit the board: only then is Replace… offered. */
  readonly canEdit: boolean;
  /** Opens the board-wide replacement of a missing family. */
  readonly onReplace: (family: string) => void;
  /** The page's memory of ignored notices if absent. */
  readonly memory?: MissingFontsNoticeMemory;
  /** The font statuses and loader; the page's if absent. */
  readonly sources?: MissingFontSources;
}

/**
 * Tells the person the board names fonts the page cannot show: which, and that their
 * text is shown in a substitute while the board keeps the name, in the board's notices. An
 * editor gets Replace…, which opens the board-wide replacement of the first missing family (one
 * undo step); Dismiss ignores them for this board on this page, until a family newly goes
 * missing. It stays while families are missing and goes when none is. An Info toast in the toast region, a `role="status"` region
 * labelled "Missing fonts". Main thread.
 *
 * @param props - The store, the board, whether the person may edit and where Replace… goes.
 * @returns Nothing inside the toast region; without one, the toast in place.
 */
export function MissingFontsNotice(props: MissingFontsNoticeProps): ReactElement | null {
  const { store, boardId, canEdit, onReplace } = props;
  const memory = props.memory ?? PAGE_MISSING_FONTS_NOTICES;
  const missing = useMissingBoardFonts(store, props.sources ?? PAGE_FONT_SOURCES);
  const [, setIgnored] = useState(0);
  const [first] = missing;
  const isShown = first !== undefined && !memory.isIgnored(boardId, missing);
  return useToast(
    isShown
      ? {
          kind: 'info',
          message: missingFontsMessage(missing),
          label: MISSING_FONTS_LABEL,
          isPersistent: true,
          key: missing.join(', '),
          ...(canEdit
            ? {
                action: {
                  label: REPLACE_MISSING_FONT_ACTION,
                  onAction: () => {
                    onReplace(first);
                  },
                },
              }
            : {}),
          onDismiss: () => {
            memory.ignore(boardId, missing);
            setIgnored((count) => count + 1);
          },
        }
      : undefined,
  );
}
