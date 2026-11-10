import type { CSSProperties, ReactElement } from 'react';

import styles from './skeleton.module.css';

/** Props of {@link Skeleton}. */
export interface SkeletonProps {
  /** Its width: CSS px as a number, or any CSS length (`60%`); else its class's or the line's. */
  readonly width?: number | string | undefined;
  /** Its height: CSS px as a number, or any CSS length; else its class's. */
  readonly height?: number | string | undefined;
  /** `bar` for a line of text (the control's 4 px corners), `block` for a picture (6 px). */
  readonly shape?: 'bar' | 'block';
  /** Whether it sits in a line of text, centred on it, rather than on a line of its own. */
  readonly isInline?: boolean;
  /** Its placement and size from the screen that shows it (a margin, an aspect ratio). */
  readonly className?: string | undefined;
}

/**
 * The shared Skeleton (Figma 35:1768; UI-18): a static bar or block on the raised surface that
 * stands where content will load, no shimmer and no motion. Sized by its props or by the
 * screen's class. Hidden from assistive technology: the screen's own status says what loads.
 *
 * @param props - Its size, shape and placement.
 * @returns The skeleton.
 */
export function Skeleton(props: SkeletonProps): ReactElement {
  const style: CSSProperties = {};
  if (props.width !== undefined) style.width = props.width;
  if (props.height !== undefined) style.height = props.height;
  return (
    <span
      className={[styles.skeleton, props.className].filter(Boolean).join(' ')}
      data-shape={props.shape ?? 'bar'}
      data-inline={props.isInline === true ? '' : undefined}
      style={style}
      aria-hidden="true"
    />
  );
}
