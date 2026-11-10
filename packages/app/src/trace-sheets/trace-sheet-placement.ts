import { TRACE_TINT_HEADER_PX, TRACE_TINT_PADDING_PX, worldToScreen } from '@canvas/engine';

import type { MountedEngine } from '../engine/mounted-engine.js';

import type { PlacedTraceSheet } from './trace-sheet-bounds.js';

/** How far a tab stays inside the canvas's edges, CSS px. */
const TAB_INSET_PX = 10;

/**
 * Where docked tabs start from the canvas's top, CSS px: below the board-name bar,
 * which floats over the canvas's top-left corner.
 */
export const DOCKED_TAB_TOP_PX = 72;

/** The gap between two docked tabs, CSS px. */
const DOCKED_TAB_GAP_PX = 8;

/** The gap between a stopped agent's notice and its tab below, CSS px (`.notice`, as the design draws it). */
const TAB_NOTICE_GAP_PX = 24;

/**
 * How much room a tab needs above it: its stopped agent's notice and the gap, or none
 * while the notice is empty.
 *
 * @param tab - The tab.
 * @returns The room, CSS px.
 */
function headroomOf(tab: HTMLElement): number {
  const notice = tab.querySelector<HTMLElement>('[data-trace-notice]')?.offsetHeight ?? 0;
  return notice === 0 ? 0 : notice + TAB_NOTICE_GAP_PX;
}

/**
 * What the tabs of a layer measure: each tab's width and height and the room its
 * stopped agent's notice takes, in order, as one string. Placement reads these, so a tab whose
 * name, buttons, font or notice changed its size is placed again.
 *
 * @param root - The tabs' layer.
 * @returns The sizes, comparable with `===`.
 */
export function tabSizesOf(root: HTMLElement): string {
  return [...root.querySelectorAll<HTMLElement>('[data-trace-sheet]')]
    .map(
      (tab) => `${String(tab.offsetWidth)}x${String(tab.offsetHeight)}+${String(headroomOf(tab))}`,
    )
    .join(' ');
}

/**
 * Places every tab of a layer once. A tab whose sheet has bounds sits at the sheet's
 * top-left corner on screen, clamped inside the canvas (`data-placed="true"`). A tab whose
 * sheet has none, because the agent made only things without geometry of their own (an
 * object-anchored comment, an empty group), is docked at the canvas's top left, one under the
 * other (`data-placed="docked"`), so Keep sheet and Lift off stay reachable though there is no
 * tint to draw. A tab with no open sheet at all is hidden (`data-placed="false"`). A tab with
 * a stopped agent's notice above it keeps room for the notice inside the canvas.
 *
 * @param root - The tabs' layer.
 * @param engine - The engine, for its camera.
 * @param placed - The sheets that have bounds.
 */
export function placeTabs(
  root: HTMLElement,
  engine: Pick<MountedEngine, 'camera'>,
  placed: readonly PlacedTraceSheet[],
): void {
  const camera = engine.camera();
  const byAgent = new Map(placed.map((sheet) => [sheet.agentId as string, sheet]));
  let dockedTop = DOCKED_TAB_TOP_PX;
  for (const tab of root.querySelectorAll<HTMLElement>('[data-trace-sheet]')) {
    const sheet = byAgent.get(tab.dataset.traceSheet ?? '');
    const headroom = headroomOf(tab);
    if (sheet === undefined) {
      tab.dataset.placed = 'docked';
      dockedTop += headroom;
      tab.style.transform = `translate(${String(TAB_INSET_PX)}px, ${String(dockedTop)}px)`;
      dockedTop += tab.offsetHeight + DOCKED_TAB_GAP_PX;
      continue;
    }
    tab.dataset.placed = 'true';
    const corner = worldToScreen(camera, { x: sheet.bounds.minX, y: sheet.bounds.minY });
    const maxX = Math.max(TAB_INSET_PX, root.clientWidth - tab.offsetWidth - TAB_INSET_PX);
    const maxY = Math.max(TAB_INSET_PX, root.clientHeight - tab.offsetHeight - TAB_INSET_PX);
    const x = corner.x - TRACE_TINT_PADDING_PX + TAB_INSET_PX;
    const y = corner.y - TRACE_TINT_HEADER_PX + TAB_INSET_PX;
    const left = Math.round(Math.min(Math.max(x, TAB_INSET_PX), maxX));
    const top = Math.round(Math.min(Math.max(y, TAB_INSET_PX + headroom), maxY));
    tab.style.transform = `translate(${String(left)}px, ${String(top)}px)`;
  }
}
