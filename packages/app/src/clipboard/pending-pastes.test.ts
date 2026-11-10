import { expect, it } from 'vitest';

import { trackPaste, whenPastesRead } from './pending-pastes.js';

it('resolves at once with no paste pending', async () => {
  await expect(whenPastesRead()).resolves.toBeUndefined();
});

it('waits for every pending paste, however it settles', async () => {
  let finish: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const first = trackPaste(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const second = trackPaste(
    new Promise<void>((resolve, reject) => {
      fail = reject;
    }),
  );
  let isRead = false;
  const read = whenPastesRead().then(() => {
    isRead = true;
  });
  finish();
  await first;
  expect(isRead).toBe(false);
  fail(new Error('refused'));
  await expect(second).rejects.toThrow('refused');
  await read;
  expect(isRead).toBe(true);
});
