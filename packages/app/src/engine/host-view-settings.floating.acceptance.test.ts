import { describe, expect, it } from 'vitest';

import { overlayPaletteOf } from '../theme/canvas-background.js';

import type { EngineHostMountOptions } from './engine-host-mount-options.js';
import { HostViewSettings } from './host-view-settings.js';

const HOST_OPTIONS: EngineHostMountOptions = { prefer: 'main' };

describe('HostViewSettings floating chrome', () => {
  it('passes its chrome to creation ink and keeps it through a theme change', () => {
    const settings = new HostViewSettings({ whiteboardChrome: 'floating' }, HOST_OPTIONS);
    expect(settings.creationInk.overlayPalette?.()).toBe(overlayPaletteOf('light', 'floating'));
    settings.setTheme('dark', undefined);
    expect(settings.creationInk.overlayPalette?.()).toBe(overlayPaletteOf('dark', 'floating'));
    settings.setTheme('light', undefined);
    expect(settings.creationInk.overlayPalette?.()).toBe(overlayPaletteOf('light', 'floating'));
  });

  it('defaults to the classic palette when no chrome is given', () => {
    const settings = new HostViewSettings({}, HOST_OPTIONS);
    expect(settings.creationInk.overlayPalette?.()).toBe(overlayPaletteOf('light', 'classic'));
    settings.setTheme('dark', undefined);
    expect(settings.creationInk.overlayPalette?.()).toBe(overlayPaletteOf('dark', 'classic'));
    expect(settings.creationInk.overlayPalette?.()).not.toHaveProperty('selection');
  });
});
