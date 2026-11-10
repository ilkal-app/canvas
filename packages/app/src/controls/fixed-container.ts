// Where a fixed popover's position is measured from, and where a trapped one is rendered.

/** Properties whose value other than `none` makes an element contain fixed descendants. */
const TRAPPING_PROPERTIES = [
  'transform',
  'translate',
  'scale',
  'rotate',
  'perspective',
  'filter',
  'backdrop-filter',
  // WebKit (the iPad) may expose only the prefixed computed property.
  '-webkit-backdrop-filter',
] as const;

/**
 * Whether an element is the containing block of its `position: fixed` descendants rather than the
 * window (MDN, "Containing block"): a value other than `none` for one of
 * {@link TRAPPING_PROPERTIES}, paint or layout containment (`contain`, or `content-visibility:
 * auto`, which implies it), or a `will-change` naming one of those properties.
 *
 * @param style - The element's computed style.
 * @returns True when it contains fixed descendants.
 */
function containsFixed(style: CSSStyleDeclaration): boolean {
  const isSet = (property: string): boolean => {
    const value = style.getPropertyValue(property);
    return value !== '' && value !== 'none';
  };
  return (
    TRAPPING_PROPERTIES.some(isSet) ||
    /\b(paint|layout|strict|content)\b/.test(style.contain) ||
    style.getPropertyValue('content-visibility') === 'auto' ||
    /\b(transform|translate|scale|rotate|perspective|filter|backdrop-filter)\b/.test(
      style.willChange,
    )
  );
}

/**
 * Where a fixed sheet's containing block starts on screen: the window's corner, unless
 * an ancestor contains fixed descendants itself (`containsFixed`: the tool panel's centring
 * transform), whose padding box's corner then offsets the sheet's `left` and `top`. Only
 * translation is accounted for: no ancestor of a popover scales or turns.
 *
 * @param sheet - The sheet, `position: fixed`.
 * @returns The containing block's origin, viewport px.
 */
export function containingBlockOrigin(sheet: HTMLElement): {
  readonly x: number;
  readonly y: number;
} {
  const block = fixedContainerOf(sheet);
  if (block === undefined) return { x: 0, y: 0 };
  const box = block.getBoundingClientRect();
  return { x: box.x + block.clientLeft, y: box.y + block.clientTop };
}

/**
 * The nearest ancestor that contains a sheet's fixed position (`containsFixed`), if any.
 *
 * @param sheet - The sheet.
 * @returns The ancestor, or undefined when the window does.
 */
function fixedContainerOf(sheet: HTMLElement): HTMLElement | undefined {
  for (let element = sheet.parentElement; element !== null; element = element.parentElement) {
    if (containsFixed(getComputedStyle(element))) return element;
  }
  return undefined;
}

/**
 * Where a sheet that an ancestor traps is rendered instead: the themed root around it
 * (`applyTheme`'s `data-theme`, the shell's root), when that root holds the trapping ancestor. A
 * trapped sheet is placed from the ancestor's corner and painted inside the ancestor's stacking
 * context, under a sibling at the same layer (a tool panel's sheet over the compact dock); in the
 * themed root it is neither, and still takes the theme's tokens. Undefined when nothing traps it,
 * or no themed root holds the trap: it stays in place, placed from its containing block's corner
 * (`containingBlockOrigin`).
 *
 * Moved, it stacks one above the layer the trap is in (the `z-index` of the trap or its nearest
 * stacked ancestor below the root, the dock's `--layer-controls`), as a popup opened from a
 * layer's sheet does (`layer-tokens.ts`): over that layer's sheets and the selection popover, under
 * the bars, the context menu and notices.
 *
 * @param sheet - The sheet, rendered in place.
 * @returns The element to render it in and the `z-index` it takes there, or undefined to keep it
 *   in place.
 */
export function portalHostOf(sheet: HTMLElement): PortalHost | undefined {
  const trap = fixedContainerOf(sheet);
  if (trap === undefined) return undefined;
  const root = sheet.parentElement?.closest<HTMLElement>('[data-theme]') ?? null;
  if (root === null || root === trap || !root.contains(trap)) return undefined;
  return { element: root, zIndex: layerOf(trap, root) + 1 };
}

/** Where a trapped sheet is rendered (`portalHostOf`). */
export interface PortalHost {
  /** The themed root it is rendered in. */
  readonly element: HTMLElement;
  /** Its `z-index` there. */
  readonly zIndex: number;
}

/**
 * The stacking layer an element is in, below a root: the `z-index` of it or its nearest ancestor
 * that has one; 0 when none does.
 *
 * @param element - The element.
 * @param root - Where to stop.
 * @returns The `z-index`.
 */
function layerOf(element: HTMLElement, root: HTMLElement): number {
  for (let at: HTMLElement | null = element; at !== null && at !== root; at = at.parentElement) {
    const zIndex = Number.parseInt(getComputedStyle(at).zIndex, 10);
    if (Number.isFinite(zIndex)) return zIndex;
  }
  return 0;
}
