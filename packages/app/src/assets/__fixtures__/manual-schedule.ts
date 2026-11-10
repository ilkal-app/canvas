// A timer a test runs by hand: the follower's waits are recorded, and `runAll` runs every wait
// scheduled so far (not those they schedule), moving the schedule's clock on to the latest of
// their due times first, so a test steps through polls and reconnections and the poll budget
// sees them due.
import type { ScheduleTimer } from '../poll-budget.js';

/** One scheduled wait. */
interface Wait {
  readonly callback: () => void;
  readonly delayMs: number;
  readonly dueAt: number;
  isCancelled: boolean;
}

/** Waits the test runs by hand, on a clock of their own. */
export class ManualSchedule {
  /** The schedule's clock, ms: give `() => schedule.now` as the code's clock. */
  now = 0;
  private waits: Wait[] = [];

  /**
   * The timer to give the code under test.
   *
   * @param callback - What to run.
   * @param delayMs - After how long, ms (recorded, and when `runAll` moves the clock to).
   * @returns Cancels it.
   */
  readonly schedule: ScheduleTimer = (callback, delayMs) => {
    const wait: Wait = { callback, delayMs, dueAt: this.now + delayMs, isCancelled: false };
    this.waits.push(wait);
    return () => {
      wait.isCancelled = true;
    };
  };

  /**
   * The delays of the waits not yet run or cancelled.
   *
   * @returns The delays, ms, in order.
   */
  get pending(): number[] {
    return this.waits.filter((wait) => !wait.isCancelled).map((wait) => wait.delayMs);
  }

  /** Runs every wait scheduled so far that was not cancelled, the clock moved to their end. */
  runAll(): void {
    const due = this.waits.filter((wait) => !wait.isCancelled);
    this.waits = [];
    for (const wait of due) this.now = Math.max(this.now, wait.dueAt);
    for (const wait of due) wait.callback();
  }
}

/**
 * Lets every settled promise and the fake's streams run.
 *
 * @returns Settles after a macrotask.
 */
export function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
