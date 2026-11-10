import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { ToastHost, ToastRegionBoundary } from '../feedback/toast-region.js';
import { Icon } from '../icons/icon.js';
import { isImeKey } from '../shortcuts/ime-key.js';

import styles from './dialog.module.css';

/**
 * How wide a {@link Dialog} is: `wide` for a reference sheet, `narrow` for a form, `gallery` for
 * a picker of cards (the New board dialog's templates: 840 × 640 px).
 */
export type DialogWidth = 'wide' | 'narrow' | 'gallery';

/**
 * How a {@link Dialog} shows below 768 px wide: `sheet`, a sheet risen from the bottom
 * edge, the full width (MS3); `page`, the whole of its container, where an element of its content
 * marked `data-dialog-actions` (its own Cancel, or Close) takes the head's place and Close hides
 * (MS4). Wider, either is the centred dialog.
 */
export type DialogCompact = 'sheet' | 'page';

/** Props of {@link Dialog}. */
export interface DialogProps {
  /** The title: the dialog's `h2`, which names it. */
  readonly title: string;
  /** Called when the person dismisses the dialog (Escape, Close, the backdrop). */
  readonly onClose: () => void;
  /** The content under the title. */
  readonly children: ReactNode;
  /** A key besides Escape that closes the dialog (the cheat sheet's own shortcut); none if absent. */
  readonly isCloseKey?: (event: KeyboardEvent<HTMLElement>) => boolean;
  /** What takes focus when the dialog opens; its Close button if absent. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /** Its width; `wide` if absent. */
  readonly width?: DialogWidth;
  /** How it shows below 768 px wide; the centred dialog, as wider, if absent. */
  readonly compact?: DialogCompact;
  /**
   * The id of the element in its content that describes it (`aria-describedby`), so a screen
   * reader reads it with the title as the dialog opens; none if absent.
   */
  readonly describedById?: string;
  /**
   * Close as a 28 px × icon button, named "Close", with no line under the head (the redesigned
   * share dialog); the text button if absent. A narrow dialog with it takes the
   * redesign's shape too: 480 px wide, a 56 px head.
   */
  readonly isCloseIcon?: boolean;
  /**
   * The icon close's accessible name and tooltip ("Close board settings", item 7);
   * "Close" if absent.
   */
  readonly closeName?: string | undefined;
  /** What the head shows between the title and Close (the templates' search); none if absent. */
  readonly headerContent?: ReactNode;
}

/** What Tab moves between: enabled controls, links and elements put in the tab order. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex="0"]';

/**
 * Whether an element is rendered, so Tab can reach it: not under `display: none`, as the
 * page form's Close is on a phone. True where the platform cannot say.
 *
 * @param element - The element.
 * @returns Whether it is rendered.
 */
function isRendered(element: HTMLElement): boolean {
  return typeof element.checkVisibility !== 'function' || element.checkVisibility();
}

/**
 * Moves focus between the dialog's first and last focusable elements so Tab stays inside it,
 * including when the dialog itself has focus after a click on its dead space. Elements not
 * rendered are skipped.
 *
 * @param event - The Tab key event (React's, or the page's from the toast region).
 * @param dialog - The dialog element.
 */
function keepFocusInside(
  event: Pick<globalThis.KeyboardEvent, 'shiftKey' | 'preventDefault'>,
  dialog: HTMLElement,
): void {
  const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isRendered);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || active === dialog)) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Moves focus into a dialog when it opens and back where it was when it closes. Where focus
 * was is read once, while rendering, not in the effect: Strict Mode runs an effect twice
 * (mount, cleanup, mount); the first cleanup cannot focus the earlier element, which sits in
 * the now `inert` shell, so the second run read the dialog's own button, still focused, and
 * focus never came back (tooling/scenario/specs/app/cheat-sheet.spec.ts).
 *
 * @param initialFocusRef - The element to focus when the dialog opens.
 */
function useFocusWhileOpen(initialFocusRef: RefObject<HTMLElement | null>): void {
  const [focusBeforeOpen] = useState(() => document.activeElement);
  useEffect(() => {
    initialFocusRef.current?.focus();
    return () => {
      if (focusBeforeOpen instanceof HTMLElement) focusBeforeOpen.focus();
    };
  }, [initialFocusRef, focusBeforeOpen]);
}

/**
 * Keeps focus inside a dialog when the focused element goes away (a row removed with its
 * button) or loses focus to the body (a control disabled while its action runs): Escape and
 * the Tab trap would not reach the dialog from the body, so the dialog takes focus itself. It
 * checks when its content changes and when focus leaves for nowhere, and again on the next
 * animation frame, since a browser's focus fix-up for a disabled control comes after the
 * observer's microtask.
 *
 * @param dialogRef - The dialog element.
 */
