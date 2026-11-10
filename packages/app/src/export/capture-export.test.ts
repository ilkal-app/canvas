// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type {
  Camera,
  EngineFrameListener,
  EngineFrameReport,
  EngineHost,
  PixelRect,
} from '@canvas/engine';
import type { BoardObject, ObjectId, TextObject } from '@canvas/schema';

import { captureExport, captureExportAreas } from './capture-export.js';
import type { ExportScope } from './export-scope.js';

vi.mock('../text-input/page-fonts.js', () => ({
  ensurePageFont: vi.fn(() => Promise.resolve(true)),
  loadPageFonts: vi.fn(),
}));
vi.mock('../engine/start-browser-host.js', () => ({
  offscreenHostPlatform: vi.fn(() => 'offscreen platform'),
  startBrowserHost: vi.fn(),
}));

const { ensurePageFont, loadPageFonts } = await import('../text-input/page-fonts.js');
const { startBrowserHost } = await import('../engine/start-browser-host.js');

/** A host that draws each tile in one colour and reports its frames as told. */
class TileHost {
  readonly calls: string[] = [];
  readonly listeners = new Set<EngineFrameListener>();
  /** How many reads report pending work before one that does not. */
  pendingReads = 0;
  /** What the frames report of images: placeholders, blanks, and whether loads are idle. */
  images = { placeholderImages: 0, blankImages: 0, isImageIdle: true as boolean | undefined };
  reads = 0;
  camera: Camera | undefined;
  isDestroyed = false;
  created: readonly string[] = [];

  applyChangeSet(changes: { readonly created: readonly string[] }): void {
    this.created = changes.created;
  }
  setGridVisible(isVisible: boolean): void {
    this.calls.push(`grid ${String(isVisible)}`);
  }
  setTheme(theme: string): void {
    this.calls.push(`theme ${theme}`);
  }
  setColorTokens(): void {
    this.calls.push('tokens');
  }
  resize(widthPx: number, heightPx: number, dpr: number): void {
    this.calls.push(`resize ${String(widthPx)}×${String(heightPx)} @${String(dpr)}`);
  }
  setCamera(camera: Camera): void {
    this.camera = camera;
  }
  requestFrame(): void {
    this.calls.push('frame');
  }
  onFrame(listener: EngineFrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  readPixels(rect: PixelRect): Promise<{ widthPx: number; heightPx: number; rgba: Uint8Array }> {
    this.reads += 1;
    const isPending = this.pendingReads > 0;
    if (isPending) this.pendingReads -= 1;
    const { placeholderImages, blankImages, isImageIdle } = this.images;
    const report = {
      camera: this.camera,
      hasPendingWork: isPending,
      stats: { placeholderImages, blankImages },
      ...(isImageIdle === undefined ? {} : { isImageIdle }),
    } as EngineFrameReport;
    for (const listener of this.listeners) listener(report);
    // Each tile in the shade of its left edge, so its place in the image shows.
    const shade = Math.round((this.camera?.x ?? 0) / 100);
    const rgba = new Uint8Array(rect.widthPx * rect.heightPx * 4).fill(shade);
    return Promise.resolve({ widthPx: rect.widthPx, heightPx: rect.heightPx, rgba });
  }
  destroy(): void {
    this.isDestroyed = true;
  }
}

/**
 * A scope over a rect, with one shown rectangle and one ancestor that does not draw.
 *
 * @param width - The rect's width, board units.
 * @param objects - Its objects; one rectangle if absent.
 * @returns The scope.
 */
function scopeOf(width: number, objects?: readonly BoardObject[]): ExportScope {
  const shown = { id: 'shape' as ObjectId, type: 'shape', parentId: null } as BoardObject;
  const list = objects ?? [shown];
  return {
    kind: 'board',
    rect: { x: 0, y: 0, width, height: 10 },
    objects: list,
    shownIds: new Set(list.map(({ id }) => id)),
  };
}

/**
 * Starts the capture on a host.
 *
 * @param host - The host.
 * @returns The start function.
 */
function starting(host: TileHost): (canvas: HTMLCanvasElement) => Promise<EngineHost> {
  return () => Promise.resolve(host as unknown as EngineHost);
}

describe('captureExport', () => {
  it('draws each tile with its camera, stitches them, and sets the host up as the canvas draws', async () => {
    const host = new TileHost();
    const pixels = await captureExport(scopeOf(5000), {
      scale: 1,
      themeName: 'dark',
      tokens: new Map(),
      startHost: starting(host),
    });
    expect([pixels.widthPx, pixels.heightPx]).toEqual([5000, 10]);
    // Two tiles: 0–4095 drawn from x 0, 4096–4999 from x 4096.
    expect(pixels.rgba[0]).toBe(0);
    expect(pixels.rgba[4096 * 4]).toBe(41);
    expect(host.calls).toEqual([
      'grid false',
      'theme dark',
      'tokens',
      'resize 4096×10 @1',
      'resize 904×10 @1',
    ]);
    expect(host.created).toEqual(['shape']);
    expect(host.isDestroyed).toBe(true);
  });

  it('reads a tile again until it has settled, and gives up after its last read', async () => {
    const host = new TileHost();
    host.pendingReads = 2;
    await captureExport(scopeOf(100), { scale: 1, themeName: 'light', startHost: starting(host) });
    expect(host.reads).toBe(3);
    expect(host.calls.filter((call) => call === 'frame')).toHaveLength(2);
    const stuck = new TileHost();
    stuck.pendingReads = Number.POSITIVE_INFINITY;
    await captureExport(scopeOf(100), { scale: 1, themeName: 'light', startHost: starting(stuck) });
    expect(stuck.reads).toBe(600);
  });

  it('waits for every image to load at its level, and says when a tile ran out of reads first', async () => {
    const done = new TileHost();
    done.images = { placeholderImages: 0, blankImages: 0, isImageIdle: undefined };
    const settled = await captureExport(scopeOf(100), {
      scale: 1,
      themeName: 'light',
      startHost: starting(done),
    });
    expect([done.reads, settled.isComplete]).toEqual([1, true]);
    for (const images of [
      { placeholderImages: 1, blankImages: 0, isImageIdle: true },
      { placeholderImages: 0, blankImages: 1, isImageIdle: true },
      { placeholderImages: 0, blankImages: 0, isImageIdle: false },
    ]) {
      const waiting = new TileHost();
      waiting.images = images;
      const captured = await captureExport(scopeOf(100), {
        scale: 1,
        themeName: 'light',
        startHost: starting(waiting),
      });
      expect([waiting.reads, captured.isComplete]).toEqual([600, false]);
    }
  });

  it('loads the fonts the objects name first, and destroys the host when drawing fails', async () => {
    const text = {
      id: 'text' as ObjectId,
      type: 'text',
      parentId: null,
      text: 'Hi',
      runs: [{ length: 2, style: { fontFamily: 'Lora' } }],
    } as unknown as TextObject;
    const host = new TileHost();
    host.readPixels = () => Promise.reject(new Error('lost'));
    await expect(
      captureExport(scopeOf(100, [text]), {
        scale: 1,
        themeName: 'light',
        startHost: starting(host),
      }),
    ).rejects.toThrow('lost');
    expect(vi.mocked(ensurePageFont)).toHaveBeenCalledWith('Lora');
    // A page that drew no board yet (home) has its fonts started first.
    expect(vi.mocked(loadPageFonts).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ensurePageFont).mock.invocationCallOrder[0] ?? 0,
    );
    expect(host.isDestroyed).toBe(true);
  });

  it('starts a main-thread host of its own, on the offscreen platform, by default', async () => {
    const host = new TileHost();
    vi.mocked(startBrowserHost).mockResolvedValue(host as unknown as EngineHost);
    await captureExport(scopeOf(100), { scale: 1, themeName: 'light' });
    expect(vi.mocked(startBrowserHost)).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      'main',
      expect.objectContaining({ platform: 'offscreen platform', backend: 'webgl2' }),
    );
    expect(host.isDestroyed).toBe(true);
  });
});

