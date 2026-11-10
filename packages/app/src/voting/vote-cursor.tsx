import { useEffect, useRef, type ReactElement } from 'react';

import type { DocumentStore } from '@canvas/document';
import { screenToWorld } from '@canvas/engine';

import type { MountedEngine } from '../engine/mounted-engine.js';

import { stickyAt } from './vote-board.js';
import { useBoardVote } from './vote-context.js';

/**
 * The voting cursor (the ticket's "a voting cursor where clicking a sticky adds a
 * vote and ⌥-clicking removes one"): while it is on, a primary press on the canvas over a sticky
 * of the page shown casts one of the person's votes for it, with ⌥ (Alt) takes one back, and
 * does nothing else (no selection, no tool); a press on empty board does nothing. The canvas
 * shows a crosshair, and Escape turns the cursor off.
 *
 * @param props - The engine and the board's store.
 * @param props.engine - The engine, once it runs.
 * @param props.store - The board's store, which a press reads the stickies from.
 * @returns A marker beside the canvas, the cursor's anchor.
 */
export function VoteCursor(props: {
  readonly engine: MountedEngine | undefined;
  readonly store: Pick<DocumentStore, 'read'> | undefined;
}): ReactElement {
  const { engine, store } = props;
  const vote = useBoardVote();
  const marker = useRef<HTMLSpanElement>(null);
  const isOn = vote?.isCursorOn === true;
  // The latest vote, so a press acts on the session as it is now without re-binding the canvas.
  const latest = useRef(vote);
  latest.current = vote;
  useEffect(() => {
    const canvas = marker.current?.parentElement?.querySelector('canvas');
    if (canvas === null || canvas === undefined || engine === undefined || store === undefined) {
      return undefined;
    }
    if (!isOn) return undefined;
    const down = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const camera = engine.camera();
      const point = screenToWorld(camera, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      const id = stickyAt(store.read(), point, camera.zoom, engine.pages?.current());
      if (id === undefined) return;
      if (event.altKey) latest.current?.retract(id);
      else latest.current?.cast(id);
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') latest.current?.setCursorOn?.(false);
    };
    canvas.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    const before = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';
    return () => {
      canvas.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
      canvas.style.cursor = before;
    };
  }, [engine, store, isOn]);
  return <span ref={marker} hidden data-vote-cursor={isOn ? 'on' : 'off'} />;
}
