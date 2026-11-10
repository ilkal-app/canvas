// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId, PageId } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';

import {
  downloadFile,
  encodePng,
  EXPORT_EMPTY_MESSAGE,
  EXPORT_FAILED_MESSAGE,
  EXPORT_INCOMPLETE_MESSAGE,
  EXPORT_TOO_LARGE_MESSAGE,
  exportBoardPng,
  exportRequestOf,
  overBackdrop,
  type BoardExporter,
} from './run-export.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const PAGE = 'page-1' as PageId;

/**
 * A root rectangle on the page.
 *
 * @param id - Its id.
 * @param width - Its width.
 * @returns The object.
 */
function rectangle(id: string, width: number): BoardObject {
  return {
    id: id as ObjectId,
    type: 'shape',
    kind: 'rectangle',
    parentId: null,
    pageId: PAGE,
    x: 0,
    y: 0,
    width,
    height: 10,
    rotation: 0,
  } as unknown as BoardObject;
}

/**
 * An engine over a board.
 *
 * @param objects - The board's objects.
 * @param selectedIds - The selection.
 * @returns The engine, as far as the export reads it.
 */
function engineOf(objects: readonly BoardObject[], selectedIds: readonly string[] = []) {
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

/**
 * The shell's exporter over an engine, its notices recorded.
 *
 * @param engine - The engine, if mounted.
 * @returns The exporter and what it was told.
 */
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

describe('exportRequestOf', () => {
  it('asks for the selection when something is selected, else the page shown', () => {
    expect(exportRequestOf(undefined)).toBeUndefined();
    expect(exportRequestOf(engineOf([], ['a']))).toEqual({ kind: 'selection', ids: ['a'] });
    expect(exportRequestOf(engineOf([]))).toEqual({ kind: 'page', pageId: PAGE });
  });
});

describe('exportBoardPng', () => {
  it('draws, encodes and saves the page under its name and scale', async () => {
    const { exporter, notices } = exporterOf(engineOf([rectangle('a', 100)]));
    const pixels = {
      widthPx: 200,
      heightPx: 20,
      rgba: new Uint8Array(200 * 20 * 4),
      isComplete: true,
    };
    const capture = vi.fn(() => Promise.resolve(pixels));
    const file = new Blob(['png']);
    const encode = vi.fn(() => Promise.resolve(file));
    const save = vi.fn();
    await exportBoardPng(exporter, 2, { capture, encode, save });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'board', rect: { x: 0, y: 0, width: 100, height: 10 } }),
      expect.objectContaining({ scale: 2, themeName: 'light' }),
    );
    expect(encode).toHaveBeenCalledWith(pixels, expect.any(Array));
    expect(save).toHaveBeenCalledWith(file, 'Plan@2x.png');
    expect(notices).toEqual([]);
  });

  it('draws at 1× when 2× is too large, and says so when even 1× is', async () => {
    const save = vi.fn();
    const capture = vi.fn(() =>
      Promise.resolve({ widthPx: 1, heightPx: 1, rgba: new Uint8Array(4), isComplete: true }),
    );
    const encode = () => Promise.resolve(new Blob());
    const wide = exporterOf(engineOf([rectangle('a', 10_000)]));
    await exportBoardPng(wide.exporter, 2, { capture, encode, save });
    expect(capture).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scale: 1 }));
    expect(save).toHaveBeenCalledWith(expect.anything(), 'Plan.png');
    const huge = exporterOf(engineOf([rectangle('a', 20_000)]));
    await exportBoardPng(huge.exporter, 1, { capture, encode, save });
    expect(huge.notices).toEqual([EXPORT_TOO_LARGE_MESSAGE]);
  });

  it('reads the whole board across pages where the view has it apart, and nothing without', async () => {
    const engine = engineOf([rectangle('a', 100)]);
    const whole = { read: () => ({ objects: new Map([['a', rectangle('a', 40)]]) }) };
    Object.assign(engine.board, { definitions: whole });
    const capture = vi.fn(() =>
      Promise.resolve({ widthPx: 1, heightPx: 1, rgba: new Uint8Array(4), isComplete: true }),
    );
    const { exporter } = exporterOf(engine);
    await exportBoardPng(exporter, 1, {
      capture,
      encode: () => Promise.resolve(new Blob()),
      save: () => undefined,
    });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ rect: { x: 0, y: 0, width: 40, height: 10 } }),
      expect.anything(),
    );
    Object.assign(engine.board, { definitions: {} });
    const unreadable = exporterOf(engine);
    await exportBoardPng(unreadable.exporter, 1);
    expect(unreadable.notices).toEqual([EXPORT_EMPTY_MESSAGE]);
  });

  it('saves an export whose images had not all loaded, and says so', async () => {
    const { exporter, notices } = exporterOf(engineOf([rectangle('a', 100)]));
    const save = vi.fn();
    await exportBoardPng(exporter, 1, {
      capture: () =>
        Promise.resolve({ widthPx: 1, heightPx: 1, rgba: new Uint8Array(4), isComplete: false }),
      encode: () => Promise.resolve(new Blob()),
      save,
    });
    expect(save).toHaveBeenCalledOnce();
    expect(notices).toEqual([EXPORT_INCOMPLETE_MESSAGE]);
  });

  it('says why nothing was exported, or that it failed', async () => {
    const unmounted = exporterOf(undefined);
    await exportBoardPng(unmounted.exporter, 1);
    expect(unmounted.notices).toEqual([EXPORT_EMPTY_MESSAGE]);
    const empty = exporterOf(engineOf([]));
    await exportBoardPng(empty.exporter, 1);
    expect(empty.notices).toEqual([EXPORT_EMPTY_MESSAGE]);
    const failing = exporterOf(engineOf([rectangle('a', 100)]));
    await exportBoardPng(failing.exporter, 1, {
      capture: () => Promise.reject(new Error('lost')),
    });
    expect(failing.notices).toEqual([EXPORT_FAILED_MESSAGE]);
  });
});

describe('overBackdrop', () => {
  it('composes the premultiplied image over the backdrop, opaque', () => {
    const rgba = new Uint8Array([128, 0, 0, 128, 0, 0, 0, 0]);
    const out = overBackdrop({ widthPx: 2, heightPx: 1, rgba }, [0, 0, 1, 1]);
    expect([...out]).toEqual([128, 0, 127, 255, 0, 0, 255, 255]);
  });
});

describe('encodePng and downloadFile', () => {
  it('refuses without a 2D canvas, and downloads a file under its name', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(
      encodePng({ widthPx: 1, heightPx: 1, rgba: new Uint8Array(4) }, [1, 1, 1, 1]),
    ).rejects.toThrow('No 2D canvas');
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => 'blob:export');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    vi.useFakeTimers();
    downloadFile(new Blob(['png']), 'Plan.png');
    expect(click).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
    vi.useRealTimers();
  });

  it('encodes through the canvas, and rejects when the browser gives no file', async () => {
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData,
    } as unknown as CanvasRenderingContext2D);
    const file = new Blob(['png']);
    let next: Blob | null = file;
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(next);
    });
    Object.assign(globalThis, {
      ImageData: class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    });
    const pixels = { widthPx: 1, heightPx: 1, rgba: new Uint8Array([0, 0, 0, 0]) };
    await expect(encodePng(pixels, [1, 1, 1, 1])).resolves.toBe(file);
    expect(putImageData).toHaveBeenCalledOnce();
    next = null;
    await expect(encodePng(pixels, [1, 1, 1, 1])).rejects.toThrow('could not encode');
  });
});
