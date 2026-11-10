import { useEffect, useMemo, useRef, type ReactElement, type RefObject } from 'react';

import type { Camera } from '@canvas/engine';

import type { BoardConnection } from '../collab/board-connection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { PostedToast } from '../feedback/toast-region.js';
import type { ToastContent } from '../feedback/toast.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import { agentColorOf } from './agent-color.js';
import type { PlacedTraceSheet } from './trace-sheet-bounds.js';
import { placeTabs, tabSizesOf } from './trace-sheet-placement.js';
import styles from './trace-sheets.module.css';
import { useTraceSheets, type TraceSheetView } from './use-trace-sheets.js';

/** Props of {@link TraceSheets}. */
export interface TraceSheetsProps {
  /** The board's connection; nothing shows without one. */
  readonly connection: BoardConnection | undefined;
  /** The engine on the canvas: its camera places the tabs, and it draws the tint. */
  readonly engine: MountedEngine | undefined;
  /** Whether the person may edit the board: only then are Keep and Lift off offered. */
  readonly canEdit: boolean;
  /** The theme, whose agent colour the tint takes. */
  readonly themeName: ThemeName;
  /** Shows a sentence in the shell's notice (what Lift off kept). */
  readonly onNotice: (message: string) => void;
}

/** Props of {@link TraceSheetTab}. */
interface TraceSheetTabProps {
  readonly sheet: TraceSheetView;
  readonly canEdit: boolean;
  readonly onKeep: () => void;
  readonly onLiftOff: () => void;
}

/**
 * The notice of a stopped agent: what happened and that its draft stays,
 * with Ask again shown but not available yet (the app cannot ask an external MCP agent to
 * retry; the in-product AI entries, to, will).
 *
 * @param name - The agent's name.
 * @returns The toast.
 */
function stoppedToast(name: string): ToastContent {
  return {
    kind: 'error',
    message: `${name} stopped: connection lost. What it drafted stays on the sheet.`,
    action: { label: 'Ask again', onAction: noAction, isAvailable: false },
  };
}

function noAction(): void {
  // Ask again is not available yet.
}

/**
 * One sheet's tab (Figma `tape tab`, node 7:436): the agent's badge and name, how many objects
 * the sheet holds, and, for a person who can edit, Lift off and Keep sheet. A stopped agent's
 * tab reads "<name> · stopped", and the X4 notice, an Error toast with Ask again, shows in the
 * toast region over the dock (item 4) for as long as the agent is stopped.
 *
 * @param props - The sheet, whether the person can edit, and the two actions.
 * @returns The tab, placed by {@link TraceSheets}.
 */
function TraceSheetTab(props: TraceSheetTabProps): ReactElement {
  const { sheet, canEdit } = props;
  const titleId = `trace-sheet-${sheet.agentId}`;
  const objects = sheet.count === 1 ? '1 object' : `${String(sheet.count)} objects`;
  return (
    <section
      className={styles.tab}
      aria-labelledby={titleId}
      data-trace-sheet={sheet.agentId}
      data-placed="false"
      data-stopped={sheet.isStopped}
    >
      <PostedToast toast={sheet.isStopped ? stoppedToast(sheet.name) : undefined} isPersistent />
      <span className={styles.badge} aria-hidden="true" />
      <div className={styles.text}>
        <h2 id={titleId} className={styles.title}>
          {sheet.isStopped ? `${sheet.name} · stopped` : `${sheet.name}’s trace sheet`}
        </h2>
        <p className={styles.caption}>{objects} so far · on its own sheet</p>
      </div>
      {canEdit && (
        <>
          <button type="button" className={styles.button} onClick={props.onLiftOff}>
            Lift off
          </button>
          <button
            type="button"
            className={styles.button}
            data-primary="true"
            onClick={props.onKeep}
          >
            Keep sheet
          </button>
        </>
      )}
    </section>
  );
}

/** What the tabs were last placed for: the camera, the sheets, the layer's and tabs' sizes. */
interface Placement {
  readonly camera: Camera;
  readonly sheets: readonly PlacedTraceSheet[];
  readonly width: number;
  readonly height: number;
  /** The tabs' measured sizes (`tabSizesOf`). */
  readonly tabSizes: string;
}

