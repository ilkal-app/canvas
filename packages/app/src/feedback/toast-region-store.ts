import {
  TOAST_DURATION_MS,
  type ToastAction,
  type ToastContent,
  type ToastKind,
  type ToastTone,
} from './toast.js';

/** A toast as a part of the app posts it to the region (`useToast`). */
export interface RegionToast {
  /** Its kind: Info, Success or Error (Figma 35:1785, Kind). */
  readonly kind: ToastKind;
  /** Its sentence, in the words the app has always used for it. */
  readonly message: string;
  /** Its action (Retry, Undo, Retry now, Sign in again), if any. */
  readonly action?: ToastAction | undefined;
  /** Its live region's accessible name ("Notice", "Board access"); unnamed if absent. */
  readonly label?: string | undefined;
  /** Its surface (`ToastTone`): the sheet if absent. */
  readonly tone?: ToastTone | undefined;
  /**
   * Called when the person dismisses it (its Dismiss, Escape) or its time runs out. With it the
   * toast offers Dismiss; a timed toast offers Dismiss even without it.
   */
  readonly onDismiss?: (() => void) | undefined;
  /**
   * Whether it states a condition (offline, view only, loading the people): it stays as long as
   * it is posted, whatever its kind, and never goes by itself. False if absent.
   */
  readonly isPersistent?: boolean | undefined;
  /**
   * What tells one posting of the same sentence from the next (the shell notice's sequence): a
   * new key shows it anew, newest and with its time restarted. None if absent.
   */
  readonly key?: string | number | undefined;
}

/**
 * How long a toast stays by itself (D-TOAST, decided by the owner on 2026-10-06): Info and
 * Success go after {@link TOAST_DURATION_MS}; an Error stays until dismissed or acted on; a
 * condition (`isPersistent`) stays until it clears. Pure.
 *
 * @param toast - The toast.
 * @returns Its lifetime, ms, or undefined when it does not go by itself.
 */
export function toastLifetimeMs(
  toast: Pick<RegionToast, 'kind' | 'isPersistent'>,
): number | undefined {
  if (toast.isPersistent === true || toast.kind === 'error') return undefined;
  return TOAST_DURATION_MS;
}

/**
 * The live region a toast speaks through: polite (`status`) for Info and Success, assertive
 * (`alert`) for an Error. Pure.
 *
 * @param kind - The toast's kind.
 * @returns Its role.
 */
export function toastRole(kind: ToastKind): 'status' | 'alert' {
  return kind === 'error' ? 'alert' : 'status';
}

/**
 * Whether the person can take a toast away (its Dismiss, Escape): one with a dismiss handler,
 * and every timed one. A condition with no dismiss handler (offline, a download kept) cannot be
 * dismissed, and neither can an action that deletes (the stranded edits' Dismiss is an action).
 * Pure.
 *
 * @param toast - The toast.
 * @returns Whether it can be dismissed.
 */
export function isDismissibleToast(
  toast: Pick<RegionToast, 'kind' | 'isPersistent' | 'onDismiss'>,
): boolean {
  return toast.onDismiss !== undefined || toastLifetimeMs(toast) !== undefined;
}

/**
 * Whether a toast posted again shows the same thing, so it keeps its place, its time and whether
 * it was dismissed; its handlers may differ (they are read when called). Pure.
 *
 * @param a - The toast shown.
 * @param b - The toast posted.
 * @returns Whether they are the same posting.
 */
export function isSamePosting(a: RegionToast, b: RegionToast): boolean {
  return (
    a.kind === b.kind &&
    a.message === b.message &&
    a.label === b.label &&
    a.tone === b.tone &&
    a.key === b.key &&
    a.isPersistent === b.isPersistent &&
    (a.onDismiss === undefined) === (b.onDismiss === undefined) &&
    a.action?.label === b.action?.label &&
    (a.action === undefined) === (b.action === undefined) &&
    a.action?.isAvailable === b.action?.isAvailable
  );
}

/**
 * Where the region shows its toasts: `default`, the provider's own place; `home`, a place a
 * shell gives it (over its canvas, clearing its dock); `modal`, the open dialog's own layer, so
 * its toasts stay reachable while the page behind is `inert`. The highest kind wins, and among
 * places of one kind the last added.
 */
