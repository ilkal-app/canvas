import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FontLibrary, fontFaceId } from '@canvas/engine';

import { postFontFiles, withFontFiles, type FontFilesMessage } from './worker-font-files.js';

const plain = { family: 'Private Sans', weight: 400, isItalic: false } as const;
const named = { ...plain, postScriptName: 'PrivateSans-Condensed' };

/**
 * Reads bundled TrueType bytes for page and worker libraries.
 *
 * @param file - Fixture filename.
 * @returns The file bytes.
 */
function bytesOf(file: string): ArrayBuffer {
  const bytes = readFileSync(new URL(`../../../engine/assets/fonts/${file}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe('worker named font transport', () => {
  it('posts and installs a named face under its distinct id', async () => {
    const page = new FontLibrary();
    page.addFace(plain, bytesOf('LiberationSans-Regular.ttf'));
    page.addFace(named, bytesOf('LiberationSans-Bold.ttf'));
    const messages: FontFilesMessage[] = [];
    const worker = {
      postMessage: (data: unknown) => messages.push(data as FontFilesMessage),
    } as Pick<Worker, 'postMessage'>;
    postFontFiles(worker, page);
    expect(messages).toHaveLength(1);
    expect(
      messages[0]?.files.map(
        (file) => (file as typeof file & { readonly postScriptName?: string }).postScriptName,
      ),
    ).toEqual([undefined, named.postScriptName]);

    const received = new FontLibrary();
    const served = withFontFiles(
      {
        onMessage: () => Promise.reject(new Error('Unexpected message')),
        onMessageError: () => undefined,
      },
      received,
      (error) => {
        throw error;
      },
    );
    await served.onMessage(messages[0], undefined);
    expect(received.faces).toEqual([plain, named]);
    expect(received.get(fontFaceId(named))?.face).toEqual(named);
    expect(received.resolve(named)?.face).toEqual(named);
  });
});
