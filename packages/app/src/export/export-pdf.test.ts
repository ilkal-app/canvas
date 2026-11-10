import { deflateSync, inflateSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId, PageId } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';

import { deflateBytes, exportBoardPdf, rgbOverBackdrop } from './export-pdf.js';

describe('rgbOverBackdrop', () => {
  it('composes premultiplied pixels over the backdrop and drops the alpha', () => {
    // Opaque red, half-covered green (premultiplied), and clear.
    const rgba = Uint8Array.from([255, 0, 0, 255, 0, 128, 0, 128, 0, 0, 0, 0]);
    const rgb = rgbOverBackdrop({ widthPx: 3, heightPx: 1, rgba }, [0, 0, 1, 1]);
    expect([...rgb]).toEqual([255, 0, 0, 0, 128, 127, 0, 0, 255]);
  });
});

describe('deflateBytes', () => {
  it('writes a zlib stream that inflates back to the bytes', async () => {
    const bytes = Uint8Array.from({ length: 300 }, (...[, index]) => index % 7);
    const deflated = await deflateBytes(bytes);
    expect(deflated[0]).toBe(0x78);
    expect([...inflateSync(deflated)]).toEqual([...bytes]);
  });
});

describe('exportBoardPdf', () => {
  it('deflates each page as it is drawn, before the next page is drawn', async () => {
    const pageId = 'page-1' as PageId;
    const frame = (key: string, y: number) =>
      ({
        id: key as ObjectId,
        type: 'frame',
        parentId: null,
        pageId,
        x: 0,
        y,
        width: 10,
        height: 5,
        rotation: 0,
        name: key,
        clip: false,
        background: null,
      }) as unknown as BoardObject;
    const objects = [frame('a', 0), frame('b', 100)];
    const board = { objects: new Map(objects.map((object) => [object.id, object])) };
    const engine = {
      board: {
        state: () => ({ selectedIds: [] }),
        board: { read: () => board },
        tokens: () => undefined,
      },
      pages: { current: () => pageId },
    } as unknown as MountedEngine;
    const steps: string[] = [];
    const save = vi.fn();
    await exportBoardPdf(
      { engine, images: undefined, title: 'Plan', themeName: 'light', notify: vi.fn() },
      {
        captureAreas: async (...[, rects, options]) => {
          for (const [index, rect] of rects.entries()) {
            steps.push(`draw ${String(rect.y)}`);
            const widthPx = rect.width * options.scale;
            const heightPx = rect.height * options.scale;
            const rgba = new Uint8Array(widthPx * heightPx * 4).fill(255);
            await options.onImage?.({ widthPx, heightPx, rgba, isComplete: true }, index);
          }
          return [];
        },
        deflate: (bytes) => {
          steps.push(`deflate ${String(bytes.length)}`);
          return Promise.resolve(deflateSync(bytes));
        },
        save,
      },
    );
    expect(steps).toEqual(['draw 0', 'deflate 600', 'draw 100', 'deflate 600']);
    expect(save).toHaveBeenCalledOnce();
    const [file] = save.mock.calls[0] as [Blob];
    const pdf = Buffer.from(await file.arrayBuffer()).toString('latin1');
    expect(pdf.match(/\/Type \/Page /g)).toHaveLength(2);
  });
});
