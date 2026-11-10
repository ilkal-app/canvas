import { useEffect, useState, type ReactElement } from 'react';

import type { MountedEngine } from '../../engine/mounted-engine.js';

import type { HostFrame } from './host-frame-feed.js';
import styles from './ink-debug-readout.module.css';
import { InkLatencyTracker, type InkLatencySummary, type InkStrokeSummary } from './ink-latency.js';

/** How often the readout redraws its figures, ms. */
const REFRESH_MS = 250;

/** Frame intervals kept for the medians. */
const INTERVALS_KEPT = 60;

/** The longest gap between two engine frames that still counts as spacing, ms; a pause is not. */
const MAX_SPACING_MS = 100;

/**
 * The median of the recent intervals between timestamps. Pure.
 *
 * @param times - Timestamps, oldest first.
 * @param maxGapMs - Longer intervals are left out (a pause between strokes).
 * @returns The median interval, ms; 0 with fewer than two.
 */
function medianInterval(times: readonly number[], maxGapMs = Infinity): number {
  const gaps = times
    .slice(1)
    .map((time, index) => time - (times[index] ?? time))
    .filter((gap) => gap <= maxGapMs);
  if (gaps.length === 0) return 0;
  const sorted = [...gaps].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/**
 * Which pointer features the browser has: coalesced and predicted events, raw updates.
 *
 * @returns Them, as a line.
 */
function pointerFeatures(): string {
  const prototype = typeof PointerEvent === 'function' ? PointerEvent.prototype : undefined;
  const yes = (has: boolean): string => (has ? 'yes' : 'no');
  return [
    `coalesced ${yes(prototype !== undefined && 'getCoalescedEvents' in prototype)}`,
    `predicted ${yes(prototype !== undefined && 'getPredictedEvents' in prototype)}`,
    `rawupdate ${yes('onpointerrawupdate' in window)}`,
  ].join(' · ');
}

/**
 * A latency summary as a line.
 *
 * @param label - What it measures.
 * @param summary - The figures.
 * @returns The line.
 */
function lineOf(label: string, summary: InkLatencySummary): string {
  if (summary.count === 0) return `${label}: draw a stroke`;
  return `${label}: p50 ${summary.p50Ms.toFixed(1)} ms · max ${summary.maxMs.toFixed(1)} ms (${String(summary.count)})`;
}

/** What the readout shows. */
interface Readout {
  readonly engine: string;
  readonly rates: string;
  /** Input → the page overlay's paint, and → the next page frame; empty with the ink in the engine. */
  readonly painted: string;
  readonly drawn: string;
  readonly presented: string;
}

/** What the readout's figures are drawn from. */
interface ReadoutSource {
  /** The latest engine frame, if any. */
  readonly last: HostFrame | undefined;
  /** Whether the live stroke is drawn on the page's overlay rather than by the engine. */
  readonly isOnPage: boolean;
  /** The stroke's latencies. */
  readonly summary: InkStrokeSummary;
  /** Recent timestamps: page frames, engine frames that drew input, and overlay paints. */
  readonly frames: {
    readonly page: readonly number[];
    readonly engine: readonly number[];
    readonly overlay: readonly number[];
  };
  /** The browser's pointer features, as a line. */
  readonly features: string;
}

/**
 * The readout's lines. With the ink on the page, the overlay's figures lead and the engine's are
 * its hidden preview's, not the ink seen. Pure.
 *
 * @param source - The figures.
 * @returns The lines.
 */
function readoutOf(source: ReadoutSource): Readout {
  const { last, isOnPage, summary, frames, features } = source;
  const display = `display ${medianInterval(frames.page).toFixed(1)} ms`;
  const engineSpacing = `${isOnPage ? 'engine drew' : 'drawn'} input every ${medianInterval(frames.engine, MAX_SPACING_MS).toFixed(1)} ms`;
  const paintSpacing = `ink painted every ${medianInterval(frames.overlay, MAX_SPACING_MS).toFixed(1)} ms`;
  const enginePrefix = isOnPage ? 'engine (hidden preview): ' : '';
  return {
    engine:
      last === undefined
        ? 'engine: no frame yet'
        : `engine: ${last.hostKind} · ${last.backendName} · ink ${isOnPage ? 'on page' : 'in engine'}`,
    rates: `${[display, ...(isOnPage ? [paintSpacing] : []), engineSpacing].join(' · ')}\n${features}`,
    painted: isOnPage
      ? [
          lineOf('input → ink painted on page', summary.painted),
          lineOf('input → next page frame after the paint (not presented)', summary.paintPresented),
        ].join('\n')
      : '',
    drawn: lineOf(`${enginePrefix}input → drawn`, summary.drawn),
    presented: lineOf(`${enginePrefix}input → next page frame (not presented)`, summary.presented),
  };
}

/**
 * The ink latency readout (`?inkdebug=1`): where the engine runs and what it draws
 * with, the display's frame interval beside the observed spacing of the engine's frames that
 * drew input (pauses left out), which pointer features the browser has, and the stroke being
 * drawn's input → frame drawn and input → next page frame, as median and maximum. With the ink
 * on the page (the live ink overlay), it leads with input → the overlay's paint and the spacing
 * of its paints, and marks the engine's figures as its hidden preview's. The spacing
 * is what was rendered, not the engine's frame clock: the engine draws on demand and the page
 * sends the next batch once a frame is acknowledged, so it can be wider than the display's
 * with the worker on its own animation frames. Input → next page frame is a proxy for
 * presentation, which the page cannot see. It listens to the engine's frames and runs a page
 * animation frame only while it is shown; nothing of it runs otherwise.
 *
 * @param props - The engine.
 * @param props.engine - The mounted engine, once it runs.
 * @returns The panel.
 */
export function InkDebugReadout(props: {
  readonly engine: MountedEngine | undefined;
}): ReactElement {
  const { engine } = props;
  const [readout, setReadout] = useState<Readout>({
    engine: 'engine: starting',
    rates: '',
    painted: '',
    drawn: '',
    presented: '',
  });
  useEffect(() => {
    const feed = engine?.hostFrames;
    if (feed === undefined) return undefined;
    const tracker = new InkLatencyTracker();
    const pageFrames: number[] = [];
    const engineFrames: number[] = [];
    const overlayPaints: number[] = [];
    let last: HostFrame | undefined;
    const stop = feed.subscribe((frame) => {
      last = frame;
      if (frame.report.pointerInputs.length > 0) engineFrames.push(frame.report.frameTimeMs);
      if (engineFrames.length > INTERVALS_KEPT) engineFrames.shift();
      tracker.frame(frame.report.pointerInputs, frame.receivedMs);
    });
    const stopPaints = engine?.liveInk?.subscribePaints((paint) => {
      tracker.overlayPaint(paint.strokeId, paint.inputMs, paint.paintedMs);
      overlayPaints.push(paint.paintedMs);
      if (overlayPaints.length > INTERVALS_KEPT) overlayPaints.shift();
    });
    let request = 0;
    const tick = (frameMs: number): void => {
      tracker.pageFrame(frameMs);
      pageFrames.push(frameMs);
      if (pageFrames.length > INTERVALS_KEPT) pageFrames.shift();
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    const features = pointerFeatures();
    const timer = setInterval(() => {
      setReadout(
        readoutOf({
          last,
          isOnPage: engine?.liveInk?.isAttached() === true,
          summary: tracker.summary(),
          frames: { page: pageFrames, engine: engineFrames, overlay: overlayPaints },
          features,
        }),
      );
    }, REFRESH_MS);
    return () => {
      stop();
      stopPaints?.();
      cancelAnimationFrame(request);
      clearInterval(timer);
    };
  }, [engine]);
  return (
    <div className={styles.readout} data-ink-debug="" aria-hidden="true">
      {[readout.engine, readout.rates, readout.painted, readout.drawn, readout.presented]
        .filter(Boolean)
        .join('\n')}
    </div>
  );
}
