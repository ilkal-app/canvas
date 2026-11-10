import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { POPUP_STACK, type PopupClaim, type PopupStack } from '../focus/popup-stack.js';
import { isImeKey } from '../shortcuts/ime-key.js';

import { onAnchorsMoved } from './anchor-moves.js';
import styles from './anchored-popover.module.css';
import { containingBlockOrigin, portalHostOf, type PortalHost } from './fixed-container.js';
import { FloatingSheet, type FloatingSheetShape } from './floating-sheet.js';
import {
  placePopover,
  type Placement,
  type PlacementAlign,
  type PlacementRequest,
  type PlacementSide,
  type ScreenRect,
} from './placement.js';

/** Why an {@link AnchoredPopover} asked to close. */
export type PopoverCloseReason = 'escape' | 'outside' | 'replaced';

/** Props of {@link AnchoredPopover}. */
export interface AnchoredPopoverProps {
  /** What it belongs to: a rectangle on screen (a selection's box), or an element. */
  readonly anchor: ScreenRect | RefObject<Element | null>;
  /** Whether it is open; closed, it renders nothing. */
  readonly isOpen: boolean;
  /**
   * Asked to close it: Escape (focus has gone back where it was before it opened), a press
   * outside it and its anchor (focus stays where the press put it), or another popup opening.
   */
  readonly onClose: (reason: PopoverCloseReason) => void;
  /** Its accessible name. */
  readonly label: string;
  /** Its role; `dialog` if absent (a toolbar of properties is `toolbar`). */
  readonly role?: 'dialog' | 'toolbar' | 'menu' | undefined;
  /** Its sheet's shape; `toolbar` if absent. */
  readonly shape?: FloatingSheetShape | undefined;
  /** The side it prefers; `top` if absent. */
  readonly side?: PlacementSide | undefined;
  /** How it lines up along the anchor; `center` if absent. */
  readonly align?: PlacementAlign | undefined;
  /** Space between it and the anchor, px; 8 if absent. */
  readonly gap?: number | undefined;
  /** Areas of the screen it must not cover (the dock, the zoom control, the facilitate card). */
  readonly reserved?: readonly ScreenRect[] | undefined;
  /** Whether focus moves to its first control when it opens; true if absent. */
  readonly shouldTakeFocus?: boolean | undefined;
  /**
   * The claim of the popup it opens from, so opening it keeps that one open; the claim of the
   * popover it is rendered inside if absent (a submenu inside its menu).
   */
  readonly parentClaim?: PopupClaim | undefined;
  /**
   * What takes focus when it opens, as a selector inside it (a dropdown's checked item); its
   * first control when nothing matches or this is absent.
   */
  readonly initialFocus?: string | undefined;
  /** The popup stack it claims; the app's if absent (tests pass their own). */
  readonly stack?: PopupStack | undefined;
  /** Its contents. */
  readonly children: ReactNode;
}

/** A placement, and the height the sheet is held to when it is shortened to stay clear. */
type FittedPlacement = Placement & { readonly maxHeight?: number };

/** The shortest a popover is held to so as to stay clear, px: below it, it covers instead. */
const SHORTEST_HEIGHT_PX = 120;

/** How much shorter each try is, px. */
const SHORTENING_STEP_PX = 24;

/**
 * Places a popover clear of its reserved areas, shortening it when it fits nowhere at its full
 * height (round 2: a tall touch menu beside a selection in the middle of a phone): the
 * tallest clear height from its full one down to {@link SHORTEST_HEIGHT_PX}, the rest scrolling;
 * when none is clear, where `placePopover` puts it at full height. Pure.
 *
 * @param request - The placement request.
 * @returns Where it goes, and the height it is held to when shortened.
 */
export function placeShortening(request: PlacementRequest): FittedPlacement {
  const full = placePopover(request);
  if (full.isClear) return full;
  for (
    let height = request.size.height - SHORTENING_STEP_PX;
    height >= SHORTEST_HEIGHT_PX;
    height -= SHORTENING_STEP_PX
  ) {
    const placed = placePopover({ ...request, size: { ...request.size, height } });
    if (placed.isClear) return { ...placed, maxHeight: height };
  }
  return full;
}

/**
 * A sheet's height with all its content showing, also while it is held shorter and scrolls.
 *
 * @param sheet - The sheet.
 * @returns Its full height, px.
 */
function naturalHeightOf(sheet: HTMLElement): number {
  return Math.max(sheet.offsetHeight, sheet.scrollHeight + sheet.offsetHeight - sheet.clientHeight);
}

/**
 * Writes a placement on a sheet directly, with no render: its offsets, its held height and side.
 *
 * @param sheet - The sheet.
 * @param placed - Where it goes.
 */
function writePlacement(sheet: HTMLElement, placed: FittedPlacement): void {
  sheet.style.left = `${String(placed.x)}px`;
  sheet.style.top = `${String(placed.y)}px`;
  sheet.style.maxHeight = placed.maxHeight === undefined ? '' : `${String(placed.maxHeight)}px`;
  sheet.style.overflowY = placed.maxHeight === undefined ? '' : 'auto';
  sheet.dataset.side = placed.side;
}

