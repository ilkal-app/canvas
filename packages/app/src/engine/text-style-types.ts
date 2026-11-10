// The style panel's view of the targeted text and the changes it sends (`document-text.ts`).
import type { TextAlign, TextBaseDirection } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';
import type { TextStylePatch } from '@canvas/tools';

import type { Mixable } from '../panels/controls/mixed-value.js';

/** What the style panel shows for text: the shared fields, and whether text is being edited. */
export interface TextStyleContext {
  /** The style fields every targeted character shares; a missing field is mixed. */
  readonly style: TextStylePatch;
  /** The alignment the targeted text objects share, or `undefined` when mixed. */
  readonly align: TextAlign | undefined;
  /**
   * The base direction the targeted text objects share, mixed when they differ; absent
   * is auto.
   */
  readonly direction?: Mixable<TextBaseDirection>;
  /**
   * The direction the auto-direction targets' first paragraphs take (their first strong
   * characters'), which sets the side of a `start` or `end` alignment; mixed when they differ,
   * absent when all are left to right.
   */
  readonly autoDirection?: Mixable<'ltr' | 'rtl'>;
  /**
   * Whether the targeted text takes a direction: false for shape labels and the text tool's
   * defaults; true when absent.
   */
  readonly canDirect?: boolean;
  /**
   * Whether the targeted text takes a language: false for the text tool's defaults;
   * true when absent.
   */
  readonly canSetLanguage?: boolean;
  /**
   * Whether the targeted text takes OpenType feature settings: false for the text
   * tool's defaults; true when absent.
   */
  readonly canSetFeatures?: boolean;
  /**
   * Whether the targeted text can be aligned: false for shape labels alone, which are always
   * centred; true when absent.
   */
  readonly canAlign?: boolean;
  /** Whether a text is being edited (the fields are the selection's or the caret's). */
  readonly isEditing: boolean;
  /**
   * While a text is edited, the list its touched paragraphs share: the list menu's
   * check; absent otherwise.
   */
  readonly list?: 'bullet' | 'numbered' | 'none' | 'mixed';
  /**
   * While a text is edited, the object whose text it is and its type (the text bar
   * sits over it, and offers a note's colours for a sticky note); absent otherwise.
   */
  readonly edited?: EditedText;
  /**
   * Each variable-font axis's value across the selected text objects' runs: a run's
   * own coordinate, else for `wght` its weight; mixed when runs differ or some leave the
   * tag unset; a tag no run sets is absent. Absent while editing, where the shown coordinates
   * are read instead.
   */
  readonly axisValues?: Readonly<Record<string, Mixable<number>>>;
}

/** The object whose text is being edited. */
export interface EditedText {
  /** Its id. */
  readonly id: ObjectId;
  /** Its type: a text object, a sticky note, or a shape's or connector's label. */
  readonly type: BoardObject['type'];
}

/** A style change from the style panel or a shortcut. */
export type TextStyleChange =
  | {
      /** Sets the fields the patch names. */
      readonly kind: 'style';
      /** The fields to set. */
      readonly patch: TextStylePatch;
    }
  | {
      /**
       * Toggles bold or italic, as mod+b and mod+i do, or underline or strikethrough, as mod+u
       * and mod+shift+x do.
       */
      readonly kind: 'toggleBold' | 'toggleItalic' | 'toggleUnderline' | 'toggleStrikethrough';
    }
  | {
      /** Sets the list of the edited paragraphs (the list menu); `null` for none. */
      readonly kind: 'list';
      /** The kind of list. */
      readonly list: 'bullet' | 'numbered' | null;
    }
  | {
      /** Indents or outdents the edited list paragraphs (Tab and Shift+Tab). */
      readonly kind: 'listLevel';
      /** +1 to indent, -1 to outdent. */
      readonly delta: 1 | -1;
    }
  | {
      /** Sets the text objects' alignment. */
      readonly kind: 'align';
      /** The alignment. */
      readonly align: TextAlign;
    }
  | {
      /** Sets the text objects' base direction. */
      readonly kind: 'direction';
      /** The direction. */
      readonly direction: TextBaseDirection;
    }
  | {
      /**
       * Shows the selected text objects restyled by the patch without writing: a
       * slider's drag, laid out and measured. A later preview replaces it; nothing while editing.
       */
      readonly kind: 'preview';
      /** The fields the drag would set. */
      readonly patch: TextStylePatch;
    }
  | {
      /** Ends a preview, showing the document again (a style change ends one too). */
      readonly kind: 'endPreview';
    };

/** A style toggle a shortcut runs: bold, italic, underline or strikethrough. */
export type TextToggle = 'toggleBold' | 'toggleItalic' | 'toggleUnderline' | 'toggleStrikethrough';

const TEXT_TOGGLES: ReadonlySet<string> = new Set<TextToggle>([
  'toggleBold',
  'toggleItalic',
  'toggleUnderline',
  'toggleStrikethrough',
]);

/**
 * Whether a command is a text style toggle.
 *
 * @param command - The command.
 * @returns True for one of the four toggles.
 */
export function isTextToggle(command: string): command is TextToggle {
  return TEXT_TOGGLES.has(command);
}
