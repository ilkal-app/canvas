import { describe, expect, it, vi } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';
import { FontLibrary } from '../text/font/font-library.js';
import { addBundledFaces, textObject } from '../text/scene/__fixtures__/text-objects.js';
import type { FontFaceSource } from '../text/scene/text-pass-resources.js';

import {
  FakeCanvas,
  FakeHostPlatform,
  ReadableFakeGpuBackend,
} from './__fixtures__/fake-host-platform.js';
import type { EngineFrameReport } from './engine-host.js';
import { EngineRuntime } from './engine-runtime.js';
import { serializeChangeSet } from './serializable-change-set.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

describe('EngineRuntime: text', () => {
  it('creates the text resources from the host options’ font faces, none when unnamed', () => {
    const face: FontFaceSource = { family: 'F', weight: 400, isItalic: false, url: 'data:,' };
    const createTextResources = vi.fn(() => new FontLibrary());
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas(4, 2);
    const callbacks = { onFrame: () => undefined, onFault: () => undefined };
    for (const options of [{ fontFaces: [face] }, {}]) {
      const backend = new ReadableFakeGpuBackend(canvas);
      new EngineRuntime(backend, canvas, platform, options, callbacks, {
        createTextResources,
      }).destroy();
    }
    expect(createTextResources.mock.calls).toEqual([[[face]], [[]]]);
  });

  it('runs the text pass’s layout and glyph jobs on its one pool, after each frame, until text draws', async () => {
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas(4, 2);
    const reports: EngineFrameReport[] = [];
    const fonts = new FontLibrary();
    addBundledFaces(fonts);
    const runtime = new EngineRuntime(
      new ReadableFakeGpuBackend(canvas),
      canvas,
      platform,
      {},
      { onFrame: (report) => reports.push(report), onFault: () => undefined },
      { createTextResources: () => fonts },
    );
    const document = new FakeSceneDocument();
    document.create(textObject('t', 'Hi'));
    runtime.applyChangeSet(serializeChangeSet(document.takeChanges()));
    runtime.setCamera(CAMERA);
    let timeMs = 0;
    // No job workers: the runtime drains the queue after each frame; the msdf handler's chunk
    // loads on its first job, so let timers run between frames.
    while (platform.pendingFrames > 0 && timeMs < 2000) {
      timeMs += 16;
      platform.runFrame(timeMs);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(platform.pendingFrames).toBe(0);
    expect(reports.at(-1)?.stats.drawCalls).toBe(1);
    runtime.destroy();
  });
});
