import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { createRandomObjectId, liftOff } from '@canvas/document';
import { EMPTY_TRACE_TINT } from '@canvas/engine';
import type { PrincipalId, Rgba } from '@canvas/schema';

import type { CollaboratorSummary } from '../collab/board-connection-status.js';
import type { BoardConnection } from '../collab/board-connection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { agentNameOf } from './agent-name.js';
import { liftOffNotice } from './lift-off-notice.js';
import {
  followSheetAgents,
  NO_SHEET_AGENTS,
  PRESENCE_SETTLE_MS,
  sheetPresenceKey,
  type SheetAgents,
} from './sheet-agents.js';
import { placeSheets, traceTintOf, type PlacedTraceSheet } from './trace-sheet-bounds.js';
import { TraceSheetTracker, type TraceSheet } from './trace-sheet-tracker.js';

/** A sheet as its tab shows it. */
export interface TraceSheetView {
  /** The agent, `agent:<id>`. */
  readonly agentId: PrincipalId;
  /** The agent's name. */
  readonly name: string;
  /** How many objects are on the sheet. */
  readonly count: number;
  /**
   * Whether the agent stopped before it was done: it left presence while the sheet
   * was open. Its objects stay on the sheet; Keep and Lift off work as before.
   */
  readonly isStopped: boolean;
}

/** What {@link useTraceSheets} gives the shell. */
export interface TraceSheetsBinding {
  /** The open sheets, in the order they opened. */
  readonly sheets: readonly TraceSheetView[];
  /** The last sentence for the live region: which agent's sheet opened. */
  readonly announcement: string;
  /**
   * The open sheets with the bounds of their objects, as last drawn.
   *
   * @returns The placed sheets.
   */
  readonly placed: () => readonly PlacedTraceSheet[];
  /** Closes an agent's sheet and leaves the board as it is (Keep). */
  readonly keep: (agentId: PrincipalId) => void;
  /** Deletes the sheet's objects in one undo step, keeping people's edits, and closes it. */
  readonly liftOff: (agentId: PrincipalId) => void;
}

/** What {@link useTraceSheets} works with. */
export interface UseTraceSheetsOptions {
  /** The board's connection; no sheet opens without one (a local board has no agent). */
  readonly connection: BoardConnection | undefined;
  /** The engine on the canvas, which draws the tint; none yet while it starts. */
  readonly engine: MountedEngine | undefined;
  /** The agent colour of the theme, for the tint. */
  readonly color: Rgba;
  /** Shows a sentence in the shell's notice. */
  readonly onNotice: (message: string) => void;
}

const NO_SHEETS: readonly TraceSheet[] = Object.freeze([]);

const NO_COLLABORATORS: readonly CollaboratorSummary[] = Object.freeze([]);

function noUnsubscribe(): void {
  // Nothing was subscribed.
}

/**
 * Follows the board's trace sheets (`TraceSheetTracker`), armed once the connection has first
 * synced, so nothing already on the board lands on a sheet.
 *
 * @param connection - The board's connection.
 * @returns The tracker, while there is a connection.
 */
function useTracker(connection: BoardConnection | undefined): TraceSheetTracker | undefined {
  const [tracker, setTracker] = useState<TraceSheetTracker>();
  useEffect(() => {
    if (connection === undefined) return undefined;
    const next = new TraceSheetTracker(connection.store);
    const arm = (): void => {
      if (connection.status().state === 'connected') next.arm();
    };
    arm();
    const stop = connection.subscribe(arm);
    setTracker(next);
    return () => {
      stop();
      next.destroy();
      setTracker(undefined);
    };
  }, [connection]);
  return tracker;
}

/**
 * Draws the tint of the open sheets whenever a sheet or one of its objects changes, sending
 * the engine a model only when the sheets' bounds changed; hides it on unmount.
 *
 * @param tracker - The sheets.
 * @param options - The connection, engine and colour.
 * @returns The placed sheets, as last drawn.
 */
function useTint(
  tracker: TraceSheetTracker | undefined,
  options: UseTraceSheetsOptions,
): () => readonly PlacedTraceSheet[] {
  const { connection, engine, color } = options;
  const placed = useRef<readonly PlacedTraceSheet[]>([]);
  useEffect(() => {
    if (tracker === undefined || connection === undefined) return undefined;
    let drawn = '[]';
    const draw = (): void => {
      placed.current = placeSheets(connection.store, tracker.sheets());
      const model = traceTintOf(placed.current, color);
      const key = JSON.stringify(model);
      if (key === drawn) return;
      drawn = key;
      engine?.showTraceTint?.(model);
    };
    draw();
    const stop = tracker.subscribe(draw);
    return () => {
      stop();
      placed.current = [];
      if (drawn !== '[]') engine?.showTraceTint?.(EMPTY_TRACE_TINT);
    };
  }, [tracker, connection, engine, color]);
  return useCallback(() => placed.current, []);
}

