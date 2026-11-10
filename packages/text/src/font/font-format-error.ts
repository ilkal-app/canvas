/**
 * Thrown when font bytes cannot be read: a truncated file, an unsupported format (a collection,
 * a table version the parser does not know) or a required table that is missing. The message
 * names what was wrong, so a caller can report which face failed to load.
 */
export class FontFormatError extends Error {
  /**
   * Creates the error.
   *
   * @param message - What is wrong with the font, naming the table when there is one.
   */
  constructor(message: string) {
    super(message);
    this.name = 'FontFormatError';
  }
}
