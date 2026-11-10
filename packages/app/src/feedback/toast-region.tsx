import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { useDockClearance, useToastEscape } from './toast-placement.js';
import {
  isDismissibleToast,
  toastRole,
  ToastRegionStore,
  type RegionEntry,
  type RegionToast,
  type ToastTarget,
  type ToastTargetKind,
} from './toast-region-store.js';
import styles from './toast-region.module.css';
import { Toast, type ToastContent } from './toast.js';

/** The region of the provider above, if any. */
const ToastRegionContext = createContext<ToastRegionStore | undefined>(undefined);

/**
 * The toast region a part of the app posts to.
 *
 * @returns The region's store.
 * @throws {Error} When no {@link ToastRegionProvider} (or boundary) is above: a toast posted
 *   there would show nowhere.
 */
export function useToastRegion(): ToastRegionStore {
  const store = useContext(ToastRegionContext);
  if (store === undefined) throw new Error('useToastRegion: no ToastRegionProvider above');
  return store;
}

/**
 * Shows a toast in the one region while it is posted (item 4): from the first render
 * that gives one until a render gives undefined or the component unmounts. Posting the same
 * toast again changes nothing, so a toast keeps its place and its time across renders; a new
 * sentence, kind or key shows it anew, as the newest. Its handlers are always the latest. With
 * no {@link ToastRegionProvider} above (a part of the app shown on its own, in a test or an
 * embed), the toast is shown in place instead, in a minimal region of its own with the same
 * role, words, action, Dismiss, name and time: the poster renders what this returns.
 *
 * @param toast - The toast, or undefined while there is none.
 * @returns Nothing inside a provider (the region shows it); without one, the toast in place,
 *   for the poster to render.
 */
export function useToast(toast: RegionToast | undefined): ReactElement | null {
  const outer = useContext(ToastRegionContext);
  // A poster's own region, used only while no provider is above it.
  const [own] = useState(() => new ToastRegionStore());
  const store = outer ?? own;
  const [id] = useState(() => store.newId());
  useLayoutEffect(() => {
    store.post(id, toast);
  });
  useLayoutEffect(
    () => () => {
      store.post(id, undefined);
    },
    [store, id],
  );
  return outer === undefined ? <StandaloneToasts store={own} /> : null;
}

/**
 * The toasts of a poster with no region above, in place: the region's stack and toasts, with no
 * place to move to, no dock to clear and no Escape of its own.
 *
 * @param props - The poster's own store.
 * @param props.store - The store.
 * @returns The toasts, or nothing while there is none.
 */
function StandaloneToasts(props: { readonly store: ToastRegionStore }): ReactElement | null {
  const { store } = props;
  const { entries } = useSyncExternalStore(store.subscribe, store.snapshot);
  if (entries.length === 0) return null;
  return (
    <div className={styles.stack} data-toast-region="" data-toast-standalone="">
      {entries.map((entry) => (
        <RegionToastItem key={entry.id} entry={entry} store={store} />
      ))}
    </div>
  );
}

/**
 * Adds an element as a place for the region's toasts while it is mounted.
 *
 * @param ref - The element.
 * @param kind - What kind of place it is.
 */
function useToastTarget(ref: RefObject<HTMLElement | null>, kind: ToastTargetKind): void {
  const store = useToastRegion();
  useLayoutEffect(() => {
    const element = ref.current;
    return element === null ? undefined : store.addTarget(element, kind);
  }, [store, ref, kind]);
}

/** Props of {@link ToastHome}. */
export interface ToastHomeProps {
  /** `home` for a shell's place; `default` for the provider's own. `home` if absent. */
  readonly kind?: 'home' | 'default';
}

/**
 * A place for the region's toasts over the bottom centre of its positioned container (a
 * shell's, or the page), clearing the registered dock (`useToastDock`) by a spacing step, with
 * the newest toast nearest it. A shell puts one outside its `inert` layout, so its toasts stay
 * live while the layout is not; an open dialog's place comes first ({@link ToastHost}).
 *
 * @param props - What kind of place it is.
 * @returns The place.
 */
export function ToastHome(props: ToastHomeProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useToastTarget(ref, props.kind ?? 'home');
  return <div ref={ref} className={styles.home} data-toast-home={props.kind ?? 'home'} />;
}

/**
 * The open dialog's place for the region's toasts (`Dialog` puts one at its foot): while it is
 * mounted the whole region shows inside the dialog, so its toasts' actions (Retry) are inside
 * the dialog's focus trap and `aria-modal` subtree, reachable while the page behind is `inert`.
 *
 * @returns The place.
 */
export function ToastHost(): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useToastTarget(ref, 'modal');
  return <div ref={ref} className={styles.host} data-toast-host="" />;
}

/**
 * Registers the dock the region's home clears (the shell's dock).
 *
 * @param ref - The dock.
 */
export function useToastDock(ref: RefObject<HTMLElement | null>): void {
  const store = useContext(ToastRegionContext);
  useLayoutEffect(() => {
    const dock = ref.current;
    if (store === undefined || dock === null) return undefined;
    store.setDock(dock);
    return () => {
      store.setDock(undefined);
    };
  }, [store, ref]);
}

/**
 * One toast of the region. Its live region is mounted empty, then filled, so a screen reader
 * announces the sentence as it arrives; once per posting: a toast mounted again with a posting
 * already shown (the region moved) shows it at once. Its time is the store's (`ToastRegionStore`),
 * so the Toast component's own timer is off.
 *
 * @param props - The entry and the store.
 * @param props.entry - The toast.
 * @param props.store - The region.
 * @returns The toast.
 */
