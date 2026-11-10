import { describe, expect, it, vi } from 'vitest';

import type { AssetId, BoardObject, ObjectId, PrincipalId } from '@canvas/schema';

import { overlayPaletteOf } from '../theme/canvas-background.js';

import { createDemoDocument } from './demo-document.js';
import type { EngineHostMountOptions } from './engine-host-mount-options.js';
import { HostViewSettings } from './host-view-settings.js';
import type { MountEngineOptions } from './mounted-engine.js';

/**
 * Mount options whose page images read records through a spy.
 *
 * @param readRecord - The record read.
 * @returns The options.
 */
function withImages(readRecord: (assetId: string) => Promise<unknown>): MountEngineOptions {
  return { images: { availability: { readRecord } } } as unknown as MountEngineOptions;
}

/** The host mount's options: the main thread. */
const HOST_OPTIONS: EngineHostMountOptions = { prefer: 'main' };

/** An image on the board. */
const IMAGE = {
  id: 'photo' as ObjectId,
  type: 'image',
  parentId: null,
  x: 0,
  y: 0,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:ada' as PrincipalId,
  createdAt: 1,
  updatedAt: 1,
  width: 100,
  height: 50,
  assetId: 'asset-photo' as AssetId,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  naturalSize: { width: 100, height: 50 },
  opacity: 1,
} satisfies BoardObject;

describe('HostViewSettings', () => {
  it('gives the creation tools the theme, the canvas and the images’ average colours', async () => {
    const readRecord = vi.fn(() => Promise.resolve({ averageColor: [0, 0, 0, 1] }));
    const settings = new HostViewSettings(
      { ...withImages(readRecord), initialTheme: 'dark' },
      HOST_OPTIONS,
    );
    const { creationInk } = settings;
    expect(creationInk.theme()).toBe('dark');
    expect(creationInk.canvasColor?.('dark')[3]).toBe(1);
    expect(creationInk.averageColorOf?.('asset-1')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(creationInk.averageColorOf?.('asset-1')).toEqual([0, 0, 0, 1]);
  });

  it('reads the board’s images ahead when a stroke or text tool is chosen, not others', () => {
    const readRecord = vi.fn((assetId: string) => new Promise<unknown>(() => assetId));
    const settings = new HostViewSettings(withImages(readRecord), HOST_OPTIONS);
    const store = createDemoDocument([IMAGE]);
    settings.toolChosen('select', store);
    expect(readRecord).not.toHaveBeenCalled();
    settings.toolChosen('shape', store);
    expect(readRecord.mock.calls).toEqual([['asset-photo']]);
    store.destroy();
  });

  it('tells the creation tools which tools’ ink the person picked', () => {
    const settings = new HostViewSettings({}, HOST_OPTIONS);
    const isPicked = settings.creationInk.isInkPicked;
    expect(isPicked?.('line')).toBe(false);
    settings.setInkPicked('line', true);
    expect(isPicked?.('line')).toBe(true);
    expect(isPicked?.('pen')).toBe(false);
    settings.setInkPicked('line', false);
    expect(isPicked?.('line')).toBe(false);
  });

  it('has no average colours on a page without images', () => {
    const settings = new HostViewSettings({}, HOST_OPTIONS);
    expect(settings.creationInk.averageColorOf).toBeUndefined();
  });

  it('gives the overlay its theme’s palette and shows it again on a theme change', () => {
    const onThemeChange = vi.fn();
    const settings = new HostViewSettings({ initialTheme: 'dark' }, HOST_OPTIONS, onThemeChange);
    expect(settings.creationInk.overlayPalette?.()).toBe(overlayPaletteOf('dark'));
    settings.setTheme('dark', undefined);
    expect(onThemeChange).not.toHaveBeenCalled();
    settings.setTheme('light', undefined);
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(settings.creationInk.overlayPalette?.()).toBe(overlayPaletteOf('light'));
  });

  it('shows the overlay again in the new chrome’s palette when the chrome changes', () => {
    const onThemeChange = vi.fn();
    const settings = new HostViewSettings({}, HOST_OPTIONS, onThemeChange);
    settings.setWhiteboardChrome('classic');
    expect(onThemeChange).not.toHaveBeenCalled();
    settings.setWhiteboardChrome('floating');
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(settings.creationInk.overlayPalette?.()).toBe(overlayPaletteOf('light', 'floating'));
    settings.setWhiteboardChrome('classic');
    expect(onThemeChange).toHaveBeenCalledTimes(2);
    expect(settings.creationInk.overlayPalette?.()).toBe(overlayPaletteOf('light', 'classic'));
  });

  it('has the design tools under every chrome but the floating one', () => {
    const settings = new HostViewSettings({ whiteboardChrome: 'floating' }, HOST_OPTIONS);
    expect(settings.hasDesignTools).toBe(false);
    settings.setWhiteboardChrome('classic');
    expect(settings.hasDesignTools).toBe(true);
  });
});
