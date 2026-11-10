import type { LinkLayout, ObjectId } from '@canvas/schema';

/**
 * A link card's popover edit: its layout (`setLinkLayout`, the layout's size with it),
 * or turning it into a text linked to its page (`linkCardToText`); one command, so one undo step.
 */
export interface LinkCardAction {
  /** Always `'linkCard'`. */
  readonly type: 'linkCard';
  /** The card. */
  readonly id: ObjectId;
  /** The edit. */
  readonly change:
    | {
        /** Set the layout. */
        readonly kind: 'layout';
        /** The image above the text, or beside it. */
        readonly layout: LinkLayout;
      }
    | {
        /** Turn the card into a text link. */
        readonly kind: 'toText';
      };
}
