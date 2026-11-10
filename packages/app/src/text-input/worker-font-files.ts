import { fontFaceId, type FontFaceKey, type FontLibrary } from '@canvas/engine';

import { FONT_FACE_SOURCES } from './font-catalogue.js';

/** The `type` of the page's message that hands the engine worker its font files. */
export const FONT_FILES_MESSAGE_TYPE = 'canvas-font-files';

/** One font file the page loaded: the face it was loaded as and its bytes. */
export interface FontFile extends FontFaceKey {
  /** The TrueType file. */
  readonly bytes: ArrayBuffer;
}

/**
 * The page's message to the engine worker with the font files it fetched, so each file
 * is downloaded once per page and the worker never fetches: the engine protocol's messages pass
 * the worker by (`withFontFiles`).
 */
export interface FontFilesMessage {
  /** {@link FONT_FILES_MESSAGE_TYPE}. */
  readonly type: typeof FONT_FILES_MESSAGE_TYPE;
  /** The files, the default face first, as the page's library holds them. */
  readonly files: readonly FontFile[];
}

/**
 * Whether a message to the engine worker is the page's font files.
 *
 * @param data - The message.
 * @returns True for a well-formed {@link FontFilesMessage}.
 */
export function isFontFilesMessage(data: unknown): data is FontFilesMessage {
  if (typeof data !== 'object' || data === null) return false;
  const { type, files } = data as Partial<FontFilesMessage>;
  return (
    type === FONT_FILES_MESSAGE_TYPE &&
    Array.isArray(files) &&
    files.every(
      (file: Partial<FontFile> | null) =>
        typeof file === 'object' &&
        file !== null &&
        typeof file.family === 'string' &&
        typeof file.weight === 'number' &&
        typeof file.isItalic === 'boolean' &&
        (file.postScriptName === undefined || typeof file.postScriptName === 'string') &&
        file.bytes instanceof ArrayBuffer,
    )
  );
}

/**
 * Sends a loaded library's font files to the engine worker, in the library's order (the first
 * is the default face on both threads). Each file is a copy of the library's bytes, transferred,
 * so the page keeps its own and the copy is not cloned again. Page only.
 *
 * @param worker - The engine worker.
 * @param fonts - The page's library, loaded.
 * @param sent - Face generations already sent to this worker.
 */
export function postFontFiles(
  worker: Pick<Worker, 'postMessage'>,
  fonts: Pick<FontLibrary, 'faces' | 'get'>,
  sent = new Map<string, string>(),
): void {
  const files = fonts.faces.flatMap((face): FontFile[] => {
    const loaded = fonts.get(fontFaceId(face));
    if (loaded === undefined || sent.get(loaded.faceId) === loaded.fontKey) return [];
    sent.set(loaded.faceId, loaded.fontKey);
    const { family, weight, isItalic, postScriptName } = face;
    // A named face keeps its name, so the worker files it under the same id.
    const name = postScriptName === undefined ? {} : { postScriptName };
    return [{ family, weight, isItalic, ...name, bytes: loaded.bytes }];
  });
  if (files.length === 0) return;
  const message: FontFilesMessage = { type: FONT_FILES_MESSAGE_TYPE, files };
  worker.postMessage(
    message,
    files.map(({ bytes }) => bytes),
  );
}

/** The worker side of a message handler, as `serveWorkerEntry` takes it. */
export interface FontFilesEntry<TPost> {
  /** Handles one message. */
  onMessage(data: unknown, post: TPost): Promise<void>;
  /** Handles a message that could not be deserialised. */
  onMessageError(post: TPost): void;
}

/**
 * Puts the page's font files into the engine worker's library, and passes every other message
 * to the engine's worker entry. Faces added after the text pass starts are laid out with when
 * they land. Engine worker.
 *
 * @param entry - The engine's worker entry.
 * @param fonts - The library the text pass draws with.
 * @param onError - Receives a file that did not parse; it is left out.
 * @returns The entry to serve.
 */
export function withFontFiles<TPost>(
  entry: FontFilesEntry<TPost>,
  fonts: Pick<FontLibrary, 'addFace' | 'prepareContentIdentity' | 'faces'>,
  onError: (error: unknown) => void,
): FontFilesEntry<TPost> {
  return {
    onMessage(data, post) {
      if (!isFontFilesMessage(data)) return entry.onMessage(data, post);
      for (const { family, weight, isItalic, postScriptName, bytes } of data.files) {
        try {
          const name = postScriptName === undefined ? {} : { postScriptName };
          fonts.addFace({ family, weight, isItalic, ...name }, bytes);
        } catch (error) {
          onError(error);
        }
      }
      const expected = new Map(
        [...FONT_FACE_SOURCES, ...fonts.faces, ...data.files].map((face) => [
          fontFaceId(face),
          face,
        ]),
      );
      return fonts.prepareContentIdentity([...expected.values()]).then(() => undefined);
    },
    onMessageError(post) {
      entry.onMessageError(post);
    },
  };
}
