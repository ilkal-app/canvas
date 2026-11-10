/** A rectangle in canvas CSS pixels. */
export interface ScreenRect {
  /** Left edge. */
  readonly left: number;
  /** Top edge. */
  readonly top: number;
  /** Width. */
  readonly width: number;
  /** Height. */
  readonly height: number;
}

/** A size in CSS pixels. */
export interface ScreenSize {
  /** Width. */
  readonly width: number;
  /** Height. */
  readonly height: number;
}

/** How far the card keeps from each edge of the viewport, CSS px. */
export interface ScreenInsets {
  /** Below the top bars. */
  readonly top: number;
  /** From the right edge. */
  readonly right: number;
  /** Above the dock. */
  readonly bottom: number;
  /** From the left edge. */
  readonly left: number;
}

/** Where a thread's card goes, and on which side of its pin. */
export interface CardPlacement {
  /** Left edge, canvas CSS px. */
  readonly left: number;
  /** Top edge, canvas CSS px. */
  readonly top: number;
  /** The side of the pin it opened on. */
  readonly side: 'right' | 'left' | 'below' | 'above';
}

/** A pin's size at rest (Figma `Comment/Pin`), CSS px. */
export const PIN_SIZE_PX = 28;

/** The gap between a pin and its card, CSS px. */
export const CARD_GAP_PX = 8;

/** How a card sits by its pin: the gap between them and how far its top rises above the pin's. */
export interface CardSpacing {
  /** The gap between the pin and the card, CSS px. */
  readonly gap: number;
  /** How far the card's top edge sits above the pin's top edge beside it, CSS px. */
  readonly lift: number;
}

/** The floating whiteboard's spacing (design frame B): 12 px off the pin, 8 px higher. */
export const WHITEBOARD_CARD_SPACING: CardSpacing = { gap: 12, lift: 8 };

/**
 * A pin's box on screen: anchored at its bottom-left corner, which sits on its point.
 *
 * @param point - The pin's point, canvas CSS px.
 * @param point.x - Across.
 * @param point.y - Down.
 * @returns Its box.
 */
export function pinRect(point: { readonly x: number; readonly y: number }): ScreenRect {
  return { left: point.x, top: point.y - PIN_SIZE_PX, width: PIN_SIZE_PX, height: PIN_SIZE_PX };
}

/**
 * Clamps a value into a range, preferring its lower end when the range is empty.
 *
 * @param value - The value.
 * @param low - Lowest.
 * @param high - Highest.
 * @returns The clamped value.
 */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/**
 * Where a thread's card opens: 8 px to the right of its pin, top-aligned with it (or
 * as `spacing` gives: the floating whiteboard's 12 px off and 8 px higher); on
 * the left when it would cross the viewport's right edge; where it fits on neither side (a
 * phone), 8 px below the pin, or above it when there is no room below, held inside the sides;
 * and where it fits nowhere beside the pin, inside the viewport's insets (below the top bars,
 * above the dock). Pure.
 *
 * @param input - The pin's box, the card's size, the viewport and its insets.
 * @param input.pin - The pin's box.
 * @param input.card - The card's size.
 * @param input.viewport - The canvas's size.
 * @param input.insets - How far the card keeps from each edge.
 * @param input.spacing - The gap and lift; 8 px off and level with the pin if absent.
 * @returns The card's top-left corner and side.
 */