describe('captureExportAreas', () => {
  it('draws each area through one host, sending the objects once, one image per area', async () => {
    const host = new TileHost();
    let starts = 0;
    const images = await captureExportAreas(
      scopeOf(1000),
      [
        { x: 0, y: 0, width: 20, height: 10 },
        { x: 300, y: 0, width: 40, height: 5 },
      ],
      {
        scale: 2,
        themeName: 'light',
        startHost: () => {
          starts += 1;
          return Promise.resolve(host as unknown as EngineHost);
        },
      },
    );
    expect(starts).toBe(1);
    expect(images.map(({ widthPx, heightPx }) => [widthPx, heightPx])).toEqual([
      [40, 20],
      [80, 10],
    ]);
    // Each drawn from its own left edge: shade x / 100.
    expect(images.map(({ rgba }) => rgba[0])).toEqual([0, 3]);
    expect(images.every(({ isComplete }) => isComplete)).toBe(true);
    expect(host.calls.filter((call) => call.startsWith('resize'))).toEqual([
      'resize 40×20 @1',
      'resize 80×10 @1',
    ]);
    expect(host.isDestroyed).toBe(true);
  });

  it('hands each image over as drawn, before drawing the next, and keeps none', async () => {
    const host = new TileHost();
    const taken: string[] = [];
    const images = await captureExportAreas(
      scopeOf(1000),
      [
        { x: 0, y: 0, width: 20, height: 10 },
        { x: 300, y: 0, width: 40, height: 5 },
      ],
      {
        scale: 1,
        themeName: 'light',
        startHost: starting(host),
        onImage: (image, index) => {
          taken.push(
            `${String(index)}: ${String(image.widthPx)} after ${String(host.calls.length)}`,
          );
          return Promise.resolve();
        },
      },
    );
    expect(images).toEqual([]);
    // The first is taken before the second area's resize.
    expect(taken).toEqual(['0: 20 after 3', '1: 40 after 4']);
    expect(host.isDestroyed).toBe(true);
  });

  it('refuses an area over the capture limits before starting a host', async () => {
    const startHost = vi.fn();
    await expect(
      captureExportAreas(scopeOf(10), [{ x: 0, y: 0, width: 20_000, height: 10 }], {
        scale: 1,
        themeName: 'light',
        startHost,
      }),
    ).rejects.toThrow(RangeError);
    expect(startHost).not.toHaveBeenCalled();
  });
});
