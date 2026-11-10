import { useEffect, useRef, type RefObject } from 'react';

/** Receives a committed value and the input. */
type Commit = (value: string, input: HTMLInputElement) => void;

/**
 * Calls `onCommit` with an input's value on its native `change` event: when a colour picker
 * closes, a number field loses focus or takes Enter, or a spinner steps; not on every keystroke
 * or drag of the picker, as React's `onChange` would. So each committed value is one command and
 * one undo step, not one per `input` event.
 *
 * The commit goes to what the control showed while the person edited it: the `onCommit` current
 * when the input took focus or last took an `input` event (a picker's colour, a keystroke), not
 * a later one. A colour input's or a number field's `change` fires when it loses focus,
 * after the press that took the focus has run; a press on another object has selected it by
 * then, and the panel shows it, so the latest `onCommit` would apply the value to that object
 * instead. A change with no edit before it (a spinner, a test) takes the latest.
 *
 * @param ref - The input.
 * @param onCommit - Receives the committed value and the input.
 */
export function useCommittedChange(
  ref: RefObject<HTMLInputElement | null>,
  onCommit: Commit,
): void {
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });
  useEffect(() => {
    const input = ref.current;
    if (input === null) return undefined;
    let editedCommit: Commit | undefined;
    const onEdit = () => {
      editedCommit = commitRef.current;
    };
    const onChange = () => {
      const commit = editedCommit ?? commitRef.current;
      editedCommit = undefined;
      commit(input.value, input);
    };
    input.addEventListener('focus', onEdit);
    input.addEventListener('input', onEdit);
    input.addEventListener('change', onChange);
    return () => {
      input.removeEventListener('focus', onEdit);
      input.removeEventListener('input', onEdit);
      input.removeEventListener('change', onChange);
    };
  }, [ref]);
}