function besidePin(input: {
  readonly pin: ScreenRect;
  readonly card: ScreenSize;
  readonly viewport: ScreenSize;
  readonly insets: ScreenInsets;
  readonly spacing?: CardSpacing | undefined;
}): CardPlacement {
  const { pin, card, viewport, insets } = input;
  const { gap, lift } = input.spacing ?? { gap: CARD_GAP_PX, lift: 0 };
  const lowest = viewport.height - insets.bottom - card.height;
  const rightmost = viewport.width - insets.right - card.width;
  const top = clamp(pin.top - lift, insets.top, lowest);
  const right = pin.left + pin.width + gap;
  if (right <= rightmost) return { left: right, top, side: 'right' };
  const left = pin.left - gap - card.width;
  if (left >= insets.left) return { left, top, side: 'left' };
  const across = clamp(pin.left, insets.left, rightmost);
  const below = pin.top + pin.height + gap;
  if (below <= lowest) return { left: across, top: below, side: 'below' };
  const above = pin.top - gap - card.height;
  if (above >= insets.top) return { left: across, top: above, side: 'above' };
  const isRightRoomier = viewport.width - right > pin.left;
  return {
    left: clamp(isRightRoomier ? right : left, insets.left, rightmost),
    top,
    side: isRightRoomier ? 'right' : 'left',
  };
}

/**
 * Whether two rectangles overlap (touching edges do not).
 *
 * @param a - One.
 * @param b - The other.
 * @returns Whether they overlap.
 */
function overlaps(a: ScreenRect, b: ScreenRect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/**
 * A placement's box.
 *
 * @param placement - Where the card goes.
 * @param card - Its size.
 * @returns Its box.
 */
function boxOf(placement: CardPlacement, card: ScreenSize): ScreenRect {
  return { left: placement.left, top: placement.top, width: card.width, height: card.height };
}

/**
 * Where a thread's card opens, clear of the floating chrome: beside its pin as
 * {@link besidePin} places it; where that box meets a reserved zone (the dock, the zoom control,
 * the Facilitate card: `measureReservedZones`), the same side moved up to end a gap above the
 * zones it meets, then the other sides in turn (right, left, below, above); where none is clear,
 * the placement beside the pin as before. Pure.
 *
 * @param input - The pin's box, the card's size, the viewport, its insets and the zones.
 * @param input.pin - The pin's box.
 * @param input.card - The card's size.
 * @param input.viewport - The canvas's size.
 * @param input.insets - How far the card keeps from each edge.
 * @param input.zones - The reserved zones, canvas CSS px; none if absent.
 * @param input.spacing - The gap and lift; 8 px off and level with the pin if absent.
 * @returns The card's top-left corner and side.
 */
export function cardPlacement(input: {
  readonly pin: ScreenRect;
  readonly card: ScreenSize;
  readonly viewport: ScreenSize;
  readonly insets: ScreenInsets;
  readonly zones?: readonly ScreenRect[] | undefined;
  readonly spacing?: CardSpacing | undefined;
}): CardPlacement {
  const { pin, card, viewport, insets, zones = [] } = input;
  const { gap, lift } = input.spacing ?? { gap: CARD_GAP_PX, lift: 0 };
  const first = besidePin(input);
  const isClear = (placement: CardPlacement): boolean =>
    zones.every((zone) => !overlaps(boxOf(placement, card), zone));
  if (isClear(first)) return first;
  const lowest = viewport.height - insets.bottom - card.height;
  const rightmost = viewport.width - insets.right - card.width;
  const top = clamp(pin.top - lift, insets.top, lowest);
  const across = clamp(pin.left, insets.left, rightmost);
  const sides: CardPlacement[] = [
    { left: pin.left + pin.width + gap, top, side: 'right' },
    { left: pin.left - gap - card.width, top, side: 'left' },
    { left: across, top: pin.top + pin.height + gap, side: 'below' },
    { left: across, top: pin.top - gap - card.height, side: 'above' },
  ];
  const fits = (placement: CardPlacement): boolean =>
    placement.left >= insets.left &&
    placement.left <= rightmost &&
    placement.top >= insets.top &&
    placement.top <= lowest;
  for (const side of sides) {
    if (!fits(side)) continue;
    if (isClear(side)) return side;
    const met = zones.filter((zone) => overlaps(boxOf(side, card), zone));
    const raised = {
      ...side,
      top: Math.min(...met.map((zone) => zone.top)) - gap - card.height,
    };
    if (fits(raised) && isClear(raised)) return raised;
  }
  return first;
}
