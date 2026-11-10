import type { ReactElement } from 'react';

import { Icon } from '../icons/icon.js';

import { avatarColorsOf } from './avatar-colors.js';
import type { PresencePerson } from './presence-people.js';
import styles from './presence-share-bar.module.css';

/**
 * One person's or agent's avatar: a person's initials on their presence colour (no picture; the
 * colour lightened or darkened only as far as the initials' legibility needs, `avatarColorsOf`),
 * an agent's mark in the agent colour, dashed. Its name is its accessible name and its tooltip.
 *
 * @param props - The entry.
 * @param props.person - Who it shows.
 * @param props.isDecorative - Whether something beside it already names them (the "+N" list).
 * @returns The avatar.
 */
export function PresenceAvatar(props: {
  readonly person: PresencePerson;
  readonly isDecorative?: boolean;
}): ReactElement {
  const { person, isDecorative = false } = props;
  const isAgent = person.kind === 'agent';
  const who = isAgent ? `${person.name}, agent` : person.name;
  const name = person.pageName === undefined ? who : `${who}, on ${person.pageName}`;
  const naming = isDecorative
    ? { 'aria-hidden': true as const }
    : { role: 'img', 'aria-label': name, title: name };
  if (isAgent) {
    return (
      <span className={styles.agent} data-kind="agent" {...naming}>
        <Icon name="agent" />
      </span>
    );
  }
  const { fill, ink } = avatarColorsOf(person.color);
  return (
    <span
      className={styles.avatar}
      data-kind="user"
      data-ink={ink}
      // The colour is data (the person's presence colour), so it is set here, not in the sheet.
      style={{ backgroundColor: fill }}
      {...naming}
    >
      {person.initials}
    </span>
  );
}
