import type {
  CommandEnvironment,
  CommandError,
  DocumentStore,
  TransactionOrigin,
} from '@canvas/document';
import type { SpatialSearch } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import type { CreationInkSource } from '../ink/creation-ink.js';

import type { DrawStyle } from './draw-style.js';
import type { EraserSource } from './eraser-hits.js';
import type { LiveInk } from './live-ink.js';

/**
 * What the draw tool works on and reports to, as
 * the line tool's context is: the app's engine document gives it from the tool modes' services.
 * Main thread.
 */
export interface DrawModeContext {
  /** The document; strokes are written only through commands. */
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
  /** Shows a stroke as previewed without writing it, or drops it. */
  readonly setPreview: (id: ObjectId, object: BoardObject | undefined) => void;
  /** Called when what the tool shows changed. */
  readonly onChange: () => void;
  /**
   * Receives the errors when the document refuses a stroke's command, so the shell can say so;
   * nothing is written then.
   */
  readonly onCommandRefused?: (errors: readonly CommandError[]) => void;
  /**
   * The creator's theme and image colours, for a new stroke's default colour;
   * the light theme when absent.
   */
  readonly creationInk?: CreationInkSource;
  /** The draw tool's style now: its defaults with the person's choices (and the sub-tool). */
  readonly drawStyle: () => DrawStyle;
  /** Ends the mode from inside it (Escape with no stroke under way): back to the select tool. */
  readonly requestExit: () => void;
  /**
   * What the eraser reads strokes through: the select tool's source, gated as the
   * engine draws; the store, ungated, when absent.
   */
  readonly source?: EraserSource;
  /**
   * The hit-test index the eraser finds candidate strokes through by their boxes;
   * every object of the store is a candidate when absent.
   */
  readonly hitIndex?: SpatialSearch;
  /**
   * The page's live ink overlay: while attached at a press, the stroke under way is
   * drawn there and previewed in the engine at opacity 0; previews alone when absent.
   */
  readonly liveInk?: LiveInk;
}
