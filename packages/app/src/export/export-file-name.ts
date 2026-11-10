/** Characters a file name cannot hold on some system: path and shell separators, quotes. */
const UNSAFE = /[/\\:*?"<>|]/g;

/** C0 control characters and DEL, written as a range so the source holds none of them. */
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * The name an export downloads as: the board's title (each character a file system
 * refuses, and each control character, replaced by `-`; `Board` when nothing is left), then
 * ` (selection)` for a selection, `@<scale>x` for a scale other than 1, and the format. Pure.
 *
 * @param title - The board's title.
 * @param kind - Whether the page or a selection is exported.
 * @param format - The file's format.
 * @param scale - Device px per board unit; 1 if absent.
 * @returns The file name.
 */
export function exportFileName(
  title: string,
  kind: 'board' | 'selection',
  format: 'png' | 'pdf',
  scale = 1,
): string {
  const base = title.trim().replace(UNSAFE, '-').replace(CONTROL, '-') || 'Board';
  const selection = kind === 'selection' ? ' (selection)' : '';
  const scaled = scale === 1 ? '' : `@${String(scale)}x`;
  return `${base}${selection}${scaled}.${format}`;
}
