import type { BoardObject, ObjectId } from '@canvas/schema';
import { selectionListOf, type TextEditingSession } from '@canvas/tools';

import {
  selectionStyleContext,
  selectionStyleContextInStages,
  STAGED_STYLE_OBJECTS,
} from './selection-style-context.js';
import { directionContextOf, isSameStyleContext } from './text-style-context.js';
import type { TextStyleContext } from './text-style-types.js';

/** What {@link StyleContextReader} reads the style context from. */
export interface StyleContextSources {
  /** The text session being edited, if any. */
  readonly session: () => TextEditingSession | undefined;
  /** The selected ids; a new array whenever the selection changes. */
  readonly selection: () => readonly ObjectId[];
  /** An object as stored. */
  readonly get: (id: ObjectId) => BoardObject | undefined;
  /** Counts document changes, so the cached context knows when it is stale. */
  readonly version: () => number;
}

/** What the cached context was worked out from: the session, its editor, selection, version. */
type StyleInputs = readonly [unknown, unknown, readonly ObjectId[], number];

/**
 * What the style panel shows for text, cached on what it reads: a hover or a drag recomputes
 * nothing, however large the selection, and a large selection is worked out in stages.
 */
export class StyleContextReader {
  readonly #sources: StyleContextSources;
  #cached:
    { readonly inputs: StyleInputs; readonly context: TextStyleContext | undefined } | undefined;

  /**
   * Reads from its sources.
   *
   * @param sources - The session, selection, board and document version.
   */
  constructor(sources: StyleContextSources) {
    this.#sources = sources;
  }

  /**
   * The context: the editing selection's or caret's style, else the selected text objects'
   * shared style; `undefined` when no text is targeted.
   *
   * @returns The context.
   */
  read(): TextStyleContext | undefined {
    const inputs = this.#inputs();
    const cached = this.#cached;
    if (cached?.inputs.every((input, index) => input === inputs[index]) === true) {
      return cached.context;
    }
    const session = this.#sources.session();
    const objects = this.#selectedObjects();
    return this.#store(
      inputs,
      session === undefined ? selectionStyleContext(objects) : editing(session),
    );
  }

  /**
   * Whether the context is to be worked out in stages: for a selection of more than
   * `STAGED_STYLE_OBJECTS` objects not being edited, not cached.
   *
   * @returns Whether it is.
   */
  isStaged(): boolean {
    const inputs = this.#inputs();
    if (inputs[0] !== undefined || inputs[2].length <= STAGED_STYLE_OBJECTS) return false;
    return this.#cached?.inputs.every((input, index) => input === inputs[index]) !== true;
  }

  /**
   * The context worked out in stages, and cached as `read` caches it, unless what it reads
   * changed meanwhile.
   *
   * @param stage - Awaited between stages.
   * @returns The context, or `undefined` once what it read changed (a later read follows).
   */
  async readInStages(
    stage: () => Promise<void>,
  ): Promise<{ readonly context: TextStyleContext | undefined } | undefined> {
    const inputs = this.#inputs();
    if (inputs[0] !== undefined) return { context: this.read() };
    const computed = await selectionStyleContextInStages(this.#selectedObjects(), stage);
    const now = this.#inputs();
    if (!now.every((input, index) => input === inputs[index])) return undefined;
    return { context: this.#store(inputs, computed) };
  }

  /**
   * What the context is worked out from now.
   *
   * @returns The inputs.
   */
  #inputs(): StyleInputs {
    const session = this.#sources.session();
    return [session, session?.editor, this.#sources.selection(), this.#sources.version()];
  }

  /**
   * Caches a context worked out from some inputs: the same fields keep the same object, so the
   * shell renders again only for a real change (not for every keystroke's new document version).
   *
   * @param inputs - What it was worked out from.
   * @param computed - The context.
   * @returns The context cached.
   */
  #store(
    inputs: StyleInputs,
    computed: TextStyleContext | undefined,
  ): TextStyleContext | undefined {
    const previous = this.#cached?.context;
    const context = isSameStyleContext(previous, computed) ? previous : computed;
    this.#cached = { inputs, context };
    return context;
  }

  /**
   * The selected objects, as stored.
   *
   * @returns Them, in selection order; `undefined` for one no longer on the board.
   */
  #selectedObjects(): (BoardObject | undefined)[] {
    return this.#sources.selection().map((id) => this.#sources.get(id));
  }
}

/**
 * The context of a text being edited: the editing selection's or caret's style.
 *
 * @param session - The session.
 * @returns The context.
 */
function editing(session: TextEditingSession): TextStyleContext {
  const object = session.object();
  const style = session.currentStyle();
  const edited = {
    ...(object === undefined ? {} : { edited: { id: session.id, type: object.type } }),
    list: selectionListOf(session.editor),
  };
  if (object?.type === 'shape' || object?.type === 'connector') {
    const fixed = { align: undefined, canAlign: false, canDirect: false } as const;
    return { style, ...fixed, isEditing: true, ...edited };
  }
  const direction = directionContextOf(object === undefined ? [] : [object]);
  return { style, align: object?.align, ...direction, isEditing: true, ...edited };
}
