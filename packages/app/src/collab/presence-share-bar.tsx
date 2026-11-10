import { useMemo, useState, useSyncExternalStore, type ReactElement } from 'react';

import { AccountMenu, type ShellAccount } from '../account/account-menu.js';
import { FloatingSheet } from '../controls/floating-sheet.js';
import { Icon } from '../icons/icon.js';

import type { ConnectionStatusSource } from './board-connection.js';
import { describeConnection, isAwayFromRelay, shortConnectionLabel } from './connection-label.js';
import { PresenceAvatars } from './presence-avatars.js';
import { presencePeopleOf, withoutPrincipal, type PresencePerson } from './presence-people.js';
import styles from './presence-share-bar.module.css';

/** Props of {@link PresenceShareBar}. */
export interface PresenceShareBarProps {
  /** The board's connection, whose state and people the bar shows; none shows Share alone. */
  readonly connection?: ConnectionStatusSource | undefined;
  /** Opens the host's share dialog; no Share button if absent. */
  readonly onShare?: (() => void) | undefined;
  /**
   * Copies the board's link in one click: an icon-only button attached to Share, the
   * two one control; no such button if absent.
   */
  readonly onCopyLink?: (() => void) | undefined;
  /**
   * Whether Share and the account button are out of reach (the shell's layout is inert: the board
   * is loading, a dialog is open, or the app is out of date), while the connection's state stays
   * live. False if absent.
   */
  readonly isShareInert?: boolean;
  /** A page's name from its id, so each person says the page they show. */
  readonly pageNameOf?: (pageId: string) => string | undefined;
  /**
   * The signed-in person: their account button ends the bar, and their own avatar is
   * left out of the people on the board. No button, and nobody left out, if absent.
   */
  readonly account?: ShellAccount | undefined;
  /**
   * Whether it is the whiteboard's floating sheet (the floating chrome at 768 px wide
   * and more) rather than the classic bar. False if absent.
   */
  readonly isFloating?: boolean;
}

/**
 * The people last seen while connected: who is here now while live, and, once the connection
 * drops (presence then forgets everyone), whoever was here last.
 *
 * @param people - Who presence says is here now.
 * @param isLive - Whether the connection is live.
 * @returns The people last seen while live.
 */
function useLastSeenPeople(
  people: readonly PresencePerson[],
  isLive: boolean,
): readonly PresencePerson[] {
  const [lastSeen, setLastSeen] = useState(people);
  // Adjusted while rendering, React's way to keep state that follows a prop.
  if (isLive && lastSeen !== people) setLastSeen(people);
  return isLive ? people : lastSeen;
}

/**
 * The connection's state and the people on the board, following the connection.
 *
 * @param props - The connection.
 * @param props.connection - The board's connection.
 * @param props.pageNameOf - A page's name from its id.
 * @param props.selfId - The signed-in person's principal id, whose own avatar the account button
 *   shows instead; none if absent.
 * @returns The state, a divider and the avatars.
 */
function PresenceState(props: {
  readonly connection: ConnectionStatusSource;
  readonly pageNameOf?: ((pageId: string) => string | undefined) | undefined;
  readonly selfId?: string | undefined;
}): ReactElement {
  const { connection, pageNameOf, selfId } = props;
  const status = useSyncExternalStore(
    (listener) => connection.subscribe(listener),
    () => connection.status(),
  );
  const { label, detail } = describeConnection(status, pageNameOf);
  const here = useMemo(
    () => withoutPrincipal(presencePeopleOf(status.collaborators, pageNameOf), selfId),
    [status.collaborators, pageNameOf, selfId],
  );
  const lastSeen = useLastSeenPeople(here, status.state === 'connected');
  // Away from the relay, the people last seen show dimmed.
  const isAway = isAwayFromRelay(status);
  const people = isAway ? lastSeen : here;
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        aria-label={`Connection: ${label}`}
        title={detail}
        className={styles.state}
        data-state={status.state}
        data-local-only={status.isLocalOnly ? '' : undefined}
      >
        <span className={styles.dot} aria-hidden="true" />
        <span>{shortConnectionLabel(status)}</span>
      </div>
      {people.length > 0 ? <span className={styles.divider} aria-hidden="true" /> : null}
      <PresenceAvatars people={people} isDimmed={isAway} />
    </>
  );
}

/**
 * The presence/share bar (the design's "presence"): a sheet floating over the
 * canvas's top-right corner that hugs its content (item 6: with nobody else here the
 * connection's state sits next to Share, and the bar grows leftwards as avatars come). It says
 * where the board stands, as the connection chip did: `Live` while
 * connected, else `Connecting…`, `Reconnecting…`, `Offline`, `Offline · local board`, `Not
 * authorized`, `App out of date: reload the page` and the rest of `describeConnection`, `·
 * read-only` for a person who may only look; a polite live region named `Connection: <label>`,
 * with the collaborators and unsent edits (never the board's id) in its tooltip. Beside it the
 * people on the board, initials on their presence colour, and agents in the agent colour with
 * the agent mark, as many as fit, then a "+N" that lists the rest; then Share, when the host
 * offers it, and last the signed-in person's account button (`AccountMenu`, item 7),
 * their own avatar then left out of the people. While the live board loads it says `Connecting`;
 * while a synced board is offline or reconnecting the people last seen
 * stay, dimmed. Under the whiteboard's floating chrome (`isFloating`; design
 * board, Whiteboard frame A) it is a bar-shaped `FloatingSheet` 16 px from the top-right corner:
 * 24 px avatars 18 px apart without a ring, a 20 px divider and a 76 px Share; following a person
 * from their avatar is's. Theme tokens only. Main thread.
 *
 * @param props - The connection, the share handler, whether Share is inert and whether it floats.
 * @returns The bar.
 */
export function PresenceShareBar(props: PresenceShareBarProps): ReactElement {
  const { connection, onShare } = props;
  const contents = (
    <>
      {connection === undefined ? null : (
        <PresenceState
          connection={connection}
          pageNameOf={props.pageNameOf}
          selfId={props.account?.principalId}
        />
      )}
      {onShare === undefined ? null : (
        <div
          className={styles.shareSlot}
          inert={props.isShareInert === true}
          {...(props.onCopyLink === undefined ? {} : { role: 'group', 'aria-label': 'Share' })}
        >
          <button type="button" className={styles.share} aria-haspopup="dialog" onClick={onShare}>
            Share
          </button>
          {props.onCopyLink === undefined ? null : (
            <button
              type="button"
              className={styles.copyLink}
              aria-label="Copy link"
              title="Copy link"
              onClick={props.onCopyLink}
            >
              <Icon name="link" />
            </button>
          )}
        </div>
      )}
      {props.account === undefined ? null : (
        <div className={styles.shareSlot} inert={props.isShareInert === true}>
          <AccountMenu account={props.account} />
        </div>
      )}
    </>
  );
  if (props.isFloating === true) {
    return (
      <FloatingSheet
        shape="bar"
        role="group"
        label="Presence and sharing"
        className={styles.floating}
        dataAttributes={{ 'data-top-bar': 'presence' }}
      >
        {contents}
      </FloatingSheet>
    );
  }
  return (
    <div
      role="group"
      aria-label="Presence and sharing"
      className={styles.bar}
      data-top-bar="presence"
    >
      {contents}
    </div>
  );
}
