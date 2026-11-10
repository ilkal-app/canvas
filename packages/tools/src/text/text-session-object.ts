import { createObjectCommand, deleteObjectsCommand, runCommand } from '@canvas/document';
import { ConnectorPlacements } from '@canvas/engine';
import { DRAFT_PREVIEW_Z, type ObjectId, type TextObject } from '@canvas/schema';

import { withCreationParent } from '../frame/creation-parent.js';

import { listParagraphsOf, withoutParagraphs } from './paragraph-edits.js';
import { isEditableTextObject, type EditableTextObject } from './text-box-object.js';
import {
  layoutContent,
  measuredSize,
  writeTextContent,
  type TextContent,
} from './text-content-writer.js';
import type { TextModeContext } from './text-mode-context.js';

/** The stacking key a draft is previewed with (moved it to `@canvas/schema`). */
export { DRAFT_PREVIEW_Z };

/**
 * The text box a text tool press makes, before anything is written ("ending an empty
 * session writes nothing"): a text object the session shows (its caret, its frame, a
 * composition) that the document does not hold yet. Its id is chosen at once, so the object
 * keeps it when created.
 *
 * @param context - The mode's context: the id generator, the clock and the origin.
 * @param object - The new object's fields.
 * @returns The draft.
 */
export function draftTextObject(
  context: Pick<TextModeContext, 'environment' | 'origin'>,
  object: Omit<TextObject, 'id' | 'z' | 'createdBy' | 'createdAt' | 'updatedAt'>,
): TextObject {
  const now = context.environment.clock();
  return {
    ...object,
    id: context.environment.createId(),
    z: DRAFT_PREVIEW_Z,
    createdBy: context.origin.principalId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A draft's fields as `createObject` takes them: its id kept, the stacking key, author and times
 * left for the command to fill in.
 *
 * @param draft - The draft.
 * @returns The fields.
 */
function newObjectFieldsOf(
  draft: TextObject,
): Omit<TextObject, 'z' | 'createdBy' | 'createdAt' | 'updatedAt'> {
  return {
    id: draft.id,
    type: draft.type,
    parentId: draft.parentId,
    x: draft.x,
    y: draft.y,
    rotation: draft.rotation,
    locked: draft.locked,
    width: draft.width,
    height: draft.height,
    text: draft.text,
    runs: draft.runs,
    align: draft.align,
    autoWidth: draft.autoWidth,
    verticalAlign: draft.verticalAlign,
  };
}

/**
 * The object an editing session writes to: a text, sticky note, shape or connector (its label)
 * the document holds (a connector read placed on its targets), or a draft
 * the text tool made, created with its first committed character (one `createObject` carrying the text, the
 * runs and the measured size, so the creation and the first word are one undo step, and a
 * session ended empty writes nothing). Main thread; no DOM.
 */
export class TextSessionObject {
  /** The object's id, the draft's included. */
  readonly id: ObjectId;
  private readonly context: TextModeContext;
  /** The draft, until it is created; `undefined` for an object the document holds. */
  private draft: TextObject | undefined;
  /** Whether this session created the object (it was a draft). */
  readonly isOwnCreation: boolean;
  /** A connector's placement on its targets, whose label is centred on its route. */
  private readonly placements = new ConnectorPlacements();

  /**
   * Follows an object.
   *
   * @param context - The mode's context.
   * @param object - The object, from the document or a draft (`draftTextObject`, a text).
   * @param isDraft - Whether the document does not hold it yet.
   */
  constructor(context: TextModeContext, object: EditableTextObject, isDraft: boolean) {
    this.context = context;
    this.id = object.id;
    this.draft = isDraft && object.type === 'text' ? object : undefined;
    this.isOwnCreation = this.draft !== undefined;
  }

  /**
   * The object as the document holds it now, or the draft.
   *
   * @returns The object, or `undefined` once the document's is gone.
   */
  current(): EditableTextObject | undefined {
    if (this.draft !== undefined) return this.draft;
    const { store } = this.context;
    const object = store.get(this.id);
    if (object?.type === 'connector') {
      // Placed on its targets as they are now, so its label's box is where the engine draws it.
      const childrenOf = (id: ObjectId) => store.references.childrenOf(id);
      return this.placements.place(object, { get: (id) => store.get(id), childrenOf });
    }
    return isEditableTextObject(object) ? object : undefined;
  }

  /**
   * Whether the draft holds typed content it has not created yet: typed before the page's fonts
   * loaded, so there was no size to create it with.
   *
   * @returns True while the content waits.
   */
  get isHeld(): boolean {
    return this.draft !== undefined && this.draft.text !== '';
  }

  /**
   * Writes new content: `setTextRuns` with the measured size for an object the document holds;
   * for a draft, nothing while the content is empty or no font is loaded to measure it with
   * (held, see {@link TextSessionObject.isHeld}), else the `createObject` that makes it.
   *
   * @param content - The new text and runs.
   * @returns Whether the content is now the object's (a draft's empty or held content counts).
   */
  write(content: TextContent): boolean {
    const draft = this.draft;
    if (draft === undefined) return writeTextContent(this.context, this.id, content);
    const paragraphs = listParagraphsOf(content);
    this.draft = {
      ...withoutParagraphs(draft),
      text: content.text,
      runs: [...content.runs],
      ...(paragraphs === undefined ? {} : { paragraphs: [...paragraphs] }),
    };
    if (content.text === '' || this.create(false)) return true;
    this.draft = draft;
    return false;
  }

  /**
   * Creates the draft from the content it holds: measured once the fonts have loaded, or, when
   * forced (the session ends before they do), with the draft's own size, reported as unmeasured
   * so the app measures it when they land.
   *
   * @param isForced - Whether to create it without fonts.
   * @returns Whether the draft was created, or had nothing to create.
   */
  writeHeld(isForced: boolean): boolean {
    return !this.isHeld || this.create(isForced);
  }

  /**
   * Creates the draft with its content, measured; held (nothing written) while no font is
   * loaded, unless forced.
   *
   * @param isForced - Whether to create it without a measured size.
   * @returns Whether it was created, or held; false when the document refused it.
   */
  private create(isForced: boolean): boolean {
    const draft = this.draft;
    if (draft === undefined) return true;
    const layout = layoutContent(this.context, draft, draft);
    if (layout === undefined && !isForced) return true;
    const { store, origin, environment } = this.context;
    const size = layout === undefined ? {} : measuredSize(draft, layout);
    // The command gives the object its stacking key, author and times; the draft's are shown only.
    // Written in a section, it joins it (item 9).
    const object = withCreationParent(store, { ...newObjectFieldsOf(draft), ...size });
    const outcome = runCommand(store, origin, createObjectCommand, { object }, environment);
    if (outcome.status !== 'applied') {
      this.context.onCommandRefused?.(outcome.errors);
      return false;
    }
    this.draft = undefined;
    if (layout === undefined) this.context.onWrittenUnmeasured?.(this.id);
    return true;
  }

  /**
   * Deletes the object, left empty when its session ends; a draft is never written, so nothing
   * happens for one. Text the session created joins its typing step while that is open, so the
   * step undoes to nothing; other text is deleted as an undo step of its own.
   *
   * @param sessionId - The ending session's number, for the typing step.
   */
  deleteEmpty(sessionId: number): void {
    if (this.draft !== undefined) return;
    const { store, origin, environment } = this.context;
    const run = (): void => {
      runCommand(store, origin, deleteObjectsCommand, { ids: [this.id] }, environment);
    };
    if (this.isOwnCreation) this.context.capture.typing(sessionId, run, true);
    else this.context.capture.command(run);
  }
}
