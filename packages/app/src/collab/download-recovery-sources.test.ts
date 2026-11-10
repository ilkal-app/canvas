// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import type { CapturedRecovery } from '@canvas/collab';

import { downloadRecoverySources } from './download-recovery-sources.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('downloads exact snapshot and update bytes without changing the retained source', async () => {
  const sources: readonly CapturedRecovery[] = [
    {
      generation: 3,
      snapshotVersion: 7,
      updateKeys: [12, 18],
      board: { snapshot: new Uint8Array([0, 127, 255]), updates: [new Uint8Array([4, 0, 255])] },
    },
  ];
  const blobs: Blob[] = [];
  const revoke = vi.fn();
  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      blobs.push(blob);
      return 'blob:recovery';
    },
    revokeObjectURL: revoke,
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  await downloadRecoverySources({ exportSources: () => Promise.resolve(sources) }, 'board-1');
  const reader = new FileReader();
  const text = new Promise<string>((resolve, reject) => {
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Recovery export was not text.'));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Could not read export.'));
    };
  });
  const blob = blobs[0];
  if (blob === undefined) throw new Error('No recovery download was created.');
  reader.readAsText(blob);
  expect(JSON.parse(await text)).toEqual({
    format: 'canvas-recovery-v1',
    boardId: 'board-1',
    sources: [
      {
        generation: 3,
        snapshotVersion: 7,
        updateKeys: [12, 18],
        board: {
          snapshot: { encoding: 'byte-array', bytes: [0, 127, 255] },
          updates: [{ encoding: 'byte-array', bytes: [4, 0, 255] }],
        },
      },
    ],
  });
  expect(click).toHaveBeenCalledOnce();
  expect(sources[0]?.board.updates[0]).toEqual(new Uint8Array([4, 0, 255]));
  // The URL is revoked on a timer after the click: wait for it while URL is still the stub, or it
  // fires after afterEach has put jsdom's URL back, which has no revokeObjectURL.
  await vi.waitFor(() => {
    expect(revoke).toHaveBeenCalledWith('blob:recovery');
  });
});
