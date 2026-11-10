import { describe, expect, it } from 'vitest';

import { detectKeyboardPlatform } from './keyboard-platform.js';

describe('detectKeyboardPlatform', () => {
  it('reports mac for macOS platform strings', () => {
    expect(detectKeyboardPlatform('MacIntel')).toBe('mac');
    expect(detectKeyboardPlatform('macOS')).toBe('mac');
  });

  it('reports mac for iPadOS and iOS, whose hardware keyboards use Command', () => {
    expect(detectKeyboardPlatform('iPad')).toBe('mac');
    expect(detectKeyboardPlatform('iPhone')).toBe('mac');
  });

  it('reports other for Windows, Linux, ChromeOS and an unknown platform', () => {
    expect(detectKeyboardPlatform('Win32')).toBe('other');
    expect(detectKeyboardPlatform('Linux x86_64')).toBe('other');
    expect(detectKeyboardPlatform('CrOS')).toBe('other');
    expect(detectKeyboardPlatform('')).toBe('other');
  });
});
