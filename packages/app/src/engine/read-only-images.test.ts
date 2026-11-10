// @vitest-environment jsdom
// Writes that finish after the person was made a viewer (re-reviews W-1a and N-1): a
// picker left open and a drop already accepted finish preparing, and nothing is created or
// uploaded, since the one place objects are created (`DocumentClipboard.createObjects`) asks
// `canEdit`; a cut's delete asks it too, so it removes nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';

import { settle } from '../assets/__fixtures__/manual-schedule.js';
import { png, setUp as setUpImages } from '../assets/__fixtures__/page-images-setup.js';

import { createEngineDocument } from './create-engine-document.js';
import { createDemoDocument } from './demo-document.js';
import { MountImages, withPageImages } from './mount-images.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/**
 * The engine's document side on a demo board, the page's images over a fake assets service, and
 * the paste location that joins them, with every document write counted.
 *
 * @returns The parts, the images' fakes and the write count.
 */
function setUp() {
  const store = createDemoDocument();
  const parts = createEngineDocument({ store }, () => undefined);
  const images = setUpImages();
  const target = () =>
    withPageImages(parts.clipboard.pasteTarget(undefined, { x: 0, y: 0 }), images.images);
  const writes = { count: 0 };
  store.subscribeUpdates(() => {
    writes.count += 1;
  });
  return { ...parts, ...images, store, target, writes };
}

/**
 * Chooses files in the picker the mount opened.
 *
 * @param files - The files.
 * @throws {Error} When no picker is open.
 */
function choose(files: File[]): void {
  const input = document.querySelector<HTMLInputElement>('input[data-image-picker]');
  if (input === null) throw new Error('No picker.');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('images arriving after a downgrade', () => {
  it('creates and uploads nothing from a picker left open while the person was made a viewer', async () => {
    const { document: engine, images, service, target, writes, toAdapter } = setUp();
    const mount = new MountImages(
      document.createElement('canvas'),
      target,
      () => CAMERA,
      () => engine.canEdit,
    );
    const picked = mount.pick(undefined);
    engine.setEditable(false);
    choose([png(1).file]);
    await picked;
    // The picked image is prepared and handed to the engine's adapter just before it would be
    // created: wait for that, then for what follows it.
    await vi.waitFor(() => {
      expect(toAdapter.some(({ type }) => type === 'local-image')).toBe(true);
    });
    await settle();
    expect(writes.count).toBe(0);
    expect(images.uploads.snapshot()).toEqual([]);
    expect(service.requests).toEqual([]);
    mount.destroy();
  });

  it('creates and uploads nothing for a drop accepted before the downgrade', async () => {
    const { document: engine, images, service, target, writes } = setUp();
    const inserting = images.insert([png(2).file], { x: 0, y: 0 }, target());
    engine.setEditable(false);
    await inserting;
    await settle();
    expect(writes.count).toBe(0);
    expect(images.uploads.snapshot()).toEqual([]);
    expect(service.requests).toEqual([]);
  });

  it('creates and uploads the images for a person who can edit', async () => {
    const { images, target, writes } = setUp();
    await images.insert([png(3).file], { x: 0, y: 0 }, target());
    expect(writes.count).toBe(1);
    expect(images.uploads.snapshot()).toHaveLength(1);
  });

  it('duplicates nothing for a viewer, even asked directly', () => {
    const { document: engine, clipboard, writes } = setUp();
    engine.runCanvasAction({ type: 'selection', command: 'selectAll' }, 1);
    engine.setEditable(false);
    clipboard.duplicateSelection();
    expect(writes.count).toBe(0);
  });

  it('removes nothing for a cut that finishes after the downgrade, or a viewer’s cut', () => {
    const { document: engine, clipboard, writes } = setUp();
    engine.runCanvasAction({ type: 'selection', command: 'selectAll' }, 1);
    const editorCut = clipboard.prepareCut();
    engine.setEditable(false);
    if (editorCut.kind !== 'ready') throw new Error('nothing to cut');
    editorCut.remove();
    const viewerCut = clipboard.prepareCut();
    expect(viewerCut.kind).toBe('ready');
    if (viewerCut.kind === 'ready') viewerCut.remove();
    expect(writes.count).toBe(0);
  });
});
