import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { fontFaceId, FontLibrary } from '@canvas/engine';

import { FONT_FACE_SOURCES } from './font-catalogue.js';
import { loadFontLibrary } from './load-font-library.js';
import {
  FONT_FILES_MESSAGE_TYPE,
  isFontFilesMessage,
  postFontFiles,
  withFontFiles,
  type FontFilesMessage,
} from './worker-font-files.js';

/**
 * Reads a catalogue file from disk, as `fetch` would serve it.
 *
 * @param url - The file's `file:` URL.
 * @returns The bytes.
 */
function readFile(url: string): Promise<ArrayBuffer> {
  const bytes = readFileSync(fileURLToPath(url));
  return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/**
 * The page's library, loaded from disk.
 *
 * @returns The library.
 */
async function pageLibrary(): Promise<FontLibrary> {
  const { fonts, loaded } = loadFontLibrary(FONT_FACE_SOURCES, () => undefined, readFile);
  await loaded;
  return fonts;
}

/**
 * A worker stand-in that keeps what was posted to it.
 *
 * @returns The worker and the posts.
 */
function recordingWorker() {
  const posts: { message: unknown; transfer: readonly Transferable[] }[] = [];
  const worker = {
    postMessage: (message: unknown, transfer: Transferable[]) => {
      posts.push({ message, transfer });
    },
  } as Pick<Worker, 'postMessage'>;
  return { worker, posts };
}

describe('postFontFiles', () => {
  it('posts every face in the library’s order, each file a transferred copy', async () => {
    const fonts = await pageLibrary();
    const { worker, posts } = recordingWorker();
    postFontFiles(worker, fonts);
    expect(posts).toHaveLength(1);
    const message = posts[0]?.message as FontFilesMessage;
    expect(isFontFilesMessage(message)).toBe(true);
    expect(
      message.files.map(({ family, weight, isItalic }) => ({ family, weight, isItalic })),
    ).toEqual(fonts.faces);
    expect(posts[0]?.transfer).toEqual(message.files.map(({ bytes }) => bytes));
    // Copies, not the library's own bytes, so transferring them leaves the page's intact.
    for (const [index, file] of message.files.entries()) {
      const face = fonts.faces[index];
      const own = face && fonts.get(fontFaceId(face))?.bytes;
      expect(file.bytes).not.toBe(own);
      expect(file.bytes.byteLength).toBe(own?.byteLength);
    }
  });

  it('posts nothing for an empty library (every file failed)', () => {
    const { worker, posts } = recordingWorker();
    postFontFiles(worker, new FontLibrary());
    expect(posts).toEqual([]);
  });
});

describe('withFontFiles', () => {
  it('fills the worker’s library from the page’s files, fetching nothing, in the page’s order', async () => {
    const page = await pageLibrary();
    const { worker, posts } = recordingWorker();
    postFontFiles(worker, page);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const entry = { onMessage: vi.fn(() => Promise.resolve()), onMessageError: vi.fn() };
    const fonts = new FontLibrary();
    const served = withFontFiles(entry, fonts, () => undefined);
    await served.onMessage(posts[0]?.message, 'post');
    expect(fonts.faces).toEqual(page.faces);
    expect(page.contentIdentity).toMatch(/^font-set:v1:/);
    expect(fonts.contentIdentity).toBe(page.contentIdentity);
    expect(fetch).not.toHaveBeenCalled();
    expect(entry.onMessage).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('passes every other message, and a message error, to the engine’s entry', async () => {
    const entry = { onMessage: vi.fn(() => Promise.resolve()), onMessageError: vi.fn() };
    const served = withFontFiles(entry, new FontLibrary(), () => undefined);
    const init = { type: 'engine-init' };
    await served.onMessage(init, 'post');
    served.onMessageError('post');
    expect(entry.onMessage).toHaveBeenCalledWith(init, 'post');
    expect(entry.onMessageError).toHaveBeenCalledWith('post');
  });

  it('reports a file that does not parse and keeps the rest', async () => {
    const onError = vi.fn();
    const fonts = new FontLibrary();
    const served = withFontFiles(
      { onMessage: () => Promise.resolve(), onMessageError: () => undefined },
      fonts,
      onError,
    );
    const good = await readFile(FONT_FACE_SOURCES[0]?.url ?? '');
    const message: FontFilesMessage = {
      type: FONT_FILES_MESSAGE_TYPE,
      files: [
        { family: 'Broken', weight: 400, isItalic: false, bytes: new ArrayBuffer(4) },
        { family: 'Liberation Sans', weight: 400, isItalic: false, bytes: good },
      ],
    };
    await served.onMessage(message, 'post');
    expect(onError).toHaveBeenCalledOnce();
    expect(fonts.contentIdentity).toBeUndefined();
    expect(fonts.faces).toEqual([{ family: 'Liberation Sans', weight: 400, isItalic: false }]);
  });
});

describe('isFontFilesMessage', () => {
  it('accepts the page’s message and refuses anything else', () => {
    const file = { family: 'Lora', weight: 700, isItalic: true, bytes: new ArrayBuffer(1) };
    expect(isFontFilesMessage({ type: FONT_FILES_MESSAGE_TYPE, files: [file] })).toBe(true);
    expect(isFontFilesMessage({ type: FONT_FILES_MESSAGE_TYPE, files: [] })).toBe(true);
    expect(isFontFilesMessage(null)).toBe(false);
    expect(isFontFilesMessage({ type: 'engine-init' })).toBe(false);
    expect(isFontFilesMessage({ type: FONT_FILES_MESSAGE_TYPE, files: 'x' })).toBe(false);
    expect(
      isFontFilesMessage({ type: FONT_FILES_MESSAGE_TYPE, files: [{ ...file, bytes: [1] }] }),
    ).toBe(false);
    expect(isFontFilesMessage({ type: FONT_FILES_MESSAGE_TYPE, files: [null] })).toBe(false);
  });
});
