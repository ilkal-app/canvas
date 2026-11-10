import { expect, it } from 'vitest';

import { RunStoppedError } from '@canvas/document';

import * as stepped from './run-stepped.js';

const { stoppedNotice } = stepped as unknown as {
  stoppedNotice: (error: RunStoppedError) => string;
};
const STOP_WITH_TOTAL = RunStoppedError as unknown as new (
  committedParts: number,
  changes: undefined,
  cause: unknown,
  plannedParts?: number,
) => RunStoppedError;

it('shows committed parts over planned parts, with the old text only while planning', () => {
  expect(stoppedNotice(new STOP_WITH_TOTAL(2, undefined, new Error('stop'), 5))).toBe(
    'That change stopped partway: 2 of 5 parts were applied.',
  );
  expect(stoppedNotice(new RunStoppedError(0, undefined, new Error('stop')))).toBe(
    'That change stopped partway: some of it was applied.',
  );
});
