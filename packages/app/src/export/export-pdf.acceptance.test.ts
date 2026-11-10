// Written before the export code. CONTRACT: PDF export captures sections or
// the whole scope, composes raster pages, saves once and reports the PNG export notices.
// Deliberately not asserted: canvas rendering details or PDF object numbering.
// @vitest-environment jsdom
import { deflateSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId, PageId } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';

const { exportBoardPdf } = await vi.importActual<{
  exportBoardPdf: (
    exporter: BoardExporter,
    dependencies?: {
      captureAreas?: (
        scope: unknown,
        rects: readonly { x: number; y: number; width: number; height: number }[],
        options: { scale: number },
      ) => Promise<
        readonly { widthPx: number; heightPx: number; rgba: Uint8Array; isComplete: boolean }[]
      >;
      deflate?: (bytes: Uint8Array) => Promise<Uint8Array>;
      save?: (file: Blob, name: string) => void;
    },
  ) => Promise<void>;
}>('./export-pdf.js');
import {
  EXPORT_EMPTY_MESSAGE,
  EXPORT_FAILED_MESSAGE,
  EXPORT_INCOMPLETE_MESSAGE,
  EXPORT_TOO_LARGE_MESSAGE,
  type BoardExporter,
} from './run-export.js';

const PAGE = 'page-1' as PageId;
const id = (value: string): ObjectId => value as ObjectId;

function rectangle(key: string, x: number, y: number, width: number, height: number): BoardObject {
  return {
    id: id(key),
    type: 'shape',
    kind: 'rectangle',
    parentId: null,
    pageId: PAGE,
    x,
    y,
    width,
    height,
    rotation: 0,
  } as unknown as BoardObject;
}

function frame(key: string, x: number, y: number, width: number, height: number): BoardObject {
  return {
    ...rectangle(key, x, y, width, height),
    type: 'frame',
    name: key,
    clip: false,
    background: null,
  } as BoardObject;
}

function engineOf(
  objects: readonly BoardObject[],
  selectedIds: readonly ObjectId[] = [],
): MountedEngine {
  const board = { objects: new Map(objects.map((object) => [object.id, object])) };
  return {
    board: {
      state: () => ({ selectedIds }),
      board: { read: () => board },
      tokens: () => new Map(),
    },
    pages: { current: () => PAGE },
  } as unknown as MountedEngine;
}

function exporterOf(engine: MountedEngine | undefined) {
  const notices: string[] = [];
  const exporter: BoardExporter = {
    engine,
    images: undefined,
    title: 'Plan',
    themeName: 'light',
    notify: (message) => notices.push(message),
  };
  return { exporter, notices };
}

function captureSpy(isComplete = true) {
  return vi.fn(
    (
      scope: unknown,
      rects: readonly { width: number; height: number }[],
      options: { scale: number },
    ) => {
      return Promise.resolve(
        rects.map((rect) => {
          const widthPx = Math.ceil(rect.width * options.scale);
          const heightPx = Math.ceil(rect.height * options.scale);
          const rgba = new Uint8Array(widthPx * heightPx * 4);
          for (let offset = 0; offset < rgba.length; offset += 4) {
            rgba[offset] = 255;
            rgba[offset + 3] = 255;
          }
          return { widthPx, heightPx, rgba, isComplete };
        }),
      );
    },
  );
}

async function savedPdf(save: ReturnType<typeof vi.fn>) {
  expect(save).toHaveBeenCalledOnce();
  const [blob, name] = save.mock.calls[0] as [Blob, string];
  expect(blob.type).toBe('application/pdf');
  return { pdf: Buffer.from(await blob.arrayBuffer()).toString('latin1'), name };
}

