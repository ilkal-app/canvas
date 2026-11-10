import type { MemoryCategory } from '@canvas/engine';

/** Observable startup milestones; none changes or certifies the underlying lifecycle. */
export const FIRST_PAINT_PHASES = [
  'authorized-start',
  'cache-read-start',
  'cache-read-complete',
  'hydration-released',
  'connection-ready',
  'preview-verified-visible',
  'handoff-fallback',
  'live-frame-visible',
] as const;

/** A lifecycle transition included in the diagnostic trace. */
export type FirstPaintPhase = (typeof FIRST_PAINT_PHASES)[number];

/** One page-clock observation from an authorized board startup. */
export interface FirstPaintMilestone {
  /** Board already authorized by the site. */
  readonly boardId: string;
  /** Unique startup within this page; navigation resets the sequence. */
  readonly attempt: number;
  /** Existing lifecycle transition being observed. */
  readonly phase: FirstPaintPhase;
  /** Monotonic page time, milliseconds since navigation. */
  readonly timeMs: number;
  /** Sidecar byte count, when a read completed. */
  readonly previewBytes?: number;
  /** Observed GPU category bytes, when sampled; absence is not zero usage. */
  readonly gpuBytesByCategory?: Readonly<Record<MemoryCategory, number>>;
  /** Observed JavaScript heap bytes, when sampled; never a memory allowance. */
  readonly heapBytes?: number;
}

let nextAttempt = 0;

/**
 * Records existing site transitions only in explicitly enabled harness builds.
 *
 * @param boardId - Authorized board.
 * @returns A recorder with one page-local startup identity.
 */
export function firstPaintTrace(
  boardId: string,
): (phase: FirstPaintPhase, previewBytes?: number) => void {
  const attempt = ++nextAttempt;
  return (phase, previewBytes) => {
    if (import.meta.env.VITE_FIRST_PAINT_DIAGNOSTIC !== '1') return;
    const detail: FirstPaintMilestone = {
      boardId,
      attempt,
      phase,
      timeMs: performance.now(),
      ...(previewBytes === undefined ? {} : { previewBytes }),
    };
    window.dispatchEvent(new CustomEvent('canvas:first-paint', { detail }));
  };
}
