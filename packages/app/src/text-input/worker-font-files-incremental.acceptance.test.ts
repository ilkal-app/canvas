// Acceptance (Claude): a family loaded after startup reaches the engine worker too, as
// one more message carrying only the new faces (every face is sent once, never re-sent), and the
// worker's library then holds the same faces as the page's in the same order with the same
// content identity, so both engine hosts draw the family the page loaded.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FontLibrary } from '@canvas/engine';

import { FONT_FACE_SOURCES, FONT_FAMILIES } from './font-catalogue.js';
import { loadFontLibrary } from './load-font-library.js';
import { postFontFiles, withFontFiles, type FontFilesMessage } from './worker-font-files.js';

/**
 * The family, weight and slant of faces, without the page's own extras (a source URL).
 *
 * @param faces - Face keys as a library lists them.
 * @returns Bare keys.
 */
function keysOf(
  faces: readonly {
    readonly family: string;
    readonly weight: number;
    readonly isItalic: boolean;
  }[],
) {
  return faces.map(({ family, weight, isItalic }) => ({ family, weight, isItalic }));
}

/**
 * Reads a bundled file from disk, as `fetch` would serve it.
 *
 * @param url - Its `file:` URL.
 * @returns The bytes.
 */
function readFile(url: string): Promise<ArrayBuffer> {
  const bytes = readFileSync(fileURLToPath(url));
  return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/**
 * A worker stand-in that keeps what was posted to it.
 *
 * @returns The worker and the posts.
 */
function recordingWorker() {
  const posts: FontFilesMessage[] = [];
  const worker = {
    postMessage: (message: unknown) => {
      posts.push(message as FontFilesMessage);
    },
  } as Pick<Worker, 'postMessage'>;
  return { worker, posts };
}

describe('fonts loaded later reach the engine worker', () => {
  it('sends only the new faces, once, and the worker ends with the page’s faces in the page’s order', async () => {
    const page = loadFontLibrary(FONT_FACE_SOURCES, () => undefined, readFile);
    await page.loaded;
    const { worker, posts } = recordingWorker();
    const sent = new Map<string, string>();
    postFontFiles(worker, page.fonts, sent);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.files).toHaveLength(4);

    // Nothing new: nothing posted.
    postFontFiles(worker, page.fonts, sent);
    expect(posts).toHaveLength(1);

    // Lora lands on the page (as a used family does), then only Lora is posted.
    const lora = FONT_FAMILIES.find((entry) => entry.family === 'Lora');
    if (lora === undefined) throw new Error('Lora is not in the library');
    for (const face of lora.faces) page.fonts.addFace(face, await readFile(face.url));
    await page.fonts.prepareContentIdentity(page.fonts.faces);
    postFontFiles(worker, page.fonts, sent);
    expect(posts).toHaveLength(2);
    expect(keysOf(posts[1]?.files ?? [])).toEqual(keysOf(lora.faces));
    postFontFiles(worker, page.fonts, sent);
    expect(posts).toHaveLength(2);

    // The worker's library grows with each message, fetching nothing.
    const workerFonts = new FontLibrary();
    const served = withFontFiles(
      {
        onMessage: () => Promise.reject(new Error('not a font message')),
        onMessageError: () => undefined,
      },
      workerFonts,
      (error) => {
        throw error;
      },
    );
    await served.onMessage(posts[0], 'post');
    expect(keysOf(workerFonts.faces)).toEqual(keysOf(page.fonts.faces.slice(0, 4)));
    await served.onMessage(posts[1], 'post');
    expect(keysOf(workerFonts.faces)).toEqual(keysOf(page.fonts.faces));
    expect(workerFonts.faces[0]).toEqual({
      family: 'Liberation Sans',
      weight: 400,
      isItalic: false,
    });
    expect(workerFonts.contentIdentity).toMatch(/^font-set:v1:/);
    expect(workerFonts.contentIdentity).toBe(page.fonts.contentIdentity);
    expect(
      workerFonts.resolve({ family: 'Lora', weight: 700, isItalic: true })?.face,
    ).toMatchObject({ family: 'Lora', weight: 700, isItalic: true });
  });
});
