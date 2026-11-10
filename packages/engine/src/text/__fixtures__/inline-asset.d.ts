// Vite's `?inline` imports, which the test fixtures use to read the bundled fonts without Node's
// file system (the engine core compiles without Node or DOM types): the file as a base64 data URL.
declare module '*?inline' {
  const dataUrl: string;
  // eslint-disable-next-line import-x/no-default-export -- Vite's ?inline modules export their data URL as the default
  export default dataUrl;
}
