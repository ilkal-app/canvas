import { ensurePageFont, pageFontLoader } from './page-fonts.js';

const PREVIEWS = new Map<string, Promise<void>>();

/**
 * Loads a requested family preview from bundled or self-hosted bytes. Reopening a failed
 * preview retries it; successful previews remain shared for the page lifetime.
 *
 * @param family - The visible preview's family.
 * @returns Settles when preview bytes are available; failures leave the UI fallback.
 */
export function prepareFontPreview(family: string): Promise<void> {
  let preview = PREVIEWS.get(family);
  if (preview !== undefined) return preview;
  preview = ensurePageFont(family, true)
    .then(async (isReady) => {
      if (!isReady || typeof FontFace === 'undefined') {
        PREVIEWS.delete(family);
        return;
      }
      const face = pageFontLoader().fonts.resolve({ family, weight: 400, isItalic: false });
      if (face === undefined) {
        PREVIEWS.delete(family);
        return;
      }
      const browserFace = new FontFace(JSON.stringify(`Canvas preview ${family}`), face.bytes);
      await browserFace.load();
      document.fonts.add(browserFace);
    })
    .catch(() => {
      PREVIEWS.delete(family);
    });
  PREVIEWS.set(family, preview);
  return preview;
}
