import { useEffect, useRef, type KeyboardEvent } from 'react';

import type { ObjectId } from '@canvas/schema';

import { layerKeyPlacement, movableLayerIds, type LayerPlacement } from './layer-drop.js';
import type { LayerRow } from './layer-rows.js';
import type { LayerTree } from './layer-tree.js';

/** The arrow keys that, with Alt, move rows. */
const MOVE_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** What {@link useLayerKeyMoves} reads from the panel. */
export interface LayerKeyMovesOptions {
  /** The model, or undefined before an engine mounts. */
  readonly tree: LayerTree | undefined;
  /** The rows, top first. */
  readonly rows: readonly LayerRow[];
  /** The selected ids, primary first. */
  readonly selectedIds: readonly ObjectId[];
  /** Whether the person may edit: a viewer's Alt+arrows move nothing. */
  readonly canEdit: boolean;
  /** An object's parent, null at the root, undefined when it cannot be read. */
  readonly parentOf: (id: ObjectId) => ObjectId | null | undefined;
  /** Makes a row the focus target, scrolls to it and focuses it (`LayerFocus.show`). */
  readonly show: (index: number, shouldFocus: boolean) => void;
  /** Places the objects. */
  readonly onPlace: (ids: readonly ObjectId[], placement: LayerPlacement) => void;
}

/** A row the keyboard moved, followed once the rows change. */
interface Followed {
  /** Its object. */
  readonly id: ObjectId;
  /** The rows when it was moved. */
  readonly rows: readonly LayerRow[];
}

/**
 * The keyboard alternative to dragging rows (the accessibility bar of the Interface
 * redesign): Alt with an arrow moves the focused row's objects (the selection when the row is
 * selected, else the row alone) up or down among their siblings, out of their parent, or into
 * the frame or group above (`layerKeyPlacement`), one `placeLayers` action each. Once the rows
 * show the move, the moved row is revealed (its new parent expanded) and keeps focus. The row is
 * the one the key came from (`keyRowIndex`), which a key pressed before the focus target follows
 * a move still names right.
 *
 * @param options - The model, rows, selection, focus and callback.
 * @returns The key handler, given the event and its row's index: true when it took the key.
 */
export function useLayerKeyMoves(
  options: LayerKeyMovesOptions,
): (event: KeyboardEvent, index: number) => boolean {
  const { tree, rows, show } = options;
  const followedRef = useRef<Followed | undefined>(undefined);
  const showRef = useRef(show);
  useEffect(() => {
    showRef.current = show;
  });
  useEffect(() => {
    const followed = followedRef.current;
    if (tree === undefined || followed === undefined || followed.rows === rows) return;
    followedRef.current = undefined;
    tree.reveal(followed.id);
    const index = tree.indexOf(followed.id);
    if (index !== undefined) showRef.current(index, true);
  }, [tree, rows]);

  return (event, index) => {
    if (!event.altKey || !MOVE_KEYS.has(event.key)) return false;
    event.preventDefault();
    const row = rows[index];
    if (!options.canEdit || row === undefined) return true;
    const isSelected = options.selectedIds.includes(row.id);
    const ids = isSelected ? movableLayerIds(options.selectedIds, options.parentOf) : [row.id];
    const placement = layerKeyPlacement(rows, index, event.key, new Set(ids));
    if (placement === undefined) return true;
    followedRef.current = { id: row.id, rows };
    options.onPlace(ids, placement);
    return true;
  };
}
