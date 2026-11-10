import { createObjectCommand, runCommand } from '@canvas/document';
import {
  isTokenRef,
  type Color,
  type ObjectId,
  type Point,
  type StickyAspect,
} from '@canvas/schema';

import { withCreationParent } from '../frame/creation-parent.js';
import type {
  ToolCursor,
  ToolKeyInput,
  ToolMode,
  ToolPointerInput,
  ToolStep,
} from '../modes/tool-mode.js';
import { TOOL_STEP_CONTINUE } from '../modes/tool-mode.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { TextModeContext } from '../text/text-mode-context.js';
import { TextMode } from '../text/text-mode.js';
import type { TextEditingSession } from '../text/text-session.js';

import { newStickyObject, type NewStickyObject } from './new-sticky-object.js';
import { DEFAULT_NOTE_COLOR } from './note-colors.js';
import { stackedStickyOf } from './stack-sticky.js';

/** What the sticky mode works on: a text mode's context, plus the colour new notes take. */
export interface StickyModeContext extends TextModeContext {
  /**
   * The colour a new note takes: the sticky tool's, the one last picked (a tuple, or a board
   * colour token); the palette's yellow
   * (`DEFAULT_NOTE_COLOR`) when absent. `newTextStyle` is the style its text is typed in, and
   * `newTextAlign` its alignment, centred when absent.
   */
  readonly newNoteColor?: () => Color;
  /** The size a new note takes: square or wide; square when absent. */
  readonly newNoteAspect?: () => StickyAspect;
  /**
   * The board point at the centre of the view, where Enter places a note; Enter places
   * nothing when absent.
   */
  readonly viewCentre?: () => Point;
  /**
   * The topmost sticky note under a point, world units, at a camera zoom: Shift+click on
   * it stacks the next note below it.
   */
  readonly stickyAt?: (world: Point, zoom: number) => ObjectId | undefined;
  /** The one sticky note selected, if that is the selection: Shift+click stacks below it. */
  readonly selectedSticky?: () => ObjectId | undefined;
}

/** How a sticky mode starts. */
export type StickyModeStart =
  | {
      /** The sticky tool: a click on the board creates a note and edits it. */
      readonly kind: 'create';
    }
  | {
      /** Editing an existing note (a double-click on it, or Enter). */
      readonly kind: 'edit';
      /** The note. */
      readonly id: ObjectId;
      /** Where the caret goes; the whole text is selected when omitted (Enter). */
      readonly world?: Point;
    };

/**
 * The sticky tool, `s`: a click on the board creates a note centred on it, 200 units square
 * (`NOTE_SIZE`) in the tool's colour (`StickyModeContext.newNoteColor`), as one `createObject` and
 * so one undo step, selects it and edits its text with the text editor (`TextMode`), so the note
 * grows with what is typed (at least square, through `setTextRuns`' size) and an empty note is
 * kept. While editing, input goes to the editor: a press outside the note ends the edit and passes
 * the press on, Escape selects the note. An activated note (double-click, Enter) is edited at once.
 * Before a note is made, Enter places one at the view's centre as a click there would, so a note
 * can be placed without a pointer. Main thread; no DOM.
 */
export class StickyMode implements ToolMode {
  readonly id = 'sticky' as const;
  private readonly context: StickyModeContext;
  /** The text editor on the note, once one is created or activated. */
  private editing: TextMode | undefined;
  /** The press a release creates a note at, while the button is down. */
  private press: Point | undefined;
  /** Where a Shift+click went down: it stacks a note when it is released. */
  private stackPress: { readonly world: Point; readonly zoom: number } | undefined;
  /** The note this mode placed last, which a Shift+click stacks below. */
  private lastPlaced: ObjectId | undefined;

  /**
   * Starts the mode.
   *
   * @param context - The document, layout, undo grouping, callbacks and the note colour.
   * @param start - Whether to create notes or edit one.
   */
  constructor(context: StickyModeContext, start: StickyModeStart) {
    this.context = context;
    if (start.kind === 'edit') {
      const editing = new TextMode(context, start);
      this.editing = editing.session === undefined ? undefined : editing;
    }
  }

  /**
   * The note's editing session, while one runs: what the hidden text input and the style panel
   * drive.
   *
   * @returns The session, or `undefined` before a note is created.
   */
  get session(): TextEditingSession | undefined {
    return this.editing?.session;
  }

