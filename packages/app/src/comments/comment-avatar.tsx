import type { ReactElement } from 'react';

import { colorForPrincipal } from '@canvas/collab';

import { avatarColorsOf } from '../collab/avatar-colors.js';
import { initialsOf } from '../collab/presence-people.js';
import { Icon } from '../icons/icon.js';

import styles from './comments.module.css';

/**
 * A comment author's avatar (Figma `Comment/Avatar`, 20 px): their initials on their
 * presence colour (`colorForPrincipal` of their user id, as the presence bar and the share
 * dialog draw people), lightened or darkened as far as the initials' legibility needs
 * (`avatarColorsOf`). Decorative: the message or the pin names them.
 *
 * An agent's message shows the presence bar's agent mark instead, named
 * "<agent>, agent" so the kind of author is announced, not only drawn.
 *
 * @param props - Who it shows.
 * @param props.userId - Their user id (any stable key for an agent).
 * @param props.name - Their display name.
 * @param props.kind - A person (default), an agent, or a guest, drawn as a person.
 * @returns The avatar.
 */
export function CommentAvatar(props: {
  readonly userId: string;
  readonly name: string;
  readonly kind?: 'user' | 'agent' | 'guest';
}): ReactElement {
  if (props.kind === 'agent') {
    const label = `${props.name}, agent`;
    return (
      <span className={styles.avatar} data-kind="agent" role="img" aria-label={label} title={label}>
        <Icon name="agent" />
      </span>
    );
  }
  const { fill, ink } = avatarColorsOf(colorForPrincipal(props.userId));
  return (
    <span
      className={styles.avatar}
      data-ink={ink}
      // The colour is data (the person's presence colour), so it is set here, not in the sheet.
      style={{ backgroundColor: fill }}
      aria-hidden="true"
    >
      {initialsOf(props.name)}
    </span>
  );
}
