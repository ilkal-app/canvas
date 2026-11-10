import type { ReactElement } from 'react';

import type { Message } from './comment-api.js';
import styles from './comments.module.css';

/**
 * Who wrote a message, in its meta line: the person's name; or an agent's name, an "Agent" badge
 * and "for <operator>", so an agent's words are never taken for a person's.
 *
 * @param props - The message.
 * @param props.message - Its author fields.
 * @returns The name and, for an agent, its badge and operator.
 */
export function CommentAuthor(props: { readonly message: Message }): ReactElement {
  const { message } = props;
  return (
    <>
      <strong>{message.authorName}</strong>
      {message.authorKind === 'agent' && (
        <>
          <span className={styles.agentBadge}>Agent</span>
          {message.operatorName != null && (
            <span className={styles.operator}>for {message.operatorName}</span>
          )}
        </>
      )}
    </>
  );
}