function useFocusKept(dialogRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    let frame: number | undefined;
    const keep = (): void => {
      const active = document.activeElement;
      const isLost = active === null || active === document.body || !dialog.contains(active);
      if (dialog.isConnected && isLost) dialog.focus();
    };
    const keepOnNextFrame = (): void => {
      frame ??= requestAnimationFrame(() => {
        frame = undefined;
        keep();
      });
    };
    const observer = new MutationObserver(() => {
      keep();
      keepOnNextFrame();
    });
    observer.observe(dialog, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    const onFocusOut = (event: FocusEvent): void => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !dialog.contains(next)) keepOnNextFrame();
    };
    dialog.addEventListener('focusout', onFocusOut);
    return () => {
      observer.disconnect();
      dialog.removeEventListener('focusout', onFocusOut);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [dialogRef]);
}

/**
 * Escape and Tab from the toast region while it shows inside the dialog (`ToastHost`). The region
 * is a portal from outside the dialog's React tree, so a key pressed on a toast's button reaches
 * the dialog's element in the page but never its React `onKeyDown`: this native listener closes
 * the dialog on Escape (once for a held key) and keeps Tab inside it, as `onKeyDown` does for the
 * rest of its content, and stops the key there, so no page listener hears it.
 *
 * @param dialogRef - The dialog element.
 * @param onClose - Closes the dialog.
 */
function useToastHostKeys(dialogRef: RefObject<HTMLElement | null>, onClose: () => void): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      const { target } = event;
      if (!(target instanceof Element) || target.closest('[data-toast-host]') === null) return;
      event.stopPropagation();
      if (event.key === 'Escape' && !isImeKey(event)) {
        event.preventDefault();
        if (!event.repeat) closeRef.current();
      } else if (event.key === 'Tab') {
        keepFocusInside(event, dialog);
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
    };
  }, [dialogRef]);
}

/**
 * A modal dialog over its positioned container, with a backdrop: `role="dialog"`,
 * `aria-modal`, named by its title (an `h2`), and a Close button. Focus moves into it on open
 * (its Close button, or `initialFocusRef`), stays inside it (Tab and Shift+Tab wrap), and
 * returns where it was on close; when the focused element goes away, or a disabled control
 * drops it to the body, the dialog takes focus itself (at once, and again on the next frame). Escape (once for a held key), `isCloseKey`, Close and a press
 * on the backdrop close it. It owns the keyboard: no key pressed inside it reaches the page's
 * own listeners (the canvas's shortcuts on `window`). Below 768 px wide it can show as a sheet
 * from the bottom edge or as the whole page (`compact`). The caller makes the rest of the page
 * `inert` while it is open; so the toast region shows inside it meanwhile, at its foot
 * (`ToastHost`, item 4), its toasts' actions inside the focus trap and the modal subtree.
 * Shown with no region above (on its own), it makes its own (`ToastRegionBoundary`).
 *
 * @param props - The title, the close handler, the content and the options.
 * @returns The dialog and its backdrop.
 */
export function Dialog(props: DialogProps): ReactElement {
  const { title, onClose, children, isCloseKey, initialFocusRef, width = 'wide', compact } = props;
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useFocusWhileOpen(initialFocusRef ?? closeRef);
  useFocusKept(dialogRef);
  useToastHostKeys(dialogRef, onClose);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if ((event.key === 'Escape' || isCloseKey?.(event) === true) && !isImeKey(event.nativeEvent)) {
      event.preventDefault();
      // A held key auto-repeats; only the first press closes.
      if (!event.repeat) onClose();
    } else if (event.key === 'Tab' && dialogRef.current !== null) {
      keepFocusInside(event, dialogRef.current);
    }
  };

  return (
    <ToastRegionBoundary>
      <div
        className={styles.backdrop}
        data-compact={compact}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={props.describedById}
          className={styles.dialog}
          data-width={width}
          data-compact={compact}
          data-close={props.isCloseIcon === true ? 'icon' : undefined}
          // Focusable by script and click only: a click on dead space keeps focus (and so Escape
          // and the Tab trap) inside the dialog instead of dropping it to the body.
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          <header
            className={styles.header}
            data-close={props.isCloseIcon === true ? 'icon' : undefined}
            data-width={width}
          >
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {props.headerContent}
            {props.isCloseIcon === true ? (
              <button
                ref={closeRef}
                type="button"
                className={styles.closeIcon}
                aria-label={props.closeName ?? 'Close'}
                title={props.closeName ?? 'Close'}
                onClick={onClose}
              >
                <Icon name="close" />
              </button>
            ) : (
              <button ref={closeRef} type="button" className={styles.close} onClick={onClose}>
                Close
              </button>
            )}
          </header>
          {children}
          <ToastHost />
        </div>
      </div>
    </ToastRegionBoundary>
  );
}
