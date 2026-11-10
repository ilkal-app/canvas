import { useId, type ReactElement } from 'react';

import { usePopup } from '../focus/use-popup.js';

import { PresenceAvatar } from './presence-avatar.js';
import type { PresencePerson } from './presence-people.js';
import styles from './presence-share-bar.module.css';
import { useFollowController, useFollowView } from './use-follow.js';

/**
 * A collaborator's avatar as a menu button (frames F1 and F7): a click opens their menu,
 * under their name and page, with Follow <name> (Stop following while following them), or Follow
 * shown disabled with the reason for someone with no view to follow (an agent); a double-click
 * follows at once. On a board without presence it is the plain avatar.
 *
 * @param props - The person.
 * @param props.person - Who it shows.
 * @returns The button and, when open, the menu.
 */
export function PresencePersonMenu(props: { readonly person: PresencePerson }): ReactElement {
  const { person } = props;
  const controller = useFollowController();
  const view = useFollowView(controller);
  const popup = usePopup();
  const menuId = useId();
  const identityId = useId();
  if (controller === undefined) return <PresenceAvatar person={person} />;
  const isAgent = person.kind === 'agent';
  const where = person.pageName === undefined ? undefined : `on ${person.pageName}`;
  const label = [isAgent ? `${person.name}, agent` : person.name, where]
    .filter((part) => part !== undefined)
    .join(', ');
  const isFollowing =
    view.follow.kind === 'following' && view.follow.principalId === person.principalId;
  const canFollow = controller.canFollow(person.principalId);
  const choose = (run: () => void) => () => {
    popup.close();
    run();
  };
  return (
    <div className={styles.personAnchor}>
      <button
        ref={popup.triggerRef}
        type="button"
        className={styles.personButton}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={popup.isOpen}
        aria-controls={popup.isOpen ? menuId : undefined}
        data-following={isFollowing ? '' : undefined}
        onClick={popup.toggle}
        onDoubleClick={() => {
          popup.close();
          if (canFollow) controller.follow(person.principalId);
        }}
        onKeyDown={popup.onTriggerKeyDown}
      >
        <PresenceAvatar person={person} />
      </button>
      {popup.isOpen ? (
        <div ref={popup.popupRef} className={styles.popup} onKeyDown={popup.onPopupKeyDown}>
          <p id={identityId} className={styles.identity}>
            <span className={styles.name}>{isAgent ? `${person.name} (agent)` : person.name}</span>
            {where === undefined ? null : <span className={styles.kind}>{where}</span>}
          </p>
          <div
            id={menuId}
            role="menu"
            aria-label={person.name}
            aria-describedby={identityId}
            className={styles.menu}
          >
            <PersonMenuEntries
              person={person}
              isFollowing={isFollowing}
              canFollow={canFollow}
              choose={choose}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A person's menu entries: Stop following while following them, else Follow <name>, or Follow
 * disabled with the reason when they have no view to follow.
 *
 * @param props - The person, the follow state, and what choosing does.
 * @param props.person - Who.
 * @param props.isFollowing - Whether they are followed now.
 * @param props.canFollow - Whether they can be followed.
 * @param props.choose - Closes the menu, then runs the entry.
 * @returns The entries.
 */
function PersonMenuEntries(props: {
  readonly person: PresencePerson;
  readonly isFollowing: boolean;
  readonly canFollow: boolean;
  readonly choose: (run: () => void) => () => void;
}): ReactElement {
  const { person, isFollowing, canFollow, choose } = props;
  const controller = useFollowController();
  if (isFollowing) {
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        data-popup-item=""
        className={styles.menuItem}
        onClick={choose(() => {
          controller?.stop('button');
        })}
      >
        Stop following
      </button>
    );
  }
  const follow = choose(() => {
    controller?.follow(person.principalId);
  });
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-popup-item=""
      className={styles.menuItem}
      aria-disabled={canFollow ? undefined : true}
      onClick={canFollow ? follow : undefined}
    >
      <span>{canFollow ? `Follow ${person.name}` : 'Follow'}</span>
      {canFollow ? null : (
        <span className={styles.menuDetail}>
          {person.kind === 'agent' ? 'Agents have no view to follow yet' : 'No view to follow yet'}
        </span>
      )}
    </button>
  );
}
