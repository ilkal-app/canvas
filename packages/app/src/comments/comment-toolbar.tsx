import type { ReactElement } from 'react';

import { DockButton } from '../toolbar/dock-button.js';

import { useCommentMode } from './comment-context.js';

/** Props of {@link CommentTool}. */
export interface CommentToolProps {
  /** Whether the comment button is available (`TOOL_AVAILABILITY.comment`). */
  readonly isAvailable: boolean;
  /** Whether it is in the compact bottom bar: a 48 px target. False if absent. */
  readonly isCompact?: boolean | undefined;
}

/**
 * The dock's comment button (placement since), last in every board mode's dock:
 * pressed while the next canvas click places a comment, and a press toggles that. Only on the
 * site, for a member who may write comments; nothing otherwise (the standalone shell has no
 * threads, and a viewer cannot comment).
 *
 * @param props - Its availability.
 * @returns The button for writers, or nothing.
 */
export function CommentTool(props: CommentToolProps): ReactElement | null {
  const mode = useCommentMode();
  if (!mode?.canWrite) return null;
  return (
    <DockButton
      label="Comment"
      icon="comment"
      hint={undefined}
      isPressed={mode.isPlacing}
      isAvailable={props.isAvailable}
      isCompact={props.isCompact}
      onSelect={() => {
        mode.setPlacing(!mode.isPlacing);
      }}
    />
  );
}
