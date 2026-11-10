import { createObjectCommand, runCommand } from '@canvas/document';
import type { WorldBounds } from '@canvas/engine';
import { shownPageIdOf, type Board, type ObjectId, type PageId } from '@canvas/schema';
import {
  DEFAULT_NOTE_COLOR,
  newStickyObject,
  WIDE_NOTE_WIDTH,
  type NewStickyObject,
} from '@canvas/tools';

import type { BoardConnection } from '../collab/board-connection.js';
import { editedBoundsOf } from '../editing/text-bar-model.js';
import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import type { VoteSession } from './vote-api.js';
import { rankedStickiesOf, sectionNameOf, voteResultsText } from './vote-board.js';

// The record a dot vote leaves on the board when it ends (the ticket's "End closes
// the session and keeps the results as a record"): a wide sticky, "Vote results" and the voted
// stickies by rank, beside what was voted on.

/** The gap between what was voted on and the record, world units. */
export const RECORD_GAP = 48;

/** The record's text size, world units: smaller than a note's default, so ten lines fit. */
const RECORD_FONT_SIZE = 16;

/** One line's height in the record, world units, with its padding above and below. */
const RECORD_LINE_HEIGHT = 24;
const RECORD_PADDING = 32;

/**
 * The box around boxes.
 *
 * @param boxes - The boxes.
 * @returns Their union, or undefined for none.
 */
function unionOf(boxes: readonly WorldBounds[]): WorldBounds | undefined {
  if (boxes.length === 0) return undefined;
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  };
}

/**
 * The record of an ended vote whose results may be seen: a wide yellow sticky with the results'
 * text ({@link voteResultsText}, every voted sticky left), its top edge level
 * with the voted stickies' (or, with none, the section's) and {@link RECORD_GAP} right of them,
 * at the root of their page. Pure.
 *
 * @param board - The board.
 * @param session - The vote, revealed or with results.
 * @returns The sticky and its page, or undefined when there are no results or nothing to place
 *   it beside (no voted sticky left and no section).
 */
export function voteRecordOf(
  board: Board,
  session: VoteSession,
): { readonly object: NewStickyObject; readonly pageId: PageId } | undefined {
  if (session.results === null) return undefined;
  const reader = { get: (id: ObjectId) => board.objects.get(id) };
  const ranked = rankedStickiesOf(reader, session);
  const scopeId = session.scopeId ?? null;
  const ids = ranked.length > 0 ? ranked.map(({ id }) => id as ObjectId) : [];
  if (ids.length === 0 && scopeId !== null) ids.push(scopeId as ObjectId);
  const anchor = ids[0] === undefined ? undefined : board.objects.get(ids[0]);
  const area = unionOf(ids.flatMap((id) => editedBoundsOf(reader, id) ?? []));
  if (anchor === undefined || area === undefined) return undefined;
  const sectionName = scopeId === null ? undefined : sectionNameOf(reader, scopeId);
  const text = voteResultsText(ranked, sectionName);
  const style = { ...DEFAULT_TEXT_STYLE, fontSize: RECORD_FONT_SIZE };
  const lines = text.split('\n').length;
  const note = newStickyObject({ x: 0, y: 0 }, style, [...DEFAULT_NOTE_COLOR], 'left', 'wide');
  const height = Math.max(note.height, RECORD_PADDING * 2 + lines * RECORD_LINE_HEIGHT);
  return {
    object: {
      ...note,
      x: area.maxX + RECORD_GAP,
      y: area.minY,
      width: WIDE_NOTE_WIDTH,
      height,
      text,
      runs: [{ length: text.length, style }],
      verticalAlign: 'top',
    },
    pageId: shownPageIdOf(board, anchor),
  };
}

/**
 * Keeps an ended vote's record on the board ({@link voteRecordOf}), as one undo step of the
 * person who ended it.
 *
 * @param connection - The board's store and the person's origin.
 * @param session - The vote as it was before it ended.
 * @returns Whether a record was placed.
 */
export function keepVoteRecord(
  connection: Pick<BoardConnection, 'store' | 'origin'>,
  session: VoteSession,
): boolean {
  const record = voteRecordOf(connection.store.read(), session);
  if (record === undefined) return false;
  const outcome = runCommand(
    connection.store,
    connection.origin,
    createObjectCommand,
    { object: { ...record.object, pageId: record.pageId } },
    { clock: Date.now, createId: () => crypto.randomUUID() as ObjectId },
  );
  return outcome.status === 'applied';
}
