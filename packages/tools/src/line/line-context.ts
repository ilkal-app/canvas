import type {
  CommandEnvironment,
  CommandError,
  DocumentStore,
  TransactionOrigin,
} from '@canvas/document';
import type {
  BoardObject,
  LineCap,
  LineObject,
  ObjectId,
  Stroke,
  StrokeStyle,
} from '@canvas/schema';

import type { CreationInkSource } from '../ink/creation-ink.js';
import type { SnapIndex } from '../snap/snap-candidates.js';

/** The style the line tool gives a new line: its stroke, its caps and its route. */
export interface LineStyle extends StrokeStyle {
  /** The stroke's colour and width. */
  readonly stroke: Stroke;
  /** The cap at the line's first point. */
  readonly startCap: LineCap;
  /** The cap at its last point: `arrow` for the arrow sub-tool (Shift+L). */
  readonly endCap: LineCap;
  /** Straight, or elbow. */
  readonly route: LineObject['route'];
}

/**
 * What the line tool and a line's endpoint editing work on and report to. The app's engine document
 * gives it from the tool modes' services. Main thread.
 */
export interface LineToolContext {
  /** The document; lines are written only through commands. */
  readonly store: DocumentStore;
  /** Who the commands are attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /**
   * Runs an edit as its own undo step, apart from any typing (the app's typing undo policy);
   * the edit runs as it is when absent.
   */
  readonly capture?: {
    /**
     * Runs an edit's command as its own undo step.
     *
     * @param run - Runs the command.
     */
    command(run: () => void): void;
  };
  /** Shows a line as previewed without writing it (a draft, a dragged end), or drops it. */
  readonly setPreview: (id: ObjectId, object: BoardObject | undefined) => void;
  /** Called when what the tool shows changed (its overlay, a preview). */
  readonly onChange: () => void;
  /**
   * Receives the errors when the document refuses a line's command (the line was locked or
   * deleted meanwhile), so the shell can say so; nothing is written then.
   */
  readonly onCommandRefused?: (errors: readonly CommandError[]) => void;
  /** The index ends snap to anchors, edges and centres through; the grid only if absent. */
  readonly snapIndex?: SnapIndex;
  /**
   * The creator's theme and image colours, for a new line's or connector's default stroke colour;
   * the light theme when absent.
   */
  readonly creationInk?: CreationInkSource;
}
