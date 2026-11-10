import { expect, it } from 'vitest';

import { isHostToWorkerMessage, isWorkerToHostMessage } from './host-protocol.js';

const mark = { kind: 'drag-end', id: 7, timestampMs: 100, markedMs: 105 };
const completion = {
  frameIndex: 3,
  frameTimeMs: 120,
  marks: [mark],
  hasPendingWork: false,
  completedMs: 130,
};

it('accepts every input kind in mark commands and completion messages', () => {
  for (const kind of [
    'drag-end',
    'zoom-step',
    'selection-change',
    'keystroke',
    'draw-move',
  ] as const) {
    const inputMark = { ...mark, kind };
    expect(
      isHostToWorkerMessage({
        type: 'engine-commands',
        commands: [{ type: 'mark-input', mark: inputMark }],
      }),
    ).toBe(true);
    expect(
      isWorkerToHostMessage({
        type: 'engine-inputs-completed',
        completion: { ...completion, marks: [inputMark] },
      }),
    ).toBe(true);
  }
});

it('rejects invalid mark kinds and non-finite mark fields', () => {
  for (const invalid of [
    { ...mark, kind: 'hover' },
    { ...mark, id: NaN },
    { ...mark, timestampMs: Infinity },
    { ...mark, markedMs: -Infinity },
  ]) {
    expect(
      isHostToWorkerMessage({
        type: 'engine-commands',
        commands: [{ type: 'mark-input', mark: invalid }],
      }),
    ).toBe(false);
    expect(
      isWorkerToHostMessage({
        type: 'engine-inputs-completed',
        completion: { ...completion, marks: [invalid] },
      }),
    ).toBe(false);
  }
});

it('rejects a completion without a marks array or with invalid timing', () => {
  for (const invalid of [
    { ...completion, marks: undefined },
    { ...completion, marks: 'drag-end' },
    { ...completion, completedMs: NaN },
    { ...completion, frameTimeMs: Infinity },
  ]) {
    expect(isWorkerToHostMessage({ type: 'engine-inputs-completed', completion: invalid })).toBe(
      false,
    );
  }
});