function pageFacts(pdf: string) {
  const objects = [...pdf.matchAll(/(?:^|\n)(\d+) 0 obj\r?\n([\s\S]*?)\r?\nendobj/g)].map(
    (match) => [Number(match[1]), match[2] ?? ''] as const,
  );
  const byId = new Map(objects);
  const tree = objects.find(([, body]) => /\/Type\s+\/Pages\b/.test(body))?.[1] ?? '';
  const ids = [...(/\/Kids\s*\[([^\]]+)\]/.exec(tree)?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map(
    (match) => Number(match[1]),
  );
  return ids.map((pageId) => {
    const page = byId.get(pageId) ?? '';
    const media = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(page);
    const imageId = Number(/\/Im0\s+(\d+) 0 R/.exec(page)?.[1]);
    const image = byId.get(imageId) ?? '';
    return {
      widthPt: Number(media?.[1]),
      heightPt: Number(media?.[2]),
      widthPx: Number(/\/Width\s+(\d+)/.exec(image)?.[1]),
      heightPx: Number(/\/Height\s+(\d+)/.exec(image)?.[1]),
    };
  });
}

describe('exportBoardPdf', () => {
  it('makes two 2× pages in reading order and saves one PDF without a scale suffix', async () => {
    const { exporter, notices } = exporterOf(
      engineOf([
        frame('B', 100, 400, 200, 150),
        frame('A', 100, 100, 300, 200),
        rectangle('outside', 800, 800, 50, 50),
      ]),
    );
    const captureAreas = captureSpy();
    const save = vi.fn();
    await exportBoardPdf(exporter, {
      captureAreas,
      deflate: (bytes) => Promise.resolve(deflateSync(bytes)),
      save,
    });
    const captured = captureAreas.mock.calls.flatMap(([, rects, options]) =>
      rects.map((rect) => ({ rect, scale: options.scale })),
    );
    expect(captured).toEqual([
      { rect: { x: 100, y: 100, width: 300, height: 200 }, scale: 2 },
      { rect: { x: 100, y: 400, width: 200, height: 150 }, scale: 2 },
    ]);
    const { pdf, name } = await savedPdf(save);
    expect(name).toBe('Plan.pdf');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pageFacts(pdf)).toEqual([
      { widthPt: 225, heightPt: 150, widthPx: 600, heightPx: 400 },
      { widthPt: 150, heightPt: 112.5, widthPx: 400, heightPx: 300 },
    ]);
    expect(notices).toEqual([]);
  });

  it('makes one page for a frameless selection and uses its selection filename', async () => {
    const engine = engineOf(
      [rectangle('a', 20, 30, 100, 50), rectangle('b', 200, 100, 40, 30)],
      [id('a'), id('b')],
    );
    const { exporter } = exporterOf(engine);
    const captureAreas = captureSpy();
    const save = vi.fn();
    await exportBoardPdf(exporter, {
      captureAreas,
      deflate: (bytes) => Promise.resolve(deflateSync(bytes)),
      save,
    });
    expect(captureAreas).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'selection' }),
      [{ x: 20, y: 30, width: 220, height: 100 }],
      expect.objectContaining({ scale: 2 }),
    );
    const { pdf, name } = await savedPdf(save);
    expect(name).toBe('Plan (selection).pdf');
    expect(pageFacts(pdf)).toEqual([{ widthPt: 165, heightPt: 75, widthPx: 440, heightPx: 200 }]);
  });

  it('uses 1× when 2× does not fit, and caps the page size at 14400 pt', async () => {
    const { exporter } = exporterOf(engineOf([rectangle('wide', 0, 0, 10_000, 10)]));
    const captureAreas = captureSpy();
    const save = vi.fn();
    await exportBoardPdf(exporter, {
      captureAreas,
      deflate: (bytes) => Promise.resolve(deflateSync(bytes)),
      save,
    });
    expect(
      captureAreas.mock.calls.flatMap(([, rects, options]) => rects.map(() => options.scale)),
    ).toEqual([1]);
    expect(pageFacts((await savedPdf(save)).pdf)).toEqual([
      { widthPt: 7500, heightPt: 7.5, widthPx: 10_000, heightPx: 10 },
    ]);
  });

  it('chooses the capture scale for each section independently', async () => {
    const { exporter } = exporterOf(
      engineOf([frame('wide', 0, 400, 10_000, 10), frame('small', 0, 0, 100, 50)]),
    );
    const captureAreas = captureSpy();
    const save = vi.fn();
    await exportBoardPdf(exporter, {
      captureAreas,
      deflate: (bytes) => Promise.resolve(deflateSync(bytes)),
      save,
    });
    const captured = captureAreas.mock.calls.flatMap(([, rects, options]) =>
      rects.map((rect) => ({ width: rect.width, scale: options.scale })),
    );
    expect(captured).toHaveLength(2);
    expect(captured).toContainEqual({ width: 100, scale: 2 });
    expect(captured).toContainEqual({ width: 10_000, scale: 1 });
    expect(pageFacts((await savedPdf(save)).pdf)).toEqual([
      { widthPt: 75, heightPt: 37.5, widthPx: 200, heightPx: 100 },
      { widthPt: 7500, heightPt: 7.5, widthPx: 10_000, heightPx: 10 },
    ]);
  });

  it('reports empty and oversized scopes without saving', async () => {
    const save = vi.fn();
    const absent = exporterOf(undefined);
    await exportBoardPdf(absent.exporter, { save });
    expect(absent.notices).toEqual([EXPORT_EMPTY_MESSAGE]);
    const empty = exporterOf(engineOf([]));
    await exportBoardPdf(empty.exporter, { save });
    expect(empty.notices).toEqual([EXPORT_EMPTY_MESSAGE]);
    const huge = exporterOf(engineOf([rectangle('huge', 0, 0, 20_000, 10)]));
    await exportBoardPdf(huge.exporter, { save });
    expect(huge.notices).toEqual([EXPORT_TOO_LARGE_MESSAGE]);
    expect(save).not.toHaveBeenCalled();
  });

  it('saves an incomplete capture with a notice, and reports a thrown capture as failed', async () => {
    const { exporter, notices } = exporterOf(engineOf([rectangle('a', 0, 0, 30, 20)]));
    const save = vi.fn();
    await exportBoardPdf(exporter, {
      captureAreas: captureSpy(false),
      deflate: (bytes) => Promise.resolve(deflateSync(bytes)),
      save,
    });
    expect(save).toHaveBeenCalledOnce();
    expect(notices).toEqual([EXPORT_INCOMPLETE_MESSAGE]);
    const failed = exporterOf(engineOf([rectangle('a', 0, 0, 30, 20)]));
    await exportBoardPdf(failed.exporter, {
      captureAreas: () => Promise.reject(new Error('capture failed')),
      save,
    });
    expect(failed.notices).toEqual([EXPORT_FAILED_MESSAGE]);
    expect(save).toHaveBeenCalledOnce();
  });
});
