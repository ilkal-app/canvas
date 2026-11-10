import type {
  CommandEnvironment,
  CommandError,
  DocumentStore,
  StylePatch,
  TransactionOrigin,
} from '@canvas/document';
import { type BoardObject, type ObjectId, type Point } from '@canvas/schema';
import {
  alignTextObjects,
  changeListLevel,
  directTextObjects,
  editingSessionOf,
  restyleTextObjects,
  setList,
  type SelectController,
  type TextEditingSession,
  type TextLayoutService,
  type TextModeContext,
  type ToolId,
  type ToolMode,
} from '@canvas/tools';

import type { TextEditingSpot } from '../editing/text-editing-feed.js';
import type { ToolStyle } from '../state/tool-style.js';
import { readFontReplacement, setFontReplacement } from '../text-input/font-replacement.js';
import {
  PAGE_TEXT_LAYOUT,
  subscribePageFonts,
  pageFontRevision,
} from '../text-input/page-fonts.js';
import { PAGE_OVERRIDE_SHAPING } from '../text-input/page-fonts.js';
import { textToolStyleOf } from '../tool-styles/text-style.js';

import {
  canEditTextFonts,
  openBoardFontReplacement,
  type FontReplacementHost,
} from './document-font-replacement.js';
import type { TextEditingInspection } from './engine-document-types.js';
import type { TextToolServices } from './modes/tool-mode-entry.js';
import { OverrideSizeFollower } from './override-size-follower.js';
import { StyleContextReader } from './style-context-reader.js';
import { TextSizeFollower } from './text-size-follower.js';
import { patchOf } from './text-style-context.js';
import { TextStylePreview } from './text-style-preview.js';
import type { TextStyleChange, TextStyleContext } from './text-style-types.js';
import { TypingUndoPolicy, type CapturingHistory } from './typing-undo-policy.js';

export type { EditedText, TextStyleChange, TextStyleContext } from './text-style-types.js';

/** What {@link DocumentText} works on. */
export interface DocumentTextOptions {
  readonly store: DocumentStore;
  readonly origin: TransactionOrigin;
  readonly environment: CommandEnvironment;
  /** The local user's history, whose steps the typing policy groups. */
  readonly history: CapturingHistory;
  /** Lays text out on the page; answers nothing until fonts load. */
  readonly layout: TextLayoutService;
  /** Ends the active tool mode: back to the select tool. */
  readonly requestExit: () => void;
  /** The active tool mode, if any: a text mode's session is the text being edited. */
  readonly activeMode: () => ToolMode | undefined;
  /**
   * The select tool: its selection is styled when no text is being edited, text modes select
   * with it, and the select mode drives it.
   */
  readonly selectTool: SelectController;
  /** Shows an object as previewed (a composition), or drops the preview. */
  readonly setPreview: (id: ObjectId, object: BoardObject | undefined) => void;
  /** The editable text under a point, for the text tool. */
  readonly textAt: (world: Point, zoom: number) => ObjectId | undefined;
  /** Called when what the text mode shows changed. */
  readonly onChange: () => void;
  /**
   * The text tool's style (`DocumentPanels.toolStyle('text')`: its registered defaults with the
   * person's choices over them), which new text starts in; the catalogue's default when empty.
   */
  readonly toolStyle?: () => StylePatch;
  /**
   * Each creation tool's style (`DocumentPanels.toolStyle`), which the tool modes create objects
   * in (the sticky tool's colour and text style).
   */
  readonly toolStyleOf?: (tool: ToolId) => ToolStyle;
  /** Receives a sentence for the person (editing ended because the text was locked). */
  readonly onNotice?: (message: string) => void;
  /** Receives the errors of an edit the document refused (text locked meanwhile). */
  readonly onCommandRefused?: (errors: readonly CommandError[]) => void;
}

/**
 * Text on the engine's document side: gives the tool modes their services (`services()`:
 * the page's layout, the typing undo policy, previews, the creation tools' styles; the text tool's
 * registration is `modes/text-mode.ts`, the sticky tool's `modes/sticky-mode.ts`), reports the text
 * being edited (a text object's or a sticky note's), and applies style changes from the panel and
 * mod+b / mod+i: to the range or the pending style while editing, else to the selected text objects
 * and notes whole. New text starts in the text tool's style (`toolStyle`), which the panel edits
 * while the tool is active with nothing targeted. Main thread.
 */
