import { useId, type ReactElement, type ReactNode } from 'react';

import { initialsOf } from '../collab/presence-people.js';
import { useFollowController, useFollowView } from '../collab/use-follow.js';
import { usePopup } from '../focus/use-popup.js';

import styles from './account-menu.module.css';

/** The signed-in person, as the presence/share bar's account button shows them. */
export interface ShellAccount {
  /** Their user id: the principal their board token names, left out of the collaborators. */
  readonly principalId: string;
  /** Their name as the site shows it, already made safe to show (`personNameOf`). */
  readonly name: string;
  /** Their email address, already made safe to show. */
  readonly email: string;
  /** Opens their account settings. */
  readonly onSettings: () => void;
  /** Goes to their boards. */
  readonly onBoards: () => void;
  /** Signs them out: the site's own sign-out, which asks first about unsent edits. */
  readonly onSignOut: () => void;
  /** Starts deleting their account: Settings with the dialog open; none if absent. */
  readonly onDeleteAccount?: () => void;
}

/** Props of {@link AccountMenu}. */
export interface AccountMenuProps {
  /** The signed-in person and what the menu's entries do. */
  readonly account: ShellAccount;
}

/**
 * One entry of the account menu: a button out of the tab order, which the arrows reach.
 *
 * @param props - What choosing it does, and its name.
 * @param props.onChoose - Called when it is chosen; the menu has closed.
 * @param props.children - Its name.
 * @param props.isDanger - Whether it is shown in red (Delete account…).
 * @param props.isDisabled - Whether it is shown but does nothing (Spotlight me for a viewer).
 * @returns The entry.
 */
function AccountMenuItem(props: {
  readonly onChoose: () => void;
  readonly children: ReactNode;
  readonly isDanger?: boolean;
  readonly isDisabled?: boolean;
}): ReactElement {
  const isDisabled = props.isDisabled === true;
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={[styles.item, props.isDanger === true ? styles.danger : ''].join(' ')}
      data-popup-item=""
      aria-disabled={isDisabled ? true : undefined}
      onClick={isDisabled ? undefined : props.onChoose}
    >
      {props.children}
    </button>
  );
}

/**
 * The account menu's spotlight entry (frame F2): "Spotlight me", under which everyone
 * else here follows the person's view; "End spotlight" while they share it; shown but disabled,
 * with the reason, for a viewer or commenter. Nothing on a board without presence.
 *
 * @param props - What choosing an entry does first.
 * @param props.choose - Closes the menu, then runs the entry.
 * @returns The entry, or nothing.
 */
function SpotlightItem(props: {
  readonly choose: (run: () => void) => () => void;
}): ReactElement | null {
  const controller = useFollowController();
  const view = useFollowView(controller);
  if (controller === undefined) return null;
  if (view.isSpotlighting) {
    return (
      <AccountMenuItem
        onChoose={props.choose(() => {
          controller.endSpotlight();
        })}
      >
        End spotlight
      </AccountMenuItem>
    );
  }
  return (
    <AccountMenuItem
      onChoose={props.choose(() => {
        controller.startSpotlight();
      })}
      isDisabled={!view.canSpotlight}
    >
      <span className={styles.entryName}>Spotlight me</span>
      <span className={styles.entryDetail}>
        {view.canSpotlight
          ? 'Everyone here follows your view'
          : 'Only editors and the owner can spotlight'}
      </span>
    </AccountMenuItem>
  );
}

/**
 * The account button at the presence/share bar's right end (item 7): the signed-in
 * person's own avatar, their initials, named "Account: <name>", in the tab order with the shared
 * focus ring. It opens a menu (`usePopup`, the WAI-ARIA menu button: Enter, Space or the arrows
 * open it, the arrows move, Escape closes it back on the button) under their name and email:
 * Settings, Your boards, Sign out and, in red, Delete account… (when the page offers it),
 * each closing the menu first. Shown only for a signed-in
 * person: the playground and the harness shell have none.
 *
 * @param props - The person and what the entries do.
 * @returns The button and, when open, the menu.
 */
export function AccountMenu(props: AccountMenuProps): ReactElement {
  const { account } = props;
  const popup = usePopup();
  const menuId = useId();
  const identityId = useId();
  const choose = (run: () => void) => () => {
    popup.close();
    run();
  };
  return (
    <div className={styles.anchor}>
      <button
        ref={popup.triggerRef}
        type="button"
        className={styles.avatar}
        aria-label={`Account: ${account.name}`}
        aria-haspopup="menu"
        aria-expanded={popup.isOpen}
        aria-controls={popup.isOpen ? menuId : undefined}
        data-account=""
        onClick={popup.toggle}
        onKeyDown={popup.onTriggerKeyDown}
      >
        <span aria-hidden="true">{initialsOf(account.name)}</span>
      </button>
      {popup.isOpen ? (
        <div ref={popup.popupRef} className={styles.popup} onKeyDown={popup.onPopupKeyDown}>
          <p id={identityId} className={styles.identity}>
            <span className={styles.name}>{account.name}</span>
            <span className={styles.email}>{account.email}</span>
          </p>
          <div
            id={menuId}
            role="menu"
            aria-label="Account"
            aria-describedby={identityId}
            className={styles.menu}
          >
            <SpotlightItem choose={choose} />
            <AccountMenuItem onChoose={choose(account.onSettings)}>Settings</AccountMenuItem>
            <AccountMenuItem onChoose={choose(account.onBoards)}>Your boards</AccountMenuItem>
            <div role="separator" className={styles.separator} />
            <AccountMenuItem onChoose={choose(account.onSignOut)}>Sign out</AccountMenuItem>
            {account.onDeleteAccount === undefined ? null : (
              <AccountMenuItem onChoose={choose(account.onDeleteAccount)} isDanger>
                Delete account…
              </AccountMenuItem>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
