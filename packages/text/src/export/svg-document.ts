// A standalone SVG document around exported fragments. It uses SVG 2 features (a
// radial gradient's focal radius `fr`), so it declares no 1.1 version. Pure.

/** What {@link svgDocument} wraps. */
export interface SvgDocumentOptions {
  /** The document's width, in user units. */
  readonly width: number;
  /** Its height. */
  readonly height: number;
  /** The user-space box shown: x, y, width, height; `0 0 width height` when absent. */
  readonly viewBox?: readonly [number, number, number, number];
  /** The content, e.g. `textSvg` fragments. */
  readonly body: string;
}

/**
 * An SVG document holding the body, with the SVG and XLink namespaces (no `version`: the
 * fragments use SVG 2's radial `fr`).
 *
 * @param options - Its size, view box and body.
 * @returns The document's text.
 */
export function svgDocument(options: SvgDocumentOptions): string {
  const { width, height, body } = options;
  const box = (options.viewBox ?? [0, 0, width, height]).map(String).join(' ');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${String(width)}" height="${String(height)}" viewBox="${box}">`,
    body,
    '</svg>',
    '',
  ].join('\n');
}
