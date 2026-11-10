import { describe, expect, it } from 'vitest';

import { FakeCanvas, FakeHostPlatform } from './__fixtures__/fake-host-platform.js';
import { createEngineHost } from './create-engine-host.js';
import {
  overlayFallbackCanvas,
  removeFallbackCanvas,
  sizeFallbackCanvas,
} from './fallback-canvas.js';

class PageCanvas extends FakeCanvas {
  readonly style: Record<string, string> = {};
  readonly offsetLeft = 12;
  readonly offsetTop = 30;
  readonly clientWidth = 200;
  readonly clientHeight = 100;
  readonly ownerDocument = { createElement: () => new PageCanvas() };
  next: unknown;
  isRemoved = false;

  remove(): void {
    this.isRemoved = true;
  }
  readonly attributes: Record<string, string> = {};

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  after(node: unknown): void {
    this.next = node;
  }
}

describe('removeFallbackCanvas', () => {
  it('takes the fallback off the page and gives the original its own opacity back', () => {
    const original = new PageCanvas();
    original.style.opacity = '0.5';
    const fallback = overlayFallbackCanvas(original) as PageCanvas;
    overlayFallbackCanvas(original);
    expect(original.style.opacity).toBe('0');
    removeFallbackCanvas(original, fallback);
    expect(fallback.isRemoved).toBe(true);
    expect(original.style.opacity).toBe('0.5');
    removeFallbackCanvas(new FakeCanvas(), new FakeCanvas());
  });
});

describe('overlayFallbackCanvas', () => {
  it('lays the fallback on the page canvas’s box, at its drawing-buffer size', () => {
    const original = new PageCanvas(400, 200);
    const fallback = overlayFallbackCanvas(original) as PageCanvas;
    expect(original.next).toBe(fallback);
    expect([fallback.width, fallback.height]).toEqual([400, 200]);
    expect(fallback.style).toEqual({
      position: 'absolute',
      left: '12px',
      top: '30px',
      width: '200px',
      height: '100px',
      pointerEvents: 'none',
    });
    expect(original.style.opacity).toBe('0');
    expect(fallback.attributes).toEqual({ 'data-engine-fallback': '' });
  });

  it('has no fallback for a canvas that is not on a page, and sizes nothing there', () => {
    const offscreen = new FakeCanvas();
    expect(overlayFallbackCanvas(offscreen)).toBeUndefined();
    sizeFallbackCanvas(offscreen, 8, 6, 2);
    expect(offscreen).toEqual(new FakeCanvas());
  });

  it('keeps the fallback’s CSS box on the drawing buffer over the pixel ratio', () => {
    const fallback = new PageCanvas();
    sizeFallbackCanvas(fallback, 300, 150, 1.5);
    expect([fallback.style.width, fallback.style.height]).toEqual(['200px', '100px']);
  });
});

describe('the main-thread host’s fallback', () => {
  it('comes off the page when the host is destroyed', async () => {
    const platform = new FakeHostPlatform();
    const original = new PageCanvas();
    const host = await createEngineHost(original, { platform, prefer: 'main', backend: 'webgpu' });
    platform.backends[0]?.loseDevice();
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
    const fallback = original.next as PageCanvas;
    expect(original.style.opacity).toBe('0');
    host.destroy();
    expect(fallback.isRemoved).toBe(true);
    expect(original.style.opacity).toBe('');
  });
});
