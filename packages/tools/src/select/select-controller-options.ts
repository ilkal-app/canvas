import type {
  CommandEnvironment,
  CommandError,
  DocumentStore,
  TransactionOrigin,
} from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type { SnapIndex } from '../snap/snap-candidates.js';

import type { FarSkip } from './far-objects.js';
import type { RootMovePreview } from './root-move-preview.js';
import type { SelectHitTester } from './select-hit-tester.js';
import type { SelectIntent } from './select-intent.js';
import type { TouchCallbacks } from './touch-gestures.js';

/** What a `SelectController` works on and reports to. */
export interface SelectControllerOptions extends TouchCallbacks {
  /** The document; the controller writes to it only through commands. */
  readonly store: DocumentStore;
  /** Who the tool's commands are attributed to (the person using it). */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /** What is under the pointer, kept in step with `store`. */
  readonly hitTester: SelectHitTester;
  /**
   * Called whenever the selection, its overlay or the drag preview changes, with the ids whose
   * preview changed (their state in `SelectController.source` is new), so the caller can
   * hand them to the scene and redraw. A retained root move also supplies its absolute positions;
   * consumers without that path can still read ordinary objects through the source.
   */
  readonly onChange?: (previewIds: readonly ObjectId[], movePreview?: RootMovePreview) => void;
  /**
   * Called with the errors when the document refuses a gesture's command. A drop into a frame
   * that cannot take the objects is then made as a plain move (`runDropPlan`), so the objects
   * stay where the pointer put them.
   */
  readonly onCommandRefused?: (errors: readonly CommandError[]) => void;
  /**
   * Called when a transform (a drag's release, a nudge) skipped selected objects that are far
   * (`isFarObject`: a box on the board past ±`BOARD_BOUND`, theirs or a descendant's, or
   * one that cannot be worked out). The others are transformed, about a pivot and from an origin
   * worked out from them alone; when every one is far nothing is, and `isEvery` says so. Not called
   * when the document refused the command (`onCommandRefused` is). The caller shows one notice.
   */
  readonly onFarSkipped?: (skip: FarSkip) => void;
  /**
   * Called with an `activate` intent (a double press) the select tool does not take itself:
   * one on anything but a group not yet entered, which it enters. The app hands it to
   * the mode registered for the object's type.
   */
  readonly onActivate?: (intent: SelectIntent & { readonly type: 'activate' }) => void;
  /** The index moves and resizes snap against, in step with `store`; the grid only if absent. */
  readonly snapIndex?: SnapIndex;
  /**
   * Whether the engine draws an object (the app's hit gate, `DrawableGate.isDrawable`):
   * an object it does not draw is left out of the selection frame, outlines and snapping, so the
   * frame agrees with the picture. Absent, each box is checked on its own instead.
   */
  readonly isDrawable?: (id: ObjectId) => boolean;
  /**
   * Whether a lone selected unlocked line is edited by its two end handles (`LineEndpoints`,
   *), which the caller shows and takes presses on: its frame then offers no resize
   * handles and no rotation bands, since that frame is the axis-aligned box of the line's ends
   * and its other corners are empty board, where a press must draw a marquee. A line turns by
   * dragging an end. A lone unlocked connector follows the same rule. False when
   * absent: the line keeps the frame's controls.
   */
  readonly hasLineEndHandles?: boolean;
  /**
   * Whether the person may edit the board now (a viewer may not), read at every input:
   * while it says no, the tool still selects (a click, Shift, a marquee, select all) but its
   * frame offers no handles and no rotation bands, a drag or a nudge moves nothing and a release
   * runs no command (`readOnlyIntentsOf`). True when absent.
   */
  readonly canEdit?: () => boolean;
}