/**
 * The agents of the open sheets as presence has shown them (`followSheetAgents`), judged only
 * while the person's connection is up, and taken for stopped only once presence has settled
 * after it came up ({@link PRESENCE_SETTLE_MS}), so the person's own lost connection, or their
 * reconnect before the relay's presence reaches them, never reads as the agents stopping.
 *
 * @param sheets - The open sheets.
 * @param collaborators - Who is on the board.
 * @param isConnected - Whether the person's connection is up.
 * @returns What presence has shown of each sheet's agent.
 */
function useSheetAgents(
  sheets: readonly TraceSheet[],
  collaborators: readonly CollaboratorSummary[],
  isConnected: boolean,
): SheetAgents {
  const [agents, setAgents] = useState<SheetAgents>(NO_SHEET_AGENTS);
  const [isSettled, setSettled] = useState(false);
  useEffect(() => {
    if (!isConnected) {
      setSettled(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setSettled(true);
    }, PRESENCE_SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isConnected]);
  const key = sheetPresenceKey(sheets, collaborators);
  useEffect(() => {
    if (!isConnected) return;
    setAgents((previous) => followSheetAgents(previous, sheets, collaborators, isSettled));
    // Keyed by what presence shows of the sheets' agents, not the arrays: the status is new on
    // every sync step and cursor move, and following each would update the shell in a loop.
  }, [key, isConnected, isSettled]);
  return agents;
}

/**
 * The trace sheets for the shell: the open sheets with their agents' names (from
 * presence), the engine's tint over them, the live region's sentence when one opens, and Keep
 * and Lift off. A sheet whose agent left presence while it was open is stopped: it
 * keeps the name presence last gave the agent, and comes back to work when the agent does. Lift off runs `liftOff` of `@canvas/document` under the person's origin, one
 * undo step in their history, and shows what it kept (`liftOffNotice`). Main thread.
 *
 * @param options - The connection, the engine, the agent colour and the notice.
 * @returns The binding.
 */
export function useTraceSheets(options: UseTraceSheetsOptions): TraceSheetsBinding {
  const { connection, onNotice } = options;
  const tracker = useTracker(connection);
  const sheets = useSyncExternalStore(
    useCallback((listener) => tracker?.subscribe(listener) ?? noUnsubscribe, [tracker]),
    () => tracker?.sheets() ?? NO_SHEETS,
  );
  const status = useSyncExternalStore(
    useCallback((listener) => connection?.subscribe(listener) ?? noUnsubscribe, [connection]),
    () => connection?.status(),
  );
  const collaborators = status?.collaborators ?? NO_COLLABORATORS;
  const agents = useSheetAgents(sheets, collaborators, status?.state === 'connected');
  const nameOf = (agentId: PrincipalId): string =>
    agentNameOf(agentId, collaborators, agents.get(agentId)?.name);
  const views = sheets.map((sheet) => ({
    agentId: sheet.agentId,
    name: nameOf(sheet.agentId),
    count: sheet.memberIds.length,
    isStopped: agents.get(sheet.agentId)?.isStopped === true,
  }));
  const placed = useTint(tracker, options);
  const announcement = useAnnouncement(views);
  const keep = useCallback((agentId: PrincipalId) => tracker?.close(agentId), [tracker]);
  const lift = (agentId: PrincipalId): void => {
    const sheet = sheets.find((candidate) => candidate.agentId === agentId);
    if (connection === undefined || tracker === undefined || sheet === undefined) return;
    const environment = { clock: () => Date.now(), createId: createRandomObjectId };
    const outcome = liftOff(connection.store, connection.origin, sheet.memberIds, environment);
    tracker.close(agentId);
    const message = liftOffNotice(outcome, nameOf(agentId));
    if (message !== undefined) onNotice(message);
  };
  return { sheets: views, announcement, placed, keep, liftOff: lift };
}

/**
 * The live region's sentence: set when a sheet opens for an agent that had none.
 *
 * @param views - The open sheets.
 * @returns The sentence; empty until a sheet opens.
 */
function useAnnouncement(views: readonly TraceSheetView[]): string {
  const [announcement, setAnnouncement] = useState('');
  const seen = useRef(new Set<PrincipalId>());
  const key = views.map(({ agentId, name }) => `${agentId}=${name}`).join('\n');
  useEffect(() => {
    const open = new Set(views.map(({ agentId }) => agentId));
    const opened = views.find(({ agentId }) => !seen.current.has(agentId));
    seen.current = open;
    if (opened !== undefined) {
      setAnnouncement(`${opened.name} is working on a trace sheet.`);
    }
    // Keyed by the sheets' agents and names, not the array, which is new on every render.
  }, [key]);
  return announcement;
}
