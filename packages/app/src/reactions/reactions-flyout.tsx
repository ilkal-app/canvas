import { useRef, type ReactElement } from 'react';

import { REACTION_EMOJIS } from '@canvas/schema';

import { FloatingSheet } from '../controls/floating-sheet.js';
import { BOTTOM_CHROME_ATTRIBUTE } from '../toolbar/bottom-chrome.js';
import { POPOVER_AVOID } from '../toolbar/tool-panels/tool-panel-host.js';
import panelStyles from '../toolbar/tool-panels/tool-panel-host.module.css';
import { useRovingFocus } from '../toolbar/use-roving-focus.js';

import type { BoardReactions } from './reactions-context.js';
import styles from './reactions-flyout.module.css';

/**
 * "+1"'s name: what it repeats.
 *
 * @param last - The last reaction's emoji, if there was one.
 * @returns The name.
 */
export function repeatNameOf(last: string | undefined): string {
  return last === undefined ? 'Repeat the last reaction (none yet)' : `Repeat ${last}`;
}

/**
 * The floating dock's Reactions flyout (the design's frame B): a tool panel of the seven
 * reactions and "+1", centred on the dock 8 px above it. A reaction pressed is armed (pressed
 * again, disarmed): each press on the board then drops it there. Chosen with Enter or Space, it
 * is sent at once at the view's centre instead, as the keyboard cannot place it. "+1" drops the last reaction
 * anyone dropped again beside it. Its cells are one tab stop, the arrows moving among them;
 * Escape closes it and disarms.
 *
 * Below 768 px wide it is a bottom sheet over the compact bar, as the tool panels.
 *
 * @param props - The board's reactions.
 * @param props.reactions - Them.
 * @param props.isSheet - Whether it is a bottom sheet over the compact bar; false if absent.
 * @returns The flyout.
 */
export function ReactionsFlyout(props: {
  readonly reactions: BoardReactions;
  readonly isSheet?: boolean | undefined;
}): ReactElement {
  const { reactions } = props;
  const itemsRef = useRef<HTMLDivElement>(null);
  const roving = useRovingFocus(itemsRef);
  return (
    <FloatingSheet
      shape="toolbar"
      role="toolbar"
      label="Reactions"
      className={[panelStyles.panel, styles.flyout].join(' ')}
      dataAttributes={{
        'data-reactions-flyout': '',
        [POPOVER_AVOID]: '',
        ...(props.isSheet === true ? { 'data-sheet': '', [BOTTOM_CHROME_ATTRIBUTE]: '' } : {}),
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        reactions.close();
      }}
    >
      <div
        ref={itemsRef}
        className={styles.items}
        onKeyDown={roving.onKeyDown}
        onFocus={roving.onFocus}
      >
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className={styles.cell}
            aria-label={`React with ${emoji}`}
            aria-pressed={reactions.armed === emoji}
            data-dock-item=""
            onKeyDown={(event) => {
              // The keyboard has no press on the board to place it: Enter or Space sends it at
              // the view's centre.
              if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat) return;
              event.preventDefault();
              reactions.sendAtCentre(emoji);
            }}
            onClick={() => {
              reactions.arm(reactions.armed === emoji ? null : emoji);
            }}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className={styles.cell}
          aria-label={repeatNameOf(reactions.last?.emoji)}
          title={repeatNameOf(reactions.last?.emoji)}
          disabled={reactions.last === undefined}
          data-dock-item=""
          data-reaction-repeat=""
          onClick={reactions.repeat}
        >
          +1
        </button>
      </div>
    </FloatingSheet>
  );
}
