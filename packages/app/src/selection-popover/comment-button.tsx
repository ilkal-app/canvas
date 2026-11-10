import { useContext, type ReactElement } from 'react';

import type { BoardObject } from '@canvas/schema';

import { commentDataContext } from '../comments/comment-data-context.js';
import { commentPlacement } from '../comments/comment-placement.js';
import { editedBoundsOf } from '../editing/text-bar-model.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { Icon } from '../icons/icon.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import styles from './selection-popover.module.css';

/** Props of {@link CommentButton}. */
export interface CommentButtonProps {
  /** The engine, once it runs. */
  readonly engine: MountedEngine | undefined;
  /** The selected objects, primary first: the comment goes on the primary one. */
  readonly selection: readonly BoardObject[];
  /** The theme, which colour tokens are hit in. */
  readonly themeName: ThemeName;
}

/**
 * The popover's Comment button: opens a first-message composer for a pin on the
 * primary selected object, at its centre (as a comment-tool click there would place it). Only
 * where comments run (a signed-in board); nothing elsewhere. Opening it opens a thread, so the
 * popover closes and the selection clears (the owner's rule: never both).
 *
 * @param props - The engine, the selection and the theme.
 * @returns The button, or nothing outside a signed-in board.
 */
export function CommentButton(props: CommentButtonProps): ReactElement | null {
  const data = useContext(commentDataContext);
  const { engine } = props;
  const primary = props.selection[0];
  if (data === undefined || engine === undefined || primary === undefined) return null;
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label="Comment"
      onClick={() => {
        const bounds = editedBoundsOf(engine.board.board, primary.id);
        if (bounds === undefined) return;
        const point = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
        const board = data.connection.store.read();
        const page = engine.pages?.current();
        data.place(commentPlacement(board, point, engine.camera().zoom, props.themeName, page));
      }}
    >
      <Icon name="comment" />
    </button>
  );
}
