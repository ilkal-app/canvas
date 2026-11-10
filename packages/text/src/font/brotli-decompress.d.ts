// brotli 1.3.3's decoder (a hand port of the reference decoder to JavaScript, MIT), which ships no
// types. Only its decompress entry is imported, lazily, by web-font.ts.
declare module 'brotli/decompress.js' {
  /**
   * Decodes a brotli stream.
   *
   * @param buffer - The compressed stream.
   * @param outputSize - The size of the output buffer; decoding past it throws.
   * @returns The decoded bytes, cut to what was written.
   */
  function decompress(buffer: Uint8Array, outputSize?: number): Uint8Array;
  export = decompress;
}
