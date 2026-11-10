import type { ReactElement } from 'react';

import { Button } from '../controls/button.js';
import { Dialog } from '../dialogs/dialog.js';

import { PresenceAvatar } from './presence-avatar.js';
import styles from './presence-people-sheet.module.css';
import { initialsOf, type PresencePerson } from './presence-people.js';
import { useFollowController, useFollowView } from './use-follow.js';

/** Props of {@link PresencePeopleSheet}. */
export interface PresencePeopleSheetProps {
  /** Everyone else on the board, one entry per principal, in the bar's order. */
  readonly people: readonly PresencePerson[];
  /** Closes the sheet (Escape, Close, the backdrop, or after an action). */
  readonly onClose: () => void;
}

/**
 * The phone's people sheet (frame P2): tapping the compact bar's avatars raises a sheet
 * from the bottom edge, "On this board · N", the person's own row first with Spotlight me (End
 * spotlight while spotlighting, the reason instead where they may not), then each person with
 * Follow (Stop following while following them) and each agent with "no view to follow". An
 * action closes the sheet. Theme tokens only.
 *
 * @param props - The people and the close handler.
 * @returns The sheet; nothing on a board without presence.
 */
export function PresencePeopleSheet(props: PresencePeopleSheetProps): ReactElement | null {
  const { people, onClose } = props;
  const controller = useFollowController();
  const view = useFollowView(controller);
  if (controller === undefined) return null;
  const self = controller.self();
  const count = people.length + (self === undefined ? 0 : 1);
  const choose = (run: () => void) => () => {
    run();
    onClose();
  };
  return (
    <Dialog
      title={`On this board · ${String(count)}`}
      onClose={onClose}
      width="narrow"
      compact="sheet"
      isCloseIcon
    >
      <ul className={styles.rows} aria-label="People">
        {self === undefined ? null : (
          <li className={styles.row}>
            <PresenceAvatar
              person={{ ...self, principalId: self.id, initials: initialsOf(self.name) }}
              isDecorative
            />
            <span className={styles.name}>{self.name} (you)</span>
            {view.isSpotlighting ? (
              <Button
                kind="secondary"
                className={styles.action}
                onClick={choose(() => {
                  controller.endSpotlight();
                })}
              >
                End spotlight
              </Button>
            ) : view.canSpotlight ? (
              <Button
                kind="primary"
                className={styles.action}
                onClick={choose(() => {
                  controller.startSpotlight();
                })}
              >
                Spotlight me
              </Button>
            ) : (
              <span className={styles.detail}>Only editors and the owner can spotlight</span>
            )}
          </li>
        )}
        {people.map((person) => (
          <PersonRow key={person.principalId} person={person} choose={choose} />
        ))}
      </ul>
    </Dialog>
  );
}

/**
 * One collaborator's row: Follow, Stop following, or why they cannot be followed.
 *
 * @param props - The person and the action wrapper that closes the sheet.
 * @param props.person - Who.
 * @param props.choose - Runs an action, then closes the sheet.
 * @returns The row.
 */
function PersonRow(props: {
  readonly person: PresencePerson;
  readonly choose: (run: () => void) => () => void;
}): ReactElement | null {
  const { person, choose } = props;
  const controller = useFollowController();
  const view = useFollowView(controller);
  if (controller === undefined) return null;
  const isFollowing =
    view.follow.kind === 'following' && view.follow.principalId === person.principalId;
  const canFollow = controller.canFollow(person.principalId);
  const name = person.kind === 'agent' ? `${person.name} (agent)` : person.name;
  return (
    <li className={styles.row}>
      <PresenceAvatar person={person} isDecorative />
      <span className={styles.name}>
        {name}
        {canFollow ? null : <span className={styles.detail}> · no view to follow</span>}
      </span>
      {isFollowing ? (
        <Button
          kind="secondary"
          className={styles.action}
          onClick={choose(() => {
            controller.stop('button');
          })}
        >
          Stop following
        </Button>
      ) : canFollow ? (
        <Button
          kind="secondary"
          className={styles.action}
          name={`Follow ${person.name}`}
          onClick={choose(() => {
            controller.follow(person.principalId);
          })}
        >
          Follow
        </Button>
      ) : null}
    </li>
  );
}