/** The claim of the open popover a component is rendered inside, for popups opened from it. */
const PopupClaimContext = createContext<PopupClaim | undefined>(undefined);

/**
 * Areas of the window the popovers opened inside it must not cover, read at each placement: the
 * selection's box on the page, which the selection popover provides so its menus never cover the
 * selection (round 2). None if absent.
 */
export const AnchoredPopoverAvoidContext = createContext<(() => readonly ScreenRect[]) | undefined>(
  undefined,
);

/** What can take focus inside the popover, in Tab order. */
const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

/**
 * The anchor's rectangle now.
 *
 * @param anchor - A rectangle or an element.
 * @returns Its rectangle, or undefined while the element is not in the page.
 */
function anchorRect(anchor: AnchoredPopoverProps['anchor']): ScreenRect | undefined {
  if (!('current' in anchor)) return anchor;
  const box = anchor.current?.getBoundingClientRect();
  return box === undefined
    ? undefined
    : { x: box.x, y: box.y, width: box.width, height: box.height };
}

/**
 * Keeps the popover placed beside its anchor: measures it, places it with
 * {@link placePopover} in the window (in the page's direction), and again when the window
 * resizes, the anchor rectangle or the reserved areas change, or an anchoring element moves
 * without a render (`announceAnchorsMoved`). The place is given as the sheet's
 * `left` and `top` in its containing block (`containingBlockOrigin`), so a transformed ancestor
 * (a tool panel) does not move it off its anchor. A sheet such an ancestor traps is first
 * moved to its themed root (`portalHostOf`), then placed there.
 *
 * @param props - The popover's props.
 * @param sheetRef - Its sheet.
 * @returns Its `left` and `top` and the side it took, undefined until it is measured, and the
 *   element and layer it is rendered in when not in place.
 */
function usePlacement(
  props: AnchoredPopoverProps,
  sheetRef: RefObject<HTMLDivElement | null>,
): { readonly placement: FittedPlacement | undefined; readonly host: PortalHost | undefined } {
  const [placement, setPlacement] = useState<FittedPlacement>();
  const [host, setHost] = useState<PortalHost>();
  const { isOpen, side, align, gap } = props;
  const anchorRef = useRef(props.anchor);
  const reservedRef = useRef(props.reserved);
  const avoid = useContext(AnchoredPopoverAvoidContext);
  const avoidRef = useRef(avoid);
  useLayoutEffect(() => {
    anchorRef.current = props.anchor;
    reservedRef.current = props.reserved;
    avoidRef.current = avoid;
  });
  // By value, not identity: a caller may pass a fresh rectangle or list on every render.
  const anchorKey = 'current' in props.anchor ? 'element' : JSON.stringify(props.anchor);
  const reservedKey = JSON.stringify(props.reserved ?? []);
  useLayoutEffect(() => {
    if (!isOpen) {
      setPlacement(undefined);
      setHost(undefined);
      return undefined;
    }
    // Where the sheet goes beside its anchor now, in its containing block.
    const placementAt = (sheet: HTMLDivElement, at: ScreenRect): FittedPlacement => {
      const avoided = avoidRef.current?.() ?? [];
      const reserved =
        avoided.length === 0 ? reservedRef.current : [...(reservedRef.current ?? []), ...avoided];
      const request: PlacementRequest = {
        anchor: at,
        size: { width: sheet.offsetWidth, height: naturalHeightOf(sheet) },
        viewport: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
        side: side ?? 'top',
        direction: getComputedStyle(sheet).direction === 'rtl' ? 'rtl' : 'ltr',
        ...(align === undefined ? {} : { align }),
        ...(gap === undefined ? {} : { gap }),
        ...(reserved === undefined ? {} : { reserved }),
      };
      // What it must keep clear of (the selection): rather than cover it, it shortens and scrolls.
      const placed = avoided.length === 0 ? placePopover(request) : placeShortening(request);
      const origin = containingBlockOrigin(sheet);
      return { ...placed, x: placed.x - origin.x, y: placed.y - origin.y };
    };
    const place = (): void => {
      const sheet = sheetRef.current;
      const at = anchorRect(anchorRef.current);
      if (sheet === null || at === undefined) return;
      // Trapped: moved first and placed once there (this runs again with the new host).
      const movedTo = host === undefined ? portalHostOf(sheet) : undefined;
      if (movedTo !== undefined) {
        setHost(movedTo);
        return;
      }
      setPlacement(placementAt(sheet, at));
    };
    // An anchor that moved with no render (the selection's popover following the camera,
    // Item 3): the sheet follows by its offsets alone, never a render per frame. A later
    // placement computes the same spot, so the render and the offsets agree.
    const follow = (): void => {
      const sheet = sheetRef.current;
      const at = anchorRect(anchorRef.current);
      if (sheet === null || at === undefined || !sheet.hasAttribute('data-side')) return;
      writePlacement(sheet, placementAt(sheet, at));
    };
    place();
    window.addEventListener('resize', place);
    const stopFollowing = 'current' in anchorRef.current ? onAnchorsMoved(follow) : undefined;
    return () => {
      window.removeEventListener('resize', place);
      stopFollowing?.();
    };
  }, [isOpen, side, align, gap, anchorKey, reservedKey, sheetRef, host]);
  return { placement, host };
}

