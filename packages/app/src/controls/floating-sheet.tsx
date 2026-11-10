import {
  type AriaRole,
  type CSSProperties,
  type KeyboardEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

import styles from './floating-sheet.module.css';

/**
 * The shapes a {@link FloatingSheet} takes: `toolbar`, a 40 px row with 8 px corners (the
 * properties popover, the tool panels); `bar`, a 44 px row with 6 px corners (the board bar, the
 * bars at the top right); `stack`, a column of rows with 8 px corners (menus, lists). On a touch
 * screen the rows grow to 48 px.
 */
export type FloatingSheetShape = 'toolbar' | 'bar' | 'stack';

/** Props of {@link FloatingSheet}. */
export interface FloatingSheetProps {
  /** Its shape; `toolbar` if absent. */
  readonly shape?: FloatingSheetShape | undefined;
  /** Its role, if it has one (`toolbar`, `dialog`, `menu`, `group`). */
  readonly role?: AriaRole | undefined;
  /** Its accessible name, when it has a role. */
  readonly label?: string | undefined;
  /** Its element's id. */
  readonly id?: string | undefined;
  /** Where it sits, when it floats (an anchored popover's position). */
  readonly style?: CSSProperties | undefined;
  /** More class names, for the feature's own layout. */
  readonly className?: string | undefined;
  /** Its keys. */
  readonly onKeyDown?: KeyboardEventHandler<HTMLDivElement> | undefined;
  /** More attributes for tests and styles: `data-side` and the like. */
  readonly dataAttributes?: Readonly<Record<`data-${string}`, string>> | undefined;
  /** Receives its element. */
  readonly ref?: Ref<HTMLDivElement> | undefined;
  /** Its contents. */
  readonly children: ReactNode;
}

/**
 * The floating sheet every surface of the whiteboard's chrome is made of (the design
 * board's Whiteboard page): the sheet surface with a hairline edge and the Float shadow of the
 * theme, in one of three shapes ({@link FloatingSheetShape}). Light and dark come from the theme
 * tokens only. It draws the sheet; where it sits and what opens it are its owner's
 * (`AnchoredPopover`, the bars).
 *
 * @param props - Its shape, role, name, contents and ref.
 * @returns The sheet.
 */
export function FloatingSheet(props: FloatingSheetProps): ReactElement {
  const className =
    props.className === undefined ? styles.sheet : `${styles.sheet ?? ''} ${props.className}`;
  return (
    <div
      ref={props.ref}
      id={props.id}
      role={props.role}
      aria-label={props.label}
      className={className}
      style={props.style}
      data-floating-sheet=""
      data-shape={props.shape ?? 'toolbar'}
      onKeyDown={props.onKeyDown}
      {...props.dataAttributes}
    >
      {props.children}
    </div>
  );
}
