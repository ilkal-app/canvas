import type { ReactElement } from 'react';

import type { BoardObject, LinkObject } from '@canvas/schema';

import { Icon } from '../icons/icon.js';

import type { PopoverStyleControlsProps } from './popover-controls.js';
import { Divider, RowButton } from './popover-row-parts.js';
import styles from './selection-popover.module.css';

/**
 * The one link card a selection is, if it is one.
 *
 * @param selection - The selected objects.
 * @returns The card, or undefined.
 */
export function singleLinkCardOf(selection: readonly BoardObject[]): LinkObject | undefined {
  const [only] = selection;
  return selection.length === 1 && only?.type === 'link' ? only : undefined;
}

/**
 * Opens a card's page in a new tab, with no way back to the board (`noopener`).
 *
 * @param card - The card.
 */
function openPage(card: LinkObject): void {
  window.open(card.url, '_blank', 'noopener,noreferrer');
}

/**
 * Puts a card's link on the clipboard; a refused write is ignored, as a copy shortcut's is.
 *
 * @param card - The card.
 */
function copyLink(card: LinkObject): void {
  void navigator.clipboard.writeText(card.url).catch(() => undefined);
}

/**
 * A button that names its action in words (the card's Open ↗, To text link and Retry).
 *
 * @param props - Its words, its icon after them, and its press.
 * @param props.label - Its words.
 * @param props.icon - An icon after them, if any.
 * @param props.onPress - What it does.
 * @returns The button.
 */
function WordButton(props: {
  readonly label: string;
  readonly icon?: 'external' | undefined;
  readonly onPress: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={styles.wordButton}
      aria-label={props.label}
      onClick={props.onPress}
    >
      {props.label}
      {props.icon === undefined ? null : <Icon name={props.icon} />}
    </button>
  );
}

/**
 * What anyone who sees a card may do with it: open its page, copy its link. A viewer's
 * popover holds only these.
 *
 * @param props - The card.
 * @param props.card - The card.
 * @returns The buttons.
 */
export function LinkCardOpenControls(props: { readonly card: LinkObject }): ReactElement {
  const { card } = props;
  return (
    <>
      <WordButton
        label="Open"
        icon="external"
        onPress={() => {
          openPage(card);
        }}
      />
      <RowButton
        label="Copy link"
        icon="copy"
        onPress={() => {
          copyLink(card);
        }}
      />
    </>
  );
}

/**
 * The link card row (frame L2): Open ↗, copy link | the image above the text or beside
 * it | To text link, and Retry on a failed card. Each edit is one action, so one undo step; a
 * locked card offers only what does not change it.
 *
 * @param props - The controls' props and the card.
 * @param props.controls - The popover's controls' props.
 * @param props.card - The selected card.
 * @returns The controls.
 */
export function LinkCardControls(props: {
  readonly controls: PopoverStyleControlsProps;
  readonly card: LinkObject;
}): ReactElement {
  const { controls, card } = props;
  const isEditable = !card.locked;
  const onRetry = controls.onRetryLink;
  return (
    <>
      <LinkCardOpenControls card={card} />
      {isEditable ? (
        <>
          <Divider />
          <RowButton
            label="Image above"
            icon="layout-vertical"
            isPressed={card.layout === 'vertical'}
            onPress={() => {
              controls.dispatch({
                type: 'linkCard',
                id: card.id,
                change: { kind: 'layout', layout: 'vertical' },
              });
            }}
          />
          <RowButton
            label="Image beside"
            icon="layout-horizontal"
            isPressed={card.layout === 'horizontal'}
            onPress={() => {
              controls.dispatch({
                type: 'linkCard',
                id: card.id,
                change: { kind: 'layout', layout: 'horizontal' },
              });
            }}
          />
          <WordButton
            label="To text link"
            onPress={() => {
              controls.dispatch({ type: 'linkCard', id: card.id, change: { kind: 'toText' } });
            }}
          />
          {card.status === 'failed' && onRetry !== undefined ? (
            <WordButton
              label="Retry"
              onPress={() => {
                onRetry(card.id, card.url);
              }}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
