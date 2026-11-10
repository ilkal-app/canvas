import { useId, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

import { usePopup } from '../focus/use-popup.js';
import { useIsMobileSite } from '../shell/mobile-site.js';

import { PresenceAvatar } from './presence-avatar.js';
import { PresencePeopleSheet } from './presence-people-sheet.js';
import { splitPresence, type PresencePerson } from './presence-people.js';
import { PresencePersonMenu } from './presence-person-menu.js';
import styles from './presence-share-bar.module.css';
import { useFollowController, useFollowView } from './use-follow.js';

/**
 * The phone's avatars (frame P1): one button over the avatars and the "+N", named for
 * how many are here, that raises the people sheet (frame P2), where each person has Follow. The
 * sheet renders in the themed shell root (`data-theme`), so it covers the shell and not the bar.
 *
 * @param props - The people.
 * @param props.people - Everyone else on the board, in order.
 * @returns The button and, when open, the sheet.
 */
function CompactPeopleButton(props: { readonly people: readonly PresencePerson[] }): ReactElement {
  const { people } = props;
  // Where the open sheet renders; undefined while closed.
  const [host, setHost] = useState<HTMLElement>();
  const anchorRef = useRef<HTMLDivElement>(null);
  const { shown, rest } = splitPresence(people);
  return (
    <div ref={anchorRef} className={styles.avatars}>
      <button
        type="button"
        className={styles.peopleButton}
        aria-label={`People on this board, ${String(people.length)}`}
        aria-haspopup="dialog"
        aria-expanded={host !== undefined}
        onClick={() => {
          setHost(anchorRef.current?.closest<HTMLElement>('[data-theme]') ?? document.body);
        }}
      >
        <span className={styles.avatarList}>
          {shown.map((person) => (
            <span key={person.principalId} className={styles.avatarItem}>
              <PresenceAvatar person={person} isDecorative />
            </span>
          ))}
        </span>
        {rest.length > 0 ? <span className={styles.more}>+{rest.length}</span> : null}
      </button>
      {host !== undefined
        ? createPortal(
            <PresencePeopleSheet
              people={people}
              onClose={() => {
                setHost(undefined);
              }}
            />,
            host,
          )
        : null}
    </div>
  );
}

/**
 * The "+N" of the presence bar and the list it opens of everyone it counts, each with their
 * avatar and name: a listbox the keyboard works (`usePopup`: Enter, Space or the arrows open it,
 * the arrows, Home and End move, Escape closes it back on the button). On a board with
 * presence choosing a person there (a click, Enter or Space) follows them, or stops
 * following the one followed, so everyone past the avatars can be followed too.
 *
 * @param props - The people it counts.
 * @param props.rest - Those people, in order.
 * @returns The button and, when open, the list.
 */
function PresenceOverflowList(props: { readonly rest: readonly PresencePerson[] }): ReactElement {
  const { rest } = props;
  const popup = usePopup();
  const listId = useId();
  const count = String(rest.length);
  const controller = useFollowController();
  const view = useFollowView(controller);
  const followed = view.follow.kind === 'following' ? view.follow.principalId : undefined;
  const actionOf = (person: PresencePerson): (() => void) | undefined => {
    if (controller === undefined) return undefined;
    if (person.principalId === followed)
      return () => {
        controller.stop('button');
      };
    if (!controller.canFollow(person.principalId)) return undefined;
    return () => {
      controller.follow(person.principalId);
    };
  };
  return (
    <div className={styles.anchor}>
      <button
        ref={popup.triggerRef}
        type="button"
        className={styles.more}
        aria-label={`${count} more on this board`}
        aria-haspopup="listbox"
        aria-expanded={popup.isOpen}
        aria-controls={popup.isOpen ? listId : undefined}
        onClick={popup.toggle}
        onKeyDown={popup.onTriggerKeyDown}
      >
        +{count}
      </button>
      {popup.isOpen ? (
        <div ref={popup.popupRef} className={styles.popup} onKeyDown={popup.onPopupKeyDown}>
          <ul id={listId} role="listbox" aria-label="Also on this board" className={styles.list}>
            {rest.map((person) => {
              const action = actionOf(person);
              const choose =
                action === undefined
                  ? undefined
                  : () => {
                      popup.close();
                      action();
                    };
              return (
                <li
                  key={person.principalId}
                  role="option"
                  aria-selected={person.principalId === followed}
                  tabIndex={-1}
                  data-popup-item=""
                  className={styles.option}
                  onClick={choose}
                  onKeyDown={(event) => {
                    if (choose === undefined || (event.key !== 'Enter' && event.key !== ' ')) {
                      return;
                    }
                    event.preventDefault();
                    choose();
                  }}
                >
                  <PresenceAvatar person={person} isDecorative />
                  <span className={styles.name}>{person.name}</span>
                  {person.kind === 'agent' ? <span className={styles.kind}>Agent</span> : null}
                  {action === undefined ? null : (
                    <span className={styles.kind}>
                      {person.principalId === followed ? 'Stop following' : 'Follow'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Who else is on the board: as many avatars as fit, then a "+N" that lists the rest
 * (`splitPresence`, the overflow rule). Nothing when nobody else is here. While the board is
 * away from the relay it shows the people last seen, dimmed, in a list
 * named "Last seen on this board".
 *
 * @param props - The people.
 * @param props.people - Everyone else on the board, one entry per principal, in order.
 * @param props.isDimmed - Whether they are the people last seen, not those here now.
 * @returns The avatars, or nothing.
 */
export function PresenceAvatars(props: {
  readonly people: readonly PresencePerson[];
  readonly isDimmed?: boolean;
}): ReactElement | null {
  const isCompact = useIsMobileSite();
  const controller = useFollowController();
  if (props.people.length === 0) return null;
  const isDimmed = props.isDimmed === true;
  if (isCompact && !isDimmed && controller !== undefined) {
    return <CompactPeopleButton people={props.people} />;
  }
  const { shown, rest } = splitPresence(props.people);
  return (
    <div className={styles.avatars} data-dimmed={isDimmed ? '' : undefined}>
      {/* Never empty: someone is here, and the slots always leave room for one avatar. */}
      <ul
        aria-label={isDimmed ? 'Last seen on this board' : 'On this board'}
        className={styles.avatarList}
      >
        {shown.map((person) => (
          <li key={person.principalId} className={styles.avatarItem}>
            {isDimmed ? <PresenceAvatar person={person} /> : <PresencePersonMenu person={person} />}
          </li>
        ))}
      </ul>
      {rest.length > 0 ? <PresenceOverflowList rest={rest} /> : null}
    </div>
  );
}
