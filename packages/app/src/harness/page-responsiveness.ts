import type { EngineFrameReport } from '@canvas/engine';

import type { PageLongTask } from './page-latency.js';

/** How many long tasks and frame receipts the recorder keeps. */
const KEPT_ENTRIES = 1_000;

/**
 * How responsive the page stays while the engine draws (for the benchmark harness): the
 * page's long tasks, and for each pointer input a frame report carried, the time from the input
 * event to the page hearing that the frame which took it was drawn (input-to-frame latency: the
 * page's own handling, the message to the engine, the wait for and the work of its frame, the
 * report back). Records from its creation; a browser without `longtask` entries records none.
 * Keyboard inputs are the window's capture-phase `beforeinput` events: each settles on
 * the first frame report drawn after it (`frameTimeMs` past its time stamp), its latency the
 * time from the event to the page receiving that report. Main thread.
 */
export class PageResponsiveness {
  private longTaskList: PageLongTask[] = [];
  private longFrameList: PageLongTask[] = [];
  private latencies: { readonly receivedMs: number; readonly latencyMs: number }[] = [];
  private keyLatencies: { readonly eventMs: number; readonly latencyMs: number }[] = [];
  private pendingKeysMs: number[] = [];
  private readonly observers: PerformanceObserver[] = [];
  private readonly onKeyInput = (event: Event): void => {
    this.pendingKeysMs.push(event.timeStamp);
    if (this.pendingKeysMs.length > KEPT_ENTRIES)
      this.pendingKeysMs = this.pendingKeysMs.slice(-KEPT_ENTRIES);
  };
  /** Whether this browser reports long tasks (`longtask` entries); none are recorded without. */
  readonly canObserveLongTasks: boolean;
  /**
   * Whether this browser reports long animation frames (`long-animation-frame` entries): without
   * them a freeze cannot show as one, so a run checks it.
   */
  readonly canObserveLongAnimationFrames: boolean;

  /** Starts observing the page's long tasks and keyboard inputs. */
  constructor() {
    if (typeof window !== 'undefined')
      window.addEventListener('beforeinput', this.onKeyInput, { capture: true });
    const supports = (type: string): boolean =>
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes.includes(type);
    this.canObserveLongTasks = supports('longtask');
    this.canObserveLongAnimationFrames = supports('long-animation-frame');
    const observe = (type: string, keep: (entries: PageLongTask[]) => void): void => {
      if (!supports(type)) return;
      const observer = new PerformanceObserver((list) => {
        keep(
          list.getEntries().map((entry) => ({
            startMs: entry.startTime,
            durationMs: entry.duration,
          })),
        );
      });
      observer.observe({ type });
      this.observers.push(observer);
    };
    observe('longtask', (entries) => {
      this.longTaskList = [...this.longTaskList, ...entries].slice(-KEPT_ENTRIES);
    });
    observe('long-animation-frame', (entries) => {
      this.longFrameList = [...this.longFrameList, ...entries].slice(-KEPT_ENTRIES);
    });
  }

  /**
   * Takes a frame report as it arrives on the page.
   *
   * @param report - The report.
   * @param receivedMs - When the page received it, ms on the page's clock.
   */
  record(report: EngineFrameReport, receivedMs: number): void {
    for (const input of report.pointerInputs) {
      this.latencies.push({ receivedMs, latencyMs: receivedMs - input.timestampMs });
    }
    if (this.latencies.length > KEPT_ENTRIES) this.latencies = this.latencies.slice(-KEPT_ENTRIES);
    const settled = this.pendingKeysMs.filter((eventMs) => eventMs < report.frameTimeMs);
    if (settled.length === 0) return;
    this.pendingKeysMs = this.pendingKeysMs.filter((eventMs) => eventMs >= report.frameTimeMs);
    for (const eventMs of settled) {
      this.keyLatencies.push({ eventMs, latencyMs: receivedMs - eventMs });
    }
    if (this.keyLatencies.length > KEPT_ENTRIES)
      this.keyLatencies = this.keyLatencies.slice(-KEPT_ENTRIES);
  }

  /**
   * The page's long tasks that began at or after a time.
   *
   * @param sinceMs - The time, ms on the page's clock.
   * @returns The tasks, oldest first.
   */
  longTasks(sinceMs: number): PageLongTask[] {
    return this.longTaskList.filter(({ startMs }) => startMs >= sinceMs);
  }

  /**
   * Long animation frames include a frame delayed by several individually short tasks.
   *
   * @param sinceMs - Start time on the page clock, ms.
   * @returns Matching frames, oldest first; empty on browsers without this observer.
   */
  longAnimationFrames(sinceMs: number): PageLongTask[] {
    return this.longFrameList.filter(({ startMs }) => startMs >= sinceMs);
  }

  /**
   * The input-to-frame latencies of the frames received at or after a time.
   *
   * @param sinceMs - The time, ms on the page's clock.
   * @returns The latencies, ms, in the order the frames arrived.
   */
  inputLatenciesMs(sinceMs: number): number[] {
    return this.latencies
      .filter(({ receivedMs }) => receivedMs >= sinceMs)
      .map(({ latencyMs }) => latencyMs);
  }

  /**
   * The input-to-frame latencies of the keyboard inputs made at or after a time: for
   * each, the time from the event to the page receiving the first frame report drawn after it.
   * Inputs still waiting for such a frame are left out.
   *
   * @param sinceMs - The time, ms on the page's clock, compared with each event's time stamp.
   * @returns The latencies, ms, in the order the inputs were made.
   */
  keyInputLatenciesMs(sinceMs: number): number[] {
    return this.keyLatencies
      .filter(({ eventMs }) => eventMs >= sinceMs)
      .map(({ latencyMs }) => latencyMs);
  }

  /**
   * How many keyboard inputs made at or after a time still wait for a frame drawn after them:
   * the inputs {@link PageResponsiveness.keyInputLatenciesMs} leaves out.
   *
   * @param sinceMs - The time, ms on the page's clock, compared with each event's time stamp.
   * @returns The count.
   */
  pendingKeyInputs(sinceMs: number): number {
    return this.pendingKeysMs.filter((eventMs) => eventMs >= sinceMs).length;
  }

  /** Stops observing. */
  stop(): void {
    if (typeof window !== 'undefined')
      window.removeEventListener('beforeinput', this.onKeyInput, { capture: true });
    for (const observer of this.observers) observer.disconnect();
  }
}
