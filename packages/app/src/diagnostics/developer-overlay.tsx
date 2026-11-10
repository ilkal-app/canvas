import { useId, useRef, useState, type ReactElement } from 'react';

import type { BenchmarkSample, MemoryCategory, PercentilePair } from '@canvas/engine';

import { usePolledValue } from '../hooks/use-polled-value.js';

import { useBelowTopBars } from './below-top-bars.js';
import styles from './developer-overlay.module.css';
import { formatBytes, formatCount, formatFps, formatMs } from './format-diagnostics.js';
import { FrameDebugView } from './frame-debug-view.js';
import { frameRateOf, type FrameRateReading } from './frame-rate.js';

/** What the overlay leaves free at the canvas's bottom, CSS px (`--space-3`). */
const OVERLAY_BOTTOM_INSET_PX = 12;

/** How often the overlay reads the frame statistics: 4 Hz, so it cannot itself cost frames. */
export const DEVELOPER_OVERLAY_POLL_INTERVAL_MS = 250;

/**
 * How often the overlay recomputes its frames-per-second figures: about twice a second, slower
 * than {@link DEVELOPER_OVERLAY_POLL_INTERVAL_MS}, so the number stays readable rather than
 * flickering with every other reading.
 */
export const DEVELOPER_OVERLAY_FPS_POLL_INTERVAL_MS = 500;

/**
 * Summarises the engine's recent frames, now or with a promise: `MountedEngine.readFrameStats`,
 * which a worker answers a message later, or `() => createBenchmarkSample(stageTimers.history)`.
 */
export type FrameStatsReader = () => BenchmarkSample | PromiseLike<BenchmarkSample>;

/** Props of {@link DeveloperOverlay}. */
export interface DeveloperOverlayProps {
  /**
   * Reads the engine's frame statistics; called at 4 Hz. The shell passes its engine's, which
   * records them while the overlay is open; without one the overlay says there are none.
   */
  readonly readFrameStats?: FrameStatsReader | undefined;
  /**
   * Reads the engine's recent frame timestamps (`MountedEngine.frameTimesMs`), for the current
   * and lowest frames-per-second figures (`frameRateOf`); called at
   * {@link DEVELOPER_OVERLAY_FPS_POLL_INTERVAL_MS}, always synchronously (no worker round trip:
   * the shell keeps this from the engine's frame reports, wherever the engine runs). Without
   * one the frame rate is left out.
   */
  readonly readFrameTimesMs?: (() => readonly number[]) | undefined;
  /**
   * The current time, the same clock as `readFrameTimesMs`'s timestamps (the page's clock,
   * `performance.now()`, even when the engine runs in a worker). Default `performance.now`;
   * tests pass their own.
   */
  readonly now?: (() => number) | undefined;
}

const MEMORY_LABELS: Readonly<Record<MemoryCategory, string>> = {
  instanceBuffers: 'Instance buffers',
  atlases: 'Glyph atlases',
  textures: 'Textures',
  meshes: 'Path meshes',
  uniforms: 'Uniforms',
  layers: 'Layers',
};

/** One row of an overlay table: a label and its two values. */
type Row = readonly [label: string, first: string, second: string];

/**
 * The developer overlay: CPU
 * time per stage, GPU time per pass, GPU memory per category and the per-frame counters of the
 * engine's recent frames, as p50 and p95. It reads the statistics at
 * {@link DEVELOPER_OVERLAY_POLL_INTERVAL_MS}, never per frame, and lets pointer input through
 * to the canvas beneath, all but its "Frame bars" toggle, which shows a bar per recent frame.
 * Shown and hidden with mod+shift+d.
 *
 * @param props - Where to read the statistics from.
 * @returns The overlay.
 */
export function DeveloperOverlay(props: DeveloperOverlayProps): ReactElement {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  useBelowTopBars(sectionRef, OVERLAY_BOTTOM_INSET_PX);
  const sample = usePolledValue(props.readFrameStats, DEVELOPER_OVERLAY_POLL_INTERVAL_MS);
  const { readFrameTimesMs } = props;
  const now = props.now ?? (() => performance.now());
  const frameRate = usePolledValue(
    readFrameTimesMs === undefined ? undefined : () => frameRateOf(readFrameTimesMs(), now()),
    DEVELOPER_OVERLAY_FPS_POLL_INTERVAL_MS,
  );
  const [isShowingBars, setShowingBars] = useState(false);
  return (
    <section ref={sectionRef} className={styles.overlay} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Developer overlay
      </h2>
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={isShowingBars}
        onClick={() => {
          setShowingBars((isShowing) => !isShowing);
        }}
      >
        Frame bars
      </button>
      {isShowingBars && sample !== undefined && <FrameDebugView frames={sample.recentFrames} />}
      {frameRate !== undefined && <FrameRateView reading={frameRate} />}
      {sample === undefined ? (
        <p className={styles.note}>
          {props.readFrameStats === undefined
            ? 'No frame statistics: the engine does not report them to the shell.'
            : 'Waiting for frame statistics from the engine.'}
        </p>
      ) : (
        <FrameStatsView sample={sample} />
      )}
    </section>
  );
}

