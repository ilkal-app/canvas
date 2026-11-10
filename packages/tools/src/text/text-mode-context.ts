import type {
  CommandEnvironment,
  CommandError,
  DocumentStore,
  TransactionOrigin,
} from '@canvas/document';
import type { TextAlign, TextLayout } from '@canvas/engine';
import type {
  BoardObject,
  ObjectId,
  ParagraphStyle,
  Point,
  StyleRun,
  TextStyle,
} from '@canvas/schema';

import type { CreationInkSource } from '../ink/creation-ink.js';

/** What the page lays a text box out from: its content and box settings. */
export interface TextLayoutInput {
  /** The characters. */
  readonly text: string;
  /** Their runs. */
  readonly runs: readonly StyleRun[];
  /** The wrapping width, world units; `null` for auto-width text. */
  readonly wrapWidth: number | null;
  /** Line alignment. */
  readonly align: TextAlign;
  /** One style per paragraph: lists indent and get markers. All plain when absent. */
  readonly paragraphs?: readonly ParagraphStyle[] | undefined;
}

/**
 * Lays text out on the page, synchronously, with the same faces and layout the engine's text
 * pass uses (`layoutTextNow` over the page's `FontLibrary`), so the caret the page draws and
 * the glyphs the engine draws agree.
 */
export interface TextLayoutService {
  /**
   * Lays a text box out.
   *
   * @param input - The content and box settings.
   * @returns The layout, or `undefined` while no font is loaded on the page.
   */
  layout(input: TextLayoutInput): TextLayout | undefined;
  /**
   * Settles once the page's fonts have loaded (every file has loaded or failed), so text held
   * or written while they were missing is written or measured then. Absent where the layout
   * never waits for fonts.
   *
   * @returns The promise; it never rejects.
   */
  whenReady?(): Promise<void>;
}

/**
 * How text edits join undo steps: typing in one session is one step per
 * word, everything else one step per command. The app's typing undo policy implements it over
 * the local user's history.
 */
export interface TypingCapture {
  /**
   * Runs a typing edit (characters typed or deleted) of an editing session, in the session's
   * current undo step; a word end (a space or a newline typed) ends the step after it.
   *
   * @param sessionId - The editing session; a new session starts a new step.
   * @param run - Runs the edit's command.
   * @param isWordEnd - Whether the step ends after this edit.
   */
  typing(sessionId: number, run: () => void, isWordEnd: boolean): void;
  /**
   * Runs any other edit (a restyle, a paste, a cut) as its own undo step.
   *
   * @param run - Runs the edit's command.
   */
  command(run: () => void): void;
  /** Ends the current typing step: the caret jumped, or the session ended. */
  endStep(): void;
}

/** What a text editing mode works on and reports to. Main thread. */
export interface TextModeContext {
  /** The document; the mode writes to it only through commands. */
  readonly store: DocumentStore;
  /** Who the mode's commands are attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /** Lays text out on the page. */
  readonly layout: TextLayoutService;
  /** Groups the mode's edits into undo steps. */
  readonly capture: TypingCapture;
  /** The style new text starts in: the text tool's style (its defaults, the person's choices). */
  readonly newTextStyle: () => TextStyle;
  /** How new text's lines align, from the text tool's style; left when absent. */
  readonly newTextAlign?: () => TextAlign;
  /**
   * Shows an object as the mode previews it, without writing it: the text being composed with an
   * input method, which never reaches the document until it commits. `undefined` drops it.
   */
  readonly setPreview: (id: ObjectId, object: BoardObject | undefined) => void;
  /** Selects objects with the select tool, as when Escape ends editing. */
  readonly selectObjects: (ids: readonly ObjectId[]) => void;
  /** Ends the mode from outside an input (Escape, the edited object deleted by someone else). */
  readonly requestExit: () => void;
  /** Called whenever what the mode shows changed: the caret, the selection, a preview. */
  readonly onChange: () => void;
  /**
   * Receives a sentence for the person when editing ends for a reason they did not choose (a
   * collaborator locked the text); nothing is said when absent.
   */
  readonly onNotice?: (message: string) => void;
  /**
   * Receives the errors when the document refuses an edit (the text was locked), so the shell
   * can say so; nothing is written then.
   */
  readonly onCommandRefused?: (errors: readonly CommandError[]) => void;
  /**
   * Receives a text written while the page's fonts were missing (no layout), whose stored size
   * was therefore not measured, so the app measures it once they land (`whenReady`).
   */
  readonly onWrittenUnmeasured?: (id: ObjectId) => void;
  /**
   * The editable text under a point (a text object or a sticky note), for the text tool's click
   * on existing text.
   *
   * @param world - The point, world units.
   * @param zoom - The camera zoom.
   * @returns The text object's id, or `undefined`.
   */
  readonly textAt?: (world: Point, zoom: number) => ObjectId | undefined;
  /** Requests an available font before opening words for editing; absent means allowed. */
  readonly canEditText?: (object: BoardObject) => boolean;
  /**
   * The creator's theme and image colours, for a new text's or shape outline's default colour;
   * the light theme when absent.
   */
  readonly creationInk?: CreationInkSource;
}
