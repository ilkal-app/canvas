import type { DockRole } from './dock-layout.js';
import {
  floatingMobileBarSectionsFor,
  type FloatingDockSection,
  type FloatingDockToolId,
} from './floating-dock.js';

// The floating whiteboard's compact bottom bar below 768 px wide: the dock's three
// sections at 48 px, the editor's less-used tools behind "More tools" so the bar keeps to the
// classic bar's seven targets, and fewer on a narrower phone.

/** The editor's tools that sit behind "More tools" on the compact bar, in the dock's order. */
export const FLOATING_MOBILE_MORE_TOOLS: readonly FloatingDockToolId[] = [
  'section',
  'image',
  'connector',
  'reactions',
];

/**
 * How many 48 px targets the compact bar holds at its widest (374 px): the classic bar's seven,
 * More included.
 */
export const FLOATING_MOBILE_BAR_SLOTS = 7;

/**
 * The editor's bar tools that go behind "More tools" first when the screen is too narrow for
 * seven targets, in that order: Draw, then Text, then Shapes.
 */
export const FLOATING_MOBILE_OVERFLOW_TOOLS: readonly FloatingDockToolId[] = [
  'draw',
  'text',
  'shapes',
];

/**
 * The narrowest viewports, in CSS px, whose compact bar holds seven and six 48 px targets: the
 * bar is the viewport less 16 px (374 px at most), less 14 px of border and padding, and holds
 * its targets with two 1 px dividers and 2 px gaps between its six parts.
 */
export const FLOATING_MOBILE_BAR_WIDTHS = { seven: 378, six: 330 } as const;

/**
 * How many 48 px targets the compact bar holds on a viewport this wide: seven from
 * 378 px, six from 330 px, five below, so no target is under 48 px on a screen of 282 px or
 * more. Pure.
 *
 * @param width - The viewport's width in CSS px.
 * @returns The targets, More included.
 */
export function floatingMobileBarSlotsFor(width: number): number {
  if (width >= FLOATING_MOBILE_BAR_WIDTHS.seven) return FLOATING_MOBILE_BAR_SLOTS;
  return width >= FLOATING_MOBILE_BAR_WIDTHS.six ? 6 : 5;
}

/** The compact floating bar for a role: its sections and the tools behind "More tools". */
export interface FloatingMobileBar {
  /** The sections, left to right, any left empty dropped. */
  readonly sections: readonly FloatingDockSection[];
  /** The tools behind "More tools", in the dock's order; none means no More button. */
  readonly more: readonly FloatingDockToolId[];
}

/**
 * The compact floating bar for a role: `floatingMobileBarSectionsFor` (no Pan: two
 * fingers pan), with an editor's {@link FLOATING_MOBILE_MORE_TOOLS} behind "More tools", and on
 * a narrower screen as many of {@link FLOATING_MOBILE_OVERFLOW_TOOLS} as it takes to fit its
 * targets. A commenter and a viewer have few enough tools to keep them all in the bar, and no
 * More. Pure.
 *
 * @param role - Whose bar it is.
 * @param slots - The targets the bar holds, More included (`floatingMobileBarSlotsFor`).
 * @returns The bar.
 */
export function floatingMobileBarOf(
  role: DockRole,
  slots: number = FLOATING_MOBILE_BAR_SLOTS,
): FloatingMobileBar {
  const sections = floatingMobileBarSectionsFor(role);
  if (role !== 'editor') return { sections, more: [] };
  const tools = sections.flatMap((section) => section.tools);
  const kept = tools.filter((tool) => !FLOATING_MOBILE_MORE_TOOLS.includes(tool));
  // Room for the kept tools and More: the overflow tools go behind More until they fit.
  const moved = FLOATING_MOBILE_OVERFLOW_TOOLS.slice(0, Math.max(0, kept.length + 1 - slots));
  const isInBar = (tool: FloatingDockToolId): boolean =>
    !FLOATING_MOBILE_MORE_TOOLS.includes(tool) && !moved.includes(tool);
  return {
    sections: sections
      .map((section) => ({ ...section, tools: section.tools.filter(isInBar) }))
      .filter((section) => section.tools.length > 0),
    more: tools.filter((tool) => !isInBar(tool)),
  };
}