/**
 * Whether the tabs placed for one placement stand as they are for another: the same camera, the
 * same placed sheets (the list is replaced whenever a sheet changes), the same layer size and the
 * same tab sizes (a name, buttons, a font or a notice can change those with nothing else).
 *
 * @param last - What the tabs were last placed for, if anything.
 * @param next - What they would be placed for now.
 * @returns Whether placing them again would write the same styles.
 */
function isSamePlacement(last: Placement | undefined, next: Placement): boolean {
  if (last === undefined) return false;
  const [a, b] = [last.camera, next.camera];
  return (
    last.sheets === next.sheets &&
    last.width === next.width &&
    last.height === next.height &&
    last.tabSizes === next.tabSizes &&
    a.x === b.x &&
    a.y === b.y &&
    a.zoom === b.zoom &&
    a.viewportWidthPx === b.viewportWidthPx &&
    a.viewportHeightPx === b.viewportHeightPx
  );
}

/**
 * Keeps each tab at its sheet's top-left corner on screen, every page frame while a sheet is
 * open, from the camera the canvas shows (a glide included), clamped inside the canvas; a tab
 * whose sheet has no bounds is docked instead (`placeTabs`). Writes styles directly, so a pan
 * renders nothing in React. With no sheet open it asks for no frame at all (the idle
 * tick cost 0.7 ms of every main-thread frame), and a frame where nothing it reads changed
 * writes nothing.
 *
 * @param layer - The tabs' layer.
 * @param engine - The engine, for its camera.
 * @param placed - The sheets with their bounds.
 * @param tabs - What the shown tabs say, changing whenever a tab is added, removed or reworded,
 *   so each change is placed afresh; empty when no sheet is open.
 */
function useTabPlacement(
  layer: RefObject<HTMLDivElement | null>,
  engine: MountedEngine | undefined,
  placed: () => readonly PlacedTraceSheet[],
  tabs: string,
): void {
  useEffect(() => {
    if (engine === undefined || tabs === '') return undefined;
    let frame = 0;
    let last: Placement | undefined;
    const tick = (): void => {
      const root = layer.current;
      if (root !== null) {
        const next: Placement = {
          camera: engine.camera(),
          sheets: placed(),
          width: root.clientWidth,
          height: root.clientHeight,
          tabSizes: tabSizesOf(root),
        };
        if (!isSamePlacement(last, next)) {
          placeTabs(root, { camera: () => next.camera }, next.sheets);
          last = next;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [layer, engine, placed, tabs]);
}

/**
 * The trace sheets over the canvas (Figma `04 · Agent working — trace sheet`): when
 * an agent creates objects on the board, its sheet's tint (drawn by the engine) and a tab at
 * the sheet's corner with the agent's name and, for a person who can edit, Keep sheet (closes
 * the sheet, the board as it is) and Lift off (deletes the sheet's objects as one undo step,
 * keeping those a person changed since, with a notice). A viewer sees the tint and the name.
 * A polite live region announces each sheet that opens; the buttons are in the tab order. When
 * the agent leaves presence while its sheet is open, the tab says it stopped, with
 * the notice in the toast region; the objects stay, and Keep and Lift off work as before.
 *
 * @param props - The connection, engine, editing right, theme and notice.
 * @returns The layer.
 */
export function TraceSheets(props: TraceSheetsProps): ReactElement | null {
  const { connection, engine, canEdit, themeName, onNotice } = props;
  const color = useMemo(() => agentColorOf(themeName), [themeName]);
  const binding = useTraceSheets({ connection, engine, color, onNotice });
  const layer = useRef<HTMLDivElement>(null);
  const tabs = binding.sheets
    .map((sheet) => `${sheet.agentId}:${String(sheet.count)}:${String(sheet.isStopped)}`)
    .join(' ');
  useTabPlacement(layer, engine, binding.placed, tabs);
  if (connection === undefined) return null;
  return (
    <div ref={layer} className={styles.layer}>
      <p role="status" className={styles.announcer}>
        {binding.announcement}
      </p>
      {binding.sheets.map((sheet) => (
        <TraceSheetTab
          key={sheet.agentId}
          sheet={sheet}
          canEdit={canEdit}
          onKeep={() => {
            binding.keep(sheet.agentId);
          }}
          onLiftOff={() => {
            binding.liftOff(sheet.agentId);
          }}
        />
      ))}
    </div>
  );
}
