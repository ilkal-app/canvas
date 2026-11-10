// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { BUSY_NOTICE } from '../notices/busy-notices.js';

import { mountOnFakeHost } from './__fixtures__/fake-engine-host.js';
import { createDemoDocument } from './demo-document.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('restyles text from the text bar at once while idle, and refuses it during a run', async () => {
  const store = createDemoDocument();
  const onNotice = vi.fn();
  const { engine } = await mountOnFakeHost({ options: { store, onNotice } });
  engine.applyTextStyle?.({ kind: 'toggleBold' });
  expect(onNotice).not.toHaveBeenCalled();
  const run = store.beginRun();
  engine.applyTextStyle?.({ kind: 'toggleBold' });
  expect(onNotice).toHaveBeenCalledWith(BUSY_NOTICE);
  run.close();
  engine.destroy();
  store.destroy();
});