export type ToastTargetKind = 'default' | 'home' | 'modal';

/** A place the region can show its toasts in. */
export interface ToastTarget {
  /** The element the toasts go into. */
  readonly element: HTMLElement;
  /** What kind of place it is. */
  readonly kind: ToastTargetKind;
}

/** One toast the region shows. */
export interface RegionEntry {
  /** Its poster's id. */
  readonly id: number;
  /** The toast as posted. */
  readonly toast: RegionToast;
  /**
   * What the Toast component shows: its content, the same object until the toast is posted
   * anew, so its time is not restarted by a render; its action calls the latest handler.
   */
  readonly content: ToastContent;
}

/** What the region shows: its toasts, oldest first, and where. */
export interface ToastRegionSnapshot {
  /** The toasts not dismissed, oldest first (the newest is nearest the dock). */
  readonly entries: readonly RegionEntry[];
  /** Where they show; none before a place is added. */
  readonly target: ToastTarget | undefined;
  /** The dock the region clears when it shows in a home; none if absent. */
  readonly dock: HTMLElement | undefined;
}

/** An entry as the store keeps it. */
interface HeldEntry {
  readonly id: number;
  toast: RegionToast;
  order: number;
  content: ToastContent;
  isDismissed: boolean;
}

/** The precedence of a place's kind. */
const TARGET_RANK: Readonly<Record<ToastTargetKind, number>> = { default: 0, home: 1, modal: 2 };

/**
 * The one toast region's state (UI-18, item 4): every toast posted by the app, in the
 * order shown, the places it can show them in, and the dock it clears. Posting the same toast
 * again keeps it where it is; posting a different one, or a new key, makes it the newest. A
 * dismissed toast stays hidden until its poster withdraws it or posts something else. A timed
 * posting's timer lives here, not in a mounted component, and a posting is announced once, so
 * moving the region (into an open dialog and back) neither restarts a toast's time nor
 * announces it again. Listeners
 * hear of each change; the snapshot is a new object only then (`useSyncExternalStore`). Main
 * thread.
 */
export class ToastRegionStore {
  readonly #entries = new Map<number, HeldEntry>();
  readonly #targets: ToastTarget[] = [];
  readonly #listeners = new Set<() => void>();
  /** Each timed posting's timer: its deadline is set once, when it is posted. */
  readonly #timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** The postings whose sentence a live region has shown: never emptied and filled again. */
  readonly #announced = new WeakSet<ToastContent>();
  #dock: HTMLElement | undefined;
  #nextId = 0;
  #nextOrder = 0;
  #snapshot: ToastRegionSnapshot = { entries: [], target: undefined, dock: undefined };

  /**
   * Adds a listener for changes.
   *
   * @param listener - Called after each change.
   * @returns Removes it.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * What the region shows now: the same object until something changes.
   *
   * @returns The snapshot.
   */
  readonly snapshot = (): ToastRegionSnapshot => this.#snapshot;

  /**
   * A new poster's id.
   *
   * @returns The id, unique in this store.
   */
  newId(): number {
    this.#nextId += 1;
    return this.#nextId;
  }

