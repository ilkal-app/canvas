import {
  HTML_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPE,
  type ClipboardFlavours,
} from './clipboard-formats.js';
import type { PasteItem } from './paste-handlers.js';

/**
 * The system clipboard outside clipboard events: for copy, cut and paste asked for by a button
 * or a menu rather than the native shortcuts, which arrive as clipboard events instead.
 */
export interface ClipboardAccess {
  /**
   * Writes a copy's flavours.
   *
   * @param flavours - The flavours by MIME type.
   * @returns Settles when written; rejects when the page may not write.
   */
  write(flavours: ClipboardFlavours): Promise<void>;
  /**
   * Reads what a paste can take.
   *
   * @returns The items; rejects when the page may not read.
   */
  read(): Promise<PasteItem[]>;
}

/** The standard types the async Clipboard API carries; the objects ride inside the HTML. */
const WRITTEN_TYPES = [PLAIN_TEXT_MIME_TYPE, HTML_MIME_TYPE] as const;

/**
 * The async Clipboard API as a {@link ClipboardAccess}. It carries only standard types, so a
 * copy writes plain text and HTML, whose root element embeds the objects flavour
 * (`data-canvas-objects`); a paste reads text flavours as strings and images as files. The
 * browser asks the person for permission where it must.
 *
 * @param clipboard - The clipboard; `navigator.clipboard` if absent.
 * @returns The access.
 */
export function createBrowserClipboardAccess(
  clipboard: Clipboard = navigator.clipboard,
): ClipboardAccess {
  return {
    async write(flavours) {
      const parts = WRITTEN_TYPES.flatMap((type) => {
        const data = flavours.get(type);
        return data === undefined ? [] : [[type, new Blob([data], { type })] as const];
      });
      await clipboard.write([new ClipboardItem(Object.fromEntries(parts))]);
    },
    async read() {
      const items = await clipboard.read();
      const reads = items.flatMap((item) =>
        item.types.map(async (type): Promise<PasteItem> => {
          const blob = await item.getType(type);
          return type.startsWith('image/')
            ? { kind: 'file', type, file: new File([blob], 'pasted-image', { type }) }
            : { kind: 'string', type, data: await blob.text() };
        }),
      );
      return Promise.all(reads);
    },
  };
}
