import { expect, it, vi } from 'vitest';

import type { GpuBackend } from '../gpu/gpu-backend.js';

import type { EngineInputsCompleted, InputMark } from './input-marks.js';
import { RuntimeInputs } from './runtime-inputs.js';

const mark: InputMark = { kind: 'selection-change', id: 3, timestampMs: 5, markedMs: 6 };
const frame = { frameIndex: 0, frameTimeMs: 16, hasPendingWork: false };

function inputs(backend: Partial<GpuBackend> | undefined) {
  let live: { backend: GpuBackend } | undefined =
    backend === undefined ? undefined : { backend: backend as GpuBackend };
  const completions: EngineInputsCompleted[] = [];
  const queue = new RuntimeInputs(
    () => live,
    () => 20,
    { onInputsCompleted: (completion) => completions.push(completion) },
  );
  return {
    queue,
    completions,
    destroy: () => {
      live = undefined;
    },
  };
}

it('reports nothing for a frame without marks or after the runtime is gone', () => {
  const whenSubmittedWorkDone = vi.fn(() => Promise.resolve());
  const f = inputs({ whenSubmittedWorkDone });
  f.queue.complete(frame, f.queue.take());
  expect(whenSubmittedWorkDone).not.toHaveBeenCalled();
  const gone = inputs(undefined);
  gone.queue.mark(mark);
  gone.queue.complete(frame, gone.queue.take());
  expect(gone.completions).toEqual([]);
});

it('drops a completion that arrives after the runtime was destroyed', async () => {
  let finish: (() => void) | undefined;
  const f = inputs({
    whenSubmittedWorkDone: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  f.queue.mark(mark);
  f.queue.complete(frame, f.queue.take());
  f.destroy();
  finish?.();
  await Promise.resolve();
  expect(f.completions).toEqual([]);
});

it('puts a failed frame’s pointer inputs and marks back ahead of newer ones', () => {
  const f = inputs({});
  const pointer = {
    type: 'down',
    xPx: 1,
    yPx: 1,
    buttons: 1,
    pointerId: 1,
    timestampMs: 1,
  } as const;
  f.queue.pointer(pointer);
  f.queue.mark(mark);
  const taken = f.queue.take();
  f.queue.mark({ ...mark, id: 4 });
  f.queue.restore(taken);
  const again = f.queue.take();
  expect(again.pointerInputs).toEqual([pointer]);
  expect(again.marks.map(({ id }) => id)).toEqual([3, 4]);
  f.queue.complete(frame, again);
  expect(f.completions).toEqual([{ ...frame, marks: again.marks, completedMs: 20 }]);
});
