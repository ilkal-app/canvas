import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import type { BoardView } from '../../engine/board-view.js';

import { LayerTree, type ScheduleFrame } from './layer-tree.js';

/** What {@link useLayerTree} gives the layers panel. */
export interface LayerTreeBinding {
  /** The model, or undefined before the board is known. */
  readonly tree: LayerTree | undefined;
  /** Its version: the panel renders again when it changes. */
  readonly version: number;
}

/**
 * Runs a callback at the next animation frame.
 *
 * @param callback - What to run.
 * @returns A function that cancels it.
 */
const nextAnimationFrame: ScheduleFrame = (callback) => {
  const handle = requestAnimationFrame(callback);
  return () => {
    cancelAnimationFrame(handle);
  };
};

/**
 * Schedules for the first animation frame once no stepped run holds the board: a page
 * switch announces its page a slice per task, and the panel restructures once at its end instead
 * of on every frame between slices.
 *
 * @param view - The board view.
 * @returns The scheduler.
 */
function afterRunFrame(view: BoardView): ScheduleFrame {
  if (view.whenIdle === undefined) return nextAnimationFrame;
  return (callback) => {
    let cancelFrame: (() => void) | undefined;
    let isCancelled = false;
    view.whenIdle?.(() => {
      if (!isCancelled) cancelFrame = nextAnimationFrame(callback);
    });
    return () => {
      isCancelled = true;
      cancelFrame?.();
    };
  };
}

/**
 * The layers panel's model over a board view: made (one walk of the board) and subscribed to
 * the document's change sets in the same effect, so no change set falls between the two;
 * dropped when the view goes. Local change sets apply at once (the person's own create is
 * listed before its selection is revealed); remote ones are queued and applied together at the
 * next animation frame, so a collaborator's burst (a paste of 1,000 objects in many change
 * sets) costs one pass a frame, and a stepped run's (a page switch's slices) one pass
 * after the run. The panel renders again whenever the rows change.
 *
 * @param view - The mounted engine's board view, if any.
 * @returns The model and its version.
 */
export function useLayerTree(view: BoardView | undefined): LayerTreeBinding {
  const [tree, setTree] = useState<LayerTree | undefined>(undefined);
  useEffect(() => {
    if (view === undefined) {
      setTree(undefined);
      return undefined;
    }
    const next = new LayerTree(view.board, { scheduleFrame: afterRunFrame(view) });
    setTree(next);
    const stop = view.subscribe((change) => {
      if (change.kind !== 'document') return;
      if (change.changes.isLocal) next.applyChanges(change.changes);
      else next.queueChanges(change.changes);
    });
    return () => {
      stop();
      next.dispose();
    };
  }, [view]);
  const subscribe = useCallback(
    (onChange: () => void) => (tree === undefined ? () => undefined : tree.subscribe(onChange)),
    [tree],
  );
  const version = useSyncExternalStore(subscribe, () => tree?.version() ?? 0);
  return { tree, version };
}