export class DocumentText {
  /** How text edits join undo steps. */
  readonly policy: TypingUndoPolicy;
  private readonly options: DocumentTextOptions;
  /** Counts document changes, so the cached style context knows when it is stale. */
  private documentVersion = 0;
  private readonly stopListening: () => void;
  private isDestroyed = false;
  /** A style drag's preview. */
  private readonly previews: TextStylePreview;
  private readonly stopFonts: (() => void) | undefined;
  /** Rewrites the sizes a collaborator's change left untrue. */
  private readonly sizes: TextSizeFollower;
  /** Keeps instances' measured override text sizes true. */
  private readonly overrideSizes: OverrideSizeFollower;
  /** The style context, cached on what it reads (`StyleContextReader`). */
  private readonly styles: StyleContextReader;

  /**
   * Starts the typing policy and follows the document.
   *
   * @param options - The document, history, layout and callbacks.
   */
  constructor(options: DocumentTextOptions) {
    this.options = options;
    this.policy = new TypingUndoPolicy(options.store, options.history);
    this.previews = new TextStylePreview(options.setPreview);
    this.styles = new StyleContextReader({
      session: () => this.session(),
      selection: () => options.selectTool.selection.ids,
      get: (id) => options.store.get(id),
      version: () => this.documentVersion,
    });
    this.stopListening = options.store.subscribe(() => {
      this.documentVersion += 1;
      this.previews.end(); // whoever changed it, the preview shows text that is no longer so
    });
    const canWrite = (): boolean => options.selectTool.canEdit;
    this.sizes = new TextSizeFollower({
      store: options.store,
      environment: options.environment,
      layout: options.layout,
      editedId: () => this.session()?.id,
      canWrite,
    });
    const shaping = options.layout === PAGE_TEXT_LAYOUT ? PAGE_OVERRIDE_SHAPING : {};
    this.overrideSizes = new OverrideSizeFollower({ ...options, canWrite, ...shaping });
    if (options.layout === PAGE_TEXT_LAYOUT) {
      let revision = pageFontRevision();
      this.stopFonts = subscribePageFonts(() => {
        const next = pageFontRevision();
        if (next === revision) return;
        revision = next;
        this.fontsLanded();
        this.options.onChange();
      });
    }
    void options.layout.whenReady?.().then(() => {
      this.fontsLanded();
    });
  }

  /**
   * The page's fonts have loaded: a new box's text typed before they did is created, measured,
   * and every text written without them is measured again.
   */
  private fontsLanded(): void {
    if (this.isDestroyed) return;
    this.session()?.writeHeld();
    this.sizes.fontsLanded();
  }

  /**
   * The text being edited now, if any.
   *
   * @returns Its session.
   */
  session(): TextEditingSession | undefined {
    return editingSessionOf(this.options.activeMode());
  }

  /**
   * Tells the size follower which text is being edited, after every tool step: a session that
   * just started has its content recorded before any collaborator's change can arrive.
   */
  noteEditing(): void {
    this.sizes.noteEditing(this.session()?.id);
  }

  /**
   * What the style panel shows for text: the editing selection's or caret's style, else the
   * selected text objects' shared style; `undefined` when no text is targeted.
   *
   * @returns The context.
   */
  styleContext(): TextStyleContext | undefined {
    return this.styles.read();
  }

  /**
   * Whether the style context is worked out in stages (`styleContextInStages`): for a
   * large selection not being edited, not cached.
   *
   * @returns Whether it is.
   */
  isStyleStaged(): boolean {
    return this.styles.isStaged();
  }

  /**
   * {@link styleContext} worked out in stages, cached unless what it reads changed
   * meanwhile.
   *
   * @param stage - Awaited between stages.
   * @returns The context, or `undefined` once what it read changed (a later read follows).
   */
  styleContextInStages(
    stage: () => Promise<void>,
  ): Promise<{ readonly context: TextStyleContext | undefined } | undefined> {
    return this.styles.readInStages(stage);
  }

  /**
   * Applies a style change to what text targets: the editing range or pending style, else the
   * selected text objects.
   *
   * @param change - The change.
   * @returns Whether any text was targeted.
   */
  apply(change: TextStyleChange): boolean {
    if (change.kind === 'endPreview') {
      this.previews.end();
      return true;
    }
    const current = this.styleContext();
    if (current === undefined) return false;
    const session = this.session();
    if (change.kind === 'preview') {
      // While editing the slider commits on release; there is nothing to preview over.
      if (session === undefined)
        this.previews.show(this.context(), this.options.selectTool.selection.ids, change.patch);
      return true;
    }
    this.previews.end();
    if (change.kind === 'list' || change.kind === 'listLevel') {
      // Lists are the edited paragraphs': the list menu only shows while editing.
      if (session === undefined) return false;
      const next =
        change.kind === 'list'
          ? setList(session.editor, change.list)
          : changeListLevel(session.editor, change.delta);
      if (next !== undefined && next !== session.editor) session.apply(next, 'command');
      return true;
    }
    const patch = patchOf(change, current.style);
    if (change.kind === 'align' || change.kind === 'direction') {
      const ids = session === undefined ? this.options.selectTool.selection.ids : [session.id];
      if (change.kind === 'align') alignTextObjects(this.context(), ids, change.align);
      else directTextObjects(this.context(), ids, change.direction);
      return true;
    }
    if (session !== undefined) session.setStyle(patch);
    else restyleTextObjects(this.context(), this.options.selectTool.selection.ids, patch);
    return true;
  }

