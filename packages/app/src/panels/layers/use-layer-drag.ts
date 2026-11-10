import { useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';

import type { ObjectId } from '@canvas/schema';

import { layerDropAt, movableLayerIds, type LayerDrop, type LayerPlacement } from './layer-drop.js';
import { LAYER_ROW_HEIGHT_PX } from './layer-row-item.js';
import type { LayerRow } from './layer-rows.js';

/** How far the pointer moves from where it pressed a row before a drag starts, CSS px. */
const DRAG_THRESHOLD_PX = 4;

/** How near the list's top or bottom edge a drag scrolls it, CSS px. */
const AUTOSCROLL_EDGE_PX = 24;

/** How far the list scrolls per pointer move at an edge, CSS px. */
const AUTOSCROLL_STEP_PX = 12;

/** What {@link useLayerDrag} reads from the panel. */
export interface LayerDragOptions {
  /** The scrolling list. */
  readonly listRef: RefObject<HTMLElement | null>;
  /** The element the rows are placed in, whose top is row 0's. */
  readonly rowsRef: RefObject<HTMLElement | null>;
  /** The rows, top first. */
  readonly rows: readonly LayerRow[];
  /** The selected ids, primary first. */
  readonly selectedIds: readonly ObjectId[];
  /** Whether the person may edit: a viewer cannot drag. */
  readonly canEdit: boolean;
  /** An object's parent, null at the root, undefined when it cannot be read. */
  readonly parentOf: (id: ObjectId) => ObjectId | null | undefined;
  /** A drag of an unselected row started: select it alone. */
  readonly onSelect: (ids: readonly ObjectId[]) => void;
  /** A drop that is not refused: place the objects. */
  readonly onPlace: (ids: readonly ObjectId[], placement: LayerPlacement) => void;
}

/** The layers list's drag and drop: the drop under the pointer and the list's handlers. */
export interface LayerDrag {
  /** The drop under the pointer while a drag is on; undefined otherwise. */
  readonly drop: LayerDrop | undefined;
  /** Whether a drag is on. */
  readonly isDragging: boolean;
  /** Ends a drag without dropping (Escape). */
  readonly cancel: () => void;
  /** The list's pointer and click handlers. */
  readonly handlers: {
    readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    readonly onClickCapture: (event: MouseEvent<HTMLElement>) => void;
  };
}

/** A row pressed, before and during its drag. */
interface Press {
  /** The pointer. */
  readonly pointerId: number;
  /** Where it pressed, client px. */
  readonly x: number;
  readonly y: number;
  /** The row's object. */
  readonly id: ObjectId;
  /** The objects the drag takes, once it started. */
  moving?: ReadonlySet<ObjectId>;
}

/**
 * The row an event happened on, unless it happened on one of the row's buttons.
 *
 * @param event - The event.
 * @returns The row's object, or undefined.
 */
function pressedRowId(event: PointerEvent<HTMLElement>): ObjectId | undefined {
  const target = event.target instanceof Element ? event.target : undefined;
  if (target?.closest('button') !== null) return undefined;
  const id = target.closest<HTMLElement>('[role="treeitem"]')?.dataset.id;
  return id === undefined ? undefined : (id as ObjectId);
}

/**
 * Scrolls the list a step when the pointer is near its top or bottom edge, so a drag reaches
 * rows out of view.
 *
 * @param list - The list.
 * @param clientY - The pointer, client px.
 */
function autoscroll(list: HTMLElement, clientY: number): void {
  const bounds = list.getBoundingClientRect();
  if (clientY < bounds.top + AUTOSCROLL_EDGE_PX) list.scrollTop -= AUTOSCROLL_STEP_PX;
  else if (clientY > bounds.bottom - AUTOSCROLL_EDGE_PX) list.scrollTop += AUTOSCROLL_STEP_PX;
}

/**
 * The drop under the pointer: the row under it and how far down that row, from the top of the
 * element the rows are placed in.
 *
 * @param rows - The rows.
 * @param moving - The dragged objects.
 * @param rowsElement - The element the rows are placed in.
 * @param clientY - The pointer, client px.
 * @returns The drop, or undefined.
 */
function dropUnder(
  rows: readonly LayerRow[],
  moving: ReadonlySet<ObjectId>,
  rowsElement: HTMLElement,
  clientY: number,
): LayerDrop | undefined {
  const offset = (clientY - rowsElement.getBoundingClientRect().top) / LAYER_ROW_HEIGHT_PX;
  const index = Math.max(0, Math.floor(offset));
  return layerDropAt(rows, moving, index, Math.min(1, Math.max(0, offset - index)));
}

/**
 * The placement a drop makes, unless it is refused.
 *
 * @param drop - The drop, or undefined.
 * @returns The placement, or undefined for no drop or a refused one.
 */
function placementOf(drop: LayerDrop | undefined): LayerPlacement | undefined {
  if (drop === undefined || drop.refusal !== undefined) return undefined;
  const { parentId, belowId } = drop;
  return { parentId, ...(belowId === undefined ? {} : { belowId }) };
}

/**
 * The layers panel's drag and drop. A press on a row (not its buttons) that moves
 * past `DRAG_THRESHOLD_PX` starts a drag of the selection when the row is selected, else of the
 * row alone (selected then); objects inside another dragged object go with it
 * (`movableLayerIds`). While it moves, the drop under the pointer (`layerDropAt`) is tracked for
 * the panel to show, and the list scrolls at its edges. Releasing places the objects
 * (`onPlace`) unless the drop is refused or there is none; the click that ends a drag selects
 * nothing. Escape, or a cancelled pointer, ends the drag without a drop. A person who cannot
 * edit never starts one.
 *
 * @param options - The list, the rows, the selection and the callbacks.
 * @returns The drop and the handlers.
 */
export function useLayerDrag(options: LayerDragOptions): LayerDrag {
  const { listRef, rowsRef, rows, selectedIds, canEdit } = options;
  const pressRef = useRef<Press | undefined>(undefined);
  const isClickSwallowedRef = useRef(false);
  const [drop, setDrop] = useState<LayerDrop | undefined>(undefined);
  const [isDragging, setIsDragging] = useState(false);

  const end = () => {
    const press = pressRef.current;
    const list = listRef.current;
    pressRef.current = undefined;
    if (press?.moving !== undefined && list?.hasPointerCapture(press.pointerId) === true) {
      list.releasePointerCapture(press.pointerId);
    }
    setDrop(undefined);
    setIsDragging(false);
  };

  const start = (press: Press, list: HTMLElement): ReadonlySet<ObjectId> => {
    const isSelected = selectedIds.includes(press.id);
    const ids = isSelected ? movableLayerIds(selectedIds, options.parentOf) : [press.id];
    if (!isSelected) options.onSelect([press.id]);
    list.setPointerCapture(press.pointerId);
    setIsDragging(true);
    return new Set(ids);
  };

  return {
    drop,
    isDragging,
    cancel: end,
    handlers: {
      onPointerDown: (event) => {
        isClickSwallowedRef.current = false;
        if (!canEdit || event.button !== 0 || event.shiftKey) return;
        const id = pressedRowId(event);
        if (id === undefined) return;
        pressRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, id };
      },
      onPointerMove: (event) => {
        const press = pressRef.current;
        const list = listRef.current;
        if (press?.pointerId !== event.pointerId || list === null) return;
        if (press.moving === undefined) {
          const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y);
          if (distance < DRAG_THRESHOLD_PX) return;
          press.moving = start(press, list);
        }
        autoscroll(list, event.clientY);
        if (rowsRef.current !== null) {
          setDrop(dropUnder(rows, press.moving, rowsRef.current, event.clientY));
        }
      },
      onPointerUp: (event) => {
        const press = pressRef.current;
        if (press?.pointerId !== event.pointerId) return;
        isClickSwallowedRef.current = press.moving !== undefined;
        const placement = placementOf(drop);
        if (press.moving !== undefined && placement !== undefined) {
          options.onPlace([...press.moving], placement);
        }
        end();
      },
      onPointerCancel: end,
      onClickCapture: (event) => {
        if (!isClickSwallowedRef.current) return;
        isClickSwallowedRef.current = false;
        event.stopPropagation();
      },
    },
  };
}
