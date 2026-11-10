import {
  useEffect,
  useId,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import type { ObjectId } from '@canvas/schema';

import type { BoardView } from '../engine/board-view.js';
import { Skeleton } from '../feedback/skeleton.js';
import { useElementHeight } from '../hooks/use-element-height.js';
import type { ShellAction } from '../state/shell-action.js';

import { ComponentsPanel } from './components/components-panel.js';
import { keyRowIndex } from './layers/key-row-index.js';
import type { LayerDrop, LayerPlacement } from './layers/layer-drop.js';
import { editingOf } from './layers/layer-editing.js';
import { layerKeyIntent } from './layers/layer-keys.js';
import { LAYER_INDENT_PX, LAYER_ROW_HEIGHT_PX, LayerRowItem } from './layers/layer-row-item.js';
import type { LayerRow } from './layers/layer-rows.js';
import type { LayerTree } from './layers/layer-tree.js';
import styles from './layers/layers.module.css';
import { useLayerDrag, type LayerDrag } from './layers/use-layer-drag.js';
import { useLayerFocus, type LayerFocus } from './layers/use-layer-focus.js';
import { useLayerKeyMoves } from './layers/use-layer-key-moves.js';
import { useLayerTree } from './layers/use-layer-tree.js';
import { renderedItems, visibleRows } from './layers/visible-rows.js';

/** Props of {@link LayersPanel}. */
export interface LayersPanelProps {
  /** The board view, or undefined before an engine mounts. */
  readonly view: BoardView | undefined;
  /** The selected ids, primary first. */
  readonly selectedIds: readonly ObjectId[];
  /** The group the select tool entered, whose row is marked; none if absent or null. */
  readonly enteredGroupId?: ObjectId | null;
  /** The shell's dispatch, for the lock toggle (`toggleLockOf`) and drops (`placeLayers`). */
  readonly dispatch: (action: ShellAction) => void;
  /**
   * Whether the person may edit the board; a person who cannot gets no lock toggles
   * and cannot drag or move rows, the rows still saying which objects are locked. True if absent.
   */
  readonly canEdit?: boolean;
  /**
   * Whether the board's objects are still loading: the list shows static skeleton rows
   * instead of rows or "The board is empty.", and says it is busy. False if absent.
   */
  readonly isLoading?: boolean;
  /** What the header shows after the heading: the drawer's close button; none if absent. */
  readonly headerEnd?: ReactNode;
}

/** The skeleton rows' bar widths while the board loads, CSS px: a few, of varied length. */
const SKELETON_BAR_WIDTHS_PX = [120, 96, 140, 72, 112, 88] as const;

/** The list's height before it is measured (jsdom, the first render), CSS px. */
const DEFAULT_LIST_HEIGHT_PX = 480;

/** Rows rendered beyond each edge of the view. */
const OVERSCAN_ROWS = 8;

const NO_ROWS: readonly LayerRow[] = [];

/**
 * The selection a click or Enter on a row makes: that row alone, or with Shift, the selection
 * with the row added (or taken out, if it was in).
 *
 * @param selectedIds - The selection now.
 * @param id - The row's object.
 * @param isAdding - Whether Shift was held.
 * @returns The new selection, primary first.
 */
export function selectionAfterRowClick(
  selectedIds: readonly ObjectId[],
  id: ObjectId,
  isAdding: boolean,
): ObjectId[] {
  if (!isAdding) return [id];
  return selectedIds.includes(id)
    ? selectedIds.filter((selected) => selected !== id)
    : [...selectedIds, id];
}

/**
 * Keeps the primary selected object's row listed and in view: expands its ancestors (O(depth)
 * plus the splice of their slices) and scrolls to it, unless the person is scrolling the list,
 * whenever the primary changes (a click on the canvas, a marquee).
 *
 * @param tree - The model.
 * @param primary - The primary selected id.
 * @param show - Makes a row the focus target and scrolls to it (`LayerFocus.reveal`).
 */
function useRevealPrimary(
  tree: LayerTree | undefined,
  primary: ObjectId | undefined,
  show: (index: number) => void,
): void {
  const showRef = useRef(show);
  useEffect(() => {
    showRef.current = show;
  });
  useEffect(() => {
    if (tree === undefined || primary === undefined) return;
    tree.reveal(primary);
    const index = tree.indexOf(primary);
    if (index !== undefined) showRef.current(index);
  }, [tree, primary]);
}

/**
 * The panel's header: its heading, then what the host puts at its end (the layers
 * drawer's close button).
 *
 * @param props - The heading's id and the end.
 * @param props.headingId - The id the panel and the tree are labelled by.
 * @param props.end - What follows the heading; nothing if absent.
 * @returns The header.
 */
function LayersHeader(props: {
  readonly headingId: string;
  readonly end: ReactNode;
}): ReactElement {
  return (
    <div className={styles.header}>
      <h2 id={props.headingId} className={styles.heading}>
        Layers
      </h2>
      {props.end}
    </div>
  );
}

/**
 * The rows the list shows while the board's objects load (Figma "Skeleton", 35:1768):
 * static bars on the raised surface, no shimmer, each a row's height, so the real rows replace
 * them where they stand. Hidden from assistive technology, which hears the list is busy.
 *
 * @returns The skeleton.
 */
function LayerSkeleton(): ReactElement {
  return (
    <div role="none" className={styles.skeleton} aria-hidden="true" data-layers-skeleton="">
      {SKELETON_BAR_WIDTHS_PX.map((widthPx, index) => (
        <div key={index} className={styles.skeletonRow} style={{ height: LAYER_ROW_HEIGHT_PX }}>
          <Skeleton width={widthPx} height={10} />
        </div>
      ))}
    </div>
  );
}

/**
 * Where a drag over the list would drop: a line between rows, indented to the level
 * the objects land at, or an outline around the frame or group they go into; in the refusal
 * colour when the target refuses them.
 *
 * @param props - The drop.
 * @param props.drop - The drop under the pointer.
 * @returns The indicator.
 */
function DropIndicator(props: { readonly drop: LayerDrop }): ReactElement {
  const { indicator, refusal } = props.drop;
  const isRefused = refusal !== undefined;
  if (indicator.kind === 'into') {
    return (
      <div
        aria-hidden="true"
        className={styles.dropInto}
        data-drop-indicator="into"
        data-refused={isRefused || undefined}
        style={{ top: indicator.index * LAYER_ROW_HEIGHT_PX, height: LAYER_ROW_HEIGHT_PX }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={styles.dropLine}
      data-drop-indicator="line"
      data-refused={isRefused || undefined}
      style={{
        top: indicator.index * LAYER_ROW_HEIGHT_PX - 1,
        left: (indicator.level - 1) * LAYER_INDENT_PX,
      }}
    />
  );
}

/** What {@link useListInput} reads besides the panel's props. */
interface ListInputModel {
  /** The model, or undefined before an engine mounts. */
  readonly tree: LayerTree | undefined;
  /** The rows, top first. */
  readonly rows: readonly LayerRow[];
  /** The scrolling list. */
  readonly listRef: RefObject<HTMLDivElement | null>;
  /** The element the rows are placed in. */
  readonly rowsRef: RefObject<HTMLDivElement | null>;
  /** The list's focus. */
  readonly focus: LayerFocus;
  /** Selects a row, or with `isAdding` adds it to the selection or takes it out. */
  readonly select: (row: LayerRow, isAdding: boolean) => void;
}

/**
 * The list's input: the drag and drop (`useLayerDrag`) and the keys. Escape ends a drag; Alt
 * with an arrow moves rows (`useLayerKeyMoves`); the other keys follow the tree pattern
 * (`layerKeyIntent`), from the row the key came from (`keyRowIndex`). Drops and moves place through one `placeLayers` action, and
 * nothing moves for a person who cannot edit or while the board loads.
 *
 * @param props - The panel's props.
 * @param model - The tree, rows, list, focus and selection.
 * @returns The drag and the list's key handler.
 */
function useListInput(
  props: LayersPanelProps,
  model: ListInputModel,
): { readonly drag: LayerDrag; readonly onKeyDown: (event: KeyboardEvent) => void } {
  const { view, selectedIds, dispatch } = props;
  const { tree, rows, focus } = model;
  const parentOf = (id: ObjectId) => view?.board.get(id)?.parentId;
  const place = (ids: readonly ObjectId[], placement: LayerPlacement) => {
    dispatch({ type: 'placeLayers', ids, ...placement });
  };
  const canEdit = props.canEdit !== false && props.isLoading !== true;
  const drag = useLayerDrag({
    ...model,
    selectedIds,
    canEdit,
    parentOf,
    onSelect: (ids) => view?.select(ids),
    onPlace: place,
  });
  const moveByKey = useLayerKeyMoves({
    tree,
    rows,
    selectedIds,
    canEdit,
    parentOf,
    show: focus.show,
    onPlace: place,
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && drag.isDragging) {
      event.preventDefault();
      drag.cancel();
      return;
    }
    const index = keyRowIndex(event.target, focus.target);
    if (moveByKey(event, index)) return;
    const intent = layerKeyIntent(rows, index, event.key);
    if (intent === undefined) return;
    event.preventDefault();
    if (intent.kind === 'focus') focus.show(intent.index, true);
    else if (intent.kind === 'expand') tree?.setExpanded([intent.row.id], intent.isExpanded);
    else model.select(intent.row, event.shiftKey);
  };
  return { drag, onKeyDown };
}

/**
 * The layers panel: under its header the board's mains
 * (`ComponentsPanel`, ruling 3, while there is one), then the board's frames, groups,
 * mains and objects as a
 * virtualised tree in paint order, top first (`sortedSiblings`), so 50k objects stay responsive
 * (only the rows in view, plus a few, are in the DOM). A click selects, Shift+click adds or
 * removes; frames and groups expand and collapse, and the group the select tool entered is
 * marked (`aria-current`); each row has a lock toggle (none for a person who cannot edit,
 *), which locks or unlocks that row's object alone (`toggleLockOf`, one `setLocked` command) and leaves the
 * selection as it is; a double-click on a frame's or main's row edits its name in place (none
 * for a person who cannot edit, `renameOf`), the way to rename a frame whose name the
 * canvas does not draw. The keyboard follows the tree pattern
 * (`layerKeyIntent`). The primary selection's row is revealed and scrolled into view. Rows are
 * dragged to reorder and reparent (`useLayerDrag`): the selection, or the row pressed,
 * goes between rows or into a frame or group, shown by a line or an outline, one `placeLayers`
 * action per drop; a locked container or one inside the dragged objects refuses the drop, shown
 * in the refusal colour with the reason announced. Alt with an arrow moves the focused row's
 * objects the same way (`layerKeyPlacement`) and keeps focus on the row. A person who cannot
 * edit cannot drag or move. While
 * the board loads (`isLoading`) the list is busy and static skeleton rows stand in its place;
 * the header ends with what the host puts there (`headerEnd`: the layers drawer's
 * close button). The list carries `data-ready` once its model is built, so a host can tell an
 * empty board from a list still being made.
 *
 * @param props - The board view, the selection, the dispatch, whether the board is loading and
 *   the header's end.
 * @returns The panel.
 */
export function LayersPanel(props: LayersPanelProps): ReactElement {
  const { view, selectedIds, enteredGroupId = null, dispatch, canEdit = true } = props;
  const isLoading = props.isLoading === true;
  const headingId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const { tree } = useLayerTree(view);
  const rows = tree?.rows() ?? NO_ROWS;
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const heightPx = useElementHeight(listRef, DEFAULT_LIST_HEIGHT_PX);
  const focus = useLayerFocus(listRef, heightPx, rows.length);
  useRevealPrimary(tree, selectedIds[0], focus.reveal);
  const select = (row: LayerRow, isAdding: boolean) => {
    view?.select(selectionAfterRowClick(selectedIds, row.id, isAdding));
  };
  const model = { tree, rows, listRef, rowsRef, focus, select };
  const { drag, onKeyDown } = useListInput(props, model);
  // While the board loads, the skeleton stands in for every row.
  const listed = isLoading ? NO_ROWS : rows;
  const range = visibleRows(
    rows.length,
    focus.scrollTopPx,
    heightPx,
    LAYER_ROW_HEIGHT_PX,
    OVERSCAN_ROWS,
  );

  return (
    <aside className={styles.panel} aria-labelledby={headingId}>
      <LayersHeader headingId={headingId} end={props.headerEnd} />
      <ComponentsPanel view={view} dispatch={dispatch} canEdit={canEdit} />
      {!isLoading && rows.length === 0 && <p className={styles.empty}>The board is empty.</p>}
      <div
        ref={listRef}
        role="tree"
        aria-labelledby={headingId}
        aria-multiselectable="true"
        aria-busy={isLoading || undefined}
        data-ready={tree === undefined ? undefined : ''}
        data-dragging={drag.isDragging || undefined}
        className={styles.list}
        {...drag.handlers}
        onScroll={(event) => {
          focus.onScroll(event.currentTarget.scrollTop);
        }}
        onKeyDown={onKeyDown}
      >
        {isLoading && <LayerSkeleton />}
        <div
          ref={rowsRef}
          role="none"
          className={styles.rows}
          style={{ height: listed.length * LAYER_ROW_HEIGHT_PX }}
        >
          {drag.drop !== undefined && <DropIndicator drop={drag.drop} />}
          {renderedItems(listed, range, focus.target).map(({ index, item: row }) => (
            <LayerRowItem
              key={row.id}
              row={row}
              index={index}
              isSelected={selected.has(row.id)}
              isEntered={row.id === enteredGroupId}
              isFocusTarget={index === focus.target}
              onSelect={select}
              onToggleExpanded={(expanding) => {
                tree?.setExpanded([expanding.id], !expanding.isExpanded);
              }}
              {...editingOf(canEdit, dispatch)}
              onFocus={focus.onRowFocus}
            />
          ))}
        </div>
      </div>
      <p role="status" className={styles.dropStatus}>
        {drag.drop?.refusal}
      </p>
    </aside>
  );
}
