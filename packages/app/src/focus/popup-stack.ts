/** A popup's hold on the screen, from {@link PopupStack.claim}. */
export interface PopupClaim {
  /**
   * Gives the hold up: the popup closed itself. It is not asked to close again; the popups
   * opened from it are, innermost first, and are forgotten with it.
   */
  readonly release: () => void;
}

/**
 * The one popup open at a time: a popover, menu or palette that opens claims the
 * stack, which closes the one open before. Nested popups (a submenu, the palette of a colour
 * button inside a popover) claim with their parent's claim as `parent`, so opening them keeps
 * the parent open, and closing the parent closes them.
 */
export interface PopupStack {
  /**
   * Claims the stack for a popup that is opening: closes every open popup that is not this one's
   * parent (or the parent's parent), innermost first.
   *
   * @param close - Closes this popup; called when another popup takes its place.
   * @param parent - The claim of the popup this one opens from, if any.
   * @returns This popup's claim.
   */
  readonly claim: (close: () => void, parent?: PopupClaim) => PopupClaim;
  /** How many popups are open, for tests. */
  readonly size: () => number;
}

/** One open popup on the stack. */
interface Entry {
  readonly claim: PopupClaim;
  readonly close: () => void;
}

/**
 * Makes a popup stack. The app shares one ({@link POPUP_STACK}); tests make their own.
 *
 * @returns The stack, empty.
 */
export function createPopupStack(): PopupStack {
  const entries: Entry[] = [];
  // The stack is one chain, outermost first: a claim closes every entry that is not its
  // ancestor, so the entries after a popup are the ones opened from it.
  const release = (claim: PopupClaim): void => {
    const index = entries.findIndex((entry) => entry.claim === claim);
    if (index === -1) return;
    const [, ...children] = entries.splice(index);
    for (const child of children.reverse()) child.close();
  };
  return {
    claim: (close, parent) => {
      const keep =
        parent === undefined ? 0 : entries.findIndex((entry) => entry.claim === parent) + 1;
      // Closes from the innermost outwards; each close may release itself meanwhile.
      for (const entry of entries.splice(keep).reverse()) entry.close();
      const claim: PopupClaim = {
        release: () => {
          release(claim);
        },
      };
      entries.push({ claim, close });
      return claim;
    },
    size: () => entries.length,
  };
}

/** The app's popup stack: every floating popup of the whiteboard chrome claims it. Main thread. */
export const POPUP_STACK: PopupStack = createPopupStack();
