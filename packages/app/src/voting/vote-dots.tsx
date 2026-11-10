import { useEffect, useState, type ReactElement } from 'react';

import { worldToScreen } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { editedBoundsOf } from '../editing/text-bar-model.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { shownVotesOf, useBoardVote } from './vote-context.js';
import styles from './vote-dots.module.css';

/** The most dots a sticky shows; more votes show as a count beside them. */
export const MAX_VOTE_DOTS = 5;

/** How far inside a sticky's right edge its dots end, CSS px (the design's 8). */
const DOTS_RIGHT_PX = 8;

/** How far above a sticky's bottom edge its dots sit, CSS px (the design's 10). */
const DOTS_BOTTOM_PX = 10;

/** One voted sticky's dots on screen. */
interface DotsPlace {
  /** The sticky. */
  readonly id: string;
  /** Where the dots end, CSS px from the canvas's left. */
  readonly x: number;
  /** Where they sit, CSS px from the canvas's top. */
  readonly y: number;
  /** Its votes shown. */
  readonly count: number;
}

/**
 * Where each voted sticky on the page shown puts its dots: its box's bottom-right corner on
 * screen; a sticky elsewhere, gone, or moving under the person's gesture shows none.
 *
 * @param engine - The engine.
 * @param votes - The votes shown, by object id.
 * @returns The places, as JSON (so a frame that moves nothing renders nothing).
 */
function placesOf(engine: MountedEngine, votes: ReadonlyMap<string, number>): string {
  const camera = engine.camera();
  const board = engine.board.board;
  const places: DotsPlace[] = [];
  for (const [id, count] of votes) {
    const object = board.get(id as ObjectId);
    const isShown = object?.type === 'sticky' && engine.board.isMoving?.(object.id) !== true;
    const bounds = isShown ? editedBoundsOf(board, object.id) : undefined;
    if (bounds === undefined) continue;
    const corner = worldToScreen(camera, { x: bounds.maxX, y: bounds.maxY });
    places.push({
      id,
      x: Math.round(corner.x - DOTS_RIGHT_PX),
      y: Math.round(corner.y - DOTS_BOTTOM_PX),
      count,
    });
  }
  return JSON.stringify(places);
}

/**
 * A sticky's dots: up to {@link MAX_VOTE_DOTS}, and the rest as "+N".
 *
 * @param props - How many.
 * @param props.count - Its votes shown.
 * @returns The dots.
 */
function Dots(props: { readonly count: number }): ReactElement {
  const shown = Math.min(props.count, MAX_VOTE_DOTS);
  return (
    <>
      {Array.from({ length: shown }, (unused, index) => index).map((index) => (
        <span key={index} className={styles.dot} data-vote-dot="" />
      ))}
      {props.count > shown && (
        <span className={styles.more}>{`+${String(props.count - shown)}`}</span>
      )}
    </>
  );
}

/**
 * The dots on voted stickies (the design's frame B), over the canvas: while a vote is
 * hidden, the person's own votes, each one a press that takes it back; once the results may be
 * seen, everyone's. They follow the camera every frame and hide while the person drags the
 * sticky.
 *
 * @param props - The engine.
 * @param props.engine - The engine, once it runs.
 * @returns The layer, or nothing without a current vote.
 */
export function VoteDots(props: {
  readonly engine: MountedEngine | undefined;
}): ReactElement | null {
  const vote = useBoardVote();
  const { engine } = props;
  const session = vote?.session ?? null;
  const [encoded, setEncoded] = useState('[]');
  useEffect(() => {
    if (engine === undefined || session === null) return undefined;
    const votes = shownVotesOf(session);
    let frame = 0;
    const tick = (): void => {
      setEncoded(placesOf(engine, votes));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [engine, session]);
  if (vote === undefined || session === null) return null;
  const places = JSON.parse(encoded) as readonly DotsPlace[];
  const canTakeBack = vote.canVote && session.status === 'open' && session.results === null;
  return (
    <div className={styles.layer} data-vote-dots="">
      {places.map((place) => {
        const style = { left: place.x, top: place.y };
        const name = `${String(place.count)} ${place.count === 1 ? 'vote' : 'votes'}`;
        return canTakeBack ? (
          <button
            key={place.id}
            type="button"
            className={styles.dots}
            style={style}
            aria-label={`Your ${name}: take one back`}
            title="Take back a vote"
            data-vote-dots-for={place.id}
            onClick={() => {
              vote.retract(place.id);
            }}
          >
            <Dots count={place.count} />
          </button>
        ) : (
          <span
            key={place.id}
            className={styles.dots}
            style={style}
            role="img"
            aria-label={name}
            data-vote-dots-for={place.id}
          >
            <Dots count={place.count} />
          </span>
        );
      })}
    </div>
  );
}
