import type { ReactElement } from 'react';

import type { RecentFrame } from '@canvas/engine';

import overlayStyles from './developer-overlay.module.css';
import { formatCount, formatMs } from './format-diagnostics.js';
import { FRAME_BUDGET_MS, stageSegments } from './frame-bars.js';
import styles from './frame-debug-view.module.css';

/** Props of {@link FrameDebugView}. */
export interface FrameDebugViewProps {
  /** The sample's recent frames, oldest first (`BenchmarkSample.recentFrames`). */
  readonly frames: readonly RecentFrame[];
}

/**
 * The frame debug view: a bar per recent frame, oldest at the top, its CPU time per
 * stage laid end to end against a 60 Hz frame (the plot's width), and the newest frame's
 * counters. Reads only the sample the overlay already
 * polls; it times nothing itself.
 *
 * @param props - The frames.
 * @param props.frames - The sample's recent frames, oldest first.
 * @returns The view.
 */
export function FrameDebugView({ frames }: FrameDebugViewProps): ReactElement {
  const newest = frames.at(-1);
  if (newest === undefined) return <p className={overlayStyles.note}>No frames yet.</p>;
  const rows: readonly (readonly [string, string])[] = [
    ['Draw calls', formatCount(newest.drawCalls)],
    ['Segments', formatCount(newest.segments)],
    ['Visible records', formatCount(newest.visibleRecords)],
    ['Render passes', formatCount(newest.renderPasses)],
    ['Pipeline switches', formatCount(newest.pipelineSwitches)],
    ['Past budget', formatMs(newest.pastBudgetMs)],
  ];
  return (
    <>
      <div className={styles.plot}>
        {frames.map((frame) => (
          <div
            key={frame.frameIndex}
            role="img"
            aria-label={`Frame ${String(frame.frameIndex)}: ${formatMs(frame.cpuMs)} CPU`}
            className={styles.bar}
          >
            {stageSegments(frame, FRAME_BUDGET_MS).map((segment) => (
              <span
                key={segment.stage}
                title={`${segment.stage} ${formatMs(segment.ms)}`}
                className={styles.segment}
                style={{ width: `${String(segment.fraction * 100)}%` }}
              />
            ))}
          </div>
        ))}
      </div>
      <table className={overlayStyles.table}>
        <caption className={overlayStyles.caption}>Newest frame</caption>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" className={overlayStyles.label}>
                {label}
              </th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
