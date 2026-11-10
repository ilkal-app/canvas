import type { BoardReader } from '@canvas/document';
import { hitPoint } from '@canvas/engine';
import {
  shownPageIdOf,
  type Board,
  type BoardObject,
  type ObjectId,
  type PageId,
  type Point,
} from '@canvas/schema';

import { editedBoundsOf } from '../editing/text-bar-model.js';

import type { VoteSession } from './vote-api.js';

// What a dot vote reads from the board: its section, the stickies in it, the ranked
// results by their text and the sticky under a press. Pure.

/** What the functions here read: an object by id. */
type ObjectReader = Pick<BoardReader, 'get'>;

/** The deepest parent chain walked; a longer one (a cycle in a damaged board) counts as none. */
const MAX_DEPTH = 64;

/** How many stickies a revealed vote's summary ranks. */
export const RANKED_STICKIES = 3;

/** The longest sticky label the summary and the record show, in characters. */
const LABEL_LENGTH = 40;

/** A sticky in a vote's summary: its id, its label and its votes. */
export interface RankedSticky {
  /** The sticky. */
  readonly id: string;
  /** Its text's first line, shortened, or "Untitled sticky". */
  readonly label: string;
  /** Its votes, everyone's. */
  readonly count: number;
}

/**
 * The section a vote started now covers: the one selected object, when it is a frame (the
 * board's sections are frames); otherwise none, the whole board.
 *
 * @param board - The board.
 * @param selectedIds - The selection.
 * @returns The frame's id, or null.
 */
export function voteScopeOf(
  board: ObjectReader,
  selectedIds: readonly ObjectId[],
): ObjectId | null {
  const [id, ...more] = selectedIds;
  if (id === undefined || more.length > 0) return null;
  return board.get(id)?.type === 'frame' ? id : null;
}

/**
 * A section's name as the card shows it: the frame's name, or "Section" when it has none.
 *
 * @param board - The board.
 * @param scopeId - The section.
 * @returns The name, or undefined when the frame is gone.
 */
export function sectionNameOf(board: ObjectReader, scopeId: string): string | undefined {
  const frame = board.get(scopeId as ObjectId);
  if (frame?.type !== 'frame') return undefined;
  return frame.name.trim() === '' ? 'Section' : frame.name.trim();
}

/**
 * An object's top-level ancestor (itself at the root), or undefined past a broken chain.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns The root object.
 */
function rootOf(board: ObjectReader, object: BoardObject): BoardObject | undefined {
  let current: BoardObject | undefined = object;
  for (let depth = 0; current !== undefined && depth < MAX_DEPTH; depth++) {
    if (current.parentId === null) return current;
    current = board.get(current.parentId);
  }
  return undefined;
}

/**
 * Whether an object is inside a frame: the frame is an ancestor, or the object is at the root and
 * its centre lies in the frame's box on the frame's page (a sticky placed over a section stays at
 * the root; one nested elsewhere is in its own parent, not the section).
 *
 * @param board - The board.
 * @param object - The object.
 * @param frameId - The frame.
 * @returns Whether it is inside.
 */
function isInsideFrame(board: ObjectReader, object: BoardObject, frameId: ObjectId): boolean {
  let parentId = object.parentId;
  for (let depth = 0; parentId !== null && depth < MAX_DEPTH; depth++) {
    if (parentId === frameId) return true;
    parentId = board.get(parentId)?.parentId ?? null;
  }
  if (object.parentId !== null) return false;
  const frame = board.get(frameId);
  const box = editedBoundsOf(board, object.id);
  const area = editedBoundsOf(board, frameId);
  if (frame === undefined || box === undefined || area === undefined) return false;
  if (rootOf(board, object)?.pageId !== rootOf(board, frame)?.pageId) return false;
  const x = (box.minX + box.maxX) / 2;
  const y = (box.minY + box.maxY) / 2;
  return x >= area.minX && x <= area.maxX && y >= area.minY && y <= area.maxY;
}

