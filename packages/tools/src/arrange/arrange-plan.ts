import {
  moveObjectsCommand,
  planAlign,
  planDistribute,
  planTidy,
  runCommand,
  type AlignKind,
  type ArrangeMove,
  type CommandEnvironment,
  type CommandOutcome,
  type DocumentStore,
  type MoveObjectsResult,
  type TransactionOrigin,
} from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type { SelectionSource } from '../select/selection-geometry.js';

import { arrangeFrameOf, type ArrangeFrame } from './arrange-frame.js';

/**
 * The nine arrange operations (align six ways, distribute two ways, tidy up), named as the app's
 * `ArrangeCommand`s that run them (`alt+a` … `ctrl+alt+t`).
 */
export const ARRANGE_OPERATIONS = [
  'alignLeft',
  'alignCentre',
  'alignRight',
  'alignTop',
  'alignMiddle',
  'alignBottom',
  'distributeHorizontally',
  'distributeVertically',
  'tidyUp',
] as const;

/** One of {@link ARRANGE_OPERATIONS}. */
export type ArrangeOperation = (typeof ARRANGE_OPERATIONS)[number];

const OPERATIONS: ReadonlySet<string> = new Set(ARRANGE_OPERATIONS);

/**
 * Whether a command name is an arrange operation.
 *
 * @param value - The name.
 * @returns True for one of {@link ARRANGE_OPERATIONS}.
 */
export function isArrangeOperation(value: string): value is ArrangeOperation {
  return OPERATIONS.has(value);
}

/** What an arrange operation does to the document: one `moveObjects` command. */
export interface ArrangePlan {
  /** Each moved object's displacement, world units in the board's frame; never empty. */
  readonly moves: readonly ArrangeMove[];
}

/**
 * The moves an operation makes, in the frame's own axes.
 *
 * @param operation - The operation.
 * @param frame - The selection's boxes and frame.
 * @returns The moves.
 */
function movesInFrame(operation: ArrangeOperation, frame: ArrangeFrame): ArrangeMove[] {
  const { boxes } = frame;
  // One object aligns to the frame it is in; with nothing to align to it stays.
  const anchor = boxes.length === 1 ? frame.parentRect : undefined;
  const align = (kind: AlignKind) => planAlign(kind, boxes, anchor);
  switch (operation) {
    case 'alignLeft':
      return align('left');
    case 'alignCentre':
      return align('centre');
    case 'alignRight':
      return align('right');
    case 'alignTop':
      return align('top');
    case 'alignMiddle':
      return align('middle');
    case 'alignBottom':
      return align('bottom');
    case 'distributeHorizontally':
      return planDistribute('horizontal', boxes);
    case 'distributeVertically':
      return planDistribute('vertical', boxes);
    case 'tidyUp':
      return planTidy(boxes);
  }
}

/**
 * Plans an arrange operation on the selection: the movable objects
 * (`arrangeFrameOf`: no locked objects, which neither move nor count as anchors, and no object
 * whose ancestor is selected) are aligned, distributed or tidied by their axis-aligned bounds in
 * their common parent's frame, and each move is turned onto the board's axes for `moveObjects`.
 * Pure: reads the document as it is.
 *
 * @param operation - The operation.
 * @param ids - The selected ids.
 * @param source - The document.
 * @returns The plan, or undefined when nothing would move.
 */
export function planArrange(
  operation: ArrangeOperation,
  ids: readonly ObjectId[],
  source: SelectionSource,
): ArrangePlan | undefined {
  const frame = arrangeFrameOf(ids, source);
  const { cos, sin } = frame.toBoard;
  const moves = movesInFrame(operation, frame).map(({ id, delta }) => ({
    id,
    delta: { x: cos * delta.x - sin * delta.y, y: sin * delta.x + cos * delta.y },
  }));
  return moves.length > 0 ? { moves } : undefined;
}

/**
 * Runs a plan as one `moveObjects` command through `runCommand`: one transaction, one change set
 * and one undo step for the whole operation. The moves carry no `parentId`, so nothing changes
 * parent ('s reparenting is a drag's, not an alignment's).
 *
 * @param store - The document.
 * @param origin - Who the change is attributed to.
 * @param environment - The command clock and id generator.
 * @param plan - The plan.
 * @returns The command's outcome.
 */
export function runArrange(
  store: DocumentStore,
  origin: TransactionOrigin,
  environment: CommandEnvironment,
  plan: ArrangePlan,
): CommandOutcome<MoveObjectsResult> {
  const moves = plan.moves.map(({ id, delta }) => ({ id, by: delta }));
  return runCommand(store, origin, moveObjectsCommand, { moves }, environment);
}
