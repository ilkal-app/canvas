// The local font check worker: reads each font file it is sent as the page would,
// off the page's thread, and answers whether it read (local-font-check.ts starts it; Vite bundles
// it from the `new URL` there).
import { checkFontBytes, type FontCheckAnswer, type FontCheckRequest } from './local-font-check.js';

self.onmessage = (event: MessageEvent<FontCheckRequest>) => {
  const { id, bytes } = event.data;
  void checkFontBytes(bytes).then((check) => {
    self.postMessage({ id, ...check } satisfies FontCheckAnswer);
  });
};