  /** The selection changed: a style preview made on the old one ends. */
  selectionChanged(): void {
    this.previews.selectionChanged(this.options.selectTool.selection.ids);
  }

  /**
   * The text being edited, for the test harness.
   *
   * @returns Its object, text, caret and anchor; `undefined` when nothing is edited.
   */
  inspect(): TextEditingInspection | undefined {
    const session = this.session();
    if (session === undefined) return undefined;
    const { text, caret, anchor } = session.editor;
    const { composition, compositionSelection } = session.displayed();
    const inspection = { id: session.id, text, caret, anchor, isComposing: session.isComposing };
    return composition === undefined
      ? inspection
      : { ...inspection, composition, compositionSelection };
  }

  /**
   * Where the person is editing text now, for presence: the object and its caret or
   * selection; `undefined` while nothing is edited, or while the edited text is a draft the
   * document does not hold yet (nobody else could see it).
   *
   * @returns The spot.
   */
  editing(): TextEditingSpot | undefined {
    const session = this.session();
    if (session === undefined || this.options.store.get(session.id) === undefined) return undefined;
    const { caret, anchor } = session.editor;
    return { objectId: session.id, anchor, focus: caret };
  }

  /** Stops the typing policy and stops following the document. */
  destroy(): void {
    this.isDestroyed = true;
    if (readFontReplacement()?.owner === this) setFontReplacement(undefined);
    this.stopFonts?.();
    this.sizes.destroy();
    this.overrideSizes.destroy();
    this.stopListening();
    this.policy.destroy();
  }

  /**
   * What the tool modes work on (`registerToolModes`): the document, the page's layout, the
   * typing undo policy, the style new text starts in, previews, the selection and the callbacks.
   *
   * @returns The services.
   */
  services(): TextToolServices {
    return this.context();
  }

  /**
   * Opens the board-wide replacement of a missing family (the missing-fonts notice's
   * Replace…; `openBoardFontReplacement`). Only with page fonts and while the person may edit.
   *
   * @param family - The missing family, as the board stores it.
   */
  openBoardFontReplacement(family: string): void {
    if (this.options.layout !== PAGE_TEXT_LAYOUT || !this.options.selectTool.canEdit) return;
    openBoardFontReplacement(this.fontReplacementHost(), family);
  }

  private fontReplacementHost(): FontReplacementHost {
    return {
      owner: this,
      canWrite: () => !this.isDestroyed && this.options.selectTool.canEdit,
      context: () => this.context(),
    };
  }

  private context(): TextToolServices & TextModeContext {
    const { store, origin, environment, layout } = this.options;
    return {
      store,
      origin,
      environment,
      layout,
      capture: this.policy,
      newTextStyle: () => textToolStyleOf(this.options.toolStyle?.()).textStyle,
      newTextAlign: () => textToolStyleOf(this.options.toolStyle?.()).align,
      setPreview: this.options.setPreview,
      selectTool: this.options.selectTool,
      selectObjects: (ids) => {
        this.options.selectTool.select(ids);
      },
      requestExit: this.options.requestExit,
      onChange: this.options.onChange,
      textAt: this.options.textAt,
      ...(layout !== PAGE_TEXT_LAYOUT
        ? {}
        : {
            canEditText: (object: BoardObject) =>
              canEditTextFonts(this.fontReplacementHost(), object),
          }),
      onWrittenUnmeasured: (id) => {
        this.sizes.noteUnmeasured(id);
      },
      ...(this.options.toolStyleOf === undefined ? {} : { toolStyleOf: this.options.toolStyleOf }),
      ...(this.options.onNotice === undefined ? {} : { onNotice: this.options.onNotice }),
      ...(this.options.onCommandRefused === undefined
        ? {}
        : { onCommandRefused: this.options.onCommandRefused }),
    };
  }
}
