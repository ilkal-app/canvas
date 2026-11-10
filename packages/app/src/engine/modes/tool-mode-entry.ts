import type {
  CommandEnvironment,
  CommandError,
  DocumentStore,
  TransactionOrigin,
} from '@canvas/document';
import type { TextAlign } from '@canvas/engine';
import type { BoardObject, ObjectId, ObjectType, Point, TextStyle } from '@canvas/schema';
import {
  isToolId,
  type CreationInkSource,
  type LiveInk,
  type PenModeContext,
  type SelectActivation,
  type SelectController,
  type SnapIndex,
  type TextLayoutService,
  type ToolId,
  type ToolMode,
  type TypingCapture,
} from '@canvas/tools';

import type { ToolStyle } from '../../state/tool-style.js';

/**
 * What the engine's document side gives every tool mode it builds: the document and who edits
 * it, the page's text layout, how edits join undo steps, the style new text starts in, previews
 * drawn without writing, the select tool and its selection, and the callbacks that end the mode
 * and redraw what it shows, the pen tool's style and point snapping. Each mode takes the fields
 * it needs (the text mode takes all but the select tool, as its `TextModeContext`; the pen modes
 * take theirs as a `PenModeContext`; the select mode takes only the select tool).
 */
export interface ToolModeServices {
  /** The document side's one select tool, which the select mode drives. */
  readonly selectTool: SelectController;
  /** The document the mode edits. */
  readonly store: DocumentStore;
  /** Who the mode's commands are attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /** Lays text out on the page, with the faces the engine draws; nothing until fonts load. */
  readonly layout: TextLayoutService;
  /** How the mode's edits join the local user's undo steps (the typing undo policy). */
  readonly capture: TypingCapture;
  /** The style new text starts in: the text tool's style. */
  readonly newTextStyle: () => TextStyle;
  /** How new text's lines align: the text tool's style's alignment. */
  readonly newTextAlign?: () => TextAlign;
  /** Shows an object as previewed without writing it, or drops the preview. */
  readonly setPreview: (id: ObjectId, object: BoardObject | undefined) => void;
  /** Selects objects with the select tool. */
  readonly selectObjects: (ids: readonly ObjectId[]) => void;
  /** Ends the mode from inside it: back to the select tool. */
  readonly requestExit: () => void;
  /** Called when what the mode shows changed. */
  readonly onChange: () => void;
  /** The editable text under a point (a text object or a sticky note), if any. */
  readonly textAt: (world: Point, zoom: number) => ObjectId | undefined;
  /** Requests an available font before opening words for editing; absent means allowed. */
  readonly canEditText?: (object: BoardObject) => boolean;
  /**
   * A creation tool's style (its defaults with the person's choices over them,
   * `DocumentPanels.toolStyle`), which its mode makes objects in: the sticky tool's colour and
   * text style, the line tool's stroke, caps and route, the pen's stroke and fill; empty when absent.
   *
   * @param tool - The creation tool.
   * @returns Its style.
   */
  readonly toolStyleOf?: (tool: ToolId) => ToolStyle;
  /** The hit-test index, which line ends snap to anchors through; the grid only if absent. */
  readonly snapIndex?: SnapIndex;
  /**
   * The object a connector end attaches to under a point when no anchor is near; the
   * connector tool attaches to nothing but anchors when absent.
   *
   * @param world - The point, world units.
   * @param zoom - The camera zoom.
   * @returns The object's id, or undefined.
   */
  readonly connectorTargetAt?: (world: Point, zoom: number) => ObjectId | undefined;
  /**
   * The sticky note under a point, inside groups too, which the sticky tool's
   * Shift+click stacks below; none when absent.
   */
  readonly stickyAt?: (world: Point, zoom: number) => ObjectId | undefined;
  /** Receives the errors of a command the document refused (a line locked mid-drag). */
  readonly onCommandRefused?: (errors: readonly CommandError[]) => void;
  /** Snaps a pen point to what is on screen and the grid; no snapping when absent. */
  readonly snapPoint?: NonNullable<PenModeContext['snapPoint']>;
  /** Receives a sentence for the person (the path or text edited was locked meanwhile). */
  readonly onNotice?: (message: string) => void;
  /**
   * Opens the file picker for the image tool: the images chosen are uploaded and placed
   * centred on `at`, or the view's centre; settles once the picker closed. Absent on a page with
   * no assets service.
   */
  readonly pickImages?: (at: Point | undefined) => Promise<void>;
  /**
   * Pans the view by a pointer's movement, CSS px, as a middle-button drag does: the hand tool's
   * drag. Absent where there is no camera to move.
   */
  readonly panView?: (deltaXPx: number, deltaYPx: number) => void;
  /**
   * The board point at the centre of the view, where the sticky tool's Enter places a note.
   * Absent where there is no camera.
   */
  readonly viewCentre?: () => Point;
  /**
   * The viewer's theme and canvas, for the default colour of a new stroke or text;
   * the light theme when absent.
   */
  readonly creationInk?: CreationInkSource;
  /**
   * The page's live ink overlay, which the draw tool draws a stroke under way on while
   * it is attached; previews alone when absent.
   */
  readonly liveInk?: LiveInk;
}

/** The services the text side gives (`DocumentText.services()`), before the pen's are added. */
export type TextToolServices = Omit<
  ToolModeServices,
  | 'snapPoint'
  | 'pickImages'
  | 'connectorTargetAt'
  | 'stickyAt'
  | 'panView'
  | 'viewCentre'
  | 'liveInk'
>;

/**
 * One tool mode's registration: the toolbar tool whose mode
 * it builds, and the object types whose activation (a double-click, or Enter with one selected)
 * it edits. A file of `modes/` named `<tool>-mode.ts` exports it as `toolModeEntry`; the tool
 * router registers every one (`TOOL_MODES`), so a new tool adds a file, not a line here or in
 * `EngineDocument`.
 */
export interface ToolModeEntry {
  /** The toolbar tool whose mode this is. */
  readonly tool: ToolId;
  /** The object types whose activation enters {@link ToolModeEntry.activate}'s mode. */
  readonly activates: readonly ObjectType[];
  /**
   * Builds the tool's mode when the toolbar makes the tool active.
   *
   * @param services - What the mode works on.
   * @returns The mode.
   */
  readonly create: (services: ToolModeServices) => ToolMode;
  /**
   * Builds the mode that edits an activated object, or declines (a locked object).
   *
   * @param services - What the mode works on.
   * @param activation - The select tool's `activate` intent.
   * @param object - The activated object, of one of {@link ToolModeEntry.activates}' types.
   * @returns The mode, or undefined to leave the object to the select tool.
   */
  readonly activate?: (
    services: ToolModeServices,
    activation: SelectActivation,
    object: BoardObject,
  ) => ToolMode | undefined;
}

/**
 * Tells whether a module export is a well-formed {@link ToolModeEntry}: a known tool, an array
 * of activated types, a `create` function, and an `activate` function when types are given.
 *
 * @param value - The export.
 * @returns Whether it is one.
 */
export function isToolModeEntry(value: unknown): value is ToolModeEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { tool, activates, create, activate } = value as Partial<
    Record<keyof ToolModeEntry, unknown>
  >;
  return (
    typeof tool === 'string' &&
    isToolId(tool) &&
    Array.isArray(activates) &&
    activates.every((type) => typeof type === 'string') &&
    typeof create === 'function' &&
    (activates.length === 0 || typeof activate === 'function')
  );
}
