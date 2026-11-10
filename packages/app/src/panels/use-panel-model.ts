import { useMemo } from 'react';

import type { BoardObject } from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import type { BoardView } from '../engine/board-view.js';
import { useBoardViewState, type BoardViewSnapshot } from '../hooks/use-board-view-state.js';

import {
  panelContextOf,
  sectionsShown,
  selectionContextOf,
  type SelectionContext,
  type StylePanelRegistry,
} from './panel-sections.js';

/** What the shell's panels show, derived from the board and the shell state. */
export interface PanelModel {
  /** The board, its version and the selection. */
  readonly board: BoardViewSnapshot;
  /** The selected objects as stored, primary first; ids that cannot be read are left out. */
  readonly selection: readonly BoardObject[];
  /** The style panel's context (`panelContextOf`). */
  readonly context: SelectionContext;
  /** The ids of the style panel sections showing, in order. */
  readonly sectionIds: readonly string[];
}

/**
 * The panels' model: follows the board view and works out the selected objects, the style
 * context and the sections showing, again only when the selection, the document or the tool
 * changes. O(selection) per change.
 *
 * @param view - The mounted engine's board view, if any.
 * @param activeTool - The active tool.
 * @param registry - The style panel's sections; undefined while they load (none show).
 * @returns The model.
 */
export function usePanelModel(
  view: BoardView | undefined,
  activeTool: ToolId,
  registry: StylePanelRegistry | undefined,
): PanelModel {
  const board = useBoardViewState(view);
  const { selectedIds, documentVersion } = board;
  const reader = board.board;
  const selection = useMemo(
    () =>
      selectedIds.flatMap((id) => {
        const object = reader.get(id);
        return object === undefined ? [] : [object];
      }),
    // The document version stands for the objects' contents, which the reader's identity
    // does not show.
    [selectedIds, reader, documentVersion],
  );
  const context = panelContextOf(selectionContextOf(selectedIds, reader), activeTool);
  const hasSelection = selection.length > 0;
  const sectionIds = useMemo(
    () =>
      registry === undefined
        ? []
        : sectionsShown(registry, context, hasSelection, selection).map((section) => section.id),
    [registry, context, hasSelection, selection],
  );
  return { board, selection, context, sectionIds };
}
