import { useEffect, useRef, type ReactElement } from 'react';

import { MAX_FRAME_NAME_LENGTH } from '@canvas/tools';

import { isImeKey } from '../../shortcuts/ime-key.js';

import styles from './layers.module.css';

/** Props of {@link LayerNameInput}. */
export interface LayerNameInputProps {
  /** The name the input starts with. */
  readonly name: string;
  /** Ends the edit: the new name to commit, or undefined to cancel (Escape, or unchanged). */
  readonly onDone: (name: string | undefined) => void;
}

/**
 * A layer row's name, edited in place: the way to rename a frame whose name is not
 * drawn on the canvas, so it has no title band to double-click. Focused, its text selected, on mount;
 * Enter or leaving it commits, Escape cancels, an unchanged name commits nothing. Its keys and
 * presses stay in it, so the tree's keys and the row's drag and click never see them. The name
 * is held to `MAX_FRAME_NAME_LENGTH` characters, as the canvas's name input holds it.
 *
 * @param props - The starting name and what ends the edit.
 * @returns The input.
 */
export function LayerNameInput(props: LayerNameInputProps): ReactElement {
  const { name, onDone } = props;
  const isDone = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // The edit starts from a double-click on the row: focus follows it, the name selected.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (next: string | undefined): void => {
    if (isDone.current) return;
    isDone.current = true;
    onDone(next === name ? undefined : next);
  };
  return (
    <input
      className={styles.nameInput}
      aria-label={`Rename ${name}`}
      defaultValue={name}
      maxLength={MAX_FRAME_NAME_LENGTH}
      ref={input}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (isImeKey(event.nativeEvent)) return;
        if (event.key === 'Enter') finish(event.currentTarget.value);
        else if (event.key === 'Escape') finish(undefined);
      }}
      onBlur={(event) => {
        finish(event.currentTarget.value);
      }}
    />
  );
}