  /**
   * A crosshair over the board until a note is made, then the editor's I-beam.
   *
   * @returns The cursor.
   */
  get cursor(): ToolCursor {
    return this.editing?.cursor ?? 'crosshair';
  }

  onPointer(input: ToolPointerInput): ToolStep {
    // Shift+click stacks the next note, even over the note being edited: the press is
    // the mode's, not the text's.
    if (input.kind === 'pointerDown' && input.isShiftPressed) {
      this.stackPress = { world: input.world, zoom: input.zoom };
      return TOOL_STEP_CONTINUE;
    }
    if (this.stackPress !== undefined) {
      const press = this.stackPress;
      if (input.kind === 'pointerUp' || input.kind === 'pointerCancel') this.stackPress = undefined;
      if (input.kind === 'pointerUp') this.stack(press.world, press.zoom);
      return TOOL_STEP_CONTINUE;
    }
    if (this.editing !== undefined) return this.editing.onPointer(input);
    switch (input.kind) {
      case 'pointerDown':
        this.press = input.world;
        return TOOL_STEP_CONTINUE;
      case 'pointerUp': {
        const { press } = this;
        this.press = undefined;
        if (press !== undefined) this.create(press);
        return TOOL_STEP_CONTINUE;
      }
      case 'pointerCancel':
        this.press = undefined;
        return TOOL_STEP_CONTINUE;
      default:
        return TOOL_STEP_CONTINUE;
    }
  }

  onKey(input: ToolKeyInput): boolean {
    if (this.editing !== undefined) return this.editing.onKey(input);
    const { viewCentre } = this.context;
    if (input.kind === 'enter' && viewCentre !== undefined) {
      this.create(viewCentre());
      return true;
    }
    if (input.kind !== 'escape') return false;
    this.context.requestExit();
    return true;
  }

  overlay(): Partial<SelectionOverlayModel> {
    return this.editing?.overlay() ?? {};
  }

  onZoom(zoom: number): void {
    this.editing?.onZoom(zoom);
  }

  exit(): void {
    this.press = undefined;
    this.stackPress = undefined;
    this.editing?.exit();
  }

  abandon(): void {
    this.press = undefined;
    this.stackPress = undefined;
    this.editing?.abandon();
  }

  /**
   * Places the next note below another (Shift+click): the sticky under the press, else
   * the one selected or being edited, else the last this mode placed; with none, a note at the
   * press as a click places one. The note being edited is finished first.
   *
   * @param press - Where the Shift+click went down, world units.
   * @param zoom - The camera zoom then.
   */
  private stack(press: Point, zoom: number): void {
    const { context } = this;
    const anchorId =
      context.stickyAt?.(press, zoom) ??
      context.selectedSticky?.() ??
      this.editing?.session?.id ??
      this.lastPlaced;
    const above = anchorId === undefined ? undefined : context.store.get(anchorId);
    this.editing?.exit();
    this.editing = undefined;
    if (above?.type === 'sticky') this.place(stackedStickyOf(above));
    else this.create(press);
  }

  /**
   * Creates a note centred on a click (or the view, for Enter) as its own undo step, selects it and starts editing it.
   * A refused creation is reported and leaves the tool as it was.
   *
   * @param centre - The click, world units.
   */
  private create(centre: Point): void {
    const { context } = this;
    const color = context.newNoteColor?.() ?? DEFAULT_NOTE_COLOR;
    const align = context.newTextAlign?.() ?? 'center';
    const fresh: Color = isTokenRef(color) ? { token: color.token } : [...color];
    const aspect = context.newNoteAspect?.() ?? 'square';
    this.place(newStickyObject(centre, context.newTextStyle(), fresh, align, aspect));
  }

  /**
   * Creates a note as one undo step, selects it and starts editing its text.
   *
   * @param object - The note.
   */
  private place(object: NewStickyObject): void {
    const { context } = this;
    let id: ObjectId | undefined;
    context.capture.command(() => {
      const { store, origin, environment } = context;
      // Drawn in a section, it joins it (item 9).
      const placed = withCreationParent(store, object);
      const outcome = runCommand(
        store,
        origin,
        createObjectCommand,
        { object: placed },
        environment,
      );
      if (outcome.status === 'applied') id = outcome.result.id;
      else context.onCommandRefused?.(outcome.errors);
    });
    if (id === undefined) return;
    this.lastPlaced = id;
    context.selectObjects([id]);
    this.editing = new TextMode(context, { kind: 'edit', id });
    context.onChange();
  }
}