  /**
   * Shows, changes or withdraws a poster's toast.
   *
   * @param id - The poster's id (`newId`).
   * @param toast - What it shows now; undefined withdraws it.
   */
  post(id: number, toast: RegionToast | undefined): void {
    const held = this.#entries.get(id);
    if (toast === undefined) {
      this.#clearTimer(id);
      if (held !== undefined) this.#entries.delete(id);
      if (held !== undefined) this.#changed();
      return;
    }
    if (held !== undefined && isSamePosting(held.toast, toast)) {
      held.toast = toast;
      return;
    }
    this.#nextOrder += 1;
    this.#entries.set(id, {
      id,
      toast,
      order: this.#nextOrder,
      content: this.#contentOf(id, toast),
      isDismissed: false,
    });
    this.#startTimer(id, toast);
    this.#changed();
  }

  /**
   * Whether a posting's sentence was already shown in a live region, so a toast mounted again
   * (moved into or out of a dialog's place) shows it at once instead of announcing it again.
   *
   * @param content - The posting's content (`RegionEntry.content`).
   * @returns Whether it was announced.
   */
  wasAnnounced(content: ToastContent): boolean {
    return this.#announced.has(content);
  }

  /**
   * Records that a posting's sentence was shown in a live region.
   *
   * @param content - The posting's content.
   */
  markAnnounced(content: ToastContent): void {
    this.#announced.add(content);
  }

  /**
   * Starts a timed posting's one timer (D-TOAST): it runs in the store, from the moment of
   * posting, whatever the toast's element does meanwhile (moved into a dialog and back).
   *
   * @param id - The poster's id.
   * @param toast - The posting.
   */
  #startTimer(id: number, toast: RegionToast): void {
    this.#clearTimer(id);
    const lifetime = toastLifetimeMs(toast);
    if (lifetime === undefined) return;
    this.#timers.set(
      id,
      setTimeout(() => {
        this.#timers.delete(id);
        this.dismiss(id);
      }, lifetime),
    );
  }

  /**
   * Stops a poster's timer, if it has one.
   *
   * @param id - The poster's id.
   */
  #clearTimer(id: number): void {
    const timer = this.#timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.#timers.delete(id);
  }

  /**
   * Takes a toast away (its Dismiss, Escape, its time) and tells its poster.
   *
   * @param id - The poster's id.
   */
  dismiss(id: number): void {
    const held = this.#entries.get(id);
    if (held === undefined || held.isDismissed) return;
    this.#clearTimer(id);
    held.isDismissed = true;
    this.#changed();
    held.toast.onDismiss?.();
  }

  /**
   * Takes the newest toast that can be dismissed away (Escape).
   *
   * @returns Whether there was one.
   */
  dismissNewest(): boolean {
    const newest = [...this.#snapshot.entries]
      .reverse()
      .find((entry) => isDismissibleToast(entry.toast));
    if (newest === undefined) return false;
    this.dismiss(newest.id);
    return true;
  }

  /**
   * Adds a place to show the toasts in.
   *
   * @param element - The place.
   * @param kind - Its kind.
   * @returns Removes it.
   */
  addTarget(element: HTMLElement, kind: ToastTargetKind): () => void {
    const target: ToastTarget = { element, kind };
    this.#targets.push(target);
    this.#changed();
    return () => {
      const index = this.#targets.indexOf(target);
      if (index >= 0) this.#targets.splice(index, 1);
      this.#changed();
    };
  }

  /**
   * Sets the dock the region clears in a home (the shell's dock registers itself).
   *
   * @param dock - The dock, or undefined when it goes.
   */
  setDock(dock: HTMLElement | undefined): void {
    if (this.#dock === dock) return;
    this.#dock = dock;
    this.#changed();
  }

  /**
   * The content the Toast component shows for a posting: timed by its kind, its action calling
   * the poster's latest handler.
   *
   * @param id - The poster's id.
   * @param toast - The posting.
   * @returns The content.
   */
  #contentOf(id: number, toast: RegionToast): ToastContent {
    const { action } = toast;
    return {
      kind: toast.kind,
      message: toast.message,
      isTimed: toastLifetimeMs(toast) !== undefined,
      ...(toast.tone === undefined ? {} : { tone: toast.tone }),
      action:
        action === undefined
          ? undefined
          : {
              label: action.label,
              isAvailable: action.isAvailable,
              onAction: () => {
                this.#entries.get(id)?.toast.action?.onAction();
              },
            },
    };
  }

  /** Makes a new snapshot and tells the listeners. */
  #changed(): void {
    const entries = [...this.#entries.values()]
      .filter((entry) => !entry.isDismissed)
      .sort((a, b) => a.order - b.order)
      .map(({ id, toast, content }) => ({ id, toast, content }));
    let target: ToastTarget | undefined;
    for (const candidate of this.#targets) {
      if (target === undefined || TARGET_RANK[candidate.kind] >= TARGET_RANK[target.kind]) {
        target = candidate;
      }
    }
    this.#snapshot = { entries, target, dock: this.#dock };
    for (const listener of [...this.#listeners]) listener();
  }
}
