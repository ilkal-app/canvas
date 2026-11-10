import type { GpuPassTiming } from '../gpu-backend.js';

/** `EXT_disjoint_timer_query_webgl2` constants; the DOM lib does not type the extension. */
const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;

/** How often, and how many times, results are polled: at most about half a second. */
const POLL_INTERVAL_MS = 4;
const MAX_POLLS = 120;

const NANOSECONDS_PER_MILLISECOND = 1_000_000;

/** Timed passes that may wait uncollected; later passes go untimed until collected. */
const MAX_UNCOLLECTED_PASSES = 128;

interface TimedPass {
  readonly label: string;
  readonly query: WebGLQuery;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

/**
 * Measures labelled passes with `EXT_disjoint_timer_query_webgl2` time-elapsed queries. Results
 * appear only after the browser regains control, so collection polls.
 * A disjoint event (GPU frequency change, context switch) voids the batch.
 */
export class WebGl2PassTimer {
  private readonly extension: object | null;
  private active: TimedPass | undefined;
  private finished: TimedPass[] = [];

  /**
   * Enables the timer extension when the context offers it.
   *
   * @param gl - The context whose passes are timed.
   */
  constructor(private readonly gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as object | null;
  }

  /**
   * Whether passes can be timed.
   *
   * @returns `true` when the context offers the timer extension.
   */
  get isSupported(): boolean {
    return this.extension !== null;
  }

  /**
   * Starts timing a pass.
   *
   * @param label - The pass's timing label; nothing is timed when absent.
   */
  begin(label: string | undefined): void {
    if (!this.extension || label === undefined || this.finished.length >= MAX_UNCOLLECTED_PASSES) {
      return;
    }
    const query = this.gl.createQuery();
    this.gl.beginQuery(TIME_ELAPSED_EXT, query);
    this.active = { label, query };
  }

  /** Stops timing the current pass, if one is timed. */
  end(): void {
    if (!this.extension || !this.active) {
      return;
    }
    this.gl.endQuery(TIME_ELAPSED_EXT);
    this.finished.push(this.active);
    this.active = undefined;
  }

  /**
   * Waits for the results of every pass timed since the previous call.
   *
   * @returns One timing per pass whose result arrived, in order; empty after a disjoint event.
   */
  async collect(): Promise<GpuPassTiming[]> {
    const { gl, extension } = this;
    const pending = this.finished;
    this.finished = [];
    if (!extension || pending.length === 0) {
      return [];
    }
    const isAvailable = ({ query }: TimedPass): boolean =>
      gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) === true;
    for (let poll = 0; poll < MAX_POLLS && !pending.every(isAvailable); poll += 1) {
      await delay(POLL_INTERVAL_MS);
    }
    const isDisjoint = gl.getParameter(GPU_DISJOINT_EXT) === true;
    const timings = isDisjoint
      ? []
      : pending.filter(isAvailable).map(({ label, query }) => ({
          label,
          durationMs:
            Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / NANOSECONDS_PER_MILLISECOND,
        }));
    for (const { query } of pending) {
      gl.deleteQuery(query);
    }
    return timings;
  }

  /** Deletes every query not yet collected. */
  destroy(): void {
    for (const { query } of [...this.finished, ...(this.active ? [this.active] : [])]) {
      this.gl.deleteQuery(query);
    }
    this.finished = [];
    this.active = undefined;
  }
}
