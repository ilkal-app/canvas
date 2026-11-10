import { useId, useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from 'react';

import { Icon } from '../icons/icon.js';
import type { Member } from '../service/board-people.js';
import { isImeKey } from '../shortcuts/ime-key.js';

import styles from './comments.module.css';

/** The longest message the comments service takes, in code points. */
const MESSAGE_LIMIT = 5000;

/** From how many code points the composer shows the count against the limit. */
const COUNT_FROM = 4500;

/** Composer input and confirmed member mentions. */
export interface CommentComposerProps {
  /** Current board members. */
  readonly members: readonly Member[];
  /** Whether a request is running. */
  readonly isBusy: boolean;
  /** The field's placeholder: "Add a comment…" for a new thread, "Reply…" otherwise. */
  readonly placeholder: string;
  /** Posts without losing the text if the request fails. */
  readonly onPost: (text: string, mentions: readonly string[]) => Promise<void>;
}

/**
 * The card's reply field (Figma `Comment/Composer`): one line that grows with its text,
 * Enter sends and Shift+Enter adds a line, the send button named "Post". Typing "@" offers the
 * board's members; the count against the 5,000 code-point limit shows from 4,500. The text stays
 * when a post fails, and focus stays in the field after one succeeds.
 *
 * @param props - Member choices, placeholder and post action.
 * @returns The form.
 */
export function CommentComposer(props: CommentComposerProps): ReactElement {
  const { members, isBusy, placeholder, onPost } = props;
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<readonly Member[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const length = Array.from(text).length;
  const hasPicker = /@[^@\s]*$/.test(text);
  const canPost = !isBusy && text.trim() !== '' && length <= MESSAGE_LIMIT;
  useGrowingField(input, text);
  const post = (): void => {
    if (!canPost) return;
    void onPost(
      text,
      mentions.filter((member) => text.includes(`@${member.name}`)).map((member) => member.userId),
    )
      .then(() => {
        setText('');
        setMentions([]);
        input.current?.focus();
      })
      .catch(() => undefined);
  };
  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        post();
      }}
    >
      <div className={styles.field}>
        <label className={styles.visuallyHidden} htmlFor={fieldId}>
          Message
        </label>
        <textarea
          ref={input}
          id={fieldId}
          value={text}
          rows={1}
          placeholder={placeholder}
          aria-describedby="comment-limit"
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || isImeKey(event.nativeEvent)) return;
            event.preventDefault();
            post();
          }}
        />
        <button type="submit" className={styles.send} aria-label="Post" disabled={!canPost}>
          <Icon name="send" />
        </button>
      </div>
      <small id="comment-limit" aria-live="polite" className={styles.limit}>
        {length >= COUNT_FROM ? `${length.toLocaleString()} / 5,000 characters` : ''}
      </small>
      {hasPicker && (
        <MemberPicker
          members={members}
          onPick={(member) => {
            setText(text.replace(/@[^@\s]*$/, `@${member.name} `));
            setMentions((previous) => [
              ...previous.filter((entry) => entry.userId !== member.userId),
              member,
            ]);
            input.current?.focus();
          }}
        />
      )}
    </form>
  );
}

/**
 * The members "@" offers: a listbox with an option per board member, by name.
 *
 * @param props - The members and what a choice does.
 * @param props.members - Board members.
 * @param props.onPick - Writes the chosen member into the message.
 * @returns The listbox.
 */
function MemberPicker(props: {
  readonly members: readonly Member[];
  readonly onPick: (member: Member) => void;
}): ReactElement {
  return (
    <div role="listbox" aria-label="Members" className={styles.members}>
      {props.members.map((member) => (
        <button
          key={member.userId}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => {
            props.onPick(member);
          }}
        >
          {member.name}
        </button>
      ))}
    </div>
  );
}

/**
 * Grows the field with its text: one line empty, up to the stylesheet's maximum height.
 *
 * @param input - The field.
 * @param text - Its text, so the height follows each change.
 */
function useGrowingField(input: RefObject<HTMLTextAreaElement | null>, text: string): void {
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${String(field.scrollHeight)}px`;
  }, [input, text]);
}