/**
 * Whether a sticky counts in a vote: anything in a board-wide vote (the service decides), else a
 * sticky inside its section (a vote whose section is gone takes none).
 *
 * @param board - The board.
 * @param objectId - The sticky.
 * @param scopeId - The vote's section, or null for the board.
 * @returns Whether it counts.
 */
export function isInVoteScope(
  board: ObjectReader,
  objectId: string,
  scopeId: string | null | undefined,
): boolean {
  if (scopeId === null || scopeId === undefined) return true;
  const object = board.get(objectId as ObjectId);
  if (object?.type !== 'sticky') return false;
  return (
    board.get(scopeId as ObjectId)?.type === 'frame' &&
    isInsideFrame(board, object, scopeId as ObjectId)
  );
}

/**
 * A sticky's label: its text's first non-empty line, shortened to {@link LABEL_LENGTH}.
 *
 * @param text - Its text.
 * @returns The label.
 */
export function stickyLabelOf(text: string): string {
  const line =
    text
      .split('\n')
      .find((part) => part.trim() !== '')
      ?.trim() ?? '';
  if (line === '') return 'Untitled sticky';
  return line.length > LABEL_LENGTH ? `${line.slice(0, LABEL_LENGTH - 1)}…` : line;
}

/**
 * A vote's ranked stickies once its results may be seen: most votes first (the service's order,
 * ties as it gives them), stickies deleted since, or outside its section, left out. A section
 * deleted since no longer limits them: everything the service counted is ranked.
 *
 * @param board - The board.
 * @param session - The session.
 * @param limit - How many; every voted sticky if absent.
 * @returns The stickies, or none while the results are hidden.
 */
export function rankedStickiesOf(
  board: ObjectReader,
  session: VoteSession,
  limit = Number.POSITIVE_INFINITY,
): RankedSticky[] {
  const ranked: RankedSticky[] = [];
  const { scopeId } = session;
  const isSectionLeft =
    scopeId !== null && scopeId !== undefined && board.get(scopeId as ObjectId)?.type === 'frame';
  for (const { objectId, count } of session.results ?? []) {
    if (ranked.length >= limit) break;
    const object = board.get(objectId as ObjectId);
    if (object?.type !== 'sticky' || count <= 0) continue;
    if (isSectionLeft && !isInVoteScope(board, objectId, scopeId)) continue;
    ranked.push({ id: objectId, label: stickyLabelOf(object.text), count });
  }
  return ranked;
}

/**
 * A count of votes in words: "1 vote", "5 votes".
 *
 * @param count - The votes.
 * @returns The words.
 */
export function votesWord(count: number): string {
  return `${String(count)} ${count === 1 ? 'vote' : 'votes'}`;
}

/**
 * The text of a vote's record kept on the board at its end: "Vote results", its section, then
 * each voted sticky by rank ("1. Idea — 5 votes"), or "No votes".
 *
 * @param ranked - The ranked stickies.
 * @param sectionName - The vote's section, if it had one.
 * @returns The text.
 */
export function voteResultsText(ranked: readonly RankedSticky[], sectionName?: string): string {
  const title = sectionName === undefined ? 'Vote results' : `Vote results · ${sectionName}`;
  const lines = ranked.map(
    (sticky, index) => `${String(index + 1)}. ${sticky.label} — ${votesWord(sticky.count)}`,
  );
  return [title, ...(lines.length === 0 ? ['No votes'] : lines)].join('\n');
}

/**
 * The topmost sticky under a point on a page: what a press of the voting cursor votes for.
 *
 * @param board - The board.
 * @param point - The point, world units.
 * @param zoom - The camera's zoom, for the pick tolerance.
 * @param pageId - The page shown; every page's stickies when absent.
 * @returns The sticky's id, or undefined.
 */
export function stickyAt(
  board: Board,
  point: Point,
  zoom: number,
  pageId?: PageId,
): ObjectId | undefined {
  const candidates = [...board.objects.values()]
    .filter((object) => object.type === 'sticky')
    .filter((object) => pageId === undefined || shownPageIdOf(board, object) === pageId)
    .map(({ id }) => id);
  const source = { get: (id: ObjectId) => board.objects.get(id) };
  return hitPoint({ searchRect: () => candidates }, source, point, { zoom })[0];
}