/**
 * The current and lowest frames-per-second figures, as a table row so its digits line up with
 * the rest of the overlay.
 *
 * @param props - The reading.
 * @param props.reading - The current and lowest FPS, or `'idle'` where nothing was drawn.
 * @returns The table.
 */
function FrameRateView({ reading }: { readonly reading: FrameRateReading }): ReactElement {
  return (
    <StatsTable
      caption="Frame rate"
      columns={['Now', 'Low 5 s']}
      rows={[['FPS', formatFps(reading.currentFps), formatFps(reading.lowFps)]]}
    />
  );
}

/**
 * The statistics of a sample with frames, or a note that none have been measured.
 *
 * @param props - The sample.
 * @param props.sample - The engine's frame statistics.
 * @returns The tables.
 */
function FrameStatsView({ sample }: { readonly sample: BenchmarkSample }): ReactElement {
  if (sample.frames === 0) return <p className={styles.note}>Waiting for the first frame.</p>;
  const passRows = percentileRows(sample.passes);
  const memoryRows = (Object.keys(MEMORY_LABELS) as MemoryCategory[]).map((category): Row => [
    MEMORY_LABELS[category],
    formatBytes(sample.memory[category].bytes),
    formatBytes(sample.memory[category].peakBytes),
  ]);
  const { p50, p95 } = sample;
  return (
    <>
      <p className={styles.note}>
        {`${formatCount(sample.frames)} frames, p50 and p95; `}
        {`slowest of ${formatCount(sample.runFrames)}: ${formatMs(sample.max.cpuMs)}`}
      </p>
      <StatsTable
        caption="CPU time per stage"
        columns={['p50', 'p95']}
        rows={[
          ['Frame', formatMs(p50.cpuMs), formatMs(p95.cpuMs)],
          ...percentileRows(sample.stages),
        ]}
      />
      {passRows.length > 0 ? (
        <StatsTable caption="GPU time per pass" columns={['p50', 'p95']} rows={passRows} />
      ) : (
        <p className={styles.note}>No GPU pass timings: the GPU cannot time passes.</p>
      )}
      <StatsTable caption="GPU memory" columns={['Now', 'Peak']} rows={memoryRows} />
      <StatsTable
        caption="Per frame"
        columns={['p50', 'p95']}
        rows={[
          ['Draw calls', formatCount(p50.drawCalls), formatCount(p95.drawCalls)],
          ['Uploaded', formatBytes(p50.uploadedBytes), formatBytes(p95.uploadedBytes)],
          ['Buffer writes', formatCount(p50.bufferWrites), formatCount(p95.bufferWrites)],
          ['Changed objects', formatCount(p50.changedObjects), formatCount(p95.changedObjects)],
          ['Visible records', formatCount(p50.visibleRecords), formatCount(p95.visibleRecords)],
          ['Vector text runs', formatCount(p50.vectorTextRuns), formatCount(p95.vectorTextRuns)],
        ]}
      />
    </>
  );
}

/**
 * Rows of named millisecond percentiles.
 *
 * @param pairs - p50 and p95 in ms by name.
 * @returns One row per name, in the record's order.
 */
function percentileRows(pairs: Readonly<Record<string, PercentilePair>>): Row[] {
  return Object.entries(pairs).map(([name, { p50, p95 }]): Row => [
    name,
    formatMs(p50),
    formatMs(p95),
  ]);
}

/**
 * A captioned table: a header row, then one row per label with two values.
 *
 * @param props - The table's content.
 * @param props.caption - The table's name.
 * @param props.columns - The two value columns' headings.
 * @param props.rows - The rows.
 * @returns The table.
 */
function StatsTable(props: {
  readonly caption: string;
  readonly columns: readonly [string, string];
  readonly rows: readonly Row[];
}): ReactElement {
  const { caption, columns, rows } = props;
  return (
    <table className={styles.table}>
      <caption className={styles.caption}>{caption}</caption>
      <thead>
        <tr>
          <td />
          <th scope="col">{columns[0]}</th>
          <th scope="col">{columns[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, first, second]) => (
          <tr key={label}>
            <th scope="row" className={styles.label}>
              {label}
            </th>
            <td>{first}</td>
            <td>{second}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
