// A section that already fits writes nothing, though turning a
// child's corners into the section's coordinates leaves rounding error behind.
import { it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { ADA } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, expectDiff, mustGet } from './__fixtures__/command-fixtures.js';
import { createNestedFramesStore } from './__fixtures__/nested-frames.js';
import { fitFrameToContentCommand } from './fit-frame-to-content.js';

const SECTION = 'frame-side' as ObjectId;

it('fits a section round a turned child once: fitting it again writes nothing', () => {
  const store = createNestedFramesStore();
  const child = mustGet(store, 'rect-side');
  store.transact(ADA, (transaction) => {
    transaction.setObject({
      ...child,
      x: 27.951,
      y: 23.513,
      rotation: 0.269,
      width: 101.59,
      height: 90.57,
    } as typeof child);
  });
  applyCommand(store, fitFrameToContentCommand, { id: SECTION });
  for (let again = 0; again < 3; again += 1) {
    const before = store.read();
    const { changes } = applyCommand(store, fitFrameToContentCommand, { id: SECTION });
    expectDiff(before, store.read(), changes, {});
  }
});
