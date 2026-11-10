import type { PresenceClock, PresenceScheduler, PresenceTimer } from '../presence-time.js';

interface ScheduledTask {
  readonly dueAtMs: number;
  readonly order: number;
  readonly callback: () => void;
  isCancelled: boolean;
}

/**
 * A frozen clock and a scheduler that runs nothing until the test advances time, so presence
 * tests are deterministic.
 */
export class ManualTime implements PresenceClock, PresenceScheduler {
  private nowMs = 0;
  private nextOrder = 0;
  private tasks: ScheduledTask[] = [];

  /**
   * The frozen time.
   *
   * @returns The current time, in ms since the fixture was created.
   */
  now(): number {
    return this.nowMs;
  }

  /**
   * How many scheduled tasks have neither run nor been cancelled.
   *
   * @returns The number of live tasks.
   */
  get pendingTaskCount(): number {
    return this.tasks.filter((task) => !task.isCancelled).length;
  }

  /**
   * Queues `callback` to run when time reaches now + `delayMs`.
   *
   * @param callback - The work to run.
   * @param delayMs - The delay, in ms.
   * @returns A handle that cancels the callback.
   */
  schedule(callback: () => void, delayMs: number): PresenceTimer {
    const task: ScheduledTask = {
      dueAtMs: this.nowMs + delayMs,
      order: this.nextOrder++,
      callback,
      isCancelled: false,
    };
    this.tasks.push(task);
    return {
      cancel: () => {
        task.isCancelled = true;
      },
    };
  }

  /**
   * Moves time forward, running every task that falls due in order, at its due time.
   *
   * @param durationMs - How far to move, in ms.
   */
  advanceBy(durationMs: number): void {
    this.advanceTo(this.nowMs + durationMs);
  }

  /**
   * Moves time forward to `targetMs`, running every task that falls due in order.
   *
   * @param targetMs - The time to reach, in ms.
   */
  advanceTo(targetMs: number): void {
    for (;;) {
      const next = this.takeNextDue(targetMs);
      if (next === undefined) {
        break;
      }
      this.nowMs = Math.max(this.nowMs, next.dueAtMs);
      next.callback();
    }
    this.nowMs = Math.max(this.nowMs, targetMs);
  }

  private takeNextDue(targetMs: number): ScheduledTask | undefined {
    this.tasks = this.tasks.filter((task) => !task.isCancelled);
    let next: ScheduledTask | undefined;
    for (const task of this.tasks) {
      if (task.dueAtMs > targetMs) {
        continue;
      }
      if (
        next === undefined ||
        task.dueAtMs < next.dueAtMs ||
        (task.dueAtMs === next.dueAtMs && task.order < next.order)
      ) {
        next = task;
      }
    }
    if (next !== undefined) {
      this.tasks = this.tasks.filter((task) => task !== next);
    }
    return next;
  }
}
