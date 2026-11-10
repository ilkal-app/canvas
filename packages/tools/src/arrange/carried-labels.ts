import type { DocumentStore } from '@canvas/document';
import {
  compareSiblings,
  type BoardObject,
  type ObjectId,
  type StickyObject,
} from '@canvas/schema';

import { NoteBoxGrid, parentBoxOf } from './note-box-grid.js';

/** What {@link carriedLabelsOf} reads: objects, and each parent's children. */
export type CarriedLabelsSource = Pick<DocumentStore, 'get' | 'references'>;

/**
 * Which raise a selection makes: to the front (every selected object above every other
 * sibling), or forward (each run of selected siblings above the sibling directly above it).
 */
export type RaiseDirection = 'front' | 'forward';

/** One parent's part of a selection: the parent, its selected notes, and every selected id. */
interface ParentNotes {
  readonly parentId: ObjectId | null;
  readonly notes: readonly StickyObject[];
  readonly selected: ReadonlySet<ObjectId>;
}

/**
 * The labels bringing a parent's selected notes to the front carries: its unselected text
 * children stacked above one of them and overlapping it (each goes below the note otherwise).
 * Text below the lowest selected note is passed over with one comparison; the rest is tested
 * against the notes its box overlaps (`NoteBoxGrid`), the stacking test only for those.
 *
 * @param board - The document.
 * @param group - The parent, its selected notes and every selected id.
 * @returns The labels, unsorted.
 */
function frontLabels(board: CarriedLabelsSource, group: ParentNotes): BoardObject[] {
  const grid = new NoteBoxGrid(group.notes.map((note) => ({ box: parentBoxOf(note), item: note })));
  const lowest = group.notes.reduce((low, note) => (compareSiblings(note, low) < 0 ? note : low));
  const labels: BoardObject[] = [];
  for (const childId of board.references.childrenOf(group.parentId)) {
    const text = board.get(childId);
    if (text?.type !== 'text' || group.selected.has(childId)) continue;
    if (compareSiblings(text, lowest) < 0) continue;
    if (grid.some(parentBoxOf(text), (note) => compareSiblings(text, note) > 0)) labels.push(text);
  }
  return labels;
}

/**
 * The labels bringing a parent's selected notes forward carries: only those that would
 * otherwise fall below a note they lie on (M-1 of's review). A run of selected siblings
 * hops over the sibling directly above it, so that sibling is carried when it is text
 * overlapping a note of the run; it then joins the run, which goes on to the next sibling above.
 * Text further up stays above the run already. One walk of the sorted siblings.
 *
 * @param board - The document.
 * @param group - The parent, its selected notes and every selected id.
 * @returns The labels, in stacking order.
 */
function forwardLabels(board: CarriedLabelsSource, group: ParentNotes): BoardObject[] {
  const siblings = [...board.references.childrenOf(group.parentId)]
    .map((childId) => board.get(childId))
    .filter((child): child is BoardObject => child !== undefined)
    .sort(compareSiblings);
  const noteById = new Map(group.notes.map((note) => [note.id, note]));
  // Each selected note by its rank among the siblings, which the run test compares.
  const grid = new NoteBoxGrid(
    siblings.flatMap((sibling, rank) => {
      const note = noteById.get(sibling.id);
      return note === undefined ? [] : [{ box: parentBoxOf(note), item: rank }];
    }),
  );
  const isSelected = (rank: number): boolean =>
    group.selected.has(siblings[rank]?.id ?? ('' as ObjectId));
  const labels: BoardObject[] = [];
  let rank = 0;
  while (rank < siblings.length) {
    if (!isSelected(rank)) {
      rank += 1;
      continue;
    }
    const runStart = rank;
    let runEnd = rank;
    for (;;) {
      while (isSelected(runEnd + 1)) runEnd += 1;
      const above = siblings[runEnd + 1];
      const isOnRun =
        above?.type === 'text' &&
        grid.some(parentBoxOf(above), (noteRank) => noteRank >= runStart && noteRank <= runEnd);
      if (!isOnRun) break;
      labels.push(above);
      runEnd += 1;
    }
    rank = runEnd + 1;
  }
  return labels;
}

/**
 * A selection as the order commands move it when it holds sticky notes ("raise carries labels"):
 * each selected note carries the plain text objects of its parent that lie on it (their boxes
 * overlap, in the parent's frame, turned boxes by their bounds) and that the raise would otherwise
 * leave below it, so bringing a note to the front or forward keeps what is written on it on top of
 * it; the order commands keep the moved objects' order among themselves, so the labels stay above
 * the note. To the front, every such text stacked above the note is carried; forward, only the text
 * the note's run would hop over (with the stack note, other, label, other, the label stays where it
 * is). Text below a note is hidden by it already and is never carried, nor is text in another
 * parent. The app's bring-to-front and bring-forward actions expand their ids through it, so the
 * note and its labels move in one command. About O((T + S) log S + matches) per parent to the
 * front, with T its texts and S its selected notes, and O(n log n) in its children forward (they
 * are sorted). Pure: nothing is written.
 *
 * @param board - The document.
 * @param ids - The selected ids, as the order command would take them.
 * @param direction - The raise: to the front (the default) or forward.
 * @returns The ids, then the carried labels in stacking order, each id once.
 */
export function carriedLabelsOf(
  board: CarriedLabelsSource,
  ids: readonly ObjectId[],
  direction: RaiseDirection = 'front',
): readonly ObjectId[] {
  const notesByParent = new Map<ObjectId | null, StickyObject[]>();
  for (const noteId of ids) {
    const note = board.get(noteId);
    if (note?.type !== 'sticky') continue;
    const siblings = notesByParent.get(note.parentId);
    if (siblings === undefined) notesByParent.set(note.parentId, [note]);
    else siblings.push(note);
  }
  if (notesByParent.size === 0) return ids;
  const selected = new Set(ids);
  const labelsOf = direction === 'front' ? frontLabels : forwardLabels;
  const labels = [...notesByParent]
    .flatMap(([parentId, notes]) => labelsOf(board, { parentId, notes, selected }))
    .sort(compareSiblings);
  return [...ids, ...labels.map((label) => label.id)];
}
