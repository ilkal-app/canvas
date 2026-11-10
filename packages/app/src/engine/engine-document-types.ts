// The engine document's interfaces: what it works on, where it shows the board, and what it
// reports to the harness (split from engine-document.ts to keep it under the file limit).
import type {
  CommandEnvironment,
  CommandError,
  DocumentStore,
  TransactionOrigin,
  UndoHistory,
} from '@canvas/document';
import type { BoardObject, ObjectId, Point } from '@canvas/schema';
import type {
  CreationInkSource,
  LiveInk,
  RootMovePreview,
  SelectionOverlayModel,
  TextLayoutService,
  ToolId,
  TouchCallbacks,
} from '@canvas/tools';

import type { NoticeSink } from '../notices/notice-outline.js';

import type { PanelEditTarget } from './document-panels.js';
import type { ChangeSetSummary, SceneChangeSink } from './document-scene-feed.js';

/**
 * Undo and redo as the engine uses them: `@canvas/document`'s `UndoHistory` for the
 * local user, or anything with the same four methods (and, optionally, `stopCapturing` and
 * `lastOmission` and `lastOmittedObjects`, which say why and whether an undo left part of its
 * step out, and `lastProtection`, who changed what since when one changed nothing,
 *).
 */
export type EditHistory = Pick<UndoHistory, 'undo' | 'redo' | 'canUndo' | 'canRedo'> &
  Partial<
    Pick<
      UndoHistory,
      'stopCapturing' | 'lastOmission' | 'lastOmittedObjects' | 'lastProtection' | 'startRestore'
    >
  >;

/** What the engine's document side reports to the test harness: plain data. */
export interface EngineInspection {
  /** The selected ids, first primary. */
  readonly selectedIds: readonly ObjectId[];
  /** The selected objects as the document holds them. */
  readonly selectedObjects: readonly BoardObject[];
  /** The document's recent change sets, oldest first: the last hundred. */
  readonly changeSets: readonly ChangeSetSummary[];
  /** How many change sets the document has had: count new ones by it, not by index. */
  readonly changeSetTotal?: number;
  /** The group entered with a double-click, or null at the board's top level. */
  readonly enteredGroupId: ObjectId | null;
  /** The text being edited: its object, text, caret and selection's other end; or undefined. */
  readonly textEditing?: TextEditingInspection | undefined;
}

/** A text editing session as the test harness sees it. */
export interface TextEditingInspection {
  /** The text object. */
  readonly id: ObjectId;
  /** Its text, as the editor holds it. */
  readonly text: string;
  /** The caret, UTF-16 code units. */
  readonly caret: number;
  /** The selection's other end. */
  readonly anchor: number;
  /** The composition in progress, if an input method is composing. */
  readonly isComposing: boolean;
  /** The displayed composition's absolute UTF-16 range, for scenario assertions. */
  readonly composition?: readonly [start: number, end: number] | undefined;
  /** The displayed target clause or IME caret, in absolute UTF-16 offsets. */
  readonly compositionSelection?: readonly [start: number, end: number] | undefined;
}

/**
 * Where the engine's document side shows the board once the engine runs: the scene's change
 * sets and the selection overlay's model. On the main thread, the scene renderer and a
 * `SelectionOverlay` stage; behind an engine host, the host (the worker draws both).
 */
export interface EngineDocumentView extends SceneChangeSink {
  /** Optional compact root-move path; ordinary source previews remain available without it. */
  showMovePreview?(model: Pick<RootMovePreview, 'ids' | 'objects' | 'positions'> | undefined): void;
  /**
   * Shows the selection overlay's model from the next frame.
   *
   * @param model - The frame, handles, outlines and marquee, world units; plain data.
   */
  showOverlay(model: SelectionOverlayModel): void;
}

/** What `EngineDocument` works on, with the select tool's touch callbacks. */
export interface EngineDocumentOptions extends TouchCallbacks {
  /** The person's input queue and its checks' board; panel actions run through it. */
  readonly input?: PanelEditTarget['input'];
  /** Whole-board definitions when store is a page-scoped view. Defaults to store. */
  readonly definitions?: DocumentStore;
  /** The document. */
  readonly store: DocumentStore;
  /** The local user's undo history over it. */
  readonly history: EditHistory;
  /** Who the tools' commands are attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /** Called whenever something on screen changed: the document, the selection, a preview. */
  readonly onChange: () => void;
  /** Called on `destroy`, to free what the caller created for this document (store, history). */
  readonly release?: () => void;
  /**
   * Receives a short sentence for the shell to show when an action does nothing and the person
   * should know why (a group of objects with different parents; objects an order command
   * left where they were), with objects to outline while it shows.
   */
  readonly onNotice?: NoticeSink;
  /** Called when the canvas changes the active tool (a mode ended or started), for the toolbar. */
  readonly onToolChange?: (tool: ToolId) => void;
  /** Lays text out on the page for the text tool; nothing lays out when absent (no fonts). */
  readonly textLayout?: TextLayoutService;
  /**
   * The viewer's theme and canvas, for the default colour of a new stroke or text;
   * the light theme when absent.
   */
  readonly creationInk?: CreationInkSource;
  /**
   * Called with the errors when the document refuses a command the person asked for (a
   * gesture's, a panel's restyle), so the shell can say so; nothing is written then.
   */
  readonly onCommandRefused?: (errors: readonly CommandError[]) => void;
  /**
   * Opens the file picker for the image tool; the images chosen go centred on the point, or the
   * view's centre. The image tool says there are no images when absent.
   */
  readonly pickImages?: (at: Point | undefined) => Promise<void>;
  /**
   * Pans the view by CSS px for the hand tool and for a finger dragging empty board
   * with the select tool; neither pans when absent.
   */
  readonly panView?: (deltaXPx: number, deltaYPx: number) => void;
  /** The board point at the view's centre, where the sticky tool's Enter places a note. */
  readonly viewCentre?: () => Point;
  /** The page's live ink overlay the draw tool draws a stroke under way on. */
  readonly liveInk?: LiveInk;
  /**
   * Whether the board's chrome has the design tools now: false under the floating
   * chrome, a whiteboard's, where Create component makes nothing however it was dispatched.
   * Always when absent.
   */
  readonly hasDesignTools?: () => boolean;
  /**
   * Shows the page an object is on, if another page is shown: the inspector's "Go to main"
   * (ruling 5). Nothing switches when absent.
   */
  readonly showPageOf?: (id: ObjectId) => void;
}
