import type { CaptureRect } from '@canvas/engine';
import {
  boardTransformOf,
  geometryBoxOf,
  isFiniteBox,
  type Board,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import type { ExportScope } from './export-scope.js';

/** A section of an export: a top-level frame, one PDF page. */
export interface ExportSection {
  /** The frame. */
  readonly id: ObjectId;
  /** Its name. */
  readonly name: string;
  /** Its board box, unpadded. */
  readonly rect: CaptureRect;
}

/**
 * Whether an object sits in a frame the export shows, through any groups. Cycle-safe.
 *
 * @param board - The board.
 * @param object - The object.
 * @param shownIds - The objects the export shows.
 * @returns True when a shown frame holds it.
 */
function isInShownFrame(
  board: Board,
  object: BoardObject,
  shownIds: ReadonlySet<ObjectId>,
): boolean {
  const walked = new Set<ObjectId>([object.id]);
  for (let id = object.parentId; id !== null && !walked.has(id);) {
    const parent = board.objects.get(id);
    if (parent === undefined) return false;
    if (parent.type === 'frame' && shownIds.has(id)) return true;
    walked.add(id);
    id = parent.parentId;
  }
  return false;
}

/**
 * The sections of an export: the frames it shows that no frame it shows holds (a frame
 * in a frame is part of its parent's page), each with its own board box, axis-aligned and
 * unpadded, in reading order: by top, then by left. None when it shows no frame. Pure; never
 * mutates the board.
 *
 * @param board - The board.
 * @param scope - The export (`exportScopeOf`).
 * @returns The sections, in order.
 */
export function exportSectionsOf(board: Board, scope: ExportScope): readonly ExportSection[] {
  const sections: ExportSection[] = [];
  for (const id of scope.shownIds) {
    const object = board.objects.get(id);
    if (object?.type !== 'frame' || isInShownFrame(board, object, scope.shownIds)) continue;
    const transform = boardTransformOf(object, (at) => board.objects.get(at));
    const box = transform === undefined ? undefined : geometryBoxOf(object, transform);
    if (box === undefined || !isFiniteBox(box)) continue;
    sections.push({
      id,
      name: object.name,
      rect: { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY },
    });
  }
  return sections.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}