function RegionToastItem(props: {
  readonly entry: RegionEntry;
  readonly store: ToastRegionStore;
}): ReactElement {
  const { entry, store } = props;
  const [content, setContent] = useState<ToastContent | undefined>(() =>
    store.wasAnnounced(entry.content) ? entry.content : undefined,
  );
  useEffect(() => {
    store.markAnnounced(entry.content);
    setContent(entry.content);
  }, [store, entry.content]);
  const shown = useMemo(
    () => (content === undefined ? undefined : { ...content, isTimed: false }),
    [content],
  );
  const onDismiss = isDismissibleToast(entry.toast)
    ? () => {
        store.dismiss(entry.id);
      }
    : undefined;
  return (
    <Toast
      role={toastRole(entry.toast.kind)}
      label={entry.toast.label}
      toast={shown}
      onDismiss={onDismiss}
    />
  );
}

/**
 * Keeps the region's one stack element in its place: inside the place that comes first while
 * there is a toast, out of the page while there is none (so an empty dialog foot takes no room).
 * The element is moved, never made anew, so its toasts keep their elements, their focus aside,
 * across a dialog opening and closing.
 *
 * @param stack - The stack element.
 * @param target - Where the region shows.
 * @param hasToasts - Whether there is a toast.
 */
function useStackPlace(
  stack: HTMLElement,
  target: ToastTarget | undefined,
  hasToasts: boolean,
): void {
  useLayoutEffect(() => {
    const place = hasToasts ? target?.element : undefined;
    if (place === undefined) {
      stack.remove();
      return;
    }
    if (stack.parentElement !== place) place.append(stack);
  }, [stack, target, hasToasts]);
  useLayoutEffect(
    () => () => {
      stack.remove();
    },
    [stack],
  );
}

/**
 * The region itself: every posted toast, oldest first so the newest is nearest the dock, in the
 * place that comes first (an open dialog's, a shell's home, the provider's own), with Escape
 * dismissing the newest and the home clearing the dock while there is a toast. The toasts are
 * rendered once, into one stack element that moves between places (`useStackPlace`), so moving
 * neither remounts nor announces them again, and their time runs on in the store.
 *
 * @param props - The store.
 * @param props.store - The region.
 * @returns The toasts, rendered into the stack element.
 */
function ToastStack(props: { readonly store: ToastRegionStore }): ReactElement {
  const { store } = props;
  const { entries, target, dock } = useSyncExternalStore(store.subscribe, store.snapshot);
  const [stack] = useState(() => {
    const element = document.createElement('div');
    element.className = styles.stack ?? '';
    element.setAttribute('data-toast-region', '');
    return element;
  });
  const hasToasts = target !== undefined && entries.length > 0;
  useStackPlace(stack, target, hasToasts);
  useToastEscape(store, target !== undefined && target.kind !== 'modal');
  useDockClearance(target, hasToasts ? dock : undefined);
  return createPortal(
    entries.map((entry) => <RegionToastItem key={entry.id} entry={entry} store={store} />),
    stack,
  );
}

/** Props of {@link ToastRegionProvider} and {@link ToastRegionBoundary}. */
export interface ToastRegionProviderProps {
  /** What may post toasts. */
  readonly children?: ReactNode;
}

/**
 * The single toast region (UI-18, item 4): what its children post with
 * {@link useToast} (the shell's notice, the board's conditions, the dialogs' and pages'
 * toasts) shows here through the shared `Toast`, polite for Info and Success and assertive for
 * an Error, for as long as its kind says (`toastLifetimeMs`). It shows in its own place after
 * its children unless a shell gives it a home ({@link ToastHome}) or a dialog is open
 * ({@link ToastHost}).
 *
 * @param props - Its children.
 * @returns The provider, its children and the region.
 */
export function ToastRegionProvider(props: ToastRegionProviderProps): ReactElement {
  const [store] = useState(() => new ToastRegionStore());
  return (
    <ToastRegionContext.Provider value={store}>
      {props.children}
      <ToastHome kind="default" />
      <ToastStack store={store} />
    </ToastRegionContext.Provider>
  );
}

/**
 * The region of the provider above, or a new one when there is none (a shell or a dialog shown
 * on its own, as in a test or an embed), so there is always exactly one region per page.
 *
 * @param props - Its children.
 * @returns The children, in a region.
 */
export function ToastRegionBoundary(props: ToastRegionProviderProps): ReactElement {
  const outer = useContext(ToastRegionContext);
  if (outer !== undefined) return <>{props.children}</>;
  return <ToastRegionProvider>{props.children}</ToastRegionProvider>;
}

/** Props of {@link PostedToast}. */
export interface PostedToastProps {
  /** What it shows (the shared Toast's content), or undefined while there is nothing. */
  readonly toast: ToastContent | undefined;
  /** Takes it away (Dismiss, Escape, its time); none if absent. */
  readonly onDismiss?: (() => void) | undefined;
  /** Whether it states a condition that stays while posted (`RegionToast.isPersistent`). */
  readonly isPersistent?: boolean | undefined;
  /** Its live region's accessible name; unnamed if absent. */
  readonly label?: string | undefined;
}

/**
 * Posts a toast to the region where a part of the app rendered a `Toast` in place before
 * (item 4): the dialogs' and the settings page's. Its time follows its kind
 * (`toastLifetimeMs`), not `isTimed`. Renders nothing in place inside a region (`useToast`).
 *
 * @param props - The toast and its handlers.
 * @returns Nothing inside a region; without one, the toast in place.
 */
export function PostedToast(props: PostedToastProps): ReactElement | null {
  const { toast } = props;
  return useToast(
    toast === undefined
      ? undefined
      : {
          kind: toast.kind,
          message: toast.message,
          action: toast.action,
          label: props.label,
          onDismiss: props.onDismiss,
          isPersistent: props.isPersistent,
        },
  );
}
