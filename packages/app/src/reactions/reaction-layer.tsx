import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';

import { screenToWorld, worldToScreen } from '@canvas/engine';
import { DEFAULT_PAGE_ID } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';

import styles from './reaction-layer.module.css';
import { useBoardReactions, type BoardReactions } from './reactions-context.js';

/** A shown reaction on screen. */
interface ReactionSpot {
  /** Its id. */
  readonly id: number;
  /** The emoji. */
  readonly emoji: string;
  /** CSS px from the canvas's left. */
  readonly x: number;
  /** CSS px from the canvas's top. */
  readonly y: number;
}

/**
 * Where the shown reactions on the page shown are on screen.
 *
 * @param engine - The engine.
 * @param reactions - The board's reactions.
 * @returns Their spots, as JSON (so a frame that moves nothing renders nothing).
 */
function spotsOf(engine: MountedEngine, reactions: BoardReactions): string {
  const camera = engine.camera();
  const page = engine.pages?.current() ?? DEFAULT_PAGE_ID;
  const spots: ReactionSpot[] = [];
  for (const reaction of reactions.shown) {
    if (reaction.pageId !== page) continue;
    const at = worldToScreen(camera, reaction);
    spots.push({
      id: reaction.id,
      emoji: reaction.emoji,
      x: Math.round(at.x),
      y: Math.round(at.y),
    });
  }
  return JSON.stringify(spots);
}

/**
 * Drops the armed emoji where the board is pressed: the press is the reaction's, not the tool's,
 * and the canvas shows a crosshair meanwhile.
 *
 * @param marker - An element inside the canvas mount, to find the canvas by.
 * @param engine - The engine.
 * @param reactions - The board's reactions.
 */
function usePlacing(
  marker: RefObject<HTMLSpanElement | null>,
  engine: MountedEngine | undefined,
  reactions: BoardReactions | undefined,
): void {
  const isArmed = reactions?.armed !== null && reactions?.armed !== undefined;
  const drop = useRef(reactions?.drop);
  drop.current = reactions?.drop;
  useEffect(() => {
    const canvas = marker.current?.parentElement?.querySelector('canvas');
    if (!canvas || engine === undefined || !isArmed) return undefined;
    const down = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const point = screenToWorld(engine.camera(), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      drop.current?.({ ...point, pageId: engine.pages?.current() ?? DEFAULT_PAGE_ID });
    };
    canvas.addEventListener('pointerdown', down, true);
    const before = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';
    return () => {
      canvas.removeEventListener('pointerdown', down, true);
      canvas.style.cursor = before;
    };
  }, [marker, engine, isArmed]);
}

/**
 * Gives the board's reactions the view's centre, where a reaction chosen with the keyboard is
 * sent, while the engine runs.
 *
 * @param engine - The engine.
 * @param provideCentre - Where the centre goes, if the board has reactions.
 */
function useViewCentre(
  engine: MountedEngine | undefined,
  provideCentre: BoardReactions['provideCentre'] | undefined,
): void {
  useEffect(() => {
    if (engine === undefined || provideCentre === undefined) return undefined;
    provideCentre(() => {
      const camera = engine.camera();
      const point = screenToWorld(camera, {
        x: camera.viewportWidthPx / 2,
        y: camera.viewportHeightPx / 2,
      });
      return { ...point, pageId: engine.pages?.current() ?? DEFAULT_PAGE_ID };
    });
    return () => {
      provideCentre(undefined);
    };
  }, [engine, provideCentre]);
}

/**
 * Reactions over the board: every reaction shown now on the page shown, at its board
 * point, following the camera, floating up and fading (fading only under reduced motion); and,
 * while an emoji is armed in the dock's Reactions flyout, a press on the board drops it there; one
 * chosen with the keyboard is sent at the view's centre.
 *
 * @param props - The engine.
 * @param props.engine - The engine, once it runs.
 * @returns The layer.
 */
export function ReactionLayer(props: { readonly engine: MountedEngine | undefined }): ReactElement {
  const reactions = useBoardReactions();
  const { engine } = props;
  const marker = useRef<HTMLSpanElement>(null);
  usePlacing(marker, engine, reactions);
  useViewCentre(engine, reactions?.provideCentre);
  const [encoded, setEncoded] = useState('[]');
  const hasShown = reactions !== undefined && reactions.shown.length > 0;
  useEffect(() => {
    if (engine === undefined || reactions === undefined || !hasShown) {
      setEncoded('[]');
      return undefined;
    }
    let frame = 0;
    const tick = (): void => {
      setEncoded(spotsOf(engine, reactions));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [engine, reactions, hasShown]);
  const spots = JSON.parse(encoded) as readonly ReactionSpot[];
  return (
    <>
      <span ref={marker} hidden />
      <div className={styles.layer} data-reactions="" aria-hidden="true">
        {spots.map((spot) => (
          <span
            key={spot.id}
            className={styles.reaction}
            style={{ left: spot.x, top: spot.y }}
            data-reaction={spot.emoji}
          >
            {spot.emoji}
          </span>
        ))}
      </div>
    </>
  );
}