/**
 * Holds the popover's place on the popup stack while it is open, and asks it to close when
 * another popup takes the stack. A popover rendered inside another claims as its child.
 *
 * @param props - The popover's props.
 * @returns Its claim while open, for the popups opened from it.
 */
function useStackClaim(props: AnchoredPopoverProps): PopupClaim | undefined {
  const { isOpen } = props;
  const enclosing = useContext(PopupClaimContext);
  const parentClaim = props.parentClaim ?? enclosing;
  const stack = props.stack ?? POPUP_STACK;
  const [claim, setClaim] = useState<PopupClaim>();
  const onCloseRef = useRef(props.onClose);
  useLayoutEffect(() => {
    onCloseRef.current = props.onClose;
  });
  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const held = stack.claim(() => {
      onCloseRef.current('replaced');
    }, parentClaim);
    setClaim(held);
    return () => {
      held.release();
      setClaim(undefined);
    };
  }, [isOpen, parentClaim, stack]);
  return claim;
}

/**
 * Closes the popover on a press outside it and its anchor element, leaving focus where the
 * press put it.
 *
 * @param props - The popover's props.
 * @param sheetRef - Its sheet.
 */
function useCloseOnOutsidePress(
  props: AnchoredPopoverProps,
  sheetRef: RefObject<HTMLDivElement | null>,
): void {
  const { isOpen, anchor } = props;
  const onCloseRef = useRef(props.onClose);
  useLayoutEffect(() => {
    onCloseRef.current = props.onClose;
  });
  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sheetRef.current?.contains(target) === true) return;
      if ('current' in anchor && anchor.current?.contains(target) === true) return;
      onCloseRef.current('outside');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [isOpen, anchor, sheetRef]);
}

/**
 * A popover beside a rectangle on screen or an element: a {@link FloatingSheet}
 * placed by {@link placePopover} (the preferred side, else the opposite, else the other two;
 * inside the window; clear of the reserved areas), in the page's direction. Opening it takes
 * the popup stack, so any other popup closes; another popup opening closes it. It moves focus
 * to its first control (unless `shouldTakeFocus` is false); Escape closes it and puts focus back
 * where it was before it opened (the canvas, for a selection's popover); a press outside it and
 * its anchor closes it. Tab moves through its controls in order and on out of it. It is fixed to
 * the window and stays in the page's tree, so the theme's tokens reach it, except under an
 * ancestor that traps fixed elements (a transformed tool panel or compact dock): then it
 * is rendered in the themed root around them (`portalHostOf`), as a portal.
 *
 * @param props - Its anchor, state, handler, name, placement and contents.
 * @returns The popover, or nothing while closed.
 */
export function AnchoredPopover(props: AnchoredPopoverProps): ReactElement | null {
  const { isOpen, shouldTakeFocus = true, initialFocus } = props;
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { placement, host } = usePlacement(props, sheetRef);
  const claim = useStackClaim(props);
  useCloseOnOutsidePress(props, sheetRef);
  const isPlaced = placement !== undefined;
  // Once placed (a hidden sheet takes no focus): remember where focus was, then take it.
  useLayoutEffect(() => {
    if (!isOpen || !isPlaced) return;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    if (!shouldTakeFocus) return;
    const sheet = sheetRef.current;
    const chosen =
      initialFocus === undefined ? null : sheet?.querySelector<HTMLElement>(initialFocus);
    (chosen ?? sheet?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
  }, [isOpen, isPlaced, shouldTakeFocus, initialFocus]);
  if (!isOpen) return null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || isImeKey(event.nativeEvent)) return;
    // The popover's, not the canvas's or a dialog's: the key stops here.
    event.preventDefault();
    event.stopPropagation();
    const back = returnFocusRef.current;
    if (back?.isConnected === true) back.focus();
    props.onClose('escape');
  };
  const sheet = (
    <FloatingSheet
      ref={sheetRef}
      shape={props.shape}
      role={props.role ?? 'dialog'}
      label={props.label}
      className={styles.popover}
      style={
        placement === undefined
          ? { visibility: 'hidden', ...(host && { zIndex: host.zIndex }) }
          : {
              left: `${String(placement.x)}px`,
              top: `${String(placement.y)}px`,
              ...(placement.maxHeight === undefined
                ? {}
                : { maxHeight: `${String(placement.maxHeight)}px`, overflowY: 'auto' }),
              ...(host && { zIndex: host.zIndex }),
            }
      }
      dataAttributes={placement === undefined ? undefined : { 'data-side': placement.side }}
      onKeyDown={onKeyDown}
    >
      <PopupClaimContext.Provider value={claim}>{props.children}</PopupClaimContext.Provider>
    </FloatingSheet>
  );
  return host === undefined ? sheet : createPortal(sheet, host.element);
}
