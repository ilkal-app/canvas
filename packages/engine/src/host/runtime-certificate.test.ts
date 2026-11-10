import { afterEach, expect, it, vi } from 'vitest';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { FakeCanvas, FakeHostPlatform } from './__fixtures__/fake-host-platform.js';
import { MainThreadEngineHost } from './main-thread-engine-host.js';
import { PreviewReads } from './preview-reads.js';
import { SceneRevisions } from './scene-revisions.js';
import { serializeChangeSet } from './serializable-change-set.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
const REQUEST = {
  scene: { session: 'mount', sequence: 0 },
  camera: CAMERA,
  coverage: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  fontSetKey: 'font-content',
};

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const platform = new FakeHostPlatform();
  const host = await MainThreadEngineHost.create(new FakeCanvas(100, 100), platform);
  const document = new FakeSceneDocument();
  document.create(shapeObject('visible'));
  host.setCamera(CAMERA);
  host.applyChangeSet(serializeChangeSet(document.takeChanges()), REQUEST.scene);
  const backend = platform.backends[0];
  if (backend === undefined) throw new Error('Missing backend');
  return { host, platform, document, backend };
}

it('owns main-thread stamps and records them only in the frame apply stage', async () => {
  const applied = vi.spyOn(SceneRevisions.prototype, 'apply');
  const { host, platform, document } = await fixture();
  const stamp = { ...REQUEST.scene, sequence: 1 };
  document.update('visible', { x: 20 });
  host.applyChangeSet(serializeChangeSet(document.takeChanges()), stamp);
  stamp.sequence = 100;
  expect(applied).not.toHaveBeenCalled();
  const gate = vi.spyOn(PreviewReads.prototype, 'matchesFrame');
  const pending = host.readPreviewCertificate({
    ...REQUEST,
    scene: { ...REQUEST.scene, sequence: 1 },
  });
  platform.runFrame(16);
  await expect(pending).resolves.toBeUndefined();
  expect(applied.mock.calls).toEqual([[REQUEST.scene], [{ ...REQUEST.scene, sequence: 1 }]]);
  expect(gate.mock.results.at(-1)?.value).toBe(true);
  host.destroy();
});

it.each(['arrival', 'camera', 'animation', 'resize'] as const)(
  'refuses scene eligibility when a draw callback queues a newer %s',
  async (kind) => {
    const { host, platform, document, backend } = await fixture();
    const gate = vi.spyOn(PreviewReads.prototype, 'matchesFrame');
    vi.spyOn(backend, 'submit').mockImplementationOnce(() => {
      if (kind === 'arrival') {
        document.update('visible', { x: 50 });
        host.applyChangeSet(serializeChangeSet(document.takeChanges()), {
          ...REQUEST.scene,
          sequence: 1,
        });
      } else if (kind === 'camera') host.setCamera({ ...CAMERA, x: 50 });
      else if (kind === 'animation') host.animateCamera({ ...CAMERA, x: 50 }, 100);
      else host.resize(200, 200, 1);
    });
    const pending = host.readPreviewCertificate(REQUEST);
    platform.runFrame(16);
    await expect(pending).resolves.toBeUndefined();
    expect(gate.mock.results.at(-1)?.value).toBe(false);
    host.destroy();
  },
);

it('keeps a failed frame permanently ineligible even when subsequent rendering succeeds', async () => {
  const { host, platform, backend } = await fixture();
  const fault = vi.fn();
  host.onFault(fault);
  const pending = host.readPreviewCertificate(REQUEST);
  const rejected = expect(pending).rejects.toThrow('draw failed');
  backend.submitFailure = new Error('draw failed');
  platform.runFrame(16);
  await rejected;
  expect(fault).toHaveBeenCalledOnce();
  const gate = vi.spyOn(PreviewReads.prototype, 'matchesFrame');
  const retry = host.readPreviewCertificate(REQUEST);
  platform.runFrame(32);
  await expect(retry).resolves.toBeUndefined();
  expect(gate.mock.results.at(-1)?.value).toBe(false);
  host.destroy();
});

it('rejects invalid requests and destruction without stranding later valid reads', async () => {
  const { host, platform } = await fixture();
  await expect(host.readPreviewCertificate({ ...REQUEST, fontSetKey: '' })).rejects.toThrow(
    'Invalid',
  );
  const pending = host.readPreviewCertificate(REQUEST);
  platform.runFrame(16);
  await expect(pending).resolves.toBeUndefined();
  const late = host.readPreviewCertificate(REQUEST);
  const rejected = expect(late).rejects.toThrow('destroyed');
  host.destroy();
  await rejected;
});

it('rejects waiting certificates at device loss and keeps a recovered mount ineligible', async () => {
  const { host, platform, backend } = await fixture();
  platform.runFrame(16);
  const gate = vi.spyOn(PreviewReads.prototype, 'matchesFrame');
  const pending = host.readPreviewCertificate(REQUEST);
  const rejected = expect(pending).rejects.toThrow('device was lost');
  backend.loseDevice();
  await rejected;
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  expect(platform.backends).toHaveLength(2);
  const recovered = host.readPreviewCertificate(REQUEST);
  platform.runFrame(32);
  await expect(recovered).resolves.toBeUndefined();
  expect(gate.mock.results.at(-1)?.value).toBe(false);
  host.destroy();
});
